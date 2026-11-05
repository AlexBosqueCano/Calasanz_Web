"""Gestión de Partidos, Resultados entre rivales y Actas del CD. Calasanz (M6).

Endpoints (docs/API_CONTRATO.md, apartados 2, 3, 4 y 5):
    GET    /api/partidos?temporada=&equipo=&competicion=&desde=&hasta=&estado=  200 paginado
    GET    /api/partidos/<id>            200 (incluye acta si existe) · 404
    POST   /api/partidos                 ENTRENADOR de su liga, COORD, DEV  201 · 403 · 422
    PATCH  /api/partidos/<id>            ENTRENADOR de su liga, COORD, DEV  200 · 403 · 404 · 409 · 422
    DELETE /api/partidos/<id>            COORDINADOR, DESARROLLADOR         204 · 403 · 404
    PUT    /api/partidos/<id>/acta       ENTRENADOR del equipo, COORD, DEV  200 · 403 · 404 · 409 · 422
    PUT    /api/partidos/<id>/resultado  ENTRENADOR de su liga, COORD, DEV  200 · 403 · 404 · 409 · 422

Notas de diseño (para el examen oral):
    * Transacción atómica del acta (PUT /acta): todo el reemplazo (borrado del
      acta previa, inserción de cabecera en `acta_partido`, eventos en
      `acta_evento`, totales en `estadisticas_partido` y marcador/ganador en
      `partido`) ocurre dentro de un único bloque `with conn` y bloqueando el
      partido con `SELECT ... FOR UPDATE`. Si falla una regla de negocio o el
      trigger de porteros, PostgreSQL hace ROLLBACK dejando el acta anterior
      intacta.
    * Cálculo en servidor desde eventos: el cliente solo envía `alineacion` y
      `eventos`. El servidor valida cronológicamente las sustituciones y
      expulsiones (que se aplican al inicio del minuto m), calcula `mins_jugados`
      según la `duracion` oficial de la categoría (40 a 90 min) y asigna los
      `goles_recibidos` únicamente al portero que estaba en el campo en el
      minuto de cada `gol_rival`.
    * Orden de códigos HTTP del contrato: 401 (sin sesión) -> 403 (rol no válido)
      -> 404 (el partido no existe) -> 403 (existe pero no pertenece al equipo o
      liga del entrenador) -> 409 (conflicto de estado/fecha) -> 422 (validación).
"""
from datetime import date
from flask import Blueprint, g, jsonify, request

from comun import (
    ApiError,
    dict_cursor,
    es_entero,
    get_db_connection,
    leer_json,
    parametros_paginacion,
    parsear_entero_query,
    parsear_fecha,
    respuesta_paginada,
)
from permisos import (
    es_entrenador_de,
    login_required,
    puede_sobre_equipo,
    puede_sobre_liga,
    rol_requerido,
)

bp = Blueprint("partidos", __name__, url_prefix="/api/partidos")

MAX_ID = 2_147_483_647
ESTADOS_ALINEACION = ("titular", "suplente")
TIPOS_EVENTO = ("gol", "gol_rival", "tarjeta", "sustitucion")
COLORES_TARJETA = ("amarilla", "roja")


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


def _validacion(detalles):
    return ApiError("validacion", "Hay datos que no son válidos.", 422, detalles)


def _sin_permiso():
    return ApiError("sin_permiso", "No tienes permiso para esta acción.", 403)


_SELECT_PARTIDO = """
    SELECT p.id_partido, p.temporada, p.jornada, p.fecha_ini, p.lugar,
           p.local AS local_id, el.nombre AS local_nombre, el.es_propio AS local_es_propio,
           el.competicion AS local_competicion, cl.duracion AS duracion_categoria,
           p.visitante AS visitante_id, ev.nombre AS visitante_nombre, ev.es_propio AS visitante_es_propio,
           ev.competicion AS visitante_competicion,
           p.resultado_local, p.resultado_visitante, p.ganador, p.evento,
           c.id AS cronica_id
    FROM partido p
    JOIN equipo el ON el.id_equipo = p.local
    JOIN categoria cl ON cl.id_categoria = el.categoria
    JOIN equipo ev ON ev.id_equipo = p.visitante
    LEFT JOIN cronica c ON c.partido = p.id_partido
"""


def _partido_a_dict(fila, acta=None, incluir_clave_acta=False):
    """Convierte una fila de _SELECT_PARTIDO en el recurso Partido del contrato."""
    res = {
        "id": fila["id_partido"],
        "temporada_id": fila["temporada"],
        "jornada": fila["jornada"],
        "fecha": fila["fecha_ini"].isoformat() if hasattr(fila["fecha_ini"], "isoformat") else str(fila["fecha_ini"]),
        "lugar": fila["lugar"],
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
        "evento": fila["evento"],
        "cronica_id": fila["cronica_id"],
    }
    if incluir_clave_acta or acta is not None:
        res["acta"] = acta
    return res


def _cargar_acta(cur, partido_id):
    """Reconstruye el objeto acta (árbitros, delegados, alineación y eventos) si existe."""
    cur.execute(
        """
        SELECT ep.id_jugador, ep.id_equipo, ep.estado, ep.mins_jugados,
               ep.goles, ep.goles_recibidos, ep.asistencias, ep.amarillas, ep.roja,
               j.nombre, j.ap1, j.ap2, j.dorsal, j.posicion
        FROM estadisticas_partido ep
        JOIN jugador j ON j.id_jugador = ep.id_jugador
        WHERE ep.partido = %s
        ORDER BY CASE WHEN ep.estado = 'titular' THEN 0 ELSE 1 END,
                 j.dorsal ASC NULLS LAST, j.id_jugador ASC
        """,
        (partido_id,),
    )
    filas_alin = cur.fetchall()

    cur.execute(
        """
        SELECT arbitro_principal, arbitro_asistente_1, arbitro_asistente_2,
               delegado_campo, delegado_equipo
        FROM acta_partido WHERE partido = %s
        """,
        (partido_id,),
    )
    cabecera = cur.fetchone()

    if not filas_alin and cabecera is None:
        return None

    cur.execute(
        """
        SELECT id, tipo, minuto, id_jugador, id_jugador_2, color, autor_rival
        FROM acta_evento
        WHERE partido = %s
        ORDER BY minuto ASC, id ASC
        """,
        (partido_id,),
    )
    filas_ev = cur.fetchall()

    asistentes = []
    if cabecera:
        if cabecera["arbitro_asistente_1"]:
            asistentes.append(cabecera["arbitro_asistente_1"])
        if cabecera["arbitro_asistente_2"]:
            asistentes.append(cabecera["arbitro_asistente_2"])

    arbitros = {
        "principal": cabecera["arbitro_principal"] if cabecera else None,
        "asistentes": asistentes,
    }
    cuerpo_tecnico = {
        "delegado_campo": cabecera["delegado_campo"] if cabecera else None,
        "delegado_equipo": cabecera["delegado_equipo"] if cabecera else None,
    }

    alineacion = []
    for f in filas_alin:
        nombre_completo = " ".join(p for p in (f["nombre"], f["ap1"], f["ap2"]) if p)
        alineacion.append({
            "jugador_id": f["id_jugador"],
            "nombre": f["nombre"],
            "ap1": f["ap1"],
            "ap2": f["ap2"],
            "nombre_completo": nombre_completo,
            "dorsal": f["dorsal"],
            "posicion": f["posicion"],
            "estado": f["estado"],
            "mins_jugados": f["mins_jugados"],
            "goles": f["goles"],
            "goles_recibidos": f["goles_recibidos"],
            "asistencias": f["asistencias"],
            "amarillas": f["amarillas"],
            "roja": f["roja"],
        })

    eventos = []
    for ev in filas_ev:
        tipo = ev["tipo"]
        item = {"tipo": tipo, "minuto": ev["minuto"]}
        if tipo == "gol":
            item["jugador_id"] = ev["id_jugador"]
            item["asistente_id"] = ev["id_jugador_2"]
        elif tipo == "gol_rival":
            item["autor"] = ev["autor_rival"]
        elif tipo == "tarjeta":
            item["jugador_id"] = ev["id_jugador"]
            item["color"] = ev["color"]
        elif tipo == "sustitucion":
            item["sale_id"] = ev["id_jugador"]
            item["entra_id"] = ev["id_jugador_2"]
        eventos.append(item)

    return {
        "arbitros": arbitros,
        "cuerpo_tecnico": cuerpo_tecnico,
        "alineacion": alineacion,
        "eventos": eventos,
    }


# ----------------------------------------------------------------------------
# GET /api/partidos
# ----------------------------------------------------------------------------
@bp.route("", methods=["GET"])
@login_required
def listar():
    temporada_id = parsear_entero_query("temporada", minimo=1)
    equipo_id = parsear_entero_query("equipo", minimo=1)
    competicion = (request.args.get("competicion") or "").strip() or None
    desde_raw = request.args.get("desde") or None
    hasta_raw = request.args.get("hasta") or None
    estado = request.args.get("estado") or None

    desde = parsear_fecha(desde_raw, "desde") if desde_raw else None
    hasta = parsear_fecha(hasta_raw, "hasta") if hasta_raw else None
    if desde and hasta and desde > hasta:
        raise _validacion([{"campo": "desde", "mensaje": "No puede ser posterior a 'hasta'."}])

    if estado is not None and estado not in ("programado", "finalizado"):
        raise _validacion([{"campo": "estado", "mensaje": "Debe ser programado o finalizado."}])

    page, por_pagina, offset = parametros_paginacion()

    condiciones, params = [], []
    if temporada_id is not None:
        condiciones.append("p.temporada = %s")
        params.append(temporada_id)
    if equipo_id is not None:
        condiciones.append("(p.local = %s OR p.visitante = %s)")
        params.extend([equipo_id, equipo_id])
    if competicion is not None:
        condiciones.append("el.competicion = %s")
        params.append(competicion)
    if desde is not None:
        condiciones.append("p.fecha_ini >= %s")
        params.append(desde)
    if hasta is not None:
        condiciones.append("p.fecha_ini <= %s")
        params.append(hasta)
    if estado == "finalizado":
        condiciones.append("p.resultado_local IS NOT NULL")
    elif estado == "programado":
        condiciones.append("p.resultado_local IS NULL")

    donde = (" WHERE " + " AND ".join(condiciones)) if condiciones else ""

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM partido p
                JOIN equipo el ON el.id_equipo = p.local
                """ + donde,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                _SELECT_PARTIDO
                + donde
                + " ORDER BY p.fecha_ini DESC, p.jornada DESC, p.id_partido DESC LIMIT %s OFFSET %s",
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    items = [_partido_a_dict(f) for f in filas]
    return jsonify(respuesta_paginada(items, page, por_pagina, total)), 200


# ----------------------------------------------------------------------------
# GET /api/partidos/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:partido_id>", methods=["GET"])
@login_required
def obtener(partido_id):
    if not _id_valido(partido_id):
        raise ApiError("no_encontrado", "El partido no existe.", 404)

    conn = get_db_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s", (partido_id,))
            fila = cur.fetchone()
            if fila is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)
            acta = _cargar_acta(cur, partido_id)
    finally:
        conn.close()

    return jsonify(_partido_a_dict(fila, acta=acta, incluir_clave_acta=True)), 200


# ----------------------------------------------------------------------------
# Validación de creación y edición de Partidos
# ----------------------------------------------------------------------------
def _validar_datos_partido(datos, parcial=False):
    errores = []
    limpio = {}

    if "temporada_id" in datos or not parcial:
        v = datos.get("temporada_id")
        if not _id_valido(v):
            errores.append({"campo": "temporada_id", "mensaje": "Obligatorio (entero positivo)."})
        else:
            limpio["temporada"] = v

    if "jornada" in datos or not parcial:
        v = datos.get("jornada")
        if not es_entero(v) or not 1 <= v <= 100:
            errores.append({"campo": "jornada", "mensaje": "Debe ser un entero mayor o igual a 1."})
        else:
            limpio["jornada"] = v

    if "fecha" in datos or not parcial:
        v = datos.get("fecha")
        try:
            limpio["fecha_ini"] = parsear_fecha(v, "fecha")
        except ApiError as exc:
            errores.extend(exc.detalles or [{"campo": "fecha", "mensaje": exc.mensaje}])

    if "local_id" in datos or not parcial:
        v = datos.get("local_id")
        if not _id_valido(v):
            errores.append({"campo": "local_id", "mensaje": "Obligatorio (id del equipo local)."})
        else:
            limpio["local"] = v

    if "visitante_id" in datos or not parcial:
        v = datos.get("visitante_id")
        if not _id_valido(v):
            errores.append({"campo": "visitante_id", "mensaje": "Obligatorio (id del equipo visitante)."})
        else:
            limpio["visitante"] = v

    if "lugar" in datos:
        v = datos.get("lugar")
        if v is not None and (not isinstance(v, str) or len(v.strip()) > 150):
            errores.append({"campo": "lugar", "mensaje": "Máximo 150 caracteres."})
        else:
            limpio["lugar"] = v.strip() if isinstance(v, str) and v.strip() else None

    if "evento" in datos:
        v = datos.get("evento")
        if v is not None and (not isinstance(v, str) or len(v.strip()) > 255):
            errores.append({"campo": "evento", "mensaje": "Máximo 255 caracteres."})
        else:
            limpio["evento"] = v.strip() if isinstance(v, str) and v.strip() else None

    if "local" in limpio and "visitante" in limpio and limpio["local"] == limpio["visitante"]:
        errores.append({"campo": "visitante_id", "mensaje": "El equipo local y el visitante deben ser distintos."})

    return errores, limpio


def _comprobar_relaciones_partido(cur, temporada_id, local_id, visitante_id):
    cur.execute("SELECT 1 FROM temporada WHERE id_temporada = %s", (temporada_id,))
    if cur.fetchone() is None:
        raise _validacion([{"campo": "temporada_id", "mensaje": "La temporada indicada no existe."}])

    cur.execute(
        "SELECT id_equipo, competicion FROM equipo WHERE id_equipo IN (%s, %s)",
        (local_id, visitante_id),
    )
    equipos = {f["id_equipo"]: f["competicion"] for f in cur.fetchall()}
    if local_id not in equipos:
        raise _validacion([{"campo": "local_id", "mensaje": "El equipo local no existe."}])
    if visitante_id not in equipos:
        raise _validacion([{"campo": "visitante_id", "mensaje": "El equipo visitante no existe."}])
    if equipos[local_id] != equipos[visitante_id]:
        raise _validacion([{
            "campo": "visitante_id",
            "mensaje": "Ambos equipos deben pertenecer a la misma competición.",
        }])


# ----------------------------------------------------------------------------
# POST /api/partidos
# ----------------------------------------------------------------------------
@bp.route("", methods=["POST"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def crear():
    datos = leer_json()
    errores, limpio = _validar_datos_partido(datos, parcial=False)
    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            _comprobar_relaciones_partido(cur, limpio["temporada"], limpio["local"], limpio["visitante"])

            if not puede_sobre_liga(g.usuario, limpio["local"], limpio["visitante"]):
                raise _sin_permiso()

            cur.execute(
                """
                INSERT INTO partido (temporada, jornada, fecha_ini, lugar, local, visitante, evento)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id_partido
                """,
                (
                    limpio["temporada"],
                    limpio["jornada"],
                    limpio["fecha_ini"],
                    limpio.get("lugar"),
                    limpio["local"],
                    limpio["visitante"],
                    limpio.get("evento"),
                ),
            )
            nuevo_id = cur.fetchone()["id_partido"]
            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s", (nuevo_id,))
            creado = cur.fetchone()
    finally:
        conn.close()

    respuesta = jsonify(_partido_a_dict(creado))
    respuesta.status_code = 201
    respuesta.headers["Location"] = f"/api/partidos/{nuevo_id}"
    return respuesta


# ----------------------------------------------------------------------------
# PATCH /api/partidos/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:partido_id>", methods=["PATCH"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def modificar(partido_id):
    if not _id_valido(partido_id):
        raise ApiError("no_encontrado", "El partido no existe.", 404)

    datos = leer_json()
    if not datos:
        raise _validacion([{"campo": "datos", "mensaje": "Envía al menos un campo para modificar."}])

    errores, limpio = _validar_datos_partido(datos, parcial=True)
    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM partido WHERE id_partido = %s FOR UPDATE",
                (partido_id,),
            )
            actual = cur.fetchone()
            if actual is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)

            if not puede_sobre_liga(g.usuario, actual["local"], actual["visitante"]):
                raise _sin_permiso()

            nueva_temp = limpio.get("temporada", actual["temporada"])
            nuevo_loc = limpio.get("local", actual["local"])
            nuevo_vis = limpio.get("visitante", actual["visitante"])
            nueva_fecha = limpio.get("fecha_ini", actual["fecha_ini"])

            if nuevo_loc == nuevo_vis:
                raise _validacion([{"campo": "visitante_id", "mensaje": "El equipo local y el visitante deben ser distintos."}])

            _comprobar_relaciones_partido(cur, nueva_temp, nuevo_loc, nuevo_vis)

            if not puede_sobre_liga(g.usuario, nuevo_loc, nuevo_vis):
                raise _sin_permiso()

            # Si ya está finalizado o tiene acta, no se permiten cambios que la invaliden (§4)
            tiene_resultado = actual["resultado_local"] is not None
            if tiene_resultado:
                if nuevo_loc != actual["local"] or nuevo_vis != actual["visitante"]:
                    raise ApiError(
                        "conflicto",
                        "No se pueden cambiar los equipos de un partido que ya tiene acta o resultado.",
                        409,
                    )
                if nueva_fecha > date.today():
                    raise ApiError(
                        "conflicto",
                        "No se puede mover al futuro un partido que ya tiene acta o resultado.",
                        409,
                    )

            campos, params = [], []
            for col, val in limpio.items():
                campos.append(f"{col} = %s")
                params.append(val)

            if campos:
                params.append(partido_id)
                cur.execute(f"UPDATE partido SET {', '.join(campos)} WHERE id_partido = %s", params)

            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s", (partido_id,))
            actualizado = cur.fetchone()
    finally:
        conn.close()

    return jsonify(_partido_a_dict(actualizado)), 200


# ----------------------------------------------------------------------------
# DELETE /api/partidos/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:partido_id>", methods=["DELETE"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def eliminar(partido_id):
    if not _id_valido(partido_id):
        raise ApiError("no_encontrado", "El partido no existe.", 404)

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("DELETE FROM partido WHERE id_partido = %s RETURNING id_partido", (partido_id,))
            if cur.fetchone() is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)
    finally:
        conn.close()

    return "", 204


# ----------------------------------------------------------------------------
# PUT /api/partidos/<id>/resultado (Solo partidos entre rivales — §4 y §5)
# ----------------------------------------------------------------------------
@bp.route("/<int:partido_id>/resultado", methods=["PUT"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def guardar_resultado(partido_id):
    if not _id_valido(partido_id):
        raise ApiError("no_encontrado", "El partido no existe.", 404)

    datos = leer_json()
    r_loc = datos.get("resultado_local")
    r_vis = datos.get("resultado_visitante")
    errores = []
    if not es_entero(r_loc) or not 0 <= r_loc <= 99:
        errores.append({"campo": "resultado_local", "mensaje": "Debe ser un entero entre 0 y 99."})
    if not es_entero(r_vis) or not 0 <= r_vis <= 99:
        errores.append({"campo": "resultado_visitante", "mensaje": "Debe ser un entero entre 0 y 99."})
    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s FOR UPDATE OF p", (partido_id,))
            p = cur.fetchone()
            if p is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)

            if not puede_sobre_liga(g.usuario, p["local_id"], p["visitante_id"]):
                raise _sin_permiso()

            if p["local_es_propio"] or p["visitante_es_propio"]:
                raise ApiError(
                    "conflicto",
                    "Los partidos de equipos propios requieren registrar el acta completa.",
                    409,
                )

            if p["fecha_ini"] > date.today():
                raise ApiError(
                    "conflicto",
                    "No se puede registrar el resultado de un partido en el futuro.",
                    409,
                )

            ganador = None
            if r_loc > r_vis:
                ganador = p["local_id"]
            elif r_vis > r_loc:
                ganador = p["visitante_id"]

            cur.execute(
                """
                UPDATE partido
                SET resultado_local = %s, resultado_visitante = %s, ganador = %s
                WHERE id_partido = %s
                """,
                (r_loc, r_vis, ganador, partido_id),
            )
            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s", (partido_id,))
            actualizado = cur.fetchone()
    finally:
        conn.close()

    return jsonify(_partido_a_dict(actualizado)), 200


# ----------------------------------------------------------------------------
# PUT /api/partidos/<id>/acta (Transacción atómica y cálculo por eventos — M6)
# ----------------------------------------------------------------------------
def _validar_cabecera_acta(datos):
    errores = []
    arb = datos.get("arbitros")
    ct = datos.get("cuerpo_tecnico")

    arb_principal = arb_asist1 = arb_asist2 = None
    if arb is not None:
        if not isinstance(arb, dict):
            errores.append({"campo": "arbitros", "mensaje": "Debe ser un objeto JSON."})
        else:
            princ = arb.get("principal")
            if princ is not None:
                if not isinstance(princ, str) or len(princ.strip()) > 100:
                    errores.append({"campo": "arbitros.principal", "mensaje": "Máximo 100 caracteres."})
                else:
                    arb_principal = princ.strip() or None

            asist = arb.get("asistentes")
            if asist is not None:
                if not isinstance(asist, list) or len(asist) > 2:
                    errores.append({"campo": "arbitros.asistentes", "mensaje": "Debe ser una lista de máximo 2 asistentes."})
                else:
                    limpios = []
                    for a in asist:
                        if a is not None:
                            if not isinstance(a, str) or len(a.strip()) > 100:
                                errores.append({"campo": "arbitros.asistentes", "mensaje": "Cada asistente admite máximo 100 caracteres."})
                                break
                            if a.strip():
                                limpios.append(a.strip())
                    arb_asist1 = limpios[0] if len(limpios) >= 1 else None
                    arb_asist2 = limpios[1] if len(limpios) >= 2 else None

    del_campo = del_equipo = None
    if ct is not None:
        if not isinstance(ct, dict):
            errores.append({"campo": "cuerpo_tecnico", "mensaje": "Debe ser un objeto JSON."})
        else:
            dc = ct.get("delegado_campo")
            if dc is not None:
                if not isinstance(dc, str) or len(dc.strip()) > 100:
                    errores.append({"campo": "cuerpo_tecnico.delegado_campo", "mensaje": "Máximo 100 caracteres."})
                else:
                    del_campo = dc.strip() or None
            de = ct.get("delegado_equipo")
            if de is not None:
                if not isinstance(de, str) or len(de.strip()) > 100:
                    errores.append({"campo": "cuerpo_tecnico.delegado_equipo", "mensaje": "Máximo 100 caracteres."})
                else:
                    del_equipo = de.strip() or None

    return errores, {
        "arbitro_principal": arb_principal,
        "arbitro_asistente_1": arb_asist1,
        "arbitro_asistente_2": arb_asist2,
        "delegado_campo": del_campo,
        "delegado_equipo": del_equipo,
    }


def _procesar_y_calcular_acta(cur, p, equipo_propio_id, datos):
    """Valida alineación y eventos, y calcula las estadísticas por jugador."""
    r_loc = datos.get("resultado_local")
    r_vis = datos.get("resultado_visitante")
    errores = []

    if not es_entero(r_loc) or not 0 <= r_loc <= 99:
        errores.append({"campo": "resultado_local", "mensaje": "Debe ser un entero entre 0 y 99."})
    if not es_entero(r_vis) or not 0 <= r_vis <= 99:
        errores.append({"campo": "resultado_visitante", "mensaje": "Debe ser un entero entre 0 y 99."})

    err_cab, cabecera = _validar_cabecera_acta(datos)
    errores.extend(err_cab)

    alineacion_raw = datos.get("alineacion")
    if not isinstance(alineacion_raw, list) or not alineacion_raw:
        errores.append({"campo": "alineacion", "mensaje": "Debe ser una lista no vacía de jugadores."})

    eventos_raw = datos.get("eventos")
    if not isinstance(eventos_raw, list):
        errores.append({"campo": "eventos", "mensaje": "Debe ser una lista de eventos."})

    if errores:
        raise _validacion(errores)

    # 1. Validar alineación y no repetición de jugadores
    estado_por_jugador = {}
    titulares_count = 0
    for item in alineacion_raw:
        if not isinstance(item, dict):
            raise _validacion([{"campo": "alineacion", "mensaje": "Formato de alineación inválido."}])
        jid = item.get("jugador_id")
        est = item.get("estado")
        if not _id_valido(jid):
            raise _validacion([{"campo": "alineacion.jugador_id", "mensaje": "ID de jugador inválido."}])
        if est not in ESTADOS_ALINEACION:
            raise _validacion([{"campo": "alineacion.estado", "mensaje": "El estado debe ser titular o suplente."}])
        if jid in estado_por_jugador:
            raise _validacion([{"campo": "alineacion", "mensaje": f"El jugador {jid} está repetido en la alineación."}])
        estado_por_jugador[jid] = est
        if est == "titular":
            titulares_count += 1

    if titulares_count == 0 or titulares_count > 11:
        raise _validacion([{"campo": "alineacion", "mensaje": "Debe haber entre 1 y 11 titulares."}])

    # Comprobar en BD que todos existen, están activos y son del equipo propio del partido
    ids_alin = list(estado_por_jugador.keys())
    cur.execute(
        "SELECT id_jugador, equipo, posicion, activo FROM jugador WHERE id_jugador = ANY(%s)",
        (ids_alin,),
    )
    fichas = {f["id_jugador"]: f for f in cur.fetchall()}

    for jid in ids_alin:
        f = fichas.get(jid)
        if f is None or not f["activo"] or f["equipo"] != equipo_propio_id:
            raise _validacion([{
                "campo": "alineacion",
                "mensaje": f"El jugador {jid} no existe, no está activo o no pertenece al equipo.",
            }])

    # 2. Estado de simulación de partido
    duracion = p["duracion_categoria"]
    sim = {}
    for jid, est in estado_por_jugador.items():
        es_tit = est == "titular"
        sim[jid] = {
            "id_jugador": jid,
            "id_equipo": equipo_propio_id,
            "posicion": fichas[jid]["posicion"],
            "estado": est,
            "en_campo": es_tit,
            "ha_entrado": es_tit,
            "minuto_entrada": 0 if es_tit else None,
            "minuto_salida": None,
            "expulsado": False,
            "amarillas": 0,
            "roja": False,
            "goles": 0,
            "asistencias": 0,
            "goles_recibidos": 0,
        }

    # 3. Validar estructura de eventos y ordenarlos por minuto
    # (Las sustituciones y expulsiones del minuto m se aplican al empezar ese minuto — §3)
    PRIORIDAD_TIPO = {"sustitucion": 0, "tarjeta": 1, "gol": 2, "gol_rival": 2}
    eventos_validados = []

    for idx, ev in enumerate(eventos_raw):
        if not isinstance(ev, dict):
            raise _validacion([{"campo": "eventos", "mensaje": "Cada evento debe ser un objeto JSON."}])
        tipo = ev.get("tipo")
        minuto = ev.get("minuto")
        if tipo not in TIPOS_EVENTO:
            raise _validacion([{"campo": "eventos.tipo", "mensaje": "Tipo de evento no válido."}])
        if not es_entero(minuto) or not 0 <= minuto <= duracion:
            raise _validacion([{
                "campo": "eventos.minuto",
                "mensaje": f"El minuto debe estar entre 0 y {duracion} para esta categoría.",
            }])
        eventos_validados.append((minuto, PRIORIDAD_TIPO[tipo], idx, ev))

    eventos_validados.sort(key=lambda x: (x[0], x[1], x[2]))

    goles_propios = 0
    goles_rival = 0
    filas_eventos_bd = []

    for minuto, _, _, ev in eventos_validados:
        tipo = ev["tipo"]

        if tipo == "sustitucion":
            sale_id = ev.get("sale_id")
            entra_id = ev.get("entra_id")
            if sale_id not in sim or entra_id not in sim or sale_id == entra_id:
                raise _validacion([{"campo": "eventos", "mensaje": "Jugadores de sustitución no válidos."}])
            s_sale = sim[sale_id]
            s_entra = sim[entra_id]
            if s_sale["expulsado"] or not s_sale["en_campo"]:
                raise _validacion([{
                    "campo": "eventos",
                    "mensaje": f"El jugador {sale_id} no está en el campo para ser sustituido.",
                }])
            if s_entra["expulsado"] or s_entra["estado"] != "suplente" or s_entra["ha_entrado"]:
                raise _validacion([{
                    "campo": "eventos",
                    "mensaje": f"El jugador {entra_id} debe ser un suplente que aún no haya jugado.",
                }])
            s_sale["en_campo"] = False
            s_sale["minuto_salida"] = minuto
            s_entra["en_campo"] = True
            s_entra["ha_entrado"] = True
            s_entra["minuto_entrada"] = minuto
            filas_eventos_bd.append((tipo, minuto, sale_id, entra_id, None, None))

        elif tipo == "tarjeta":
            jid = ev.get("jugador_id")
            color = ev.get("color")
            if jid not in sim:
                raise _validacion([{"campo": "eventos", "mensaje": "El jugador amonestado no está en la alineación."}])
            if color not in COLORES_TARJETA:
                raise _validacion([{"campo": "eventos.color", "mensaje": "El color debe ser amarilla o roja."}])
            st = sim[jid]
            if st["expulsado"]:
                raise _validacion([{
                    "campo": "eventos",
                    "mensaje": f"El jugador {jid} ya fue expulsado y no puede recibir más eventos.",
                }])
            if color == "amarilla":
                st["amarillas"] += 1
                if st["amarillas"] > 2:
                    raise _validacion([{"campo": "eventos", "mensaje": "Un jugador no puede recibir más de 2 amarillas."}])
                if st["amarillas"] == 2:
                    st["roja"] = True
                    st["expulsado"] = True
                    if st["en_campo"]:
                        st["en_campo"] = False
                        st["minuto_salida"] = minuto
            else:
                st["roja"] = True
                st["expulsado"] = True
                if st["en_campo"]:
                    st["en_campo"] = False
                    st["minuto_salida"] = minuto
            filas_eventos_bd.append((tipo, minuto, jid, None, color, None))

        elif tipo == "gol":
            jid = ev.get("jugador_id")
            asist_id = ev.get("asistente_id")
            if jid not in sim:
                raise _validacion([{"campo": "eventos", "mensaje": "El goleador debe estar en la alineación."}])
            if sim[jid]["expulsado"] or not sim[jid]["en_campo"]:
                raise _validacion([{"campo": "eventos", "mensaje": "El goleador no se encuentra en el terreno de juego."}])
            if asist_id is not None:
                if asist_id not in sim or asist_id == jid:
                    raise _validacion([{"campo": "eventos", "mensaje": "El asistente debe estar en la alineación y ser distinto del goleador."}])
                if sim[asist_id]["expulsado"] or not sim[asist_id]["en_campo"]:
                    raise _validacion([{"campo": "eventos", "mensaje": "El asistente no se encuentra en el terreno de juego."}])
                sim[asist_id]["asistencias"] += 1

            sim[jid]["goles"] += 1
            goles_propios += 1
            filas_eventos_bd.append((tipo, minuto, jid, asist_id, None, None))

        elif tipo == "gol_rival":
            autor = ev.get("autor")
            if autor is not None and (not isinstance(autor, str) or len(autor.strip()) > 100):
                raise _validacion([{"campo": "eventos.autor", "mensaje": "Máximo 100 caracteres para el autor rival."}])
            autor_limpio = autor.strip() if isinstance(autor, str) and autor.strip() else None
            goles_rival += 1

            # Goles recibidos: solo a porteros que están en el campo en este minuto (§3)
            for st in sim.values():
                if st["posicion"] == "Portero" and st["en_campo"]:
                    st["goles_recibidos"] += 1

            filas_eventos_bd.append((tipo, minuto, None, None, None, autor_limpio))

    # 4. Comprobar coherencia del marcador con los eventos (§3 y §5)
    es_local_propio = p["local_id"] == equipo_propio_id
    esperados_propios = r_loc if es_local_propio else r_vis
    esperados_rival = r_vis if es_local_propio else r_loc

    if goles_propios != esperados_propios or goles_rival != esperados_rival:
        raise _validacion([{
            "campo": "eventos",
            "mensaje": "El número de goles en los eventos debe coincidir exactamente con el marcador.",
        }])

    # 5. Calcular minutos jugados finales por jugador
    estadisticas_finales = []
    for st in sim.values():
        if not st["ha_entrado"]:
            mins = 0
        else:
            salida = st["minuto_salida"] if st["minuto_salida"] is not None else duracion
            mins = max(0, salida - st["minuto_entrada"])
        st["mins_jugados"] = mins
        estadisticas_finales.append(st)

    return r_loc, r_vis, cabecera, filas_eventos_bd, estadisticas_finales


@bp.route("/<int:partido_id>/acta", methods=["PUT"])
@rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
def guardar_acta(partido_id):
    if not _id_valido(partido_id):
        raise ApiError("no_encontrado", "El partido no existe.", 404)

    datos = leer_json()

    conn = get_db_connection()
    try:
        with conn, dict_cursor(conn) as cur:
            # 1.º ¿Existe el partido? -> 404
            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s FOR UPDATE OF p", (partido_id,))
            p = cur.fetchone()
            if p is None:
                raise ApiError("no_encontrado", "El partido no existe.", 404)

            # Determinar el equipo propio del partido
            equipo_propio_id = None
            if p["local_es_propio"] and p["visitante_es_propio"]:
                if g.usuario["rol"] == "ENTRENADOR":
                    if es_entrenador_de(g.usuario, p["local_id"]):
                        equipo_propio_id = p["local_id"]
                    elif es_entrenador_de(g.usuario, p["visitante_id"]):
                        equipo_propio_id = p["visitante_id"]
                else:
                    equipo_propio_id = p["local_id"]
            elif p["local_es_propio"]:
                equipo_propio_id = p["local_id"]
            elif p["visitante_es_propio"]:
                equipo_propio_id = p["visitante_id"]

            # 2.º Permisos (403) y tipo de partido (409 si es entre rivales)
            if equipo_propio_id is None:
                if g.usuario["rol"] == "ENTRENADOR" and not puede_sobre_liga(
                    g.usuario, p["local_id"], p["visitante_id"]
                ):
                    raise _sin_permiso()
                raise ApiError(
                    "conflicto",
                    "Los partidos entre rivales no llevan acta; utiliza la ruta de resultado.",
                    409,
                )

            if not puede_sobre_equipo(g.usuario, equipo_propio_id):
                raise _sin_permiso()

            # 3.º ¿Partido en el futuro? -> 409
            if p["fecha_ini"] > date.today():
                raise ApiError(
                    "conflicto",
                    "No se puede enviar el acta de un partido cuya fecha aún no ha llegado.",
                    409,
                )

            # 4.º Validación completa y cálculo de estadísticas (422 si algo falla)
            r_loc, r_vis, cabecera, filas_eventos, stats_finales = _procesar_y_calcular_acta(
                cur, p, equipo_propio_id, datos
            )

            # 5.º Reemplazo atómico en BD
            cur.execute("DELETE FROM acta_evento WHERE partido = %s", (partido_id,))
            cur.execute("DELETE FROM acta_partido WHERE partido = %s", (partido_id,))
            cur.execute(
                "DELETE FROM estadisticas_partido WHERE partido = %s AND id_equipo = %s",
                (partido_id, equipo_propio_id),
            )

            cur.execute(
                """
                INSERT INTO acta_partido (
                    partido, arbitro_principal, arbitro_asistente_1, arbitro_asistente_2,
                    delegado_campo, delegado_equipo
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    partido_id,
                    cabecera["arbitro_principal"],
                    cabecera["arbitro_asistente_1"],
                    cabecera["arbitro_asistente_2"],
                    cabecera["delegado_campo"],
                    cabecera["delegado_equipo"],
                ),
            )

            for ev_row in filas_eventos:
                cur.execute(
                    """
                    INSERT INTO acta_evento (
                        partido, tipo, minuto, id_jugador, id_jugador_2, color, autor_rival
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (partido_id, *ev_row),
                )

            for st in stats_finales:
                cur.execute(
                    """
                    INSERT INTO estadisticas_partido (
                        partido, id_jugador, id_equipo, estado, mins_jugados,
                        goles, goles_recibidos, asistencias, amarillas, roja
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        partido_id,
                        st["id_jugador"],
                        st["id_equipo"],
                        st["estado"],
                        st["mins_jugados"],
                        st["goles"],
                        st["goles_recibidos"],
                        st["asistencias"],
                        st["amarillas"],
                        st["roja"],
                    ),
                )

            ganador = None
            if r_loc > r_vis:
                ganador = p["local_id"]
            elif r_vis > r_loc:
                ganador = p["visitante_id"]

            cur.execute(
                """
                UPDATE partido
                SET resultado_local = %s, resultado_visitante = %s, ganador = %s
                WHERE id_partido = %s
                """,
                (r_loc, r_vis, ganador, partido_id),
            )

            cur.execute(_SELECT_PARTIDO + " WHERE p.id_partido = %s", (partido_id,))
            actualizado = cur.fetchone()
            acta_guardada = _cargar_acta(cur, partido_id)
    finally:
        conn.close()

    return jsonify(_partido_a_dict(actualizado, acta=acta_guardada, incluir_clave_acta=True)), 200
