"""Tests de autenticación (E7): registro, login, logout y /yo.

Necesitan la base de datos cargada (01_tablas.sql + 02_datos.sql), igual que
test_csrf.py. Los usuarios que crean los tests se borran al terminar.
"""
import secrets

import pytest

from comun import get_db_connection

CLAVE_VALIDA = "clave-valida-123"


# ----------------------------------------------------------------------------
# Fixtures y ayudas
# ----------------------------------------------------------------------------
@pytest.fixture
def datos_registro():
    """Datos válidos y únicos en cada test; borra el usuario si llega a crearse."""
    sufijo = secrets.token_hex(3)
    datos = {
        "username": f"reg_{sufijo}",
        "email": f"reg_{sufijo}@test.local",
        "password": CLAVE_VALIDA,
    }
    yield datos

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM usuarios WHERE lower(username) = lower(%s)",
                (datos["username"],),
            )
    finally:
        conn.close()


def _fila_usuario(username):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT rol, activo, password_hash FROM usuarios "
                "WHERE lower(username) = lower(%s)",
                (username,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def _campos_con_error(respuesta):
    detalles = respuesta.get_json()["error"].get("detalles", [])
    return {d["campo"] for d in detalles}


# ----------------------------------------------------------------------------
# Registro
# ----------------------------------------------------------------------------
def test_registro_valido_devuelve_201_y_rol_estandar(api, datos_registro):
    r = api.post("/api/auth/registro", csrf=False, json=datos_registro)
    assert r.status_code == 201
    cuerpo = r.get_json()
    assert cuerpo["username"] == datos_registro["username"]
    assert cuerpo["email"] == datos_registro["email"]
    assert cuerpo["rol"] == "ESTANDAR"
    assert cuerpo["activo"] is True


def test_registro_no_devuelve_ni_la_contrasena_ni_el_hash(api, datos_registro):
    r = api.post("/api/auth/registro", csrf=False, json=datos_registro)
    assert r.status_code == 201
    texto = r.get_data(as_text=True)
    assert "password" not in texto
    assert CLAVE_VALIDA not in texto
    assert "argon2" not in texto


def test_registro_guarda_un_hash_argon2id_no_la_contrasena(api, datos_registro):
    api.post("/api/auth/registro", csrf=False, json=datos_registro)
    rol, activo, password_hash = _fila_usuario(datos_registro["username"])
    assert password_hash != CLAVE_VALIDA
    assert password_hash.startswith("$argon2id$")


def test_registro_ignora_un_rol_enviado_por_el_cliente(api, datos_registro):
    """Nadie puede hacerse DESARROLLADOR escribiéndolo en el JSON."""
    datos = {**datos_registro, "rol": "DESARROLLADOR", "activo": False}
    r = api.post("/api/auth/registro", csrf=False, json=datos)
    assert r.status_code == 201
    assert r.get_json()["rol"] == "ESTANDAR"
    rol, activo, _ = _fila_usuario(datos_registro["username"])
    assert rol == "ESTANDAR"
    assert activo is True


def test_registro_con_username_repetido_devuelve_409(api, datos_registro):
    assert api.post("/api/auth/registro", csrf=False, json=datos_registro).status_code == 201
    otro = {**datos_registro, "email": f"otro_{secrets.token_hex(3)}@test.local"}
    r = api.post("/api/auth/registro", csrf=False, json=otro)
    assert r.status_code == 409
    assert r.get_json()["error"]["codigo"] == "conflicto"


def test_registro_con_username_repetido_en_mayusculas_devuelve_409(api, datos_registro):
    assert api.post("/api/auth/registro", csrf=False, json=datos_registro).status_code == 201
    otro = {
        **datos_registro,
        "username": datos_registro["username"].upper(),
        "email": f"otro_{secrets.token_hex(3)}@test.local",
    }
    r = api.post("/api/auth/registro", csrf=False, json=otro)
    assert r.status_code == 409


def test_registro_con_email_repetido_devuelve_409(api, datos_registro):
    assert api.post("/api/auth/registro", csrf=False, json=datos_registro).status_code == 201
    otro = {**datos_registro, "username": f"otro_{secrets.token_hex(3)}"}
    r = api.post("/api/auth/registro", csrf=False, json=otro)
    assert r.status_code == 409


@pytest.mark.parametrize("username", [
    "ab",                # demasiado corto
    "a" * 31,            # demasiado largo
    "con espacios",
    "raro<script>",
    "",
    None,
    123,
])
def test_registro_con_username_invalido_devuelve_422(api, datos_registro, username):
    r = api.post("/api/auth/registro", csrf=False,
                 json={**datos_registro, "username": username})
    assert r.status_code == 422
    assert "username" in _campos_con_error(r)


@pytest.mark.parametrize("email", [
    "sin-arroba", "@sin-usuario.com", "sin@punto", "con espacio@x.com",
    "a" * 250 + "@x.com", "", None, 42,
])
def test_registro_con_email_invalido_devuelve_422(api, datos_registro, email):
    r = api.post("/api/auth/registro", csrf=False,
                 json={**datos_registro, "email": email})
    assert r.status_code == 422
    assert "email" in _campos_con_error(r)


@pytest.mark.parametrize("password", [
    "corta",             # menos de 10
    "a" * 129,           # más de 128
    "",
    None,
    1234567890,
])
def test_registro_con_password_invalida_devuelve_422(api, datos_registro, password):
    r = api.post("/api/auth/registro", csrf=False,
                 json={**datos_registro, "password": password})
    assert r.status_code == 422
    assert "password" in _campos_con_error(r)


def test_registro_con_password_igual_al_username_devuelve_422(api, datos_registro):
    datos = {**datos_registro, "username": "usuario_largo_1", "password": "USUARIO_LARGO_1"}
    r = api.post("/api/auth/registro", csrf=False, json=datos)
    assert r.status_code == 422
    assert "password" in _campos_con_error(r)


def test_registro_con_varios_errores_los_devuelve_todos(api):
    r = api.post("/api/auth/registro", csrf=False,
                 json={"username": "a", "email": "x", "password": "1"})
    assert r.status_code == 422
    assert _campos_con_error(r) == {"username", "email", "password"}


def test_registro_sin_campos_devuelve_422(api):
    r = api.post("/api/auth/registro", csrf=False, json={})
    assert r.status_code == 422


@pytest.mark.parametrize("cuerpo", ["esto no es json", "[1, 2, 3]", '"texto"'])
def test_registro_con_cuerpo_que_no_es_un_objeto_json_devuelve_400(api, cuerpo):
    r = api.post("/api/auth/registro", csrf=False, data=cuerpo,
                 headers={"Content-Type": "application/json"})
    assert r.status_code == 400
    assert r.get_json()["error"]["codigo"] == "json_invalido"


def test_se_puede_iniciar_sesion_tras_registrarse(api, datos_registro):
    api.post("/api/auth/registro", csrf=False, json=datos_registro)
    r = api.login(datos_registro["username"], datos_registro["password"])
    assert r.status_code == 200
    assert r.get_json()["usuario"]["rol"] == "ESTANDAR"


# ----------------------------------------------------------------------------
# Login
# ----------------------------------------------------------------------------
def test_login_correcto_devuelve_usuario_y_token(api, crear_usuario):
    u = crear_usuario("ENTRENADOR")
    r = api.login(u["username"], u["password"])
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert cuerpo["usuario"]["username"] == u["username"]
    assert cuerpo["usuario"]["rol"] == "ENTRENADOR"
    assert cuerpo["csrf_token"]
    assert "password_hash" not in r.get_data(as_text=True)


def test_login_ignora_mayusculas_en_el_username(api, crear_usuario):
    u = crear_usuario()
    r = api.login(u["username"].upper(), u["password"])
    assert r.status_code == 200


def test_login_con_password_incorrecta_devuelve_401(api, crear_usuario):
    u = crear_usuario()
    r = api.login(u["username"], "contraseña-equivocada")
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


def test_login_con_usuario_inexistente_devuelve_401(api):
    r = api.login("no_existe_" + secrets.token_hex(4), CLAVE_VALIDA)
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


def test_login_no_revela_si_el_usuario_existe(api, crear_usuario):
    """Usuario inexistente y contraseña mala deben dar exactamente el mismo mensaje."""
    u = crear_usuario()
    mala = api.login(u["username"], "contraseña-equivocada").get_json()
    inexistente = api.login("no_existe_" + secrets.token_hex(4), "lo-que-sea-123").get_json()
    assert mala == inexistente


def test_login_de_usuario_desactivado_devuelve_401(api, crear_usuario):
    u = crear_usuario()
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("UPDATE usuarios SET activo = false WHERE id_usuario = %s", (u["id"],))
    finally:
        conn.close()
    r = api.login(u["username"], u["password"])
    assert r.status_code == 401
    # Mismo mensaje que con una contraseña mala: no se avisa de que está desactivado.
    assert r.get_json()["error"]["mensaje"] == "Usuario o contraseña incorrectos."


@pytest.mark.parametrize("cuerpo", [
    {},
    {"username": "x"},
    {"password": "x"},
    {"username": "", "password": ""},
    {"username": 1, "password": 2},
    {"username": "a" * 31, "password": "x"},
    {"username": "x", "password": "a" * 129},
])
def test_login_con_datos_invalidos_devuelve_422(api, cuerpo):
    r = api.post("/api/auth/login", csrf=False, json=cuerpo)
    assert r.status_code == 422
    assert r.get_json()["error"]["codigo"] == "validacion"


def test_login_con_cuerpo_que_no_es_json_devuelve_400(api):
    r = api.post("/api/auth/login", csrf=False, data="no es json",
                 headers={"Content-Type": "application/json"})
    assert r.status_code == 400


def test_login_con_intento_de_inyeccion_sql_no_entra(api):
    r = api.login("' OR '1'='1' --", "' OR '1'='1' --")
    assert r.status_code in (401, 422)


def test_cookie_de_sesion_es_httponly_y_samesite(api, crear_usuario):
    u = crear_usuario()
    r = api.login(u["username"], u["password"])
    cookie = r.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie


def test_login_cambia_el_token_csrf_de_la_sesion(api, crear_usuario):
    """Cada login genera un token nuevo (no se reutiliza el de una sesión anterior)."""
    u = crear_usuario()
    t1 = api.login(u["username"], u["password"]).get_json()["csrf_token"]
    t2 = api.login(u["username"], u["password"]).get_json()["csrf_token"]
    assert t1 != t2


# ----------------------------------------------------------------------------
# /yo y logout
# ----------------------------------------------------------------------------
def test_yo_sin_sesion_devuelve_401(api):
    r = api.get("/api/auth/yo")
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


@pytest.mark.parametrize("rol", ["ESTANDAR", "JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR"])
def test_yo_devuelve_el_usuario_con_su_rol(api_como, rol):
    api = api_como(rol)
    r = api.get("/api/auth/yo")
    assert r.status_code == 200
    assert r.get_json()["usuario"]["rol"] == rol


def test_yo_no_devuelve_el_hash_de_la_contrasena(api_como):
    api = api_como()
    texto = api.get("/api/auth/yo").get_data(as_text=True)
    assert "password" not in texto


def test_logout_devuelve_204_y_cierra_la_sesion(api_como):
    api = api_como()
    assert api.post("/api/auth/logout").status_code == 204
    assert api.get("/api/auth/yo").status_code == 401


def test_logout_sin_sesion_devuelve_401(api):
    assert api.post("/api/auth/logout").status_code == 401


def test_sesion_se_invalida_si_desactivan_al_usuario(api, crear_usuario):
    u = crear_usuario()
    assert api.login(u["username"], u["password"]).status_code == 200
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("UPDATE usuarios SET activo = false WHERE id_usuario = %s", (u["id"],))
    finally:
        conn.close()
    assert api.get("/api/auth/yo").status_code == 401


def test_cambio_de_rol_se_nota_sin_volver_a_iniciar_sesion(api, crear_usuario):
    u = crear_usuario("ESTANDAR")
    api.login(u["username"], u["password"])
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("UPDATE usuarios SET rol = 'ENTRENADOR' WHERE id_usuario = %s", (u["id"],))
    finally:
        conn.close()
    assert api.get("/api/auth/yo").get_json()["usuario"]["rol"] == "ENTRENADOR"
