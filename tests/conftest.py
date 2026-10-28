import os
import secrets
import sys
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "clave-solo-para-tests")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

METODOS_CON_TOKEN = ("post", "put", "patch", "delete")
CLAVE_DE_PRUEBA = "clave-de-test-123"


class ClienteAPI:
    def __init__(self, cliente):
        self._cliente = cliente
        self.csrf_token = None

    def login(self, username, password):
        r = self._cliente.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        if r.status_code == 200:
            self.csrf_token = r.get_json()["csrf_token"]
        return r

    def _enviar(self, metodo, url, csrf, kwargs):
        headers = dict(kwargs.pop("headers", None) or {})
        if csrf and self.csrf_token and metodo in METODOS_CON_TOKEN:
            headers.setdefault("X-CSRF-Token", self.csrf_token)
        return getattr(self._cliente, metodo)(url, headers=headers, **kwargs)

    def get(self, url, **kwargs):
        return self._enviar("get", url, True, kwargs)

    def post(self, url, csrf=True, **kwargs):
        return self._enviar("post", url, csrf, kwargs)

    def put(self, url, csrf=True, **kwargs):
        return self._enviar("put", url, csrf, kwargs)

    def patch(self, url, csrf=True, **kwargs):
        return self._enviar("patch", url, csrf, kwargs)

    def delete(self, url, csrf=True, **kwargs):
        return self._enviar("delete", url, csrf, kwargs)


def _nuevo_cliente():
    from app import app as flask_app

    flask_app.config["TESTING"] = True
    return ClienteAPI(flask_app.test_client())


@pytest.fixture
def api():
    return _nuevo_cliente()


@pytest.fixture
def crear_usuario():
    from argon2 import PasswordHasher
    from comun import get_db_connection

    ids_creados = []

    def _crear(rol="ESTANDAR", password=CLAVE_DE_PRUEBA):
        username = f"t_{rol.lower()}_{secrets.token_hex(3)}"
        conn = get_db_connection()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO usuarios (username, email, password_hash, rol)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id_usuario
                    """,
                    (username, f"{username}@test.local",
                     PasswordHasher().hash(password), rol),
                )
                id_usuario = cur.fetchone()[0]
        finally:
            conn.close()
        ids_creados.append(id_usuario)
        return {"id": id_usuario, "username": username,
                "password": password, "rol": rol}

    yield _crear

    if ids_creados:
        conn = get_db_connection()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM usuarios WHERE id_usuario = ANY(%s)", (ids_creados,)
                )
        finally:
            conn.close()


@pytest.fixture
def api_como(crear_usuario):
    def _api_como(rol="ESTANDAR"):
        usuario = crear_usuario(rol)
        cliente = _nuevo_cliente()
        r = cliente.login(usuario["username"], usuario["password"])
        assert r.status_code == 200, f"No se pudo iniciar sesión como {rol}: {r.get_json()}"
        return cliente

    return _api_como
