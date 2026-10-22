"""Control de acceso.

Ahora mismo solo contiene login_required (lo que necesita E2).
En E3 se añadirán rol_requerido y la comprobación de propiedad.
"""
from functools import wraps

from flask import g, session

from comun import error, get_db_connection, usuario_a_dict


def cargar_usuario(user_id):
    """Lee el usuario de la BD. Devuelve un dict o None si no existe."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id_usuario, username, email, rol, activo
                FROM usuarios WHERE id_usuario = %s
                """,
                (user_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()
    return usuario_a_dict(fila) if fila else None


def login_required(f):
    """Exige sesión iniciada. Deja el usuario en g.usuario."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        user_id = session.get("user_id")
        usuario = cargar_usuario(user_id) if user_id else None

        # El rol y el estado se leen de la BD en cada petición (no de la cookie):
        # así, si desactivan a un usuario o le cambian el rol, se nota al momento.
        if usuario is None or not usuario["activo"]:
            session.clear()
            return error("no_autenticado", "Debes iniciar sesión.", 401)

        g.usuario = usuario
        return f(*args, **kwargs)

    return wrapper
