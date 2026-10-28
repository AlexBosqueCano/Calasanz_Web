def test_login_devuelve_el_token_csrf(api, crear_usuario):
    usuario = crear_usuario()
    r = api.login(usuario["username"], usuario["password"])
    assert r.status_code == 200
    assert r.get_json()["csrf_token"]


def test_login_no_exige_token(api, crear_usuario):
    usuario = crear_usuario()
    r = api.post("/api/auth/login", csrf=False,
                 json={"username": usuario["username"], "password": usuario["password"]})
    assert r.status_code == 200


def test_post_sin_sesion_devuelve_401(api):
    r = api.post("/api/auth/logout")
    assert r.status_code == 401
    assert r.get_json()["error"]["codigo"] == "no_autenticado"


def test_post_con_sesion_pero_sin_token_devuelve_403(api_como):
    api = api_como()
    r = api.post("/api/auth/logout", csrf=False)
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "csrf_invalido"


def test_post_con_token_incorrecto_devuelve_403(api_como):
    api = api_como()
    r = api.post("/api/auth/logout", headers={"X-CSRF-Token": "token-falso"})
    assert r.status_code == 403
    assert r.get_json()["error"]["codigo"] == "csrf_invalido"


def test_post_con_token_correcto_funciona(api_como):
    api = api_como()
    assert api.post("/api/auth/logout").status_code == 204


def test_get_no_necesita_token(api_como):
    api = api_como()
    assert api.get("/api/auth/yo").status_code == 200


def test_yo_devuelve_el_mismo_token_del_login(api_como):
    api = api_como()
    r = api.get("/api/auth/yo")
    assert r.get_json()["csrf_token"] == api.csrf_token
