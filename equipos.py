"""Módulo de Catálogos, Equipos y Clasificación del CD. Calasanz (M5 y M7).

Endpoints (docs/API_CONTRATO.md, apartados 2, 3 y 4):
    GET /api/temporadas
    GET /api/categorias
    GET /api/equipos?categoria=&propios=true&competicion=
    GET /api/equipos/<id>
    GET /api/equipos/<id>/plantilla
    GET /api/equipos/<id>/clasificacion?temporada=
    GET /api/equipos/<id>/goleadores?temporada=
    GET /api/equipos/<id>/estadisticas?temporada=
    GET /api/equipos/<id>/partidos?temporada=&estado=
    GET /api/inicio

Notas de diseño (para el examen oral):
    * Cálculo 3-1-0 de la clasificación: se computa dinámicamente en SQL sumando
      los partidos jugados como local y como visitante entre todos los equipos
      de la misma competición/liga del equipo consultado. Solo puntúan los
      partidos con estado 'finalizado' (resultado_local IS NOT NULL).
    * Criterio de desempate federativo: puntos DESC, diferencia de goles DESC,
      goles a favor DESC y nombre ASC.
    * Privacidad en plantillas: la función `puede_ver_datos_fisicos` evalúa si el
      usuario tiene permiso para ver 'estatura' y 'peso'. Si no, los campos se
      omiten del JSON devuelto en la plantilla.
    * Cero inyección SQL: todos los filtros de consulta usan parámetros '%s'.
"""
from datetime import date
from flask import Blueprint, g, jsonify, request

from comun import (
    ApiError,
    dict_cursor,
    es_entero,
    get_db_connection,
    parsear_bool_query,
    parsear_entero_query,
)
from permisos import login_required, puede_ver_datos_fisicos

bp = Blueprint("equipos", __name__, url_prefix="/api")

MAX_ID = 2_147_483_647


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


def _equipo_a_dict(fila):
    """Convierte una fila de la BD en el recurso Equipo según el contrato."""
    return {
        "id": fila["id_equipo"],
        "nombre": fila["nombre"],
        "categoria": {
            "id": fila["id_categoria"],
            "nombre": fila["categoria_nombre"],
            "duracion": fila["categoria_duracion"],
        },
        "competicion": fila["competicion"],
        "es_propio": fila["es_propio"],
        "entrenador": (
            {
                "id": fila["id_entrenador"],
                "username": fila["entrenador_username"],
            }
            if fila["id_entrenador"] is not None
            else None
        ),
    }


def _partido_a_dict(fila):
    """Convierte una fila en el recurso Partido del contrato."""
    return {
        "id": fila["id_partido"],
        "temporada_id": fila["temporada"],
        "jornada": fila["jornada"],
        "fecha": fila["fecha_ini"].isoformat() if hasattr(fila["fecha_ini"], "isoformat") else str(fila["fecha_ini"]),
        "lugar": fila.get("lugar"),
        "local": {
            "id": fila["local_id"],
            "nombre": fila["local_nombre"],
            "es_propio": fila["local_es_propio"],
        },
        "visitante": {
            "id": fila["visitante_id"],
            "nombre": fila["visitante_nombre"],
            "es_propio": fila["visitante_es_propio"],
        },
        "resultado_local": fila["resultado_local"],
        "resultado_visitante": fila["resultado_visitante"],
        "ganador_id": fila["ganador"],
        "estado": "finalizado" if fila["resultado_local"] is not None else "programado",
        "evento": fila.get("evento"),
        "cronica_id": fila.get("cronica_id"),
    }


# ----------------------------------------------------------------------------
# Catálogos: Temporadas y Categorías
# ----------------------------------------------------------------------------
@bp.route("/temporadas", methods=["GET"])
@login_required
def listar_temporadas():
    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_temporada AS id, año FROM temporada ORDER BY año DESC")
            filas = cur.fetchall()
    finally:
        conn.close()
    return jsonify(filas), 200


@bp.route("/categorias", methods=["GET"])
@login_required
def listar_categorias():
    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_categoria AS id, nombre, duracion FROM categoria ORDER BY duracion DESC, id_categoria ASC")
            filas = cur.fetchall()
    finally:
        conn.close()
    return jsonify(filas), 200


# ----------------------------------------------------------------------------
# Listado y detalle de Equipos
# ----------------------------------------------------------------------------
_SELECT_EQUIPO = """
    SELECT e.id_equipo, e.nombre, e.categoria, e.competicion, e.es_propio, e.id_entrenador,
           c.id_categoria, c.nombre AS categoria_nombre, c.duracion AS categoria_duracion,
           u.username AS entrenador_username
    FROM equipo e
    JOIN categoria c ON c.id_categoria = e.categoria
    LEFT JOIN usuarios u ON u.id_usuario = e.id_entrenador
"""


@bp.route("/equipos", methods=["GET"])
@login_required
def listar_equipos():
    cat_id = parsear_entero_query("categoria", minimo=1)
    propios = parsear_bool_query("propios")
    competicion = request.args.get("competicion") or None

    condiciones, params = [], []
    if cat_id is not None:
        condiciones.append("e.categoria = %s")
        params.append(cat_id)
    if propios is not None:
        condiciones.append("e.es_propio = %s")
        params.append(propios)
    if competicion:
        condiciones.append("e.competicion = %s")
        params.append(competicion.strip())

    donde = (" WHERE " + " AND ".join(condiciones)) if condiciones else ""

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_EQUIPO + donde + " ORDER BY e.es_propio DESC, e.nombre ASC", params)
            filas = cur.fetchall()
    finally:
        conn.close()

    return jsonify([_equipo_a_dict(f) for f in filas]), 200


@bp.route("/equipos/<int:equipo_id>", methods=["GET"])
@login_required
def obtener_equipo(equipo_id):
    if not _id_valido(equipo_id):
        raise ApiError("no_encontrado", "El equipo no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_EQUIPO + " WHERE e.id_equipo = %s", (equipo_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    if fila is None:
        raise ApiError("no_encontrado", "El equipo no existe.", 404)

    return jsonify(_equipo_a_dict(fila)), 200


@bp.route("/equipos/<int:equipo_id>/plantilla", methods=["GET"])
@login_required
def plantilla_equipo(equipo_id):
    if not _id_valido(equipo_id):
        raise ApiError("no_encontrado", "El equipo no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_equipo, nombre FROM equipo WHERE id_equipo = %s", (equipo_id,))
            eq = cur.fetchone()
            if eq is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            cur.execute(
                """
                SELECT id_jugador, nombre, ap1, ap2, estatura, peso, equipo,
                       dorsal, posicion, activo
                FROM jugador
                WHERE equipo = %s AND activo = true
                ORDER BY dorsal ASC NULLS LAST, nombre ASC
                """,
                (equipo_id,),
            )
            jugadores = cur.fetchall()
    finally:
        conn.close()

    resultado = []
    for j in jugadores:
        item = {
            "id": j["id_jugador"],
            "nombre": j["nombre"],
            "ap1": j["ap1"],
            "ap2": j["ap2"],
            "posicion": j["posicion"],
            "dorsal": j["dorsal"],
            "equipo": {"id": eq["id_equipo"], "nombre": eq["nombre"]},
            "activo": j["activo"],
        }
        if puede_ver_datos_fisicos(g.usuario, j["id_jugador"], equipo_id):
            item["estatura"] = float(j["estatura"]) if j["estatura"] is not None else None
            item["peso"] = float(j["peso"]) if j["peso"] is not None else None
        resultado.append(item)

    return jsonify(resultado), 200


# ----------------------------------------------------------------------------
# Clasificación de la Liga / Competición (M7 — Regla 3-1-0)
# ----------------------------------------------------------------------------
@bp.route("/equipos/<int:equipo_id>/clasificacion", methods=["GET"])
@login_required
def clasificacion_equipo(equipo_id):
    temporada_id = parsear_entero_query("temporada", minimo=1)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_equipo, competicion FROM equipo WHERE id_equipo = %s", (equipo_id,))
            eq = cur.fetchone()
            if eq is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            # Si no se indica temporada, se toma la más reciente con partidos
            if temporada_id is None:
                cur.execute(
                    """
                    SELECT p.temporada FROM partido p
                    JOIN equipo el ON el.id_equipo = p.local
                    WHERE el.competicion = %s
                    ORDER BY p.temporada DESC LIMIT 1
                    """,
                    (eq["competicion"],),
                )
                temp_row = cur.fetchone()
                temporada_id = temp_row["temporada"] if temp_row else 1

            # Trae todos los equipos de la misma competición
            cur.execute(
                """
                SELECT id_equipo, nombre, es_propio
                FROM equipo
                WHERE competicion = %s
                ORDER BY nombre ASC
                """,
                (eq["competicion"],),
            )
            equipos_liga = cur.fetchall()

            # Partidos finalizados de esa competición en la temporada indicada
            cur.execute(
                """
                SELECT p.local, p.visitante, p.resultado_local, p.resultado_visitante
                FROM partido p
                JOIN equipo el ON el.id_equipo = p.local
                JOIN equipo ev ON ev.id_equipo = p.visitante
                WHERE el.competicion = %s AND ev.competicion = %s
                  AND p.temporada = %s
                  AND p.resultado_local IS NOT NULL AND p.resultado_visitante IS NOT NULL
                """,
                (eq["competicion"], eq["competicion"], temporada_id),
            )
            partidos = cur.fetchall()
    finally:
        conn.close()

    tabla = {
        e["id_equipo"]: {
            "equipo": {"id": e["id_equipo"], "nombre": e["nombre"], "es_propio": e["es_propio"]},
            "pj": 0, "g": 0, "e": 0, "p": 0,
            "gf": 0, "gc": 0, "dg": 0, "puntos": 0,
        }
        for e in equipos_liga
    }

    for p in partidos:
        loc_id, vis_id = p["local"], p["visitante"]
        r_loc, r_vis = p["resultado_local"], p["resultado_visitante"]

        if loc_id in tabla and vis_id in tabla:
            t_loc = tabla[loc_id]
            t_vis = tabla[vis_id]

            t_loc["pj"] += 1
            t_vis["pj"] += 1
            t_loc["gf"] += r_loc
            t_loc["gc"] += r_vis
            t_vis["gf"] += r_vis
            t_vis["gc"] += r_loc

            if r_loc > r_vis:
                t_loc["g"] += 1
                t_loc["puntos"] += 3
                t_vis["p"] += 1
            elif r_loc < r_vis:
                t_vis["g"] += 1
                t_vis["puntos"] += 3
                t_loc["p"] += 1
            else:
                t_loc["e"] += 1
                t_loc["puntos"] += 1
                t_vis["e"] += 1
                t_vis["puntos"] += 1

    for stats in tabla.values():
        stats["dg"] = stats["gf"] - stats["gc"]

    # Criterio: puntos DESC, dif. goles DESC, goles favor DESC, nombre ASC
    ordenados = sorted(
        tabla.values(),
        key=lambda s: (-s["puntos"], -s["dg"], -s["gf"], s["equipo"]["nombre"].lower()),
    )

    for idx, stats in enumerate(ordenados, start=1):
        stats["posicion"] = idx

    return jsonify(ordenados), 200


# ----------------------------------------------------------------------------
# Goleadores y Estadísticas del Equipo (M7)
# ----------------------------------------------------------------------------
@bp.route("/equipos/<int:equipo_id>/goleadores", methods=["GET"])
@login_required
def goleadores_equipo(equipo_id):
    temporada_id = parsear_entero_query("temporada", minimo=1)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT 1 FROM equipo WHERE id_equipo = %s", (equipo_id,))
            if cur.fetchone() is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            filtro_temp = "AND p.temporada = %s" if temporada_id else ""
            params = [equipo_id, temporada_id] if temporada_id else [equipo_id]

            cur.execute(
                f"""
                SELECT j.id_jugador, j.nombre, j.ap1, j.ap2, j.dorsal, j.posicion,
                       COALESCE(SUM(ep.goles), 0) AS goles,
                       COUNT(DISTINCT ep.partido) AS partidos
                FROM jugador j
                JOIN estadisticas_partido ep ON ep.id_jugador = j.id_jugador
                JOIN partido p ON p.id_partido = ep.partido
                WHERE j.equipo = %s {filtro_temp}
                GROUP BY j.id_jugador, j.nombre, j.ap1, j.ap2, j.dorsal, j.posicion
                HAVING SUM(ep.goles) > 0
                ORDER BY goles DESC, partidos ASC, j.nombre ASC
                """,
                params,
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    resultado = [
        {
            "jugador": {
                "id": f["id_jugador"],
                "nombre": f["nombre"],
                "ap1": f["ap1"],
                "ap2": f["ap2"],
                "dorsal": f["dorsal"],
                "posicion": f["posicion"],
            },
            "goles": int(f["goles"]),
            "partidos": int(f["partidos"]),
        }
        for f in filas
    ]
    return jsonify(resultado), 200


@bp.route("/equipos/<int:equipo_id>/estadisticas", methods=["GET"])
@login_required
def estadisticas_equipo(equipo_id):
    temporada_id = parsear_entero_query("temporada", minimo=1)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT 1 FROM equipo WHERE id_equipo = %s", (equipo_id,))
            if cur.fetchone() is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            filtro_temp = "AND p.temporada = %s" if temporada_id else ""
            params = [equipo_id, temporada_id] if temporada_id else [equipo_id]

            cur.execute(
                f"""
                SELECT j.id_jugador, j.nombre, j.ap1, j.ap2, j.dorsal, j.posicion, j.activo,
                       COUNT(ep.partido) AS partidos,
                       COALESCE(SUM(ep.mins_jugados), 0) AS minutos,
                       COALESCE(SUM(ep.goles), 0) AS goles,
                       COALESCE(SUM(ep.asistencias), 0) AS asistencias,
                       COALESCE(SUM(ep.amarillas), 0) AS amarillas,
                       COALESCE(COUNT(NULLIF(ep.roja, false)), 0) AS rojas
                FROM jugador j
                LEFT JOIN estadisticas_partido ep ON ep.id_jugador = j.id_jugador
                LEFT JOIN partido p ON p.id_partido = ep.partido {filtro_temp}
                WHERE j.equipo = %s
                GROUP BY j.id_jugador, j.nombre, j.ap1, j.ap2, j.dorsal, j.posicion, j.activo
                ORDER BY j.dorsal ASC NULLS LAST, j.nombre ASC
                """,
                params,
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    resultado = [
        {
            "jugador": {
                "id": f["id_jugador"],
                "nombre": f["nombre"],
                "ap1": f["ap1"],
                "ap2": f["ap2"],
                "dorsal": f["dorsal"],
                "posicion": f["posicion"],
                "activo": f["activo"],
            },
            "partidos": int(f["partidos"]),
            "minutos": int(f["minutos"]),
            "goles": int(f["goles"]),
            "asistencias": int(f["asistencias"]),
            "amarillas": int(f["amarillas"]),
            "rojas": int(f["rojas"]),
        }
        for f in filas
    ]
    return jsonify(resultado), 200


# ----------------------------------------------------------------------------
# Partidos de un Equipo
# ----------------------------------------------------------------------------
_SELECT_PARTIDOS = """
    SELECT p.id_partido, p.temporada, p.jornada, p.fecha_ini, p.lugar,
           p.local AS local_id, el.nombre AS local_nombre, el.es_propio AS local_es_propio,
           p.visitante AS visitante_id, ev.nombre AS visitante_nombre, ev.es_propio AS visitante_es_propio,
           p.resultado_local, p.resultado_visitante, p.ganador, p.evento,
           c.id AS cronica_id
    FROM partido p
    JOIN equipo el ON el.id_equipo = p.local
    JOIN equipo ev ON ev.id_equipo = p.visitante
    LEFT JOIN cronica c ON c.partido = p.id_partido
"""


@bp.route("/equipos/<int:equipo_id>/partidos", methods=["GET"])
@login_required
def partidos_equipo(equipo_id):
    temporada_id = parsear_entero_query("temporada", minimo=1)
    estado = request.args.get("estado") or None
    if estado is not None and estado not in ("programado", "finalizado"):
        raise ApiError("validacion", "Parámetros de consulta no válidos.", 422, [
            {"campo": "estado", "mensaje": "Debe ser programado o finalizado."}
        ])

    condiciones = ["(p.local = %s OR p.visitante = %s)"]
    params = [equipo_id, equipo_id]

    if temporada_id:
        condiciones.append("p.temporada = %s")
        params.append(temporada_id)

    if estado == "finalizado":
        condiciones.append("p.resultado_local IS NOT NULL")
    elif estado == "programado":
        condiciones.append("p.resultado_local IS NULL")

    donde = " WHERE " + " AND ".join(condiciones)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT 1 FROM equipo WHERE id_equipo = %s", (equipo_id,))
            if cur.fetchone() is None:
                raise ApiError("no_encontrado", "El equipo no existe.", 404)

            cur.execute(_SELECT_PARTIDOS + donde + " ORDER BY p.fecha_ini ASC, p.jornada ASC", params)
            filas = cur.fetchall()
    finally:
        conn.close()

    return jsonify([_partido_a_dict(f) for f in filas]), 200


# ----------------------------------------------------------------------------
# Resumen de Inicio (M7 — GET /api/inicio)
# ----------------------------------------------------------------------------
@bp.route("/inicio", methods=["GET"])
@login_required
def inicio():
    hoy = date.today()
    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            # Próximos partidos de equipos propios (máximo 3)
            cur.execute(
                _SELECT_PARTIDOS + """
                WHERE (el.es_propio = true OR ev.es_propio = true)
                  AND p.resultado_local IS NULL
                  AND p.fecha_ini >= %s
                ORDER BY p.fecha_ini ASC, p.id_partido ASC
                LIMIT 3
                """,
                (hoy,),
            )
            proximos = cur.fetchall()

            # Resultados recientes de equipos propios finalizados
            cur.execute(
                _SELECT_PARTIDOS + """
                WHERE (el.es_propio = true OR ev.es_propio = true)
                  AND p.resultado_local IS NOT NULL
                ORDER BY p.fecha_ini DESC, p.id_partido DESC
                LIMIT 5
                """
            )
            recientes = cur.fetchall()

            # Últimas noticias o eventos publicados (máximo 3)
            cur.execute(
                """
                SELECT n.id_noticia AS id, n.titulo, n.cuerpo, n.tipo, n.fecha_evento,
                       n.publicada_en, u.id_usuario, u.username
                FROM noticia n
                JOIN usuarios u ON u.id_usuario = n.id_autor
                ORDER BY n.publicada_en DESC
                LIMIT 3
                """
            )
            noticias = cur.fetchall()
    finally:
        conn.close()

    formato_noticias = []
    for n in noticias:
        estado_evento = None
        if n["tipo"] == "evento" and n["fecha_evento"]:
            estado_evento = "finalizado" if n["fecha_evento"] < hoy else "proximo"
        formato_noticias.append({
            "id": n["id"],
            "titulo": n["titulo"],
            "cuerpo": n["cuerpo"],
            "tipo": n["tipo"],
            "fecha_evento": n["fecha_evento"].isoformat() if n["fecha_evento"] else None,
            "estado_evento": estado_evento,
            "publicada_en": n["publicada_en"].isoformat() if hasattr(n["publicada_en"], "isoformat") else str(n["publicada_en"]),
            "autor": {"id": n["id_usuario"], "username": n["username"]},
        })

    return jsonify({
        "proximos_partidos": [_partido_a_dict(p) for p in proximos],
        "resultados_semana": [_partido_a_dict(p) for p in recientes],
        "ultimas_noticias": formato_noticias,
    }), 200