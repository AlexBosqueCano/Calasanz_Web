"""Utilidades compartidas por auth.py y permisos.py."""
import os

import psycopg2
from flask import jsonify


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


def usuario_a_dict(fila):
    """Convierte una fila de usuario en el recurso Usuario del contrato."""
    return {
        "id": fila[0],
        "username": fila[1],
        "email": fila[2],
        "rol": fila[3],
        "activo": fila[4],
        "jugador_id": fila[5] if len(fila) > 5 else None,
        "equipo_id": fila[6] if len(fila) > 6 else None,
    }
