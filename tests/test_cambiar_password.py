"""Tests de POST /api/auth/cambiar-password.

Mínimo del contrato (apartado 8): 401 sin sesión, caso correcto con su estado
resultante, y datos inválidos / contraseña incorrecta / límite -> 422 / 403 / 429.
En cada rechazo se comprueba además que la contraseña NO cambió.
"""
import pytest

from comun import get_db_connection
from seguridad import limite_cambio_password

URL = "/api/auth/cambiar-password"
ACTUAL = "clave-de-test-123"            # la que pone el fixture crear_usuario
NUEVA = "otra-clave-distinta-456"


# ----------------------------------------------------------------------------
# Fixtures y ayudas
# ----------------------------------------------------------------------------
@pytest.fixture
def limites_activos():
    """Enciende los límites (en los tests están apagados) y los deja vacíos."""
    from app import app as flask_app

    flask_app.config["LIMITES_EN_TESTS"] = True
    limite_cambio_password.vaciar()
    yield
    flask_app.config["LIMITES_EN_TESTS"] = False
    limite_cambio_password.vaciar()


@pytest.fixture
def sesion(api, crear_usuario):
    """Un cliente con la sesión iniciada y los datos del usuario."""

    def _sesion(rol="ESTANDAR"):
        usuario = crear_usuario(rol)
        r = api.login(usuario["username"], usuario["password"])
        assert r.status_code == 200
        return usuario

    return _sesion


def hash_guardado(id_usuario):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM usuarios WHERE id_usuario = %s", (id_usuario,))
            return cur.fetchone()[0]
    finally:
        conn.close()


def cambiar(api, actual=ACTUAL, nueva=NUEVA, **kwargs):
    return api.post(URL, json={"password_actual": actual, "password_nueva": nueva}, **kwargs)


def puede_entrar(api, usuario, password):
    """¿Funciona el login con esta contraseña? Reutiliza el mismo cliente."""
    return api.login(usuario["username"], password).status_code == 200


# ============================================================================
# Acceso
# ============================================================================
def test_sin_sesion_devuelve_401(api):
    r = cambiar(api)
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


def test_sin_token_csrf_devuelve_403_y_no_cambia_nada(api, sesion):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])

    r = cambiar(api, csrf=False)
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "csrf_invalido"
    assert hash_guardado(usuario["id"]) == antes


@pytest.mark.parametrize("rol", ["ESTANDAR", "JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR"])
def test_cualquier_rol_autenticado_puede_cambiar_su_contrasena(api, sesion, rol):
    sesion(rol)
    assert cambiar(api).status_code == 204


# ============================================================================
# Caso correcto
# ============================================================================
def test_cambio_correcto_devuelve_204_sin_cuerpo(api, sesion):
    sesion()
    r = cambiar(api)
    assert r.status_code == 204
    assert r.data == b""


def test_tras_cambiar_solo_vale_la_contrasena_nueva(api, sesion):
    usuario = sesion()
    assert cambiar(api).status_code == 204

    api.post("/api/auth/logout")
    assert puede_entrar(api, usuario, ACTUAL) is False        # la vieja ya no
    assert puede_entrar(api, usuario, NUEVA) is True          # la nueva sí


def test_se_guarda_un_hash_argon2id_nuevo_y_nunca_la_contrasena(api, sesion):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])
    cambiar(api)

    despues = hash_guardado(usuario["id"])
    assert despues != antes
    assert despues.startswith("$argon2id$")
    assert NUEVA not in despues


def test_la_sesion_sigue_abierta_y_el_token_csrf_sigue_valido(api, sesion):
    """mi-cuenta.js no recibe cuerpo en el 204: el token anterior debe seguir sirviendo."""
    sesion()
    assert cambiar(api).status_code == 204

    assert api.get("/api/auth/yo").status_code == 200
    # Se puede cambiar otra vez con el mismo token (ahora la actual es NUEVA).
    assert cambiar(api, actual=NUEVA, nueva="una-tercera-clave-789").status_code == 204


def test_los_espacios_forman_parte_de_la_contrasena(api, sesion):
    usuario = sesion()
    con_espacios = "  clave con espacios  "
    assert cambiar(api, nueva=con_espacios).status_code == 204

    api.post("/api/auth/logout")
    assert puede_entrar(api, usuario, con_espacios.strip()) is False
    assert puede_entrar(api, usuario, con_espacios) is True


@pytest.mark.parametrize("longitud", [10, 128])
def test_acepta_los_limites_de_longitud(api, sesion, longitud):
    sesion()
    assert cambiar(api, nueva="x" * longitud).status_code == 204


# ============================================================================
# 403: la contraseña actual no es correcta
# ============================================================================
def test_contrasena_actual_incorrecta_devuelve_403_y_no_cambia_nada(api, sesion):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])

    r = cambiar(api, actual="no-es-la-actual-999")
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "sin_permiso"
    assert hash_guardado(usuario["id"]) == antes

    api.post("/api/auth/logout")
    assert puede_entrar(api, usuario, ACTUAL) is True         # sigue valiendo la de siempre


# ============================================================================
# 400 / 422
# ============================================================================
@pytest.mark.parametrize("cuerpo", ["esto no es json", "[1, 2]", '"texto"'])
def test_cuerpo_que_no_es_un_objeto_json_devuelve_400(api, sesion, cuerpo):
    sesion()
    r = api.post(URL, data=cuerpo, headers={"Content-Type": "application/json"})
    assert r.status_code == 400
    assert r.get_json()["error"]["codigo"] == "json_invalido"


@pytest.mark.parametrize("nueva", [None, 123, "", "123456789", "x" * 129])
def test_nueva_invalida_devuelve_422_y_no_cambia_nada(api, sesion, nueva):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])

    r = cambiar(api, nueva=nueva)
    assert r.status_code == 422
    assert [d["campo"] for d in r.get_json()["error"]["detalles"]] == ["password_nueva"]
    assert hash_guardado(usuario["id"]) == antes


def test_nueva_igual_al_nombre_de_usuario_devuelve_422(api, sesion):
    usuario = sesion()
    for variante in (usuario["username"], usuario["username"].upper()):
        r = cambiar(api, nueva=variante)
        assert r.status_code == 422
        assert r.get_json()["error"]["detalles"][0]["campo"] == "password_nueva"


def test_nueva_igual_a_la_actual_devuelve_422(api, sesion):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])

    r = cambiar(api, nueva=ACTUAL)
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "password_nueva"
    assert hash_guardado(usuario["id"]) == antes


@pytest.mark.parametrize("actual", [None, 123, "", "x" * 129])
def test_actual_invalida_devuelve_422(api, sesion, actual):
    usuario = sesion()
    antes = hash_guardado(usuario["id"])

    r = cambiar(api, actual=actual)
    assert r.status_code == 422
    assert [d["campo"] for d in r.get_json()["error"]["detalles"]] == ["password_actual"]
    assert hash_guardado(usuario["id"]) == antes


def test_faltan_los_dos_campos_devuelve_422_con_los_dos_detalles(api, sesion):
    sesion()
    r = api.post(URL, json={})
    assert r.status_code == 422
    campos = {d["campo"] for d in r.get_json()["error"]["detalles"]}
    assert campos == {"password_actual", "password_nueva"}


# ============================================================================
# 429: límite de intentos con la actual incorrecta
# ============================================================================
def fallar(api, veces):
    return [cambiar(api, actual="no-es-la-actual-999").status_code for _ in range(veces)]


def test_tras_5_fallos_el_sexto_intento_devuelve_429(api, sesion, limites_activos):
    usuario = sesion()
    assert fallar(api, 5) == [403] * 5

    r = cambiar(api, actual="no-es-la-actual-999")
    assert r.status_code == 429
    assert r.get_json()["error"]["codigo"] == "demasiados_intentos"
    assert 1 <= int(r.headers["Retry-After"]) <= 15 * 60

    # Bloqueado: ni siquiera la contraseña correcta cambia nada.
    antes = hash_guardado(usuario["id"])
    assert cambiar(api).status_code == 429
    assert hash_guardado(usuario["id"]) == antes


def test_un_cambio_correcto_reinicia_el_contador(api, sesion, limites_activos):
    sesion()
    assert fallar(api, 4) == [403] * 4
    assert cambiar(api).status_code == 204                    # ahora la actual es NUEVA

    # Si no se hubiera reiniciado, el segundo fallo ya daría 429.
    assert fallar(api, 5) == [403] * 5
    assert cambiar(api, actual="no-es-la-actual-999").status_code == 429


def test_los_422_no_cuentan_para_el_limite(api, sesion, limites_activos):
    sesion()
    for _ in range(10):
        assert cambiar(api, nueva="corta").status_code == 422
    assert cambiar(api, actual="no-es-la-actual-999").status_code == 403   # no 429


def test_el_limite_es_por_usuario(api, api_como, sesion, limites_activos):
    sesion()
    assert fallar(api, 6)[-1] == 429                          # este usuario, bloqueado

    otro = api_como("ESTANDAR")                               # otro usuario, mismo test
    assert cambiar(otro).status_code == 204
