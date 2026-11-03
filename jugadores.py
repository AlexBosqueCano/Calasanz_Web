"""Gestión de Jugadores y Estadísticas del CD. Calasanz (M4).

Endpoints (docs/API_CONTRATO.md, apartados 2, 3 y 4):
    GET    /api/jugadores?equipo=&posicion=&q=&activos=true   200 paginado
    GET    /api/jugadores/<id>                                200 · 404
    GET    /api/jugadores/<id>/estadisticas?temporada=        200 · 404
    POST   /api/jugadores                                     COORDINADOR, DESARROLLADOR  201 · 403 · 409 · 422
    PATCH  /api/jugadores/<id>                                COORDINADOR, DESARROLLADOR  200 · 403 · 404 · 409 · 422
    DELETE /api/jugadores/<id>                                COORDINADOR, DESARROLLADOR  204 (baja lógica) · 403 · 404

Notas de diseño (para el examen oral):
    * Baja lógica (DELETE): en lugar de borrar la fila física de la base de datos,
      se marca `activo = false`. Esto permite conservar todas las estadísticas
      históricas del jugador en actas pasadas y libera su dorsal gracias al
      índice único parcial `uq_jugador_dorsal_activo`.
    * Datos físicos sensibles: `estatura` y `peso` solo se incorporan al diccionario
      si `puede_ver_datos_fisicos(g.usuario, id_jugador, equipo_id)` devuelve True
      (desarrolladores, coordinadores, el entrenador de su equipo o el propio jugador).
    * Estadísticas de portero: el campo `goles_recibidos_totales` devuelve un entero
      si la posición es 'Portero', y estrictamente `null` (`None` en Python) si es
      jugador de campo, cumpliendo la clave exacta que espera el frontend.
"""
from decimal import Decimal
from flask import Blueprint, g, jsonify, request
from psycopg2 import errors as pg_errors

from comun import (
    ApiError,
    dict_cursor,
    es_entero,
    get_db_connection,
    leer_json,
    parametros_paginacion,
    parsear_bool_query,
    parsear_entero_query,
    respuesta_paginada,
)
from permisos import login_required, puede_ver_datos_fisicos, rol_requerido

bp = Blueprint("jugadores", __name__, url_prefix="/api/jugadores")

POSICIONES = ("Portero", "Defensa", "Centrocampista", "Delantero")
MAX_ID = 2_147_483_647


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


_SELECT_JUGADOR = """
    SELECT j.id_jugador, j.nombre, j.ap1, j.ap2, j.posicion, j.dorsal,
           j.equipo AS equipo_id, e.nombre AS equipo_nombre,
           j.estatura, j.peso, j.activo
    FROM jugador j
    JOIN equipo e ON e.id_equipo = j.equipo
"""


def _formatear_jugador(fila, usuario):
    """Devuelve el dict del recurso Jugador ocultando estatura y peso si no procede."""
    item = {
        "id": fila["id_jugador"],
        "nombre": fila["nombre"],
        "ap1": fila["ap1"],
        "ap2": fila["ap2"],
        "posicion": fila["posicion"],
        "dorsal": fila["dorsal"],
        "equipo": {
            "id": fila["equipo_id"],
            "nombre": fila["equipo_nombre"],
        },
        "activo": fila["activo"],
    }
    if puede_ver_datos_fisicos(usuario, fila["id_jugador"], fila["equipo_id"]):
        item["estatura"] = float(fila["estatura"]) if fila["estatura"] is not None else None
        item["peso"] = float(fila["peso"]) if fila["peso"] is not None else None
    return item


# ----------------------------------------------------------------------------
# GET /api/jugadores
# ----------------------------------------------------------------------------
@bp.route("", methods=["GET"])
@login_required
def listar():
    equipo_id = parsear_entero_query("equipo", minimo=1)
    posicion = request.args.get("posicion") or None
    q = (request.args.get("q") or "").strip() or None
    activos = parsear_bool_query("activos", default=True)

    errores = []
    if posicion is not None and posicion not in POSICIONES:
        errores.append({"campo": "posicion", "mensaje": "Debe ser: " + ", ".join(POSICIONES) + "."})
    if q is not None and len(q) > 100:
        errores.append({"campo": "q", "mensaje": "Máximo 100 caracteres."})
    if errores:
        raise ApiError("validacion", "Parámetros de consulta no válidos.", 422, errores)

    page, por_pagina, offset = parametros_paginacion()

    condiciones, params = [], []
    if equipo_id is not None:
        condiciones.append("j.equipo = %s")
        params.append(equipo_id)
    if posicion is not None:
        condiciones.append("j.posicion = %s")
        params.append(posicion)
    if activos is not None:
        condiciones.append("j.activo = %s")
        params.append(activos)
    if q is not None:
        patron = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        condiciones.append("(j.nombre ILIKE %s ESCAPE '\\' OR j.ap1 ILIKE %s ESCAPE '\\' OR j.ap2 ILIKE %s ESCAPE '\\')")
        params += [patron, patron, patron]

    donde = (" WHERE " + " AND ".join(condiciones)) if condiciones else ""

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT COUNT(*) AS total FROM jugador j" + donde, params)
            total = cur.fetchone()["total"]

            cur.execute(
                _SELECT_JUGADOR + donde + " ORDER BY j.dorsal ASC NULLS LAST, j.nombre ASC LIMIT %s OFFSET %s",
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    items = [_formatear_jugador(f, g.usuario) for f in filas]
    return jsonify(respuesta_paginada(items, page, por_pagina, total)), 200


# ----------------------------------------------------------------------------
# GET /api/jugadores/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:jugador_id>", methods=["GET"])
@login_required
def obtener(jugador_id):
    if not _id_valido(jugador_id):
        raise ApiError("no_encontrado", "El jugador no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_JUGADOR + " WHERE j.id_jugador = %s", (jugador_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    if fila is None:
        raise ApiError("no_encontrado", "El jugador no existe.", 404)

    return jsonify(_formatear_jugador(fila, g.usuario)), 200


# ----------------------------------------------------------------------------
# GET /api/jugadores/<id>/estadisticas
# ----------------------------------------------------------------------------
@bp.route("/<int:jugador_id>/estadisticas", methods=["GET"])
@login_required
def estadisticas(jugador_id):
    if not _id_valido(jugador_id):
        raise ApiError("no_encontrado", "El jugador no existe.", 404)

    temporada_id = parsear_entero_query("temporada", minimo=1)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute("SELECT id_jugador, posicion FROM jugador WHERE id_jugador = %s", (jugador_id,))
            j = cur.fetchone()
            if j is None:
                raise ApiError("no_encontrado", "El jugador no existe.", 404)

            filtro_temp = "AND p.temporada = %s" if temporada_id else ""
            params = [jugador_id, temporada_id] if temporada_id else [jugador_id]

            cur.execute(
                f"""
                SELECT COUNT(ep.partido) AS partidos_jugados,
                       COALESCE(COUNT(NULLIF(ep.estado = 'titular', false)), 0) AS titular,
                       COALESCE(COUNT(NULLIF(ep.estado = 'suplente', false)), 0) AS suplente,
                       COALESCE(SUM(ep.mins_jugados), 0) AS minutos_totales,
                       COALESCE(SUM(ep.goles), 0) AS goles_totales,
                       COALESCE(SUM(ep.asistencias), 0) AS asistencias_totales,
                       COALESCE(SUM(ep.amarillas), 0) AS amarillas_totales,
                       COALESCE(COUNT(NULLIF(ep.roja, false)), 0) AS rojas_totales,
                       COALESCE(SUM(ep.goles_recibidos), 0) AS goles_recibidos_totales
                FROM estadisticas_partido ep
                JOIN partido p ON p.id_partido = ep.partido
                WHERE ep.id_jugador = %s {filtro_temp}
                """,
                params,
            )
            stats = cur.fetchone()
    finally:
        conn.close()

    # Si no es Portero, goles_recibidos_totales es estrictamente None (§3)
    es_portero = j["posicion"] == "Portero"
    recibidos = int(stats["goles_recibidos_totales"]) if es_portero else None

    return jsonify({
        "partidos_jugados": int(stats["partidos_jugados"]),
        "titular": int(stats["titular"]),
        "suplente": int(stats["suplente"]),
        "minutos_totales": int(stats["minutos_totales"]),
        "goles_totales": int(stats["goles_totales"]),
        "asistencias_totales": int(stats["asistencias_totales"]),
        "amarillas_totales": int(stats["amarillas_totales"]),
        "rojas_totales": int(stats["rojas_totales"]),
        "goles_recibidos_totales": recibidos,
    }), 200


# ----------------------------------------------------------------------------
# Validación de Altas y Modificaciones
# ----------------------------------------------------------------------------
def _validar_datos_jugador(datos, parcial=False):
    """Valida campos de jugador. Devuelve (errores, limpio)."""
    errores = []
    limpio = {}

    # Nombre (1..50)
    if "nombre" in datos or not parcial:
        v = datos.get("nombre")
        if not isinstance(v, str) or not 1 <= len(v.strip()) <= 50:
            errores.append({"campo": "nombre", "mensaje": "Obligatorio (entre 1 y 50 caracteres)."})
        else:
            limpio["nombre"] = v.strip()

    # Primer Apellido (1..100)
    if "ap1" in datos or not parcial:
        v = datos.get("ap1")
        if not isinstance(v, str) or not 1 <= len(v.strip()) <= 100:
            errores.append({"campo": "ap1", "mensaje": "Obligatorio (entre 1 y 100 caracteres)."})
        else:
            limpio["ap1"] = v.strip()

    # Segundo Apellido (opcional, max 100)
    if "ap2" in datos:
        v = datos.get("ap2")
        if v is not None and (not isinstance(v, str) or len(v.strip()) > 100):
            errores.append({"campo": "ap2", "mensaje": "Máximo 100 caracteres."})
        else:
            limpio["ap2"] = v.strip() if isinstance(v, str) and v.strip() else None

    # Posición
    if "posicion" in datos or not parcial:
        v = datos.get("posicion")
        if not isinstance(v, str) or v not in POSICIONES:
            errores.append({"campo": "posicion", "mensaje": "Debe ser: " + ", ".join(POSICIONES) + "."})
        else:
            limpio["posicion"] = v

    # Dorsal (opcional, int 1..99)
    if "dorsal" in datos:
        v = datos.get("dorsal")
        if v is not None and (not es_entero(v) or not 1 <= v <= 99):
            errores.append({"campo": "dorsal", "mensaje": "Debe ser un número entero entre 1 y 99."})
        else:
            limpio["dorsal"] = v

    # Equipo ID (obligatorio en alta)
    if "equipo_id" in datos or not parcial:
        v = datos.get("equipo_id")
        if not _id_valido(v):
            errores.append({"campo": "equipo_id", "mensaje": "Obligatorio (id del equipo propio)."})
        else:
            limpio["equipo"] = v

    # Estatura (opcional, float 1.00..2.30)
    if "estatura" in datos:
        v = datos.get("estatura")
        if v is not None:
            try:
                dec = Decimal(str(v))
                if not Decimal("1.00") <= dec <= Decimal("2.30"):
                    raise ValueError
                limpio["estatura"] = dec
            except Exception:
                errores.append({"campo": "estatura", "mensaje": "Debe estar entre 1.00 y 2.30 metros."})
        else:
            limpio["estatura"] = None

    # Peso (opcional, float 20.00..200.00)
    if "peso" in datos:
        v = datos.get("peso")
        if v is not None:
            try:
                dec = Decimal(str(v))
                if not Decimal("20.00") <= dec <= Decimal("200.00"):
                    raise ValueError
                limpio["peso"] = dec
            except Exception:
                errores.append({"campo": "peso", "mensaje": "Debe estar entre 20.00 y 200.00 kg."})
        else:
            limpio["peso"] = None

    if "activo" in datos and parcial:
        v = datos.get("activo")
        if not isinstance(v, bool):
            errores.append({"campo": "activo", "mensaje": "Debe ser true o false."})
        else:
            limpio["activo"] = v

    return errores, limpio


# ----------------------------------------------------------------------------
# POST /api/jugadores
# ----------------------------------------------------------------------------
@bp.route("", methods=["POST"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def crear():
    datos = leer_json()
    errores, limpio = _validar_datos_jugador(datos, parcial=False)
    if errores:
        raise ApiError("validacion", "Hay datos que no son válidos.", 422, errores)

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            # Comprobar que el equipo existe y es del club
            cur.execute("SELECT es_propio FROM equipo WHERE id_equipo = %s", (limpio["equipo"],))
            fila_eq = cur.fetchone()
            if fila_eq is None or not fila_eq[0]:
                raise ApiError("validacion", "Hay datos que no son válidos.", 422, [
                    {"campo": "equipo_id", "mensaje": "El equipo no existe o no es un equipo propio del club."}
                ])

            # Comprobar dorsal único en el equipo para jugadores activos
            if limpio.get("dorsal") is not None:
                cur.execute(
                    "SELECT 1 FROM jugador WHERE equipo = %s AND dorsal = %s AND activo = true",
                    (limpio["equipo"], limpio["dorsal"]),
                )
                if cur.fetchone():
                    raise ApiError("conflicto", "Ese dorsal ya está ocupado por un jugador activo del equipo.", 409)

            try:
                cur.execute(
                    """
                    INSERT INTO jugador (nombre, ap1, ap2, estatura, peso, equipo, dorsal, posicion, activo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)
                    RETURNING id_jugador
                    """,
                    (
                        limpio["nombre"],
                        limpio["ap1"],
                        limpio.get("ap2"),
                        limpio.get("estatura"),
                        limpio.get("peso"),
                        limpio["equipo"],
                        limpio.get("dorsal"),
                        limpio["posicion"],
                    ),
                )
                nuevo_id = cur.fetchone()[0]
            except pg_errors.UniqueViolation:
                raise ApiError("conflicto", "Ese dorsal ya está ocupado en el equipo.", 409)
    finally:
        conn.close()

    # Leemos el recurso recién creado
    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_JUGADOR + " WHERE j.id_jugador = %s", (nuevo_id,))
            creado = cur.fetchone()
    finally:
        conn.close()

    respuesta = jsonify(_formatear_jugador(creado, g.usuario))
    respuesta.status_code = 201
    respuesta.headers["Location"] = f"/api/jugadores/{nuevo_id}"
    return respuesta


# ----------------------------------------------------------------------------
# PATCH /api/jugadores/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:jugador_id>", methods=["PATCH"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def modificar(jugador_id):
    if not _id_valido(jugador_id):
        raise ApiError("no_encontrado", "El jugador no existe.", 404)

    datos = leer_json()
    if not datos:
        raise ApiError("validacion", "No se han enviado campos para actualizar.", 422)

    errores, limpio = _validar_datos_jugador(datos, parcial=True)
    if errores:
        raise ApiError("validacion", "Hay datos que no son válidos.", 422, errores)

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT equipo, dorsal, activo FROM jugador WHERE id_jugador = %s FOR UPDATE", (jugador_id,))
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "El jugador no existe.", 404)

            eq_id = limpio.get("equipo", actual[0])
            if "equipo" in limpio:
                cur.execute("SELECT es_propio FROM equipo WHERE id_equipo = %s", (eq_id,))
                eq_fila = cur.fetchone()
                if eq_fila is None or not eq_fila[0]:
                    raise ApiError("validacion", "Hay datos que no son válidos.", 422, [
                        {"campo": "equipo_id", "mensaje": "El equipo no existe o no es propio."}
                    ])

            dorsal_nuevo = limpio.get("dorsal", actual[1])
            activo_nuevo = limpio.get("activo", actual[2])

            # Comprobar colisión de dorsal si cambia equipo, dorsal o reactiva
            if dorsal_nuevo is not None and activo_nuevo:
                cur.execute(
                    """
                    SELECT 1 FROM jugador
                    WHERE equipo = %s AND dorsal = %s AND activo = true AND id_jugador <> %s
                    """,
                    (eq_id, dorsal_nuevo, jugador_id),
                )
                if cur.fetchone():
                    raise ApiError("conflicto", "Ese dorsal ya está ocupado por un jugador activo del equipo.", 409)

            campos, params = [], []
            for col, val in limpio.items():
                campos.append(f"{col} = %s")
                params.append(val)

            if campos:
                params.append(jugador_id)
                cur.execute(f"UPDATE jugador SET {', '.join(campos)} WHERE id_jugador = %s", params)
    finally:
        conn.close()

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_JUGADOR + " WHERE j.id_jugador = %s", (jugador_id,))
            actualizado = cur.fetchone()
    finally:
        conn.close()

    return jsonify(_formatear_jugador(actualizado, g.usuario)), 200


# ----------------------------------------------------------------------------
# DELETE /api/jugadores/<id> (Baja lógica — §4 del Contrato)
# ----------------------------------------------------------------------------
@bp.route("/<int:jugador_id>", methods=["DELETE"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def eliminar(jugador_id):
    if not _id_valido(jugador_id):
        raise ApiError("no_encontrado", "El jugador no existe.", 404)

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT activo FROM jugador WHERE id_jugador = %s FOR UPDATE", (jugador_id,))
            fila = cur.fetchone()
            if fila is None:
                raise ApiError("no_encontrado", "El jugador no existe.", 404)

            # Baja lógica: activo = false conservando estadísticas
            cur.execute("UPDATE jugador SET activo = false WHERE id_jugador = %s", (jugador_id,))
    finally:
        conn.close()

    return "", 204