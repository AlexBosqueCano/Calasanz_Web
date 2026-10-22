"""Autenticación del CD. Calasanz.

Tarea E1: registro de usuarios con hash de contraseña (argon2id).
Login, logout y sesión (E2) se añadirán a este mismo blueprint.
"""
import os
import re

import psycopg2
from argon2 import PasswordHasher
from flask import Blueprint, jsonify, request
from psycopg2 import errors

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# argon2id es el algoritmo por defecto de argon2-cffi.
ph = PasswordHasher()

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def get_db_connection():
    # TODO (M3): sustituir por la capa de acceso a datos común que haga Mateo.
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "calasanz_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASS", "postgres"),
    )


def error(codigo, mensaje, status, detalles=None):
    """Respuesta de error en el formato del contrato de la API."""
    cuerpo = {"codigo": codigo, "mensaje": mensaje}
    if detalles:
        cuerpo["detalles"] = detalles
    return jsonify(error=cuerpo), status


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

    usuario = {
        "id": fila[0],
        "username": fila[1],
        "email": fila[2],
        "rol": fila[3],
        "activo": fila[4],
        "jugador_id": None,
        "equipo_id": None,
    }
    return jsonify(usuario), 201