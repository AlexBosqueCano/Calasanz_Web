"""Tests de las solicitudes de acceso (E4).

Siguen el mínimo del contrato (apartado 8): sin sesión -> 401, rol sin permiso
-> 403 (y se comprueba que no cambió nada), caso correcto con su estado
resultante, y datos inválidos / conflictos -> 422 / 409 / 404.

Cada test crea sus propios equipos y fichas (no toca los del seed) y los borra
al terminar.
"""
import secrets

import pytest

from comun import get_db_connection

URL = "/api/solicitudes"
MENSAJE = "Soy yo, quiero vincular mi cuenta."


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


def valor(sql, params=()):
    """Primer valor de la primera fila (o None)."""
    fila = ejecutar(sql, params, devolver=True)
    return fila[0] if fila else None


def n_solicitudes(id_usuario):
    return valor("SELECT COUNT(*) FROM solicitud_acceso WHERE id_usuario = %s", (id_usuario,))


def rol_de(id_usuario):
    return valor("SELECT rol FROM usuarios WHERE id_usuario = %s", (id_usuario,))


def estado_de(id_solicitud):
    return valor("SELECT estado FROM solicitud_acceso WHERE id_solicitud = %s", (id_solicitud,))


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

    def _crear(propio=True, id_entrenador=None):
        # «categoria» y «competicion» se copian de un equipo del seed, así el
        # fixture no depende de si competicion es texto o una clave foránea.
        fila = ejecutar(
            """
            INSERT INTO equipo (nombre, categoria, competicion, es_propio, id_entrenador)
            SELECT %s, categoria, competicion, %s, %s
            FROM equipo ORDER BY id_equipo LIMIT 1
            RETURNING id_equipo
            """,
            (f"T-equipo-{secrets.token_hex(4)}", propio, id_entrenador),
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

    def _crear(id_equipo, activo=True, id_usuario=None):
        fila = ejecutar(
            """
            INSERT INTO jugador (nombre, ap1, ap2, equipo, posicion, id_usuario, activo)
            VALUES ('Test', 'Jugador', 'Prueba', %s, 'Delantero', %s, %s)
            RETURNING id_jugador
            """,
            (id_equipo, id_usuario, activo),
            devolver=True,
        )
        ids.append(fila[0])
        return fila[0]

    yield _crear

    if ids:
        # Una solicitud con la ficha borrada violaría su CHECK: se borra antes.
        ejecutar("DELETE FROM solicitud_acceso WHERE id_jugador = ANY(%s)", (ids,))
        ejecutar("DELETE FROM jugador WHERE id_jugador = ANY(%s)", (ids,))


# ----------------------------------------------------------------------------
# Ayudas de la API
# ----------------------------------------------------------------------------
def id_de(cliente):
    return cliente.get("/api/auth/yo").get_json()["usuario"]["id"]


def pedir_ficha(cliente, jugador_id, mensaje=MENSAJE):
    return cliente.post(URL, json={
        "rol_solicitado": "JUGADOR", "jugador_id": jugador_id, "mensaje": mensaje,
    })


def pedir_equipo(cliente, equipo_id, mensaje=MENSAJE):
    return cliente.post(URL, json={
        "rol_solicitado": "ENTRENADOR", "equipo_id": equipo_id, "mensaje": mensaje,
    })


def resolver(cliente, id_solicitud, **cuerpo):
    return cliente.patch(f"{URL}/{id_solicitud}", json=cuerpo)


@pytest.fixture
def escenario(api_como, crear_equipo, crear_jugador):
    """Un ESTANDAR con una solicitud de ficha pendiente y un coordinador."""
    equipo = crear_equipo()
    ficha = crear_jugador(equipo)
    estandar = api_como("ESTANDAR")
    uid = id_de(estandar)
    id_solicitud = pedir_ficha(estandar, ficha).get_json()["id"]
    return {
        "equipo": equipo, "ficha": ficha, "estandar": estandar, "uid": uid,
        "id_solicitud": id_solicitud, "coord": api_como("COORDINADOR"),
    }


# ============================================================================
# POST /api/solicitudes
# ============================================================================
def test_crear_sin_sesion_devuelve_401(api):
    r = api.post(URL, json={"rol_solicitado": "JUGADOR", "jugador_id": 1, "mensaje": MENSAJE})
    assert r.status_code == 401


def test_crear_sin_token_csrf_devuelve_403(api_como, crear_equipo, crear_jugador):
    ficha = crear_jugador(crear_equipo())
    estandar = api_como("ESTANDAR")
    r = estandar.post(
        URL, csrf=False,
        json={"rol_solicitado": "JUGADOR", "jugador_id": ficha, "mensaje": MENSAJE},
    )
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "csrf_invalido"
    assert n_solicitudes(id_de(estandar)) == 0


@pytest.mark.parametrize("rol", ["JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR"])
def test_crear_con_rol_que_no_es_estandar_devuelve_403(api_como, crear_equipo, crear_jugador, rol):
    ficha = crear_jugador(crear_equipo())
    cliente = api_como(rol)
    r = pedir_ficha(cliente, ficha)
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "sin_permiso"
    assert n_solicitudes(id_de(cliente)) == 0
    assert dueno_de_ficha(ficha) is None


def test_crear_solicitud_de_jugador_devuelve_201(api_como, crear_equipo, crear_jugador):
    ficha = crear_jugador(crear_equipo())
    estandar = api_como("ESTANDAR")
    uid = id_de(estandar)

    r = pedir_ficha(estandar, ficha, "  Soy este jugador.  ")
    assert r.status_code == 201
    cuerpo = r.get_json()
    assert r.headers["Location"] == f"/api/solicitudes/{cuerpo['id']}"
    assert set(cuerpo) == {
        "id", "usuario", "rol_solicitado", "jugador", "equipo", "mensaje",
        "estado", "comentario_resolucion", "creada_en", "resuelta_en",
    }
    assert cuerpo["usuario"]["id"] == uid
    assert cuerpo["rol_solicitado"] == "JUGADOR"
    assert cuerpo["jugador"] == {"id": ficha, "nombre_completo": "Test Jugador Prueba"}
    assert cuerpo["equipo"] is None
    assert cuerpo["mensaje"] == "Soy este jugador."          # se guarda recortado
    assert cuerpo["estado"] == "pendiente"
    assert cuerpo["comentario_resolucion"] is None
    assert cuerpo["resuelta_en"] is None
    assert "T" in cuerpo["creada_en"]

    # Pedir no concede nada: ni cambia el rol ni vincula la ficha.
    assert rol_de(uid) == "ESTANDAR"
    assert dueno_de_ficha(ficha) is None


def test_crear_solicitud_de_entrenador_devuelve_201(api_como, crear_equipo):
    equipo = crear_equipo()
    estandar = api_como("ESTANDAR")
    uid = id_de(estandar)

    r = pedir_equipo(estandar, equipo)
    assert r.status_code == 201
    cuerpo = r.get_json()
    assert cuerpo["rol_solicitado"] == "ENTRENADOR"
    assert cuerpo["jugador"] is None
    assert cuerpo["equipo"]["id"] == equipo
    assert cuerpo["estado"] == "pendiente"
    assert rol_de(uid) == "ESTANDAR"
    assert entrenador_de(equipo) is None


def test_crear_ignora_campos_que_no_son_del_contrato(api_como, crear_equipo, crear_jugador):
    ficha = crear_jugador(crear_equipo())
    estandar = api_como("ESTANDAR")
    r = estandar.post(URL, json={
        "rol_solicitado": "JUGADOR", "jugador_id": ficha, "mensaje": MENSAJE,
        "rol": "DESARROLLADOR", "estado": "aprobada", "id_usuario": 1,
    })
    assert r.status_code == 201
    assert r.get_json()["estado"] == "pendiente"
    assert rol_de(id_de(estandar)) == "ESTANDAR"


@pytest.mark.parametrize("cuerpo", ["esto no es json", "[1, 2]", '"texto"'])
def test_crear_con_cuerpo_que_no_es_un_objeto_json_devuelve_400(api_como, cuerpo):
    estandar = api_como("ESTANDAR")
    r = estandar.post(URL, data=cuerpo, headers={"Content-Type": "application/json"})
    assert r.status_code == 400
    assert r.get_json()["error"]["codigo"] == "json_invalido"
    assert n_solicitudes(id_de(estandar)) == 0


@pytest.mark.parametrize("rol", [None, "", "COORDINADOR", "DESARROLLADOR", "ESTANDAR", "jugador", 5])
def test_crear_con_rol_solicitado_invalido_devuelve_422(api_como, crear_equipo, crear_jugador, rol):
    ficha = crear_jugador(crear_equipo())
    estandar = api_como("ESTANDAR")
    r = estandar.post(URL, json={"rol_solicitado": rol, "jugador_id": ficha, "mensaje": MENSAJE})
    assert r.status_code == 422
    campos = [d["campo"] for d in r.get_json()["error"]["detalles"]]
    assert "rol_solicitado" in campos
    assert n_solicitudes(id_de(estandar)) == 0


@pytest.mark.parametrize("mensaje", [None, 123, "", "abcd", "    abc  ", "x" * 501])
def test_crear_con_mensaje_invalido_devuelve_422(api_como, crear_equipo, crear_jugador, mensaje):
    ficha = crear_jugador(crear_equipo())
    estandar = api_como("ESTANDAR")
    r = pedir_ficha(estandar, ficha, mensaje)
    assert r.status_code == 422
    campos = [d["campo"] for d in r.get_json()["error"]["detalles"]]
    assert campos == ["mensaje"]
    assert n_solicitudes(id_de(estandar)) == 0


@pytest.mark.parametrize("mensaje", ["abcde", "x" * 500])
def test_crear_acepta_los_limites_del_mensaje(api_como, crear_equipo, crear_jugador, mensaje):
    ficha = crear_jugador(crear_equipo())
    assert pedir_ficha(api_como("ESTANDAR"), ficha, mensaje).status_code == 201


@pytest.mark.parametrize("valor_id", [None, "1", True, 0, -1, 1.5, 2 ** 40])
def test_crear_jugador_con_jugador_id_invalido_devuelve_422(api_como, valor_id):
    estandar = api_como("ESTANDAR")
    r = estandar.post(URL, json={
        "rol_solicitado": "JUGADOR", "jugador_id": valor_id, "mensaje": MENSAJE,
    })
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "jugador_id"
    assert n_solicitudes(id_de(estandar)) == 0


@pytest.mark.parametrize("valor_id", [None, "1", True, 0, -1, 1.5, 2 ** 40])
def test_crear_entrenador_con_equipo_id_invalido_devuelve_422(api_como, valor_id):
    estandar = api_como("ESTANDAR")
    r = estandar.post(URL, json={
        "rol_solicitado": "ENTRENADOR", "equipo_id": valor_id, "mensaje": MENSAJE,
    })
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "equipo_id"
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_no_admite_ficha_y_equipo_a_la_vez(api_como, crear_equipo, crear_jugador):
    equipo = crear_equipo()
    ficha = crear_jugador(equipo)
    estandar = api_como("ESTANDAR")
    for rol in ("JUGADOR", "ENTRENADOR"):
        r = estandar.post(URL, json={
            "rol_solicitado": rol, "jugador_id": ficha, "equipo_id": equipo, "mensaje": MENSAJE,
        })
        assert r.status_code == 422
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_con_ficha_inexistente_devuelve_422(api_como):
    estandar = api_como("ESTANDAR")
    r = pedir_ficha(estandar, 2_000_000_000)
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "jugador_id"
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_con_ficha_dada_de_baja_devuelve_422(api_como, crear_equipo, crear_jugador):
    ficha = crear_jugador(crear_equipo(), activo=False)
    estandar = api_como("ESTANDAR")
    assert pedir_ficha(estandar, ficha).status_code == 422
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_con_equipo_inexistente_devuelve_422(api_como):
    estandar = api_como("ESTANDAR")
    r = pedir_equipo(estandar, 2_000_000_000)
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "equipo_id"
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_con_equipo_rival_devuelve_422(api_como, crear_equipo):
    rival = crear_equipo(propio=False)
    estandar = api_como("ESTANDAR")
    assert pedir_equipo(estandar, rival).status_code == 422
    assert n_solicitudes(id_de(estandar)) == 0


def test_crear_con_ficha_ya_vinculada_devuelve_409(api_como, crear_usuario, crear_equipo, crear_jugador):
    otro = crear_usuario("JUGADOR")
    ficha = crear_jugador(crear_equipo(), id_usuario=otro["id"])
    estandar = api_como("ESTANDAR")
    r = pedir_ficha(estandar, ficha)
    assert r.status_code == 409
    assert r.get_json()["error"]["codigo"] == "conflicto"
    assert n_solicitudes(id_de(estandar)) == 0
    assert dueno_de_ficha(ficha) == otro["id"]


def test_crear_con_equipo_que_ya_tiene_entrenador_devuelve_409(api_como, crear_usuario, crear_equipo):
    otro = crear_usuario("ENTRENADOR")
    equipo = crear_equipo(id_entrenador=otro["id"])
    estandar = api_como("ESTANDAR")
    assert pedir_equipo(estandar, equipo).status_code == 409
    assert n_solicitudes(id_de(estandar)) == 0
    assert entrenador_de(equipo) == otro["id"]


def test_una_segunda_solicitud_pendiente_devuelve_409(api_como, crear_equipo, crear_jugador):
    equipo = crear_equipo()
    ficha = crear_jugador(equipo)
    estandar = api_como("ESTANDAR")
    assert pedir_ficha(estandar, ficha).status_code == 201

    r = pedir_equipo(estandar, equipo)
    assert r.status_code == 409
    assert r.get_json()["error"]["codigo"] == "conflicto"
    assert n_solicitudes(id_de(estandar)) == 1


def test_tras_un_rechazo_se_puede_volver_a_solicitar(escenario):
    resolver(escenario["coord"], escenario["id_solicitud"], estado="rechazada", comentario="Falta información.")
    r = pedir_ficha(escenario["estandar"], escenario["ficha"], "Ahora con más datos.")
    assert r.status_code == 201
    assert n_solicitudes(escenario["uid"]) == 2


def test_tras_una_aprobacion_ya_no_se_puede_solicitar_mas(escenario, crear_jugador):
    resolver(escenario["coord"], escenario["id_solicitud"], estado="aprobada")
    otra = crear_jugador(escenario["equipo"])
    r = pedir_ficha(escenario["estandar"], otra)
    assert r.status_code == 403            # ya no es ESTANDAR
    assert n_solicitudes(escenario["uid"]) == 1


# ============================================================================
# GET /api/solicitudes/mias
# ============================================================================
def test_mias_sin_sesion_devuelve_401(api):
    assert api.get(f"{URL}/mias").status_code == 401


def test_mias_sin_solicitudes_devuelve_lista_vacia(api_como):
    r = api_como("ESTANDAR").get(f"{URL}/mias")
    assert r.status_code == 200
    assert r.get_json() == []


def test_mias_devuelve_solo_las_del_usuario(escenario, api_como):
    r = escenario["estandar"].get(f"{URL}/mias")
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert isinstance(cuerpo, list)                       # array directo, sin paginar
    assert [s["id"] for s in cuerpo] == [escenario["id_solicitud"]]

    ajeno = api_como("ESTANDAR").get(f"{URL}/mias")
    assert ajeno.get_json() == []


def test_mias_muestra_el_comentario_del_rechazo(escenario):
    resolver(escenario["coord"], escenario["id_solicitud"], estado="rechazada", comentario="Ficha equivocada.")
    s = escenario["estandar"].get(f"{URL}/mias").get_json()[0]
    assert s["estado"] == "rechazada"
    assert s["comentario_resolucion"] == "Ficha equivocada."
    assert s["resuelta_en"] is not None


@pytest.mark.parametrize("rol", ["JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR"])
def test_mias_la_puede_pedir_cualquier_rol(api_como, rol):
    assert api_como(rol).get(f"{URL}/mias").status_code == 200


# ============================================================================
# GET /api/solicitudes
# ============================================================================
def test_listar_sin_sesion_devuelve_401(api):
    assert api.get(URL).status_code == 401


@pytest.mark.parametrize("rol", ["ESTANDAR", "JUGADOR", "ENTRENADOR"])
def test_listar_con_rol_sin_permiso_devuelve_403(api_como, rol):
    r = api_como(rol).get(URL)
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "sin_permiso"


@pytest.mark.parametrize("rol", ["COORDINADOR", "DESARROLLADOR"])
def test_listar_devuelve_la_respuesta_paginada(escenario, api_como, rol):
    r = api_como(rol).get(f"{URL}?estado=pendiente&por_pagina=100")
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert set(cuerpo) == {"items", "page", "por_pagina", "total"}
    assert cuerpo["page"] == 1 and cuerpo["por_pagina"] == 100
    assert cuerpo["total"] >= 1
    assert escenario["id_solicitud"] in [s["id"] for s in cuerpo["items"]]
    assert all(s["estado"] == "pendiente" for s in cuerpo["items"])


def test_listar_filtra_por_estado(escenario):
    coord = escenario["coord"]
    sid = escenario["id_solicitud"]
    assert resolver(coord, sid, estado="aprobada").status_code == 200

    def ids(estado):
        r = coord.get(f"{URL}?estado={estado}&por_pagina=100")
        return [s["id"] for s in r.get_json()["items"]]

    assert sid not in ids("pendiente")
    assert sid in ids("aprobada")
    assert sid not in ids("rechazada")


def test_listar_respeta_la_paginacion(escenario):
    r = escenario["coord"].get(f"{URL}?por_pagina=1&page=1")
    cuerpo = r.get_json()
    assert r.status_code == 200
    assert cuerpo["por_pagina"] == 1
    assert len(cuerpo["items"]) <= 1


@pytest.mark.parametrize("consulta", [
    "estado=cualquiera", "estado=PENDIENTE", "page=0", "page=abc", "por_pagina=0", "por_pagina=101",
])
def test_listar_con_parametros_invalidos_devuelve_422(api_como, consulta):
    r = api_como("COORDINADOR").get(f"{URL}?{consulta}")
    assert r.status_code == 422
    assert r.get_json()["error"]["codigo"] == "validacion"


# ============================================================================
# PATCH /api/solicitudes/<id>
# ============================================================================
def test_resolver_sin_sesion_devuelve_401(api, escenario):
    r = api.patch(f"{URL}/{escenario['id_solicitud']}", json={"estado": "aprobada"})
    assert r.status_code == 401
    assert estado_de(escenario["id_solicitud"]) == "pendiente"


@pytest.mark.parametrize("rol", ["ESTANDAR", "JUGADOR", "ENTRENADOR"])
def test_resolver_con_rol_sin_permiso_devuelve_403_y_no_cambia_nada(escenario, api_como, rol):
    r = resolver(api_como(rol), escenario["id_solicitud"], estado="aprobada")
    assert r.status_code == 403
    assert estado_de(escenario["id_solicitud"]) == "pendiente"
    assert rol_de(escenario["uid"]) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) is None


@pytest.mark.parametrize("rol", ["COORDINADOR", "DESARROLLADOR"])
def test_aprobar_ficha_cambia_rol_vincula_y_cierra(escenario, api_como, rol):
    r = resolver(api_como(rol), escenario["id_solicitud"], estado="aprobada", comentario="Bienvenido.")
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert cuerpo["estado"] == "aprobada"
    assert cuerpo["comentario_resolucion"] == "Bienvenido."
    assert cuerpo["resuelta_en"] is not None

    assert estado_de(escenario["id_solicitud"]) == "aprobada"
    assert rol_de(escenario["uid"]) == "JUGADOR"
    assert dueno_de_ficha(escenario["ficha"]) == escenario["uid"]

    # El usuario lo nota en su siguiente petición, sin volver a iniciar sesión.
    yo = escenario["estandar"].get("/api/auth/yo").get_json()["usuario"]
    assert yo["rol"] == "JUGADOR"
    assert yo["jugador_id"] == escenario["ficha"]


@pytest.mark.parametrize("rol", ["COORDINADOR", "DESARROLLADOR"])
def test_aprobar_entrenador_cambia_rol_y_asigna_el_equipo(api_como, crear_equipo, rol):
    equipo = crear_equipo()
    estandar = api_como("ESTANDAR")
    uid = id_de(estandar)
    sid = pedir_equipo(estandar, equipo).get_json()["id"]

    r = resolver(api_como(rol), sid, estado="aprobada")
    assert r.status_code == 200
    assert r.get_json()["estado"] == "aprobada"
    assert rol_de(uid) == "ENTRENADOR"
    assert entrenador_de(equipo) == uid

    yo = estandar.get("/api/auth/yo").get_json()["usuario"]
    assert yo["rol"] == "ENTRENADOR"
    assert yo["equipo_id"] == equipo


def test_aprobar_no_exige_comentario(escenario):
    r = resolver(escenario["coord"], escenario["id_solicitud"], estado="aprobada")
    assert r.status_code == 200
    assert r.get_json()["comentario_resolucion"] is None


def test_rechazar_guarda_el_comentario_y_no_concede_nada(escenario):
    r = resolver(escenario["coord"], escenario["id_solicitud"], estado="rechazada", comentario="  No eres tú.  ")
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert cuerpo["estado"] == "rechazada"
    assert cuerpo["comentario_resolucion"] == "No eres tú."
    assert cuerpo["resuelta_en"] is not None
    assert rol_de(escenario["uid"]) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) is None


@pytest.mark.parametrize("comentario", [None, "", "    "])
def test_rechazar_sin_comentario_devuelve_422_y_sigue_pendiente(escenario, comentario):
    cuerpo = {"estado": "rechazada"}
    if comentario is not None:
        cuerpo["comentario"] = comentario
    r = resolver(escenario["coord"], escenario["id_solicitud"], **cuerpo)
    assert r.status_code == 422
    assert r.get_json()["error"]["detalles"][0]["campo"] == "comentario"
    assert estado_de(escenario["id_solicitud"]) == "pendiente"


@pytest.mark.parametrize("cuerpo", [
    {}, {"estado": None}, {"estado": ""}, {"estado": "pendiente"}, {"estado": "aprobar"},
    {"estado": "APROBADA"}, {"estado": 1},
    {"estado": "aprobada", "comentario": 123},
    {"estado": "aprobada", "comentario": "x" * 501},
])
def test_resolver_con_datos_invalidos_devuelve_422_y_no_cambia_nada(escenario, cuerpo):
    r = resolver(escenario["coord"], escenario["id_solicitud"], **cuerpo)
    assert r.status_code == 422
    assert estado_de(escenario["id_solicitud"]) == "pendiente"
    assert rol_de(escenario["uid"]) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) is None


def test_resolver_con_cuerpo_que_no_es_json_devuelve_400(escenario):
    r = escenario["coord"].patch(f"{URL}/{escenario['id_solicitud']}", data="no es json")
    assert r.status_code == 400
    assert estado_de(escenario["id_solicitud"]) == "pendiente"


def test_resolver_una_solicitud_inexistente_devuelve_404(api_como):
    r = resolver(api_como("COORDINADOR"), 999_999_999, estado="aprobada")
    assert r.status_code == 404
    assert r.get_json()["error"]["codigo"] == "no_encontrado"


@pytest.mark.parametrize("segundo", [
    {"estado": "aprobada"},
    {"estado": "rechazada", "comentario": "Ahora no."},
])
def test_una_solicitud_resuelta_no_se_puede_resolver_otra_vez(escenario, segundo):
    coord, sid = escenario["coord"], escenario["id_solicitud"]
    assert resolver(coord, sid, estado="aprobada").status_code == 200

    r = resolver(coord, sid, **segundo)
    assert r.status_code == 409
    assert estado_de(sid) == "aprobada"
    assert rol_de(escenario["uid"]) == "JUGADOR"


def test_una_solicitud_rechazada_no_se_puede_aprobar_despues(escenario):
    coord, sid = escenario["coord"], escenario["id_solicitud"]
    assert resolver(coord, sid, estado="rechazada", comentario="No.").status_code == 200

    assert resolver(coord, sid, estado="aprobada").status_code == 409
    assert estado_de(sid) == "rechazada"
    assert rol_de(escenario["uid"]) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) is None


def test_si_otra_solicitud_ya_se_llevo_la_ficha_aprobar_devuelve_409(escenario, api_como):
    # Dos usuarios piden la misma ficha (es posible: ambas quedan pendientes).
    rival = api_como("ESTANDAR")
    rival_id = id_de(rival)
    sid_rival = pedir_ficha(rival, escenario["ficha"]).get_json()["id"]

    coord = escenario["coord"]
    assert resolver(coord, escenario["id_solicitud"], estado="aprobada").status_code == 200

    r = resolver(coord, sid_rival, estado="aprobada")
    assert r.status_code == 409
    assert estado_de(sid_rival) == "pendiente"             # se puede rechazar después
    assert rol_de(rival_id) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) == escenario["uid"]

    assert resolver(coord, sid_rival, estado="rechazada", comentario="Ficha ya asignada.").status_code == 200


def test_si_otra_solicitud_ya_se_llevo_el_equipo_aprobar_devuelve_409(api_como, crear_equipo):
    equipo = crear_equipo()
    primero, segundo = api_como("ESTANDAR"), api_como("ESTANDAR")
    sid1 = pedir_equipo(primero, equipo).get_json()["id"]
    sid2 = pedir_equipo(segundo, equipo).get_json()["id"]

    coord = api_como("COORDINADOR")
    assert resolver(coord, sid1, estado="aprobada").status_code == 200
    r = resolver(coord, sid2, estado="aprobada")
    assert r.status_code == 409
    assert estado_de(sid2) == "pendiente"
    assert rol_de(id_de(segundo)) == "ESTANDAR"
    assert entrenador_de(equipo) == id_de(primero)


def test_aprobar_es_atomico_si_el_usuario_ya_entrena_otro_equipo(api_como, crear_equipo):
    pedido, otro = crear_equipo(), crear_equipo()
    estandar = api_como("ESTANDAR")
    uid = id_de(estandar)
    sid = pedir_equipo(estandar, pedido).get_json()["id"]

    # Entre la petición y la aprobación, el usuario queda como entrenador de otro equipo.
    ejecutar("UPDATE equipo SET id_entrenador = %s WHERE id_equipo = %s", (uid, otro))

    r = resolver(api_como("COORDINADOR"), sid, estado="aprobada")
    assert r.status_code == 409
    # No se guardó NADA de la aprobación.
    assert estado_de(sid) == "pendiente"
    assert rol_de(uid) == "ESTANDAR"
    assert entrenador_de(pedido) is None
    assert entrenador_de(otro) == uid


def test_aprobar_devuelve_409_si_el_usuario_ya_no_es_estandar(escenario):
    ejecutar("UPDATE usuarios SET rol = 'ENTRENADOR' WHERE id_usuario = %s", (escenario["uid"],))

    r = resolver(escenario["coord"], escenario["id_solicitud"], estado="aprobada")
    assert r.status_code == 409
    assert estado_de(escenario["id_solicitud"]) == "pendiente"
    assert rol_de(escenario["uid"]) == "ENTRENADOR"
    assert dueno_de_ficha(escenario["ficha"]) is None


def test_aprobar_devuelve_409_si_la_ficha_se_dio_de_baja(escenario):
    ejecutar("UPDATE jugador SET activo = false WHERE id_jugador = %s", (escenario["ficha"],))

    r = resolver(escenario["coord"], escenario["id_solicitud"], estado="aprobada")
    assert r.status_code == 409
    assert estado_de(escenario["id_solicitud"]) == "pendiente"
    assert rol_de(escenario["uid"]) == "ESTANDAR"
    assert dueno_de_ficha(escenario["ficha"]) is None
