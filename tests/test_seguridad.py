"""Tests de seguridad (E6): limitación de intentos y cabeceras.

Los de LimitadorIntentos y las cabeceras de la página principal no necesitan
base de datos; el resto sí (igual que test_auth.py).
"""
import secrets

import pytest

from comun import get_db_connection
from seguridad import CSP, LimitadorIntentos, limite_login, limite_registro

CLAVE_VALIDA = "clave-valida-123"


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------
@pytest.fixture
def limites_activos():
    """Enciende los límites (en los tests están apagados) y los deja vacíos."""
    from app import app as flask_app

    flask_app.config["LIMITES_EN_TESTS"] = True
    limite_login.vaciar()
    limite_registro.vaciar()
    yield
    flask_app.config["LIMITES_EN_TESTS"] = False
    limite_login.vaciar()
    limite_registro.vaciar()


@pytest.fixture
def registrar_y_limpiar():
    """Función que intenta registrar un usuario nuevo; borra los creados."""
    creados = []

    def _registrar(api, **cambios):
        sufijo = secrets.token_hex(4)
        datos = {
            "username": f"lim_{sufijo}",
            "email": f"lim_{sufijo}@test.local",
            "password": CLAVE_VALIDA,
        }
        datos.update(cambios)
        creados.append(datos["username"])
        return api.post("/api/auth/registro", csrf=False, json=datos)

    yield _registrar

    if creados:
        conn = get_db_connection()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM usuarios WHERE lower(username) = ANY(%s)",
                    ([c.lower() for c in creados],),
                )
        finally:
            conn.close()


# ----------------------------------------------------------------------------
# LimitadorIntentos (sin BD, con reloj falso)
# ----------------------------------------------------------------------------
class RelojFalso:
    def __init__(self):
        self.ahora = 1000.0

    def __call__(self):
        return self.ahora


def test_limitador_deja_pasar_hasta_el_maximo_y_luego_bloquea():
    reloj = RelojFalso()
    lim = LimitadorIntentos(3, 60, reloj)
    for _ in range(3):
        assert lim.segundos_de_espera("a") == 0
        lim.anotar("a")
    assert lim.segundos_de_espera("a") > 0


def test_limitador_devuelve_los_segundos_que_faltan():
    reloj = RelojFalso()
    lim = LimitadorIntentos(2, 60, reloj)
    lim.anotar("a")
    reloj.ahora += 10
    lim.anotar("a")
    assert lim.segundos_de_espera("a") == 50  # falta lo que queda del primero


def test_limitador_olvida_los_intentos_cuando_pasa_la_ventana():
    reloj = RelojFalso()
    lim = LimitadorIntentos(2, 60, reloj)
    lim.anotar("a")
    lim.anotar("a")
    assert lim.segundos_de_espera("a") > 0
    reloj.ahora += 60
    assert lim.segundos_de_espera("a") == 0


def test_limitador_separa_las_claves():
    lim = LimitadorIntentos(1, 60, RelojFalso())
    lim.anotar("a")
    assert lim.segundos_de_espera("a") > 0
    assert lim.segundos_de_espera("b") == 0


def test_limitador_reiniciar_borra_los_intentos():
    lim = LimitadorIntentos(1, 60, RelojFalso())
    lim.anotar("a")
    lim.reiniciar("a")
    assert lim.segundos_de_espera("a") == 0


def test_limitador_purga_claves_caducadas_cuando_crece_demasiado(monkeypatch):
    import seguridad

    monkeypatch.setattr(seguridad, "MAX_CLAVES_ANTES_DE_PURGAR", 10)
    reloj = RelojFalso()
    lim = LimitadorIntentos(5, 60, reloj)
    for i in range(20):
        lim.anotar(f"k{i}")
    reloj.ahora += 61
    lim.anotar("nueva")
    assert len(lim._intentos) == 1


# ----------------------------------------------------------------------------
# Login: 5 fallos por usuario+IP
# ----------------------------------------------------------------------------
def test_login_se_bloquea_tras_5_fallos(limites_activos, api, crear_usuario):
    u = crear_usuario()
    for _ in range(5):
        assert api.login(u["username"], "mala-contraseña").status_code == 401
    r = api.login(u["username"], "mala-contraseña")
    assert r.status_code == 429
    assert r.get_json()["error"]["codigo"] == "demasiados_intentos"
    assert int(r.headers["Retry-After"]) > 0


def test_con_el_bloqueo_activo_ni_la_contrasena_correcta_entra(limites_activos, api, crear_usuario):
    u = crear_usuario()
    for _ in range(5):
        api.login(u["username"], "mala-contraseña")
    assert api.login(u["username"], u["password"]).status_code == 429


def test_login_correcto_reinicia_el_contador(limites_activos, api, crear_usuario):
    u = crear_usuario()
    for _ in range(4):
        assert api.login(u["username"], "mala-contraseña").status_code == 401
    assert api.login(u["username"], u["password"]).status_code == 200
    # Si no se hubiera reiniciado, el siguiente fallo (el 5.º) ya bloquearía.
    for _ in range(4):
        assert api.login(u["username"], "mala-contraseña").status_code == 401


def test_el_bloqueo_es_por_usuario_no_afecta_a_otros(limites_activos, api, crear_usuario):
    u1, u2 = crear_usuario(), crear_usuario()
    for _ in range(5):
        api.login(u1["username"], "mala-contraseña")
    assert api.login(u1["username"], u1["password"]).status_code == 429
    assert api.login(u2["username"], u2["password"]).status_code == 200


def test_el_bloqueo_no_distingue_mayusculas(limites_activos, api, crear_usuario):
    u = crear_usuario()
    for _ in range(5):
        api.login(u["username"], "mala-contraseña")
    assert api.login(u["username"].upper(), u["password"]).status_code == 429


def test_tambien_se_bloquea_un_usuario_que_no_existe(limites_activos, api):
    """Si solo se bloquearan los usuarios reales, el 429 delataría cuáles existen."""
    nombre = "no_existe_" + secrets.token_hex(3)
    for _ in range(5):
        assert api.login(nombre, "lo-que-sea-123").status_code == 401
    assert api.login(nombre, "lo-que-sea-123").status_code == 429


def test_los_datos_invalidos_422_no_cuentan_como_fallo(limites_activos, api, crear_usuario):
    u = crear_usuario()
    for _ in range(10):
        assert api.post("/api/auth/login", csrf=False,
                        json={"username": u["username"]}).status_code == 422
    assert api.login(u["username"], u["password"]).status_code == 200


def test_sin_activar_los_limites_no_hay_bloqueo_en_tests(api, crear_usuario):
    u = crear_usuario()
    for _ in range(8):
        assert api.login(u["username"], "mala-contraseña").status_code == 401


# ----------------------------------------------------------------------------
# Registro: 5 por hora y por IP
# ----------------------------------------------------------------------------
def test_registro_se_bloquea_tras_5_intentos(limites_activos, api, registrar_y_limpiar):
    for _ in range(5):
        assert registrar_y_limpiar(api).status_code == 201
    r = registrar_y_limpiar(api)
    assert r.status_code == 429
    assert r.get_json()["error"]["codigo"] == "demasiados_intentos"
    assert int(r.headers["Retry-After"]) > 0


def test_registro_con_datos_invalidos_no_gasta_intentos(limites_activos, api, registrar_y_limpiar):
    for _ in range(10):
        assert registrar_y_limpiar(api, password="corta").status_code == 422
    assert registrar_y_limpiar(api).status_code == 201


def test_registro_los_conflictos_409_si_cuentan(limites_activos, api, registrar_y_limpiar):
    primero = registrar_y_limpiar(api)
    assert primero.status_code == 201
    repetido = {"username": primero.get_json()["username"], "email": primero.get_json()["email"]}
    for _ in range(4):
        assert registrar_y_limpiar(api, **repetido).status_code == 409
    assert registrar_y_limpiar(api).status_code == 429


# ----------------------------------------------------------------------------
# Cabeceras de seguridad
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("ruta", ["/", "/api/auth/yo"])
def test_las_respuestas_llevan_las_cabeceras_de_seguridad(api, ruta):
    r = api.get(ruta)
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "same-origin"
    assert r.headers["Content-Security-Policy"] == CSP
    assert "Permissions-Policy" in r.headers


def test_la_politica_csp_es_estricta():
    assert "default-src 'self'" in CSP
    assert "frame-ancestors 'none'" in CSP
    assert "object-src 'none'" in CSP
    assert "unsafe-inline" not in CSP
    assert "unsafe-eval" not in CSP


def test_las_respuestas_de_la_api_no_se_cachean(api):
    assert api.get("/api/auth/yo").headers["Cache-Control"] == "no-store"


def test_hsts_solo_si_la_cookie_es_secure(api):
    from app import app as flask_app

    assert "Strict-Transport-Security" not in api.get("/api/auth/yo").headers
    flask_app.config["SESSION_COOKIE_SECURE"] = True
    try:
        r = api.get("/api/auth/yo")
        assert "max-age=" in r.headers["Strict-Transport-Security"]
    finally:
        flask_app.config["SESSION_COOKIE_SECURE"] = False
