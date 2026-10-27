"""Tests de permisos (E3). No necesitan base de datos.

Se simula el «usuario de la BD» y las consultas de propiedad con monkeypatch,
y se prueba con una mini-app de Flask creada aquí mismo. Así se pueden ejecutar
ya, antes de que exista el esquema nuevo (M2) y los fixtures comunes (G3).
"""
import sys
from pathlib import Path

# Permite `import permisos` aunque pytest se ejecute desde otra carpeta.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from flask import Flask, jsonify

import permisos
from permisos import (
    ROLES,
    login_required,
    puede_modificar_propio,
    puede_sobre_equipo,
    puede_sobre_liga,
    puede_ver_datos_fisicos,
    rol_requerido,
)

STAFF = ("COORDINADOR", "DESARROLLADOR")


def _usuario(id_, rol):
    return {
        "id": id_, "username": rol.lower(), "email": f"{rol.lower()}@ejemplo.com",
        "rol": rol, "activo": True, "jugador_id": None, "equipo_id": None,
    }


USUARIOS = {rol: _usuario(i, rol) for i, rol in enumerate(ROLES, start=1)}


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------
@pytest.fixture
def bd(monkeypatch):
    """La «tabla usuarios»: se puede modificar dentro de cada test."""
    usuarios = {u["id"]: dict(u) for u in USUARIOS.values()}
    monkeypatch.setattr(permisos, "cargar_usuario", usuarios.get)
    return usuarios


@pytest.fixture
def app(bd):
    app = Flask(__name__)
    app.config.update(SECRET_KEY="clave-de-test", TESTING=True)

    @app.route("/abierta")
    @login_required
    def abierta():
        return jsonify(ok=True)

    @app.route("/gestion")
    @rol_requerido("COORDINADOR", "DESARROLLADOR")
    def gestion():
        return jsonify(ok=True)

    @app.route("/entrenadores")
    @rol_requerido("ENTRENADOR")
    def entrenadores():
        return jsonify(ok=True)

    return app


def cliente_como(app, rol=None):
    """Cliente de pruebas con la sesión iniciada como ese rol (o sin sesión)."""
    cliente = app.test_client()
    if rol:
        with cliente.session_transaction() as sesion:
            sesion["user_id"] = USUARIOS[rol]["id"]
    return cliente


# ----------------------------------------------------------------------------
# login_required y rol_requerido
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("ruta", ["/abierta", "/gestion", "/entrenadores"])
def test_sin_sesion_devuelve_401(app, ruta):
    r = cliente_como(app).get(ruta)
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


@pytest.mark.parametrize("rol", ROLES)
def test_login_required_deja_pasar_a_cualquier_rol(app, rol):
    assert cliente_como(app, rol).get("/abierta").status_code == 200


@pytest.mark.parametrize("rol", ROLES)
def test_rol_requerido_gestion(app, rol):
    r = cliente_como(app, rol).get("/gestion")
    if rol in STAFF:
        assert r.status_code == 200
    else:
        assert r.status_code == 403
        assert r.get_json()["error"]["codigo"] == "sin_permiso"


@pytest.mark.parametrize("rol", ROLES)
def test_rol_requerido_solo_entrenador(app, rol):
    r = cliente_como(app, rol).get("/entrenadores")
    assert r.status_code == (200 if rol == "ENTRENADOR" else 403)


def test_usuario_desactivado_pierde_el_acceso(app, bd):
    cliente = cliente_como(app, "COORDINADOR")
    assert cliente.get("/gestion").status_code == 200
    bd[USUARIOS["COORDINADOR"]["id"]]["activo"] = False
    assert cliente.get("/gestion").status_code == 401


def test_cambio_de_rol_se_nota_en_la_siguiente_peticion(app, bd):
    cliente = cliente_como(app, "ESTANDAR")
    assert cliente.get("/gestion").status_code == 403
    bd[USUARIOS["ESTANDAR"]["id"]]["rol"] = "COORDINADOR"
    assert cliente.get("/gestion").status_code == 200


def test_usuario_borrado_devuelve_401(app, bd):
    cliente = cliente_como(app, "JUGADOR")
    del bd[USUARIOS["JUGADOR"]["id"]]
    assert cliente.get("/abierta").status_code == 401


def test_rol_mal_escrito_falla_al_declarar_la_ruta():
    with pytest.raises(ValueError):
        rol_requerido("ADMIN")
    with pytest.raises(ValueError):
        rol_requerido()


def test_las_rutas_conservan_su_nombre(app):
    assert {"abierta", "gestion", "entrenadores"} <= set(app.view_functions)


# ----------------------------------------------------------------------------
# Propiedad: puede_sobre_equipo
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("rol, es_su_equipo, esperado", [
    ("ESTANDAR", True, False),
    ("JUGADOR", True, False),
    ("ENTRENADOR", True, True),
    ("ENTRENADOR", False, False),     # entrenador de OTRO equipo
    ("COORDINADOR", False, True),
    ("DESARROLLADOR", False, True),
])
def test_puede_sobre_equipo(monkeypatch, rol, es_su_equipo, esperado):
    monkeypatch.setattr(permisos, "es_entrenador_de", lambda u, e: es_su_equipo)
    assert puede_sobre_equipo(USUARIOS[rol], 1) is esperado


def test_apuntes_el_coordinador_no_pero_el_desarrollador_si(monkeypatch):
    monkeypatch.setattr(permisos, "es_entrenador_de", lambda u, e: True)
    solo_dev = ("DESARROLLADOR",)
    assert puede_sobre_equipo(USUARIOS["COORDINADOR"], 1, globales=solo_dev) is False
    assert puede_sobre_equipo(USUARIOS["DESARROLLADOR"], 1, globales=solo_dev) is True
    assert puede_sobre_equipo(USUARIOS["ENTRENADOR"], 1, globales=solo_dev) is True


def test_el_staff_no_consulta_la_bd(monkeypatch):
    def no_deberia_llamarse(*args):
        raise AssertionError("No hacía falta consultar la BD")

    monkeypatch.setattr(permisos, "es_entrenador_de", no_deberia_llamarse)
    monkeypatch.setattr(permisos, "es_de_su_liga", no_deberia_llamarse)
    for rol in STAFF:
        assert puede_sobre_equipo(USUARIOS[rol], 1) is True
        assert puede_sobre_liga(USUARIOS[rol], 1, 2) is True


# ----------------------------------------------------------------------------
# Propiedad: puede_sobre_liga
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("rol, de_su_liga, esperado", [
    ("ESTANDAR", True, False),
    ("JUGADOR", True, False),
    ("ENTRENADOR", True, True),
    ("ENTRENADOR", False, False),     # algún equipo es de otra competición
    ("COORDINADOR", False, True),
    ("DESARROLLADOR", False, True),
])
def test_puede_sobre_liga(monkeypatch, rol, de_su_liga, esperado):
    monkeypatch.setattr(permisos, "es_de_su_liga", lambda u, *ids: de_su_liga)
    assert puede_sobre_liga(USUARIOS[rol], 1, 11) is esperado


# ----------------------------------------------------------------------------
# Propiedad: datos físicos del jugador (estatura y peso)
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("rol, equipo_propio, ficha_propia, esperado", [
    ("ESTANDAR", True, True, False),
    ("JUGADOR", False, True, True),       # solo el suyo
    ("JUGADOR", False, False, False),     # el de un compañero
    ("ENTRENADOR", True, False, True),    # los de su equipo
    ("ENTRENADOR", False, False, False),  # los de otro equipo
    ("COORDINADOR", False, False, True),
    ("DESARROLLADOR", False, False, True),
])
def test_puede_ver_datos_fisicos(monkeypatch, rol, equipo_propio, ficha_propia, esperado):
    monkeypatch.setattr(permisos, "es_entrenador_de", lambda u, e: equipo_propio)
    monkeypatch.setattr(permisos, "es_su_ficha", lambda u, j: ficha_propia)
    assert puede_ver_datos_fisicos(USUARIOS[rol], jugador_id=3, equipo_id=1) is esperado


# ----------------------------------------------------------------------------
# Propiedad: editar o borrar lo que uno mismo ha escrito (crónicas, apuntes)
# ----------------------------------------------------------------------------
def test_el_autor_puede_modificar_lo_suyo():
    entrenador = USUARIOS["ENTRENADOR"]
    assert puede_modificar_propio(entrenador, autor_id=entrenador["id"]) is True


def test_un_entrenador_no_modifica_lo_de_otro():
    assert puede_modificar_propio(USUARIOS["ENTRENADOR"], autor_id=999) is False


def test_cronicas_el_staff_modifica_todo():
    for rol in STAFF:
        assert puede_modificar_propio(USUARIOS[rol], autor_id=999) is True


def test_apuntes_el_coordinador_no_modifica_lo_de_otros():
    solo_dev = ("DESARROLLADOR",)
    assert puede_modificar_propio(USUARIOS["COORDINADOR"], 999, globales=solo_dev) is False
    assert puede_modificar_propio(USUARIOS["DESARROLLADOR"], 999, globales=solo_dev) is True
