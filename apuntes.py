"""Apuntes tácticos privados del entrenador del CD. Calasanz (M8).

Endpoints (docs/API_CONTRATO.md, apartados 2, 3, 4 y 5):
    GET    /api/equipos/<id>/apuntes  ENTRENADOR del equipo, DESARROLLADOR  200 (array) · 403 · 404
    POST   /api/apuntes               ENTRENADOR del equipo, DESARROLLADOR  201 · 403 · 422
    PATCH  /api/apuntes/<id>          su autor, DESARROLLADOR               200 · 403 · 404 · 422
    DELETE /api/apuntes/<id>          su autor, DESARROLLADOR               204 · 403 · 404

Notas de diseño (para el examen oral):
    * Privacidad frente al coordinador: a diferencia de otros recursos del club,
      la matriz de permisos (§2) establece que los apuntes tácticos son privados
      del entrenador del equipo (y visibles para DESARROLLADOR por soporte), pero
      NO para el COORDINADOR. Por ello se invoca `puede_sobre_equipo` y
      `puede_modificar_propio` pasando explícitamente `globales=("DESARROLLADOR",)`.
    * Coherencia de liga: si se indica `rival_id`, se verifica en el servidor
      que pertenezca a la misma `competicion` que el equipo propio. Si se indica
      `partido_id`, debe existir y pertenecer a la misma competición/equipo.
"""
from flask import Blueprint, g, jsonify

from comun import (
    ApiError,
    dict_cursor,
    es_entero,
    get_db_connection,
    leer_json,
)
from permisos import (
    puede_modificar_propio,
    puede_sobre_equipo,
    rol_requerido,
)

bp = Blueprint("apuntes", __name__, url_prefix="/api")

MAX_ID = 2_147_483_647
TEXTO_MIN, TEXTO_MAX = 1, 2000
SOLO_DEV = ("DESARROLLADOR",)


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


def _validacion(detalles):
    return ApiError("validacion", "Hay datos que no son válidos.", 422, detalles)


def _sin_permiso():
    return ApiError("sin_permiso", "No tienes permiso para esta acción.", 403)


def _apunte_a_dict(fila):
    creado = fila["creado_en"]
    return {
        "id": fila["id_apunte"],
        "equipo_id": fila["id_equipo"],
        "rival_id": fila["id_rival"],
        "partido_id": fila["id_partido"],
        "texto": fila["texto"],
        "autor_id": fila["id_autor"],
        "creado_en": creado.isoformat() if hasattr(creado, "isoformat") else str(creado),
    }


# ----------------------------------------------------------------------------
# GET /api/equipos/<id>/apuntes
# ----------------------------------------------------------------------------
@bp.route("/equipos/<int:equipo_id>/apuntes", methods=["GET"])
@rol_requerido("ENTRENADOR", "DESARROLLADOR")
def listar_por_equipo(equipo_id):
    if not _id_valido(equipo_id):
        raise ApiError("no_encontrado", "El equipo no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_equipo, es_propio FROM equipo WHERE id_equipo = %s", (equipo_id,))
            eq = cur.fetchone()
            if eq is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            if not puede_sobre_equipo(g.usuario, equipo_id, globales=SOLO_DEV):
                raise _sin_permiso()

            cur.execute(
                """
                SELECT id_apunte, id_equipo, id_rival, id_partido, texto, id_autor, creado_en
                FROM apunte_entrenador
                WHERE id_equipo = %s
                ORDER BY creado_en DESC, id_apunte DESC
                """,
                (equipo_id,),
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    return jsonify([_apunte_a_dict(f) for f in filas]), 200


# ----------------------------------------------------------------------------
# POST /api/apuntes
# ----------------------------------------------------------------------------
@bp.route("/apuntes", methods=["POST"])
@rol_requerido("ENTRENADOR", "DESARROLLADOR")
def crear():
    datos = leer_json()
    errores = []

    equipo_id = datos.get("equipo_id")
    rival_id = datos.get("rival_id")
    partido_id = datos.get("partido_id")
    texto_raw = datos.get("texto")

    if not _id_valido(equipo_id):
        errores.append({"campo": "equipo_id", "mensaje": "Obligatorio (id del equipo propio)."})
    if rival_id is not None and not _id_valido(rival_id):
        errores.append({"campo": "rival_id", "mensaje": "Debe ser un identificador entero válido."})
    if partido_id is not None and not _id_valido(partido_id):
        errores.append({"campo": "partido_id", "mensaje": "Debe ser un identificador entero válido."})

    texto = texto_raw.strip() if isinstance(texto_raw, str) else None
    if texto is None or not TEXTO_MIN <= len(texto) <= TEXTO_MAX:
        errores.append({
            "campo": "texto",
            "mensaje": f"Obligatorio (entre {TEXTO_MIN} y {TEXTO_MAX} caracteres).",
        })

    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(
                "SELECT id_equipo, es_propio, competicion FROM equipo WHERE id_equipo = %s",
                (equipo_id,),
            )
            eq = cur.fetchone()
            if eq is None or not eq["es_propio"]:
                raise _validacion([{"campo": "equipo_id", "mensaje": "El equipo no existe o no es propio."}])

            if not puede_sobre_equipo(g.usuario, equipo_id, globales=SOLO_DEV):
                raise _sin_permiso()

            if rival_id is not None:
                if rival_id == equipo_id:
                    raise _validacion([{"campo": "rival_id", "mensaje": "El rival no puede ser el mismo equipo."}])
                cur.execute("SELECT competicion FROM equipo WHERE id_equipo = %s", (rival_id,))
                riv = cur.fetchone()
                if riv is None or riv["competicion"] != eq["competicion"]:
                    raise _validacion([{
                        "campo": "rival_id",
                        "mensaje": "El equipo rival no existe o no pertenece a la liga del equipo.",
                    }])

            if partido_id is not None:
                cur.execute(
                    """
                    SELECT p.local, p.visitante, el.competicion
                    FROM partido p
                    JOIN equipo el ON el.id_equipo = p.local
                    WHERE p.id_partido = %s
                    """,
                    (partido_id,),
                )
                part = cur.fetchone()
                if part is None or part["competicion"] != eq["competicion"]:
                    raise _validacion([{
                        "campo": "partido_id",
                        "mensaje": "El partido no existe o no pertenece a la liga del equipo.",
                    }])

            cur.execute(
                """
                INSERT INTO apunte_entrenador (id_equipo, id_rival, id_partido, texto, id_autor)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id_apunte, id_equipo, id_rival, id_partido, texto, id_autor, creado_en
                """,
                (equipo_id, rival_id, partido_id, texto, g.usuario["id"]),
            )
            creado = cur.fetchone()
    finally:
        conn.close()

    respuesta = jsonify(_apunte_a_dict(creado))
    respuesta.status_code = 201
    respuesta.headers["Location"] = f"/api/apuntes/{creado['id_apunte']}"
    return respuesta


# ----------------------------------------------------------------------------
# PATCH /api/apuntes/<id>
# ----------------------------------------------------------------------------
@bp.route("/apuntes/<int:apunte_id>", methods=["PATCH"])
@rol_requerido("ENTRENADOR", "DESARROLLADOR")
def modificar(apunte_id):
    if not _id_valido(apunte_id):
        raise ApiError("no_encontrado", "El apunte no existe.", 404)

    datos = leer_json()
    campos_extra = set(datos.keys()) - {"texto"}
    if campos_extra:
        raise _validacion([{"campo": "texto", "mensaje": "Solo se permite modificar el campo 'texto'."}])

    texto_raw = datos.get("texto")
    texto = texto_raw.strip() if isinstance(texto_raw, str) else None
    if texto is None or not TEXTO_MIN <= len(texto) <= TEXTO_MAX:
        raise _validacion([{
            "campo": "texto",
            "mensaje": f"Obligatorio (entre {TEXTO_MIN} y {TEXTO_MAX} caracteres).",
        }])

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(
                "SELECT id_apunte, id_equipo, id_autor FROM apunte_entrenador WHERE id_apunte = %s FOR UPDATE",
                (apunte_id,),
            )
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "El apunte no existe.", 404)

            if not puede_modificar_propio(g.usuario, actual["id_autor"], globales=SOLO_DEV):
                raise _sin_permiso()

            cur.execute(
                """
                UPDATE apunte_entrenador SET texto = %s WHERE id_apunte = %s
                RETURNING id_apunte, id_equipo, id_rival, id_partido, texto, id_autor, creado_en
                """,
                (texto, apunte_id),
            )
            actualizado = cur.fetchone()
    finally:
        conn.close()

    return jsonify(_apunte_a_dict(actualizado)), 200


# ----------------------------------------------------------------------------
# DELETE /api/apuntes/<id>
# ----------------------------------------------------------------------------
@bp.route("/apuntes/<int:apunte_id>", methods=["DELETE"])
@rol_requerido("ENTRENADOR", "DESARROLLADOR")
def eliminar(apunte_id):
    if not _id_valido(apunte_id):
        raise ApiError("no_encontrado", "El apunte no existe.", 404)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(
                "SELECT id_apunte, id_autor FROM apunte_entrenador WHERE id_apunte = %s FOR UPDATE",
                (apunte_id,),
            )
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "El apunte no existe.", 404)

            if not puede_modificar_propio(g.usuario, actual["id_autor"], globales=SOLO_DEV):
                raise _sin_permiso()

            cur.execute("DELETE FROM apunte_entrenador WHERE id_apunte = %s", (apunte_id,))
    finally:
        conn.close()

    return "", 204
