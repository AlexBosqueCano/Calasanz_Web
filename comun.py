"""Capa común de acceso a datos, validaciones y errores de la API (M2, M3, M9)."""
from datetime import date, datetime
import os

from flask import g, jsonify, request
import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor


# ----------------------------------------------------------------------------
# Excepción de negocio y respuestas de error (§1 del Contrato)
# ----------------------------------------------------------------------------
class ApiError(Exception):
    """Excepción controlada que se convierte automáticamente en respuesta JSON."""

    def __init__(self, codigo, mensaje, status=422, detalles=None, headers=None):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.status = status
        self.detalles = detalles
        self.headers = headers or {}


def error(codigo, mensaje, status, detalles=None):
    """Respuesta de error en el formato del contrato de la API."""
    cuerpo = {"codigo": codigo, "mensaje": mensaje}
    if detalles:
        cuerpo["detalles"] = detalles
    return jsonify(error=cuerpo), status


# ----------------------------------------------------------------------------
# Conexión a Base de Datos (M3)
# ----------------------------------------------------------------------------
def get_db_connection():
    """Abre una conexión a PostgreSQL usando las variables de entorno."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "calasanz_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASS", "postgres"),
    )


def dict_cursor(conn):
    """Cursor que devuelve cada fila como diccionario {columna: valor}."""
    return conn.cursor(cursor_factory=RealDictCursor)


def get_db():
    """Obtiene una conexión asociada al contexto de la petición actual (g)."""
    if "db_conn" not in g or g.db_conn.closed:
        g.db_conn = get_db_connection()
    return g.db_conn


def close_db(_exc=None):
    """Cierra la conexión de g al terminar la petición."""
    conn = g.pop("db_conn", None)
    if conn is not None and not conn.closed:
        conn.close()


# ----------------------------------------------------------------------------
# Conversión de usuario (M2)
# ----------------------------------------------------------------------------
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


# ----------------------------------------------------------------------------
# Helpers de entrada, tipos y paginación (M3 + M9)
# ----------------------------------------------------------------------------
def leer_json():
    """Lee el cuerpo JSON de la petición o lanza 400 json_invalido."""
    if not request.is_json:
        raise ApiError("json_invalido", "El cuerpo debe ser un JSON válido.", 400)
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        raise ApiError("json_invalido", "El cuerpo debe ser un objeto JSON válido.", 400)
    return datos


def es_entero(valor):
    """Comprueba que sea int real (en Python isinstance(True, int) es True)."""
    return isinstance(valor, int) and not isinstance(valor, bool)


def parsear_entero_query(nombre, default=None, minimo=None, maximo=None):
    """Lee un parámetro entero de request.args o lanza 422 si no es válido."""
    raw = request.args.get(nombre)
    if raw is None or raw == "":
        return default
    try:
        valor = int(raw)
    except ValueError:
        raise ApiError(
            "validacion",
            "Parámetros de consulta no válidos.",
            422,
            [{"campo": nombre, "mensaje": "Debe ser un número entero."}],
        )
    if minimo is not None and valor < minimo:
        raise ApiError(
            "validacion",
            "Parámetros de consulta no válidos.",
            422,
            [{"campo": nombre, "mensaje": f"Debe ser mayor o igual que {minimo}."}],
        )
    if maximo is not None and valor > maximo:
        raise ApiError(
            "validacion",
            "Parámetros de consulta no válidos.",
            422,
            [{"campo": nombre, "mensaje": f"No puede superar {maximo}."}],
        )
    return valor


def parsear_bool_query(nombre, default=None):
    """Lee un parámetro booleano ('true'/'false'/'1'/'0') de request.args."""
    raw = request.args.get(nombre)
    if raw is None or raw == "":
        return default
    val = raw.strip().lower()
    if val in ("true", "1"):
        return True
    if val in ("false", "0"):
        return False
    raise ApiError(
        "validacion",
        "Parámetros de consulta no válidos.",
        422,
        [{"campo": nombre, "mensaje": "Debe ser true o false."}],
    )


def parsear_fecha(valor, campo="fecha"):
    """Convierte un string YYYY-MM-DD en datetime.date o lanza 422."""
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    if not isinstance(valor, str) or len(valor) != 10:
        raise ApiError(
            "validacion",
            "Hay datos que no son válidos.",
            422,
            [{"campo": campo, "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)."}],
        )
    try:
        return date.fromisoformat(valor)
    except ValueError:
        raise ApiError(
            "validacion",
            "Hay datos que no son válidos.",
            422,
            [{"campo": campo, "mensaje": "La fecha indicada no es válida."}],
        )


def parametros_paginacion():
    """Devuelve (page, por_pagina, offset) validados según §1 del contrato."""
    page = parsear_entero_query("page", default=1, minimo=1)
    por_pagina = parsear_entero_query("por_pagina", default=20, minimo=1, maximo=100)
    offset = (page - 1) * por_pagina
    return page, por_pagina, offset


def respuesta_paginada(items, page, por_pagina, total):
    """Estructura estándar de listado paginado (§1 del contrato)."""
    return {
        "items": items,
        "page": page,
        "por_pagina": por_pagina,
        "total": total,
    }


# ----------------------------------------------------------------------------
# Traducción de errores de PostgreSQL y Manejadores Globales (M9)
# ----------------------------------------------------------------------------
def traducir_error_bd(exc):
    """Convierte excepciones de psycopg2 en respuestas JSON 409 o 422 sin filtrar SQL."""
    if isinstance(exc, pg_errors.RaiseException):
        mensaje_trigger = str(exc).split("\n")[0].replace("ERROR:", "").strip()
        return error(
            "validacion",
            "Hay datos que no son válidos.",
            422,
            [{"campo": "goles_recibidos", "mensaje": mensaje_trigger}],
        )

    if isinstance(exc, pg_errors.UniqueViolation):
        diag = getattr(exc, "diag", None)
        constraint = getattr(diag, "constraint_name", "") or ""
        if "dorsal" in constraint:
            return error("conflicto", "Ese dorsal ya está ocupado por un jugador activo del equipo.", 409)
        if "lesion" in constraint:
            return error("conflicto", "El jugador ya tiene una lesión activa registrada.", 409)
        if "solicitud" in constraint:
            return error("conflicto", "Ya existe una solicitud pendiente para este usuario.", 409)
        if "cronica" in constraint:
            return error("conflicto", "Este partido ya tiene una crónica publicada.", 409)
        if "entrenador" in constraint:
            return error("conflicto", "Ese entrenador ya tiene un equipo asignado.", 409)
        return error("conflicto", "El recurso entra en conflicto con un registro existente.", 409)

    if isinstance(exc, pg_errors.ForeignKeyViolation):
        diag = getattr(exc, "diag", None)
        detalle_fk = (getattr(diag, "message_detail", "") or "").lower()
        if "still referenced" in detalle_fk or "referida" in detalle_fk:
            return error("conflicto", "No se puede eliminar porque tiene registros asociados.", 409)
        return error("validacion", "Uno de los recursos relacionados no existe.", 422)

    if isinstance(exc, (pg_errors.CheckViolation, pg_errors.NotNullViolation, pg_errors.DataException)):
        diag = getattr(exc, "diag", None)
        constraint = getattr(diag, "constraint_name", "") or "datos"
        return error(
            "validacion",
            "Hay datos que no son válidos.",
            422,
            [{"campo": constraint, "mensaje": "El valor incumple las restricciones de validación."}],
        )

    return error("error_interno", "Error interno del servidor.", 500)


def registrar_manejadores_errores(app):
    """Registra el control global de errores JSON en la aplicación Flask."""
    app.teardown_appcontext(close_db)

    @app.errorhandler(ApiError)
    def manejar_api_error(exc):
        resp, status = error(exc.codigo, exc.mensaje, exc.status, exc.detalles)
        for k, v in exc.headers.items():
            resp.headers[k] = v
        return resp, status

    @app.errorhandler(psycopg2.Error)
    def manejar_error_postgres(exc):
        conn = g.get("db_conn")
        if conn is not None and not conn.closed:
            conn.rollback()
        return traducir_error_bd(exc)

    @app.errorhandler(400)
    def manejar_400(_exc):
        return error("json_invalido", "La petición no es válida.", 400)

    @app.errorhandler(404)
    def manejar_404(_exc):
        if request.path.startswith("/api/"):
            return error("no_encontrado", "El recurso solicitado no existe.", 404)
        return "Página no encontrada", 404

    @app.errorhandler(405)
    def manejar_405(_exc):
        return error("no_encontrado", "Método no permitido en esta ruta.", 405)

    @app.errorhandler(500)
    def manejar_500(_exc):
        return error("error_interno", "Error interno del servidor.", 500)
