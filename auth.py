"""Autenticación del CD. Calasanz.

E1: registro de usuarios con hash de contraseña (argon2id).
E2: login, logout, /yo, sesión segura y protección CSRF.
"""
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from flask import Blueprint, g, jsonify, request, session
from psycopg2 import errors

from comun import error, get_db_connection, usuario_a_dict
from permisos import login_required

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# argon2id es el algoritmo por defecto de argon2-cffi.
ph = PasswordHasher()

# Hash de relleno: se usa cuando el usuario no existe, para que el login tarde
# lo mismo y no se pueda averiguar qué usuarios existen midiendo el tiempo.
DUMMY_HASH = ph.hash("contraseña-de-relleno")

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

METODOS_CON_CSRF = {"POST", "PUT", "PATCH", "DELETE"}
# Aún no hay sesión, así que no pueden llevar token.
RUTAS_SIN_CSRF = {"/api/auth/registro", "/api/auth/login"}


# ----------------------------------------------------------------------------
# CSRF: se ejecuta antes de CADA petición de la app (no solo las de este
# blueprint), así protege también las rutas que hagan los demás.
# ----------------------------------------------------------------------------
@bp.before_app_request
def comprobar_csrf():
    if request.method not in METODOS_CON_CSRF:
        return None
    if not request.path.startswith("/api/") or request.path in RUTAS_SIN_CSRF:
        return None
    if "user_id" not in session:
        return None  # sin sesión responderá 401 la propia ruta (login_required)

    enviado = request.headers.get("X-CSRF-Token", "")
    esperado = session.get("csrf_token", "")
    if not esperado or not secrets.compare_digest(
        enviado.encode(), esperado.encode()
    ):
        return error("csrf_invalido", "Token CSRF inválido o ausente.", 403)
    return None


# ----------------------------------------------------------------------------
# E1: registro
# ----------------------------------------------------------------------------
def validar_registro(datos):
    """Devuelve una lista de {campo, mensaje}. Vacía si todo es válido."""
    errores = []
    username = datos.get("username")
    email = datos.get("email")
    password = datos.get("password")

    if not isinstance(username, str) or not USERNAME_RE.match(username):
        errores.append({
            "campo": "username",
            "mensaje": "Debe tener entre 3 y 30 caracteres: letras, números, _ . -",
        })

    if not isinstance(email, str) or len(email) > 254 or not EMAIL_RE.match(email):
        errores.append({"campo": "email", "mensaje": "El email no es válido."})

    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        errores.append({
            "campo": "password",
            "mensaje": "Debe tener entre 10 y 128 caracteres.",
        })
    elif isinstance(username, str) and password.lower() == username.lower():
        errores.append({
            "campo": "password",
            "mensaje": "No puede ser igual que el nombre de usuario.",
        })

    return errores


@bp.route("/registro", methods=["POST"])
def registro():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        return error("json_invalido", "El cuerpo debe ser un JSON válido.", 400)

    errores = validar_registro(datos)
    if errores:
        return error("validacion", "Hay datos que no son válidos.", 422, errores)

    # Lo que se guarda es el hash, nunca la contraseña en claro.
    password_hash = ph.hash(datos["password"])

    conn = get_db_connection()
    try:
        # "with conn" confirma la transacción (o la deshace si hay excepción).
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO usuarios (username, email, password_hash, rol)
                VALUES (%s, %s, %s, 'ESTANDAR')
                RETURNING id_usuario, username, email, rol, activo
                """,
                (datos["username"], datos["email"], password_hash),
            )
            fila = cur.fetchone()
    except errors.UniqueViolation:
        # Los índices únicos de la BD (sin distinguir mayúsculas) garantizan
        # que no haya duplicados ni siquiera con dos peticiones simultáneas.
        return error("conflicto", "Ese usuario o email ya existe.", 409)
    finally:
        conn.close()

    return jsonify(usuario_a_dict(fila)), 201


# ----------------------------------------------------------------------------
# E2: login, logout, yo
# ----------------------------------------------------------------------------
@bp.route("/login", methods=["POST"])
def login():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        return error("json_invalido", "El cuerpo debe ser un JSON válido.", 400)

    username = datos.get("username")
    password = datos.get("password")
    if (
        not isinstance(username, str) or not username or len(username) > 30
        or not isinstance(password, str) or not password or len(password) > 128
    ):
        return error("validacion", "Hay datos que no son válidos.", 422, [
            {"campo": "username", "mensaje": "Obligatorio (máximo 30 caracteres)."},
            {"campo": "password", "mensaje": "Obligatoria (máximo 128 caracteres)."},
        ])

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id_usuario, username, email, rol, activo, password_hash
                FROM usuarios WHERE lower(username) = lower(%s)
                """,
                (username,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()

    # Se verifica SIEMPRE un hash, exista o no el usuario (mismo tiempo).
    hash_a_comprobar = fila[5] if fila else DUMMY_HASH
    try:
        ph.verify(hash_a_comprobar, password)
        password_correcta = fila is not None
    except (VerificationError, InvalidHashError):
        password_correcta = False

    # Mismo mensaje en todos los fallos: no se revela si el usuario existe.
    if not password_correcta or not fila[4]:
        return error("no_autenticado", "Usuario o contraseña incorrectos.", 401)

    # clear() descarta cualquier sesión anterior (evita la "fijación de sesión").
    session.clear()
    session.permanent = True
    session["user_id"] = fila[0]
    session["csrf_token"] = secrets.token_urlsafe(32)

    return jsonify(
        usuario=usuario_a_dict(fila[:5]),
        csrf_token=session["csrf_token"],
    ), 200


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return "", 204


@bp.route("/yo", methods=["GET"])
@login_required
def yo():
    return jsonify(usuario=g.usuario, csrf_token=session["csrf_token"]), 200
