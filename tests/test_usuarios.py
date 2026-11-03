"""Tests de la gestión de usuarios (E5).

Siguen el mínimo del contrato (apartado 8): sin sesión -> 401, rol sin permiso
-> 403 (y se comprueba que no cambió nada), caso correcto con su estado
resultante, y datos inválidos / conflictos -> 422 / 409 / 404.

Cada test crea sus propios usuarios, equipos y fichas (no toca los del seed) y
los borra al terminar. Los tests del «último desarrollador» desactivan un rato
a los demás desarrolladores y los reactivan al acabar.
"""
import secrets

import pytest

from comun import get_db_connection

URL = "/api/usuarios"
ROLES = ("ESTANDAR", "JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
CAMPOS_USUARIO = {"id", "username", "email", "rol", "activo", "jugador_id", "equipo_id"}


# ----------------------------------------------------------------------------
# Ayudas de base de datos
# ----------------------------------------------------------------------------
def ejecutar(sql, params=(), devolver=False):
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone() if devolver else None
    finally:
        conn.close()


def ejecutar_todos(sql, params=()):
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


def valor(sql, params=()):
    """Primer valor de la primera fila (o None)."""
    fila = ejecutar(sql, params, devolver=True)
    return fila[0] if fila else None


def rol_de(id_usuario):
    return valor("SELECT rol FROM usuarios WHERE id_usuario = %s", (id_usuario,))


def activo_de(id_usuario):
    return valor("SELECT activo FROM usuarios WHERE id_usuario = %s", (id_usuario,))


def existe(id_usuario):
    return valor("SELECT 1 FROM usuarios WHERE id_usuario = %s", (id_usuario,)) is not None


def dueno_de_ficha(id_jugador):
    return valor("SELECT id_usuario FROM jugador WHERE id_jugador = %s", (id_jugador,))


def entrenador_de(id_equipo):
    return valor("SELECT id_entrenador FROM equipo WHERE id_equipo = %s", (id_equipo,))


# ----------------------------------------------------------------------------
# Fixtures: equipos y fichas propios de cada test
# ----------------------------------------------------------------------------
@pytest.fixture
def crear_equipo():
    ids = []

    def _crear(id_entrenador=None):
        # «categoria» y «competicion» se copian de un equipo del seed.
        fila = ejecutar(
            """
            INSERT INTO equipo (nombre, categoria, competicion, es_propio, id_entrenador)
            SELECT %s, categoria, competicion, true, %s
            FROM equipo ORDER BY id_equipo LIMIT 1
            RETURNING id_equipo
            """,
            (f"T-equipo-{secrets.token_hex(4)}", id_entrenador),
            devolver=True,
        )
        assert fila is not None, "No hay ningún equipo en la BD: carga primero 02_datos.sql"
        ids.append(fila[0])
        return fila[0]

    yield _crear

    if ids:
        ejecutar("DELETE FROM solicitud_acceso WHERE id_equipo = ANY(%s)", (ids,))
        ejecutar("DELETE FROM equipo WHERE id_equipo = ANY(%s)", (ids,))


@pytest.fixture
def crear_jugador(crear_equipo):
    # Depende de crear_equipo para que las fichas se borren ANTES que su equipo.
    ids = []

    def _crear(id_equipo, id_usuario=None):
        fila = ejecutar(
            """
            INSERT INTO jugador (nombre, ap1, ap2, equipo, posicion, id_usuario, activo)
            VALUES ('Test', 'Jugador', 'Prueba', %s, 'Delantero', %s, true)
            RETURNING id_jugador
            """,
            (id_equipo, id_usuario),
            devolver=True,
        )
        ids.append(fila[0])
        return fila[0]

    yield _crear

    if ids:
        ejecutar("DELETE FROM solicitud_acceso WHERE id_jugador = ANY(%s)", (ids,))
        ejecutar("DELETE FROM jugador WHERE id_jugador = ANY(%s)", (ids,))


# ----------------------------------------------------------------------------
# Ayudas de la API
# ----------------------------------------------------------------------------
def id_de(cliente):
    return cliente.get("/api/auth/yo").get_json()["usuario"]["id"]


def parchear(cliente, id_usuario, **cuerpo):
    return cliente.patch(f"{URL}/{id_usuario}", json=cuerpo)


def eliminar(cliente, id_usuario):
    return cliente.delete(f"{URL}/{id_usuario}")


@pytest.fixture
def desarrollador_unico(api_como):
    """Un desarrollador con sesión que es el ÚNICO activo (los demás, apagados)."""
    cliente = api_como("DESARROLLADOR")
    uid = id_de(cliente)
    apagados = ejecutar_todos(
        "UPDATE usuarios SET activo = false "
        "WHERE rol = 'DESARROLLADOR' AND activo = true AND id_usuario <> %s "
        "RETURNING id_usuario",
        (uid,),
    )
    ids_apagados = [f[0] for f in apagados]
    yield cliente, uid
    if ids_apagados:
        ejecutar("UPDATE usuarios SET activo = true WHERE id_usuario = ANY(%s)", (ids_apagados,))


# ============================================================================
# GET /api/usuarios
# ============================================================================
def test_listar_sin_sesion_devuelve_401(api):
    assert api.get(URL).status_code == 401


@pytest.mark.parametrize("rol", ("ESTANDAR", "JUGADOR", "ENTRENADOR"))
def test_listar_con_rol_sin_permiso_devuelve_403(api_como, rol):
    assert api_como(rol).get(URL).status_code == 403


@pytest.mark.parametrize("rol", ("COORDINADOR", "DESARROLLADOR"))
def test_listar_devuelve_la_respuesta_paginada(api_como, rol):
    r = api_como(rol).get(URL)
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert set(cuerpo) == {"items", "page", "por_pagina", "total"}
    assert cuerpo["page"] == 1 and cuerpo["por_pagina"] == 20
    assert cuerpo["total"] >= 1 and cuerpo["items"]
    for item in cuerpo["items"]:
        assert set(item) == CAMPOS_USUARIO


def test_listar_no_expone_contrasenas(api_como):
    texto = api_como("COORDINADOR").get(URL + "?por_pagina=100").get_data(as_text=True)
    assert "password" not in texto
    assert "argon2" not in texto


def test_listar_filtra_por_rol(api_como, crear_usuario):
    u = crear_usuario("JUGADOR")
    items = api_como("COORDINADOR").get(URL + "?rol=JUGADOR&por_pagina=100").get_json()["items"]
    assert items and all(i["rol"] == "JUGADOR" for i in items)
    assert u["id"] in [i["id"] for i in items]


def test_listar_busca_por_nombre_de_usuario_sin_distinguir_mayusculas(api_como, crear_usuario):
    u = crear_usuario("ESTANDAR")
    trozo = u["username"].split("_")[-1]          # los 6 hex únicos del usuario
    coord = api_como("COORDINADOR")
    for q in (trozo, trozo.upper()):
        items = coord.get(URL, query_string={"q": q}).get_json()["items"]
        assert [i["id"] for i in items] == [u["id"]]


def test_listar_busca_por_email(api_como, crear_usuario):
    u = crear_usuario("ESTANDAR")
    items = api_como("COORDINADOR").get(URL, query_string={"q": u["username"] + "@test"}).get_json()["items"]
    assert [i["id"] for i in items] == [u["id"]]


def test_listar_trata_los_comodines_como_texto(api_como):
    """Buscar «%» no debe devolver a todo el mundo."""
    cuerpo = api_como("COORDINADOR").get(URL, query_string={"q": "%"}).get_json()
    assert cuerpo["total"] == 0 and cuerpo["items"] == []


def test_listar_combina_rol_y_busqueda(api_como, crear_usuario):
    u = crear_usuario("ENTRENADOR")
    coord = api_como("COORDINADOR")
    trozo = u["username"].split("_")[-1]
    assert coord.get(URL, query_string={"q": trozo, "rol": "ENTRENADOR"}).get_json()["total"] == 1
    assert coord.get(URL, query_string={"q": trozo, "rol": "JUGADOR"}).get_json()["total"] == 0


def test_listar_respeta_la_paginacion(api_como, crear_usuario):
    crear_usuario("ESTANDAR")
    crear_usuario("ESTANDAR")
    coord = api_como("COORDINADOR")
    p1 = coord.get(URL + "?por_pagina=1&page=1").get_json()
    p2 = coord.get(URL + "?por_pagina=1&page=2").get_json()
    assert len(p1["items"]) == 1 and len(p2["items"]) == 1
    assert p1["total"] >= 2
    assert p1["items"][0]["id"] != p2["items"][0]["id"]


def test_listar_muestra_los_vinculos(api_como, crear_usuario, crear_equipo, crear_jugador):
    jugador = crear_usuario("JUGADOR")
    entrenador = crear_usuario("ENTRENADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=jugador["id"])
    equipo = crear_equipo(id_entrenador=entrenador["id"])
    coord = api_como("COORDINADOR")

    def buscar(u):
        trozo = u["username"].split("_")[-1]
        return coord.get(URL, query_string={"q": trozo}).get_json()["items"][0]

    assert buscar(jugador)["jugador_id"] == ficha
    assert buscar(entrenador)["equipo_id"] == equipo


@pytest.mark.parametrize("consulta", [
    "?rol=ADMIN", "?rol=jugador", "?q=" + "a" * 101,
    "?page=0", "?page=abc", "?por_pagina=0", "?por_pagina=101",
])
def test_listar_con_parametros_invalidos_devuelve_422(api_como, consulta):
    r = api_como("COORDINADOR").get(URL + consulta)
    assert r.status_code == 422
    assert r.get_json()["error"]["codigo"] == "validacion"


# ============================================================================
# PATCH /api/usuarios/<id>: permisos y forma de la petición
# ============================================================================
def test_modificar_sin_sesion_devuelve_401(api):
    assert api.patch(f"{URL}/1", json={"rol": "JUGADOR"}).status_code == 401


@pytest.mark.parametrize("rol", ("ESTANDAR", "JUGADOR", "ENTRENADOR"))
def test_modificar_con_rol_sin_permiso_devuelve_403_y_no_cambia_nada(api_como, crear_usuario, rol):
    objetivo = crear_usuario("ESTANDAR")
    r = parchear(api_como(rol), objetivo["id"], rol="JUGADOR", activo=False)
    assert r.status_code == 403
    assert rol_de(objetivo["id"]) == "ESTANDAR" and activo_de(objetivo["id"]) is True


def test_modificar_sin_token_csrf_devuelve_403(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    r = api_como("COORDINADOR").patch(f"{URL}/{objetivo['id']}", csrf=False, json={"rol": "JUGADOR"})
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "csrf_invalido"
    assert rol_de(objetivo["id"]) == "ESTANDAR"


@pytest.mark.parametrize("rol", ("COORDINADOR", "DESARROLLADOR"))
def test_modificar_un_usuario_inexistente_devuelve_404(api_como, rol):
    r = parchear(api_como(rol), 2_000_000_000, rol="JUGADOR")
    assert r.status_code == 404
    assert r.get_json()["error"]["codigo"] == "no_encontrado"


@pytest.mark.parametrize("cuerpo", [
    {},
    {"nada": 1},
    {"rol": "ADMIN"},
    {"rol": "jugador"},
    {"rol": 5},
    {"rol": None},
    {"rol": ["DESARROLLADOR"]},
    {"activo": "false"},
    {"activo": 0},
    {"activo": None},
    {"rol": "JUGADOR", "activo": "si"},
])
def test_modificar_con_datos_invalidos_devuelve_422_y_no_cambia_nada(api_como, crear_usuario, cuerpo):
    objetivo = crear_usuario("ESTANDAR")
    r = parchear(api_como("COORDINADOR"), objetivo["id"], **cuerpo)
    assert r.status_code == 422
    assert r.get_json()["error"]["codigo"] == "validacion"
    assert rol_de(objetivo["id"]) == "ESTANDAR" and activo_de(objetivo["id"]) is True


def test_modificar_con_cuerpo_que_no_es_json_devuelve_400(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    r = api_como("COORDINADOR").patch(
        f"{URL}/{objetivo['id']}", data="no es json", headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 400


def test_modificar_ignora_los_campos_que_no_son_del_contrato(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    antes = ejecutar(
        "SELECT username, email, password_hash FROM usuarios WHERE id_usuario = %s",
        (objetivo["id"],), devolver=True,
    )
    r = parchear(
        api_como("COORDINADOR"), objetivo["id"], rol="JUGADOR",
        username="otro_nombre", email="otro@x.es", password_hash="x", id=1,
    )
    assert r.status_code == 200
    despues = ejecutar(
        "SELECT username, email, password_hash FROM usuarios WHERE id_usuario = %s",
        (objetivo["id"],), devolver=True,
    )
    assert despues == antes


# ============================================================================
# PATCH: jerarquía (quién asigna qué)
# ============================================================================
@pytest.mark.parametrize("origen,destino", [
    ("ESTANDAR", "JUGADOR"), ("ESTANDAR", "ENTRENADOR"),
    ("JUGADOR", "ESTANDAR"), ("JUGADOR", "ENTRENADOR"),
    ("ENTRENADOR", "ESTANDAR"), ("ENTRENADOR", "JUGADOR"),
])
def test_el_coordinador_mueve_entre_estandar_jugador_y_entrenador(api_como, crear_usuario, origen, destino):
    objetivo = crear_usuario(origen)
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol=destino)
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert set(cuerpo) == CAMPOS_USUARIO
    assert cuerpo["id"] == objetivo["id"] and cuerpo["rol"] == destino
    assert rol_de(objetivo["id"]) == destino


@pytest.mark.parametrize("destino", ("COORDINADOR", "DESARROLLADOR"))
def test_el_coordinador_no_asciende_a_nadie_por_encima_de_entrenador(api_como, crear_usuario, destino):
    objetivo = crear_usuario("ESTANDAR")
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol=destino)
    assert r.status_code == 403
    assert rol_de(objetivo["id"]) == "ESTANDAR"


@pytest.mark.parametrize("origen", ("COORDINADOR", "DESARROLLADOR"))
@pytest.mark.parametrize("cuerpo", [{"rol": "ESTANDAR"}, {"activo": False}])
def test_el_coordinador_no_toca_a_coordinadores_ni_desarrolladores(api_como, crear_usuario, origen, cuerpo):
    objetivo = crear_usuario(origen)
    r = parchear(api_como("COORDINADOR"), objetivo["id"], **cuerpo)
    assert r.status_code == 403
    assert rol_de(objetivo["id"]) == origen and activo_de(objetivo["id"]) is True


@pytest.mark.parametrize("origen,destino", [
    ("ESTANDAR", "COORDINADOR"), ("ESTANDAR", "DESARROLLADOR"),
    ("JUGADOR", "DESARROLLADOR"), ("COORDINADOR", "ESTANDAR"),
    ("COORDINADOR", "DESARROLLADOR"), ("DESARROLLADOR", "COORDINADOR"),
    ("DESARROLLADOR", "ESTANDAR"),
])
def test_el_desarrollador_puede_asignar_cualquier_rol(api_como, crear_usuario, origen, destino):
    objetivo = crear_usuario(origen)
    r = parchear(api_como("DESARROLLADOR"), objetivo["id"], rol=destino)
    assert r.status_code == 200
    assert rol_de(objetivo["id"]) == destino


def test_el_desarrollador_puede_desactivar_a_un_coordinador(api_como, crear_usuario):
    objetivo = crear_usuario("COORDINADOR")
    assert parchear(api_como("DESARROLLADOR"), objetivo["id"], activo=False).status_code == 200
    assert activo_de(objetivo["id"]) is False


# ============================================================================
# PATCH: reglas del contrato (uno mismo, último desarrollador)
# ============================================================================
@pytest.mark.parametrize("rol,nuevo", [("DESARROLLADOR", "COORDINADOR"), ("COORDINADOR", "ESTANDAR")])
def test_nadie_se_cambia_el_rol_a_si_mismo(api_como, rol, nuevo):
    cliente = api_como(rol)
    uid = id_de(cliente)
    r = parchear(cliente, uid, rol=nuevo)
    assert r.status_code == 409
    assert r.get_json()["error"]["codigo"] == "conflicto"
    assert rol_de(uid) == rol


def test_enviar_el_mismo_rol_a_uno_mismo_no_es_un_cambio(api_como):
    cliente = api_como("DESARROLLADOR")
    uid = id_de(cliente)
    r = parchear(cliente, uid, rol="DESARROLLADOR", activo=True)
    assert r.status_code == 200
    assert rol_de(uid) == "DESARROLLADOR" and activo_de(uid) is True


def test_el_ultimo_desarrollador_no_puede_desactivarse(desarrollador_unico):
    cliente, uid = desarrollador_unico
    r = parchear(cliente, uid, activo=False)
    assert r.status_code == 409
    assert activo_de(uid) is True
    assert cliente.get("/api/auth/yo").status_code == 200       # sigue con sesión


def test_un_desarrollador_puede_desactivarse_si_queda_otro_activo(api_como, crear_usuario):
    crear_usuario("DESARROLLADOR")                               # otro desarrollador activo
    cliente = api_como("DESARROLLADOR")
    uid = id_de(cliente)
    assert parchear(cliente, uid, activo=False).status_code == 200
    assert activo_de(uid) is False
    assert cliente.get("/api/auth/yo").status_code == 401        # su sesión deja de valer


# ============================================================================
# PATCH: efectos sobre la cuenta y sus vínculos
# ============================================================================
def test_un_cambio_de_rol_se_nota_en_la_sesion_abierta_del_usuario(api, api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    assert api.login(objetivo["username"], objetivo["password"]).status_code == 200
    parchear(api_como("COORDINADOR"), objetivo["id"], rol="ENTRENADOR")
    assert api.get("/api/auth/yo").get_json()["usuario"]["rol"] == "ENTRENADOR"


def test_desactivar_cierra_el_acceso_y_reactivar_lo_devuelve(api, api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    assert api.login(objetivo["username"], objetivo["password"]).status_code == 200
    coord = api_como("COORDINADOR")

    r = parchear(coord, objetivo["id"], activo=False)
    assert r.status_code == 200 and r.get_json()["activo"] is False
    assert api.get("/api/auth/yo").status_code == 401                        # sesión abierta
    assert api.login(objetivo["username"], objetivo["password"]).status_code == 401   # login nuevo

    assert parchear(coord, objetivo["id"], activo=True).status_code == 200
    assert api.login(objetivo["username"], objetivo["password"]).status_code == 200


def test_se_pueden_enviar_rol_y_activo_a_la_vez(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol="JUGADOR", activo=False)
    assert r.status_code == 200
    assert (rol_de(objetivo["id"]), activo_de(objetivo["id"])) == ("JUGADOR", False)


def test_repetir_los_mismos_valores_no_cambia_nada(api_como, crear_usuario):
    objetivo = crear_usuario("JUGADOR")
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol="JUGADOR", activo=True)
    assert r.status_code == 200
    assert (rol_de(objetivo["id"]), activo_de(objetivo["id"])) == ("JUGADOR", True)


def test_quitar_el_rol_jugador_libera_la_ficha(api_como, crear_usuario, crear_equipo, crear_jugador):
    objetivo = crear_usuario("JUGADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=objetivo["id"])
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol="ESTANDAR")
    assert r.status_code == 200 and r.get_json()["jugador_id"] is None
    assert dueno_de_ficha(ficha) is None


def test_quitar_el_rol_entrenador_libera_el_equipo(api_como, crear_usuario, crear_equipo):
    objetivo = crear_usuario("ENTRENADOR")
    equipo = crear_equipo(id_entrenador=objetivo["id"])
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol="ESTANDAR")
    assert r.status_code == 200 and r.get_json()["equipo_id"] is None
    assert entrenador_de(equipo) is None


def test_pasar_de_jugador_a_entrenador_libera_la_ficha(api_como, crear_usuario, crear_equipo, crear_jugador):
    objetivo = crear_usuario("JUGADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=objetivo["id"])
    assert parchear(api_como("COORDINADOR"), objetivo["id"], rol="ENTRENADOR").status_code == 200
    assert dueno_de_ficha(ficha) is None


def test_mantener_el_rol_no_toca_el_vinculo(api_como, crear_usuario, crear_equipo, crear_jugador):
    objetivo = crear_usuario("JUGADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=objetivo["id"])
    r = parchear(api_como("COORDINADOR"), objetivo["id"], rol="JUGADOR")
    assert r.status_code == 200 and r.get_json()["jugador_id"] == ficha
    assert dueno_de_ficha(ficha) == objetivo["id"]


def test_desactivar_no_toca_el_vinculo(api_como, crear_usuario, crear_equipo):
    objetivo = crear_usuario("ENTRENADOR")
    equipo = crear_equipo(id_entrenador=objetivo["id"])
    coord = api_como("COORDINADOR")
    assert parchear(coord, objetivo["id"], activo=False).status_code == 200
    assert entrenador_de(equipo) == objetivo["id"]
    assert parchear(coord, objetivo["id"], activo=True).get_json()["equipo_id"] == equipo


# ============================================================================
# DELETE /api/usuarios/<id>
# ============================================================================
def test_eliminar_sin_sesion_devuelve_401(api):
    assert api.delete(f"{URL}/1").status_code == 401


@pytest.mark.parametrize("rol", ("ESTANDAR", "JUGADOR", "ENTRENADOR", "COORDINADOR"))
def test_eliminar_con_rol_sin_permiso_devuelve_403_y_no_borra(api_como, crear_usuario, rol):
    objetivo = crear_usuario("ESTANDAR")
    assert eliminar(api_como(rol), objetivo["id"]).status_code == 403
    assert existe(objetivo["id"])


def test_eliminar_sin_token_csrf_devuelve_403(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    r = api_como("DESARROLLADOR").delete(f"{URL}/{objetivo['id']}", csrf=False)
    assert r.status_code == 403
    assert existe(objetivo["id"])


def test_eliminar_un_usuario_inexistente_devuelve_404(api_como):
    r = eliminar(api_como("DESARROLLADOR"), 2_000_000_000)
    assert r.status_code == 404
    assert r.get_json()["error"]["codigo"] == "no_encontrado"


def test_eliminar_devuelve_204_y_borra_al_usuario(api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    dev = api_como("DESARROLLADOR")
    r = eliminar(dev, objetivo["id"])
    assert r.status_code == 204 and r.data == b""
    assert not existe(objetivo["id"])
    assert eliminar(dev, objetivo["id"]).status_code == 404


def test_eliminar_cierra_la_sesion_del_usuario(api, api_como, crear_usuario):
    objetivo = crear_usuario("ESTANDAR")
    assert api.login(objetivo["username"], objetivo["password"]).status_code == 200
    assert eliminar(api_como("DESARROLLADOR"), objetivo["id"]).status_code == 204
    assert api.get("/api/auth/yo").status_code == 401


def test_eliminar_libera_su_ficha_y_su_equipo(api_como, crear_usuario, crear_equipo, crear_jugador):
    objetivo = crear_usuario("JUGADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=objetivo["id"])
    equipo = crear_equipo(id_entrenador=objetivo["id"])
    assert eliminar(api_como("DESARROLLADOR"), objetivo["id"]).status_code == 204
    assert dueno_de_ficha(ficha) is None
    assert entrenador_de(equipo) is None


def test_eliminar_borra_sus_solicitudes(api_como, crear_usuario, crear_equipo):
    objetivo = crear_usuario("ESTANDAR")
    ejecutar(
        "INSERT INTO solicitud_acceso (id_usuario, rol_solicitado, id_equipo, mensaje) "
        "VALUES (%s, 'ENTRENADOR', %s, 'Mensaje de prueba')",
        (objetivo["id"], crear_equipo()),
    )
    assert eliminar(api_como("DESARROLLADOR"), objetivo["id"]).status_code == 204
    assert valor("SELECT COUNT(*) FROM solicitud_acceso WHERE id_usuario = %s", (objetivo["id"],)) == 0


def test_eliminar_a_un_usuario_con_contenido_publicado_devuelve_409(api_como, crear_usuario):
    autor = crear_usuario("COORDINADOR")
    ejecutar(
        "INSERT INTO noticia (titulo, cuerpo, tipo, id_autor) VALUES ('T-noticia', 'Texto', 'noticia', %s)",
        (autor["id"],),
    )
    try:
        r = eliminar(api_como("DESARROLLADOR"), autor["id"])
        assert r.status_code == 409
        assert r.get_json()["error"]["codigo"] == "conflicto"
        assert existe(autor["id"])
    finally:
        ejecutar("DELETE FROM noticia WHERE id_autor = %s", (autor["id"],))


@pytest.mark.parametrize("rol", ("COORDINADOR", "DESARROLLADOR"))
def test_el_desarrollador_puede_eliminar_a_coordinadores_y_a_otros_desarrolladores(api_como, crear_usuario, rol):
    objetivo = crear_usuario(rol)
    assert eliminar(api_como("DESARROLLADOR"), objetivo["id"]).status_code == 204
    assert not existe(objetivo["id"])


def test_el_ultimo_desarrollador_no_puede_eliminarse(desarrollador_unico):
    cliente, uid = desarrollador_unico
    r = eliminar(cliente, uid)
    assert r.status_code == 409
    assert existe(uid)


def test_un_desarrollador_puede_eliminarse_si_queda_otro_activo(api_como, crear_usuario):
    crear_usuario("DESARROLLADOR")
    cliente = api_como("DESARROLLADOR")
    uid = id_de(cliente)
    assert eliminar(cliente, uid).status_code == 204
    assert not existe(uid)
    assert cliente.get("/api/auth/yo").status_code == 401
