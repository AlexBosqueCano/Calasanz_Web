"""Tests de reglas de negocio: partidos, actas, clasificación, jugadores y apuntes (M10).

Verifica los requisitos de docs/API_CONTRATO.md (§5 y §8):
    - 401 sin sesión y 403 por rol/propiedad (comprobando que la BD no muta).
    - Privacidad de estatura y peso según el rol y vínculo del solicitante.
    - Baja lógica de jugadores (conserva estadísticas históricas y libera dorsal).
    - Cálculo de estadísticas de acta a partir de eventos (minutos por categoría,
      sustituciones, expulsiones por doble amarilla/roja y goles encajados por portero).
    - Atomicidad de PUT /api/partidos/<id>/acta: un error 422 hace rollback y
      mantiene intacta el acta anterior.
    - Traducción del trigger de BD `verificar_goles_portero` a HTTP 422 (nunca 500).
    - Cálculo de clasificación 3-1-0 y desempate con partidos propios y entre rivales.
    - Privacidad de apuntes del entrenador (403 para coordinador y otros entrenadores).
"""
from datetime import date, timedelta
from pathlib import Path
import os

import pytest

os.environ.setdefault("SECRET_KEY", "clave-secreta-de-test-calasanz")

from app import app as flask_app
from comun import get_db_connection, traducir_error_bd

RAIZ = Path(__file__).resolve().parent.parent
SQL_TABLAS = (RAIZ / "PostGres" / "web" / "01_tablas.sql").read_text(encoding="utf-8")
SQL_DATOS = (RAIZ / "PostGres" / "web" / "02_datos.sql").read_text(encoding="utf-8")

# IDs de usuarios definidos en 02_datos.sql
USUARIOS_SEED = {
    "DEV": 1,          # dev_admin (DESARROLLADOR)
    "COORD": 2,        # coord (COORDINADOR)
    "ENTRENADOR": 3,   # mister_juv (ENTRENADOR del equipo 1 - Juvenil A)
    "JUGADOR": 4,      # david9 (JUGADOR vinculado a jugador 1 - David López)
    "ESTANDAR": 5,     # aficionado (ESTANDAR)
}

CSRF_TEST = "token-csrf-fijo-para-tests"


def _reiniciar_bd():
    """Recrea el esquema y los datos semilla antes de cada test."""
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(SQL_TABLAS)
            cur.execute(SQL_DATOS)
    finally:
        conn.close()


class ClienteAutenticado:
    """Wrapper sobre FlaskClient que adjunta automáticamente X-CSRF-Token."""

    def __init__(self, client):
        self._client = client

    def login_como(self, rol_o_id):
        uid = USUARIOS_SEED[rol_o_id] if isinstance(rol_o_id, str) else rol_o_id
        with self._client.session_transaction() as sess:
            sess["user_id"] = uid
            sess["csrf_token"] = CSRF_TEST
        return self

    def logout(self):
        with self._client.session_transaction() as sess:
            sess.clear()
        return self

    def _headers(self, extra=None):
        h = {"X-CSRF-Token": CSRF_TEST}
        if extra:
            h.update(extra)
        return h

    def get(self, url, **kwargs):
        return self._client.get(url, **kwargs)

    def post(self, url, json=None, **kwargs):
        return self._client.post(url, json=json, headers=self._headers(kwargs.pop("headers", None)), **kwargs)

    def put(self, url, json=None, **kwargs):
        return self._client.put(url, json=json, headers=self._headers(kwargs.pop("headers", None)), **kwargs)

    def patch(self, url, json=None, **kwargs):
        return self._client.patch(url, json=json, headers=self._headers(kwargs.pop("headers", None)), **kwargs)

    def delete(self, url, **kwargs):
        return self._client.delete(url, headers=self._headers(kwargs.pop("headers", None)), **kwargs)


@pytest.fixture()
def api():
    flask_app.config["TESTING"] = True
    _reiniciar_bd()
    with flask_app.test_client() as c:
        yield ClienteAutenticado(c)


# ============================================================================
# 1. JUGADORES, PRIVACIDAD DE DATOS FÍSICOS Y BAJA LÓGICA (M4)
# ============================================================================
def test_privacidad_datos_fisicos_jugador(api):
    # Usuario ESTANDAR no ve estatura ni peso de ningún jugador
    api.login_como("ESTANDAR")
    r = api.get("/api/jugadores/1")
    assert r.status_code == 200
    datos = r.get_json()
    assert "estatura" not in datos and "peso" not in datos

    # El JUGADOR 1 (David) ve su propia estatura y peso, pero no los del jugador 2
    api.login_como("JUGADOR")
    r_propio = api.get("/api/jugadores/1").get_json()
    assert r_propio["estatura"] == 1.80 and r_propio["peso"] == 75.0
    r_ajeno = api.get("/api/jugadores/2").get_json()
    assert "estatura" not in r_ajeno and "peso" not in r_ajeno

    # El ENTRENADOR del equipo 1 ve los datos físicos de toda su plantilla
    api.login_como("ENTRENADOR")
    r_mister = api.get("/api/jugadores/2").get_json()
    assert r_mister["estatura"] == 1.85 and r_mister["peso"] == 80.0


def test_baja_logica_jugador_conserva_estadisticas_y_libera_dorsal(api):
    api.login_como("COORD")

    # Damos de baja al jugador 1 (dorsal 9 en equipo 1, tiene 2 goles en el partido 1)
    r_del = api.delete("/api/jugadores/1")
    assert r_del.status_code == 204

    # El jugador sigue existiendo con activo=false y conserva sus estadísticas
    r_jug = api.get("/api/jugadores/1").get_json()
    assert r_jug["activo"] is False

    r_stats = api.get("/api/jugadores/1/estadisticas").get_json()
    assert r_stats["goles_totales"] == 2
    assert r_stats["partidos_jugados"] == 1
    assert r_stats["goles_recibidos_totales"] is None  # Es Delantero, no Portero

    # El dorsal 9 ha quedado libre en el equipo 1 para un nuevo fichaje activo
    r_nuevo = api.post("/api/jugadores", json={
        "nombre": "Sergio",
        "ap1": "Canales",
        "posicion": "Delantero",
        "dorsal": 9,
        "equipo_id": 1,
        "estatura": 1.76,
        "peso": 72.0,
    })
    assert r_nuevo.status_code == 201
    assert r_nuevo.headers.get("Location", "").startswith("/api/jugadores/")

    # Intentar crear otro jugador activo con el mismo dorsal 9 devuelve 409 conflicto
    r_dup = api.post("/api/jugadores", json={
        "nombre": "Otro",
        "ap1": "Nueve",
        "posicion": "Delantero",
        "dorsal": 9,
        "equipo_id": 1,
    })
    assert r_dup.status_code == 409
    assert r_dup.get_json()["error"]["codigo"] == "conflicto"


def test_estadisticas_portero_incluye_goles_recibidos(api):
    api.login_como("ESTANDAR")
    # El jugador 2 (Juan Pérez) es Portero: goles_recibidos_totales debe ser entero (0), no None
    r = api.get("/api/jugadores/2/estadisticas")
    assert r.status_code == 200
    assert r.get_json()["goles_recibidos_totales"] == 0


# ============================================================================
# 2. ACTA ATÓMICA, CÁLCULO POR EVENTOS Y ROLLBACK (M6 + M9)
# ============================================================================
def test_acta_calcula_minutos_tarjetas_y_goles_portero(api):
    api.login_como("COORD")
    # Añadimos un suplente al Juvenil A (equipo 1) para probar sustituciones
    r_sup = api.post("/api/jugadores", json={
        "nombre": "Pablo",
        "ap1": "Torre",
        "posicion": "Centrocampista",
        "dorsal": 10,
        "equipo_id": 1,
    })
    suplente_id = r_sup.get_json()["id"]

    # El entrenador del Juvenil A actualiza el acta del Partido 1 (duración Juvenil = 90 min)
    api.login_como("ENTRENADOR")
    acta_payload = {
        "resultado_local": 2,
        "resultado_visitante": 1,
        "arbitros": {"principal": "Mateu Lahoz, Antonio", "asistentes": ["Asistente Uno"]},
        "cuerpo_tecnico": {"delegado_campo": "Delegado Local", "delegado_equipo": "Delegado Juvenil"},
        "alineacion": [
            {"jugador_id": 1, "estado": "titular"},         # Delantero (sustituido min 60)
            {"jugador_id": 2, "estado": "titular"},         # Portero (juega los 90 min, encaja 1)
            {"jugador_id": 3, "estado": "titular"},         # Defensa (doble amarilla en min 75)
            {"jugador_id": suplente_id, "estado": "suplente"},  # Entra en min 60 (juega 30 min)
        ],
        "eventos": [
            {"tipo": "gol", "minuto": 15, "jugador_id": 1, "asistente_id": 3},
            {"tipo": "gol_rival", "minuto": 40, "autor": "Delantero Laredo"},
            {"tipo": "tarjeta", "minuto": 50, "jugador_id": 3, "color": "amarilla"},
            {"tipo": "sustitucion", "minuto": 60, "sale_id": 1, "entra_id": suplente_id},
            {"tipo": "gol", "minuto": 70, "jugador_id": suplente_id, "asistente_id": None},
            {"tipo": "tarjeta", "minuto": 75, "jugador_id": 3, "color": "amarilla"},
        ],
    }

    r = api.put("/api/partidos/1/acta", json=acta_payload)
    assert r.status_code == 200
    partido = r.get_json()
    assert partido["estado"] == "finalizado"
    assert partido["ganador_id"] == 1

    alin = {item["jugador_id"]: item for item in partido["acta"]["alineacion"]}

    # Jugador 1: titular, sustituido en el min 60 -> 60 mins, 1 gol
    assert alin[1]["mins_jugados"] == 60
    assert alin[1]["goles"] == 1

    # Jugador 2 (Portero): 90 mins, 1 gol recibido
    assert alin[2]["mins_jugados"] == 90
    assert alin[2]["goles_recibidos"] == 1

    # Jugador 3: titular, expulsado por 2ª amarilla en min 75 -> 75 mins, 2 amarillas y roja=True
    assert alin[3]["mins_jugados"] == 75
    assert alin[3]["amarillas"] == 2
    assert alin[3]["roja"] is True
    assert alin[3]["asistencias"] == 1

    # Suplente: entra en el 60 hasta el 90 -> 30 mins, 1 gol
    assert alin[suplente_id]["mins_jugados"] == 30
    assert alin[suplente_id]["goles"] == 1


def test_acta_invalida_hace_rollback_y_conserva_acta_anterior(api):
    api.login_como("ENTRENADOR")

    # El partido 1 ya tiene acta en el seed (2-0 con 2 goles de David)
    antes = api.get("/api/partidos/1").get_json()
    assert antes["resultado_local"] == 2
    assert len(antes["acta"]["alineacion"]) == 3

    # Enviamos un acta incoherente: marcador dice 3-0 pero solo hay 1 evento de gol
    r_err = api.put("/api/partidos/1/acta", json={
        "resultado_local": 3,
        "resultado_visitante": 0,
        "alineacion": [
            {"jugador_id": 1, "estado": "titular"},
            {"jugador_id": 2, "estado": "titular"},
        ],
        "eventos": [
            {"tipo": "gol", "minuto": 10, "jugador_id": 1},
        ],
    })
    assert r_err.status_code == 422
    assert r_err.get_json()["error"]["codigo"] == "validacion"

    # Comprobamos que el acta anterior sigue intacta en la BD
    despues = api.get("/api/partidos/1").get_json()
    assert despues["resultado_local"] == 2
    assert len(despues["acta"]["alineacion"]) == 3


def test_acta_partido_futuro_devuelve_409(api):
    api.login_como("ENTRENADOR")
    # El partido 2 (2026-11-15) está en el futuro
    r = api.put("/api/partidos/2/acta", json={
        "resultado_local": 1,
        "resultado_visitante": 0,
        "alineacion": [{"jugador_id": 1, "estado": "titular"}, {"jugador_id": 2, "estado": "titular"}],
        "eventos": [{"tipo": "gol", "minuto": 20, "jugador_id": 1}],
    })
    assert r.status_code == 409
    assert r.get_json()["error"]["codigo"] == "conflicto"


def test_trigger_portero_se_traduce_a_422_nunca_500():
    # Verificación directa de M9: si en BD salta el trigger verificar_goles_portero
    # para el jugador 1 (Delantero), traducir_error_bd devuelve HTTP 422
    conn = get_db_connection()
    try:
        with pytest.raises(Exception) as exc_info:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE estadisticas_partido SET goles_recibidos = 1 WHERE partido = 1 AND id_jugador = 1"
                )
        with flask_app.app_context():
            resp, status = traducir_error_bd(exc_info.value)
            assert status == 422
            assert resp.get_json()["error"]["codigo"] == "validacion"
    finally:
        conn.close()


# ============================================================================
# 3. PARTIDOS ENTRE RIVALES Y CLASIFICACIÓN 3-1-0 (M6 + M7)
# ============================================================================
def test_partido_entre_rivales_y_recalculo_clasificacion(api):
    api.login_como("ENTRENADOR")
    ayer = (date.today() - timedelta(days=1)).isoformat()

    # El entrenador crea un partido entre dos rivales de su misma competición (11 vs 12)
    r_crear = api.post("/api/partidos", json={
        "temporada_id": 2,
        "jornada": 1,
        "fecha": ayer,
        "local_id": 11,
        "visitante_id": 12,
        "lugar": "Campo Municipal de Laredo",
    })
    assert r_crear.status_code == 201
    partido_rival_id = r_crear.get_json()["id"]

    # Un partido entre rivales rechaza PUT /acta con 409
    r_acta = api.put(f"/api/partidos/{partido_rival_id}/acta", json={
        "resultado_local": 1,
        "resultado_visitante": 1,
        "alineacion": [{"jugador_id": 1, "estado": "titular"}],
        "eventos": [],
    })
    assert r_acta.status_code == 409

    # Pero acepta PUT /resultado (empate 1-1 entre Laredo y Racing B)
    r_res = api.put(f"/api/partidos/{partido_rival_id}/resultado", json={
        "resultado_local": 1,
        "resultado_visitante": 1,
    })
    assert r_res.status_code == 200
    assert r_res.get_json()["estado"] == "finalizado"
    assert r_res.get_json()["ganador_id"] is None

    # Consultamos la clasificación de la liga (Juvenil A: 3 pts, Racing B: 1 pt, Laredo: 1 pt)
    r_clas = api.get("/api/equipos/1/clasificacion?temporada=2")
    assert r_clas.status_code == 200
    tabla = r_clas.get_json()
    assert len(tabla) == 3

    # 1.º Juvenil A (3 puntos, DG +2)
    assert tabla[0]["posicion"] == 1
    assert tabla[0]["equipo"]["id"] == 1
    assert tabla[0]["puntos"] == 3 and tabla[0]["dg"] == 2

    # 2.º Racing B (1 punto, DG 0) por delante de Laredo (1 punto, DG -2)
    assert tabla[1]["posicion"] == 2
    assert tabla[1]["equipo"]["id"] == 12
    assert tabla[1]["puntos"] == 1 and tabla[1]["dg"] == 0

    assert tabla[2]["posicion"] == 3
    assert tabla[2]["equipo"]["id"] == 11
    assert tabla[2]["puntos"] == 1 and tabla[2]["dg"] == -2


# ============================================================================
# 4. PERMISOS DE PROPIEDAD, APUNTES Y CRÓNICAS (M8 + §8)
# ============================================================================
def test_permisos_apuntes_privados_del_entrenador(api):
    # Sin sesión -> 401
    api.logout()
    assert api.get("/api/equipos/1/apuntes").status_code == 401

    # El COORDINADOR NO tiene permiso para ver ni crear apuntes del entrenador -> 403
    api.login_como("COORD")
    assert api.get("/api/equipos/1/apuntes").status_code == 403
    assert api.post("/api/apuntes", json={"equipo_id": 1, "texto": "Intento coord"}).status_code == 403

    # El ENTRENADOR del equipo 1 tampoco puede ver ni crear apuntes para el equipo 2 (Cadete B) -> 403
    api.login_como("ENTRENADOR")
    assert api.get("/api/equipos/2/apuntes").status_code == 403
    assert api.post("/api/apuntes", json={"equipo_id": 2, "texto": "Otro equipo"}).status_code == 403

    # Pero sí puede crear, editar y borrar apuntes de su propio equipo (equipo 1)
    r_post = api.post("/api/apuntes", json={
        "equipo_id": 1,
        "rival_id": 12,
        "texto": "Presionar la salida del mediocentro rival.",
    })
    assert r_post.status_code == 201
    apunte_id = r_post.get_json()["id"]

    r_patch = api.patch(f"/api/apuntes/{apunte_id}", json={"texto": "Apunte actualizado."})
    assert r_patch.status_code == 200
    assert r_patch.get_json()["texto"] == "Apunte actualizado."

    r_del = api.delete(f"/api/apuntes/{apunte_id}")
    assert r_del.status_code == 204


def test_cronicas_unicidad_y_partido_no_jugado(api):
    api.login_como("ENTRENADOR")

    # El Partido 1 ya tiene crónica en 02_datos.sql -> crear otra devuelve 409
    r_dup = api.post("/api/cronicas", json={
        "partido_id": 1,
        "titulo": "Segunda crónica repetida",
        "texto": "Texto de más de cincuenta caracteres para superar la validación de longitud mínima.",
    })
    assert r_dup.status_code == 409

    # El Partido 2 aún está programado (sin jugar) -> crear crónica devuelve 409
    r_prog = api.post("/api/cronicas", json={
        "partido_id": 2,
        "titulo": "Crónica antes de jugar",
        "texto": "Texto de más de cincuenta caracteres para superar la validación de longitud mínima.",
    })
    assert r_prog.status_code == 409
