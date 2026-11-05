"""Crónicas de partidos propios finalizados del CD. Calasanz.

Endpoints (docs/API_CONTRATO.md, apartados 2, 3, 4 y 5):
    GET    /api/cronicas?equipo=&temporada=&page=  200 paginado (más recientes primero)
    GET    /api/cronicas/<id>                      200 · 404
    POST   /api/cronicas                           ENTRENADOR del equipo, COORD, DEV  201 · 403 · 404 · 409 · 422
    PATCH  /api/cronicas/<id>                      su autor, COORD, DEV               200 · 403 · 404 · 422
    DELETE /api/cronicas/<id>                      su autor, COORD, DEV               204 · 403 · 404

Notas de diseño (para el examen oral):
    * Restricción de negocio: solo pueden tener crónica los partidos propios cuyo
      estado sea 'finalizado' (resultado_local IS NOT NULL). Si el partido es
      entre rivales o aún está 'programado', se devuelve 409 conflicto.
    * Unicidad por partido: la columna `cronica.partido` tiene una restricción
      UNIQUE en base de datos, garantizando que como máximo exista una crónica
      por partido incluso ante peticiones concurrentes.
    * Permisos diferenciados en alta vs edición: un entrenador puede crear la
      crónica de un partido de su equipo, pero solo puede editar o borrar las
      crónicas de las que él mismo es autor (mientras que COORDINADOR y
      DESARROLLADOR pueden gestionar todas).
"""
from flask import Blueprint, g, jsonify
from psycopg2 import errors as pg_errors

from comun import (
    ApiError,
    dict_cursor,
    es_entero,
    get_db_connection,
    leer_json,
    parametros_paginacion,
    parsear_entero_query,
    respuesta_paginada,
)
from permisos import (
    es_entrenador_de,
    login_required,
    puede_modificar_propio,
    rol_requerido,
)

bp = Blueprint("cronicas", __name__, url_prefix="/api/cronicas")

MAX_ID = 2_147_483_647
TITULO_MIN, TITULO_MAX = 3, 120
TEXTO_MIN, TEXTO_MAX = 50, 3000


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


def _validacion(detalles):
    return ApiError("validacion", "Hay datos que no son válidos.", 422, detalles)


def _sin_permiso():
    return ApiError("sin_permiso", "No tienes permiso para esta acción.", 403)


_SELECT_CRONICA = """
    SELECT c.id, c.partido AS partido_id, c.titulo, c.texto,
           c.id_autor, u.username AS autor_username,
           c.creada_en, c.actualizada_en,
           p.jornada, p.fecha_ini, p.resultado_local, p.resultado_visitante,
           p.local AS local_id, el.nombre AS local_nombre,
           p.visitante AS visitante_id, ev.nombre AS visitante_nombre
    FROM cronica c
    JOIN partido p ON p.id_partido = c.partido
    JOIN equipo el ON el.id_equipo = p.local
    JOIN equipo ev ON ev.id_equipo = p.visitante
    JOIN usuarios u ON u.id_usuario = c.id_autor
"""


def _cronica_a_dict(f):
    creada = f["creada_en"]
    actualizada = f["actualizada_en"]
    fecha_p = f["fecha_ini"]
    return {
        "id": f["id"],
        "partido": {
            "id": f["partido_id"],
            "jornada": f["jornada"],
            "fecha": fecha_p.isoformat() if hasattr(fecha_p, "isoformat") else str(fecha_p),
            "local": {"id": f["local_id"], "nombre": f["local_nombre"]},
            "visitante": {"id": f["visitante_id"], "nombre": f["visitante_nombre"]},
            "resultado_local": f["resultado_local"],
            "resultado_visitante": f["resultado_visitante"],
        },
        "titulo": f["titulo"],
        "texto": f["texto"],
        "autor": {"id": f["id_autor"], "username": f["autor_username"]},
        "creada_en": creada.isoformat() if hasattr(creada, "isoformat") else str(creada),
        "actualizada_en": (
            actualizada.isoformat()
            if actualizada is not None and hasattr(actualizada, "isoformat")
            else (str(actualizada) if actualizada is not None else None)
        ),
    }


# ----------------------------------------------------------------------------
# GET /api/cronicas?equipo=&temporada=&page=
# ----------------------------------------------------------------------------
@bp.route("", methods=["GET"])
@login_required
def listar():
    equipo_id = parsear_entero_query("equipo", minimo=1)
    temporada_id = parsear_entero_query("temporada", minimo=1)
    page, por_pagina, offset = parametros_paginacion()

    condiciones, params = [], []
    if equipo_id is not None:
        condiciones.append("(p.local = %s OR p.visitante = %s)")
        params.extend([equipo_id, equipo_id])
    if temporada_id is not None:
        condiciones.append("p.temporada = %s")
        params.append(temporada_id)

    donde = (" WHERE " + " AND ".join(condiciones)) if condiciones else ""

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                "SELECT COUNT(*) AS total FROM cronica c JOIN partido p ON p.id_partido = c.partido" + donde,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                _SELECT_CRONICA + donde + " ORDER BY c.creada_en DESC, c.id DESC LIMIT %s OFFSET %s",
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    items = [_cronica_a_dict(f) for f in filas]
    return jsonify(respuesta_paginada(items, page, por_pagina, total)), 200


# ----------------------------------------------------------------------------
# GET /api/cronicas/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:cronica_id>", methods=["GET"])
@login_required
def obtener(cronica_id):
    if not _id_valido(cronica_id):
        raise ApiError("no_encontrado", "La crónica no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_CRONICA + " WHERE c.id = %s", (cronica_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    if fila is None:
        raise ApiError("no_encontrado", "La crónica no existe.", 404)

    return jsonify(_cronica_a_dict(fila)), 200


# ----------------------------------------------------------------------------
# POST /api/cronicas
# ----------------------------------------------------------------------------
@bp.route("", methods=["POST"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def crear():
    datos = leer_json()
    errores = []

    partido_id = datos.get("partido_id")
    titulo_raw = datos.get("titulo")
    texto_raw = datos.get("texto")

    if not _id_valido(partido_id):
        errores.append({"campo": "partido_id", "mensaje": "Obligatorio (id del partido)."})

    titulo = titulo_raw.strip() if isinstance(titulo_raw, str) else None
    if titulo is None or not TITULO_MIN <= len(titulo) <= TITULO_MAX:
        errores.append({
            "campo": "titulo",
            "mensaje": f"Debe tener entre {TITULO_MIN} y {TITULO_MAX} caracteres.",
        })

    texto = texto_raw.strip() if isinstance(texto_raw, str) else None
    if texto is None or not TEXTO_MIN <= len(texto) <= TEXTO_MAX:
        errores.append({
            "campo": "texto",
            "mensaje": f"Debe tener entre {TEXTO_MIN} y {TEXTO_MAX} caracteres.",
        })

    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT p.id_partido, p.local, p.visitante, p.resultado_local,
                       el.es_propio AS local_es_propio, ev.es_propio AS visitante_es_propio
                FROM partido p
                JOIN equipo el ON el.id_equipo = p.local
                JOIN equipo ev ON ev.id_equipo = p.visitante
                WHERE p.id_partido = %s FOR UPDATE OF p
                """,
                (partido_id,),
            )
            p = cur.fetchone()
            if p is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)

            if g.usuario["rol"] == "ENTRENADOR":
                es_suyo = (
                    (p["local_es_propio"] and es_entrenador_de(g.usuario, p["local"]))
                    or (p["visitante_es_propio"] and es_entrenador_de(g.usuario, p["visitante"]))
                )
                if not es_suyo:
                    raise _sin_permiso()

            if not p["local_es_propio"] and not p["visitante_es_propio"]:
                raise ApiError(
                    "conflicto",
                    "Solo los partidos de equipos propios pueden tener crónica.",
                    409,
                )

            if p["resultado_local"] is None:
                raise ApiError(
                    "conflicto",
                    "Solo se puede escribir la crónica de un partido finalizado.",
                    409,
                )

            try:
                cur.execute(
                    """
                    INSERT INTO cronica (partido, titulo, texto, id_autor)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                    """,
                    (partido_id, titulo, texto, g.usuario["id"]),
                )
                nueva_id = cur.fetchone()["id"]
            except pg_errors.UniqueViolation:
                raise ApiError("conflicto", "Este partido ya tiene una crónica publicada.", 409)

            cur.execute(_SELECT_CRONICA + " WHERE c.id = %s", (nueva_id,))
            creada = cur.fetchone()
    finally:
        conn.close()

    respuesta = jsonify(_cronica_a_dict(creada))
    respuesta.status_code = 201
    respuesta.headers["Location"] = f"/api/cronicas/{nueva_id}"
    return respuesta


# ----------------------------------------------------------------------------
# PATCH /api/cronicas/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:cronica_id>", methods=["PATCH"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def modificar(cronica_id):
    if not _id_valido(cronica_id):
        raise ApiError("no_encontrado", "La crónica no existe.", 404)

    datos = leer_json()
    errores = []
    cambios, params = [], []

    if "titulo" not in datos and "texto" not in datos:
        errores.append({"campo": "titulo", "mensaje": "Indica titulo y/o texto para actualizar."})

    if "titulo" in datos:
        t_raw = datos.get("titulo")
        titulo = t_raw.strip() if isinstance(t_raw, str) else None
        if titulo is None or not TITULO_MIN <= len(titulo) <= TITULO_MAX:
            errores.append({
                "campo": "titulo",
                "mensaje": f"Debe tener entre {TITULO_MIN} y {TITULO_MAX} caracteres.",
            })
        else:
            cambios.append("titulo = %s")
            params.append(titulo)

    if "texto" in datos:
        tx_raw = datos.get("texto")
        texto = tx_raw.strip() if isinstance(tx_raw, str) else None
        if texto is None or not TEXTO_MIN <= len(texto) <= TEXTO_MAX:
            errores.append({
                "campo": "texto",
                "mensaje": f"Debe tener entre {TEXTO_MIN} y {TEXTO_MAX} caracteres.",
            })
        else:
            cambios.append("texto = %s")
            params.append(texto)

    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute("SELECT id, id_autor FROM cronica WHERE id = %s FOR UPDATE", (cronica_id,))
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "La crónica no existe.", 404)

            if not puede_modificar_propio(g.usuario, actual["id_autor"]):
                raise _sin_permiso()

            cambios.append("actualizada_en = NOW()")
            params.append(cronica_id)
            cur.execute("UPDATE cronica SET " + ", ".join(cambios) + " WHERE id = %s", params)

            cur.execute(_SELECT_CRONICA + " WHERE c.id = %s", (cronica_id,))
            actualizada = cur.fetchone()
    finally:
        conn.close()

    return jsonify(_cronica_a_dict(actualizada)), 200


# ----------------------------------------------------------------------------
# DELETE /api/cronicas/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:cronica_id>", methods=["DELETE"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def eliminar(cronica_id):
    if not _id_valido(cronica_id):
        raise ApiError("no_encontrado", "La crónica no existe.", 404)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute("SELECT id, id_autor FROM cronica WHERE id = %s FOR UPDATE", (cronica_id,))
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "La crónica no existe.", 404)

            if not puede_modificar_propio(g.usuario, actual["id_autor"]):
                raise _sin_permiso()

            cur.execute("DELETE FROM cronica WHERE id = %s", (cronica_id,))
    finally:
        conn.close()

    return "", 204
