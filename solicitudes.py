"""Solicitudes de acceso del CD. Calasanz (E4).

Un usuario ESTANDAR pide que su cuenta pase a ser JUGADOR (vinculada a una
ficha) o ENTRENADOR (vinculado a un equipo propio). Coordinación o desarrollo
la aprueban o la rechazan.

Endpoints (docs/API_CONTRATO.md, apartado 4):
    POST  /api/solicitudes        ESTANDAR              201 · 403 · 409 · 422
    GET   /api/solicitudes/mias   cualquier sesión      200 (array)
    GET   /api/solicitudes        COORDINADOR, DESARROLLADOR   200 paginado
    PATCH /api/solicitudes/<id>   COORDINADOR, DESARROLLADOR   200 · 404 · 409 · 422

Notas de diseño (para el examen oral):
    * Aprobar es UNA transacción: bloquea la solicitud y al usuario
      (SELECT ... FOR UPDATE), vincula la ficha o el equipo, cambia el rol y
      cierra la solicitud. Si cualquier paso falla, no se guarda nada.
    * El vínculo se hace con un UPDATE condicional (... AND id_usuario IS NULL):
      si otra solicitud se aprobó antes sobre la misma ficha o el mismo equipo,
      el UPDATE no toca ninguna fila y se responde 409 en vez de pisarla.
    * Los índices únicos de la BD son la red de seguridad final (una pendiente
      por usuario, una ficha por usuario, un equipo por entrenador): sus
      violaciones llegan como 409 gracias a traducir_error_bd (comun.py).
    * Coordinador y desarrollador pueden resolver cualquier solicitud porque la
      BD solo admite solicitar JUGADOR o ENTRENADOR (CHECK ck_solicitud_rol), y
      esos son justo los roles que el contrato deja gestionar al coordinador.
"""
from flask import Blueprint, g, jsonify, request

from comun import (
    ApiError,
    es_entero,
    get_db_connection,
    leer_json,
    parametros_paginacion,
    respuesta_paginada,
)
from permisos import login_required, rol_requerido

bp = Blueprint("solicitudes", __name__, url_prefix="/api/solicitudes")

ROLES_SOLICITABLES = ("JUGADOR", "ENTRENADOR")
ESTADOS = ("pendiente", "aprobada", "rechazada")
MENSAJE_MIN, MENSAJE_MAX = 5, 500
COMENTARIO_MAX = 500
MAX_ID = 2_147_483_647  # mayor valor de un INT de PostgreSQL

_SELECT = """
    SELECT s.id_solicitud, s.id_usuario, u.username, s.rol_solicitado,
           s.id_jugador, concat_ws(' ', j.nombre, j.ap1, j.ap2),
           s.id_equipo, e.nombre,
           s.mensaje, s.estado, s.comentario_resolucion,
           s.creada_en, s.resuelta_en
    FROM solicitud_acceso s
    JOIN usuarios u ON u.id_usuario = s.id_usuario
    LEFT JOIN jugador j ON j.id_jugador = s.id_jugador
    LEFT JOIN equipo e ON e.id_equipo = s.id_equipo
"""
_ORDEN = " ORDER BY s.creada_en DESC, s.id_solicitud DESC"


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def _iso(valor):
    return valor.isoformat() if valor is not None else None


def solicitud_a_dict(f):
    """Fila de _SELECT -> recurso «Solicitud de acceso» del contrato."""
    return {
        "id": f[0],
        "usuario": {"id": f[1], "username": f[2]},
        "rol_solicitado": f[3],
        "jugador": {"id": f[4], "nombre_completo": f[5]} if f[4] is not None else None,
        "equipo": {"id": f[6], "nombre": f[7]} if f[6] is not None else None,
        "mensaje": f[8],
        "estado": f[9],
        "comentario_resolucion": f[10],
        "creada_en": _iso(f[11]),
        "resuelta_en": _iso(f[12]),
    }


def _validacion(detalles):
    return ApiError("validacion", "Hay datos que no son válidos.", 422, detalles)


def _id_valido(valor):
    return es_entero(valor) and 1 <= valor <= MAX_ID


# ----------------------------------------------------------------------------
# POST /api/solicitudes
# ----------------------------------------------------------------------------
def validar_alta(datos):
    """Comprueba la forma del cuerpo. Devuelve (errores, limpio)."""
    errores = []
    rol = datos.get("rol_solicitado")
    if rol not in ROLES_SOLICITABLES:
        errores.append({
            "campo": "rol_solicitado",
            "mensaje": "Debe ser JUGADOR o ENTRENADOR.",
        })

    mensaje = datos.get("mensaje")
    texto = mensaje.strip() if isinstance(mensaje, str) else None
    if texto is None or not MENSAJE_MIN <= len(texto) <= MENSAJE_MAX:
        errores.append({
            "campo": "mensaje",
            "mensaje": f"Debe tener entre {MENSAJE_MIN} y {MENSAJE_MAX} caracteres.",
        })

    jugador_id = datos.get("jugador_id")
    equipo_id = datos.get("equipo_id")
    if rol == "JUGADOR":
        if not _id_valido(jugador_id):
            errores.append({
                "campo": "jugador_id",
                "mensaje": "Obligatorio: id de tu ficha de jugador.",
            })
        if equipo_id is not None:
            errores.append({
                "campo": "equipo_id",
                "mensaje": "No se envía al solicitar ser jugador.",
            })
    elif rol == "ENTRENADOR":
        if not _id_valido(equipo_id):
            errores.append({
                "campo": "equipo_id",
                "mensaje": "Obligatorio: id del equipo que quieres entrenar.",
            })
        if jugador_id is not None:
            errores.append({
                "campo": "jugador_id",
                "mensaje": "No se envía al solicitar ser entrenador.",
            })

    return errores, {
        "rol": rol,
        "mensaje": texto,
        "jugador_id": jugador_id,
        "equipo_id": equipo_id,
    }


def _comprobar_ficha(cur, jugador_id):
    cur.execute(
        "SELECT activo, id_usuario FROM jugador WHERE id_jugador = %s",
        (jugador_id,),
    )
    fila = cur.fetchone()
    if fila is None or not fila[0]:
        raise _validacion([{
            "campo": "jugador_id",
            "mensaje": "La ficha no existe o no está activa.",
        }])
    if fila[1] is not None:
        raise ApiError("conflicto", "Esa ficha ya está vinculada a otra cuenta.", 409)


def _comprobar_equipo(cur, equipo_id):
    cur.execute(
        "SELECT es_propio, id_entrenador FROM equipo WHERE id_equipo = %s",
        (equipo_id,),
    )
    fila = cur.fetchone()
    if fila is None or not fila[0]:
        raise _validacion([{
            "campo": "equipo_id",
            "mensaje": "El equipo no existe o no es del club.",
        }])
    if fila[1] is not None:
        raise ApiError("conflicto", "Ese equipo ya tiene un entrenador asignado.", 409)


@bp.route("", methods=["POST"])
@rol_requerido("ESTANDAR")
def crear():
    datos = leer_json()
    errores, limpio = validar_alta(datos)
    if errores:
        raise _validacion(errores)

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM solicitud_acceso WHERE id_usuario = %s AND estado = 'pendiente'",
                (g.usuario["id"],),
            )
            if cur.fetchone():
                raise ApiError("conflicto", "Ya tienes una solicitud pendiente.", 409)

            if limpio["rol"] == "JUGADOR":
                _comprobar_ficha(cur, limpio["jugador_id"])
            else:
                _comprobar_equipo(cur, limpio["equipo_id"])

            # Si dos peticiones simultáneas llegan hasta aquí, el índice único
            # uq_solicitud_pendiente_usuario deja pasar solo a una (la otra -> 409).
            cur.execute(
                """
                INSERT INTO solicitud_acceso
                    (id_usuario, rol_solicitado, id_jugador, id_equipo, mensaje)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id_solicitud
                """,
                (
                    g.usuario["id"],
                    limpio["rol"],
                    limpio["jugador_id"],
                    limpio["equipo_id"],
                    limpio["mensaje"],
                ),
            )
            nueva_id = cur.fetchone()[0]
            cur.execute(_SELECT + " WHERE s.id_solicitud = %s", (nueva_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    respuesta = jsonify(solicitud_a_dict(fila))
    respuesta.status_code = 201
    respuesta.headers["Location"] = f"/api/solicitudes/{nueva_id}"
    return respuesta


# ----------------------------------------------------------------------------
# GET /api/solicitudes/mias
# ----------------------------------------------------------------------------
@bp.route("/mias", methods=["GET"])
@login_required
def mias():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                _SELECT + " WHERE s.id_usuario = %s" + _ORDEN,
                (g.usuario["id"],),
            )
            filas = cur.fetchall()
    finally:
        conn.close()
    return jsonify([solicitud_a_dict(f) for f in filas]), 200


# ----------------------------------------------------------------------------
# GET /api/solicitudes?estado=
# ----------------------------------------------------------------------------
@bp.route("", methods=["GET"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def listar():
    estado = request.args.get("estado") or None
    if estado is not None and estado not in ESTADOS:
        raise _validacion([{
            "campo": "estado",
            "mensaje": "Debe ser pendiente, aprobada o rechazada.",
        }])
    page, por_pagina, offset = parametros_paginacion()

    donde, params = "", []
    if estado is not None:
        donde = " WHERE s.estado = %s"
        params.append(estado)

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM solicitud_acceso s" + donde, params)
            total = cur.fetchone()[0]
            cur.execute(
                _SELECT + donde + _ORDEN + " LIMIT %s OFFSET %s",
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    items = [solicitud_a_dict(f) for f in filas]
    return jsonify(respuesta_paginada(items, page, por_pagina, total)), 200


# ----------------------------------------------------------------------------
# PATCH /api/solicitudes/<id>
# ----------------------------------------------------------------------------
def validar_resolucion(datos):
    """Devuelve (estado, comentario) o lanza 422."""
    errores = []
    estado = datos.get("estado")
    if estado not in ("aprobada", "rechazada"):
        errores.append({
            "campo": "estado",
            "mensaje": "Debe ser aprobada o rechazada.",
        })

    comentario = datos.get("comentario")
    if comentario is not None and not isinstance(comentario, str):
        errores.append({"campo": "comentario", "mensaje": "Debe ser texto."})
        comentario = None
    elif isinstance(comentario, str):
        comentario = comentario.strip() or None
        if comentario is not None and len(comentario) > COMENTARIO_MAX:
            errores.append({
                "campo": "comentario",
                "mensaje": f"Máximo {COMENTARIO_MAX} caracteres.",
            })

    if estado == "rechazada" and comentario is None and not errores:
        errores.append({
            "campo": "comentario",
            "mensaje": "Obligatorio al rechazar una solicitud.",
        })

    if errores:
        raise _validacion(errores)
    return estado, comentario


def _aprobar(cur, id_usuario, rol, id_jugador, id_equipo):
    """Vincula, cambia el rol. Se ejecuta dentro de la transacción de resolver()."""
    # Bloquea al usuario: nadie le cambia el rol mientras aprobamos.
    cur.execute(
        "SELECT rol FROM usuarios WHERE id_usuario = %s FOR UPDATE", (id_usuario,)
    )
    fila = cur.fetchone()
    if fila is None or fila[0] != "ESTANDAR":
        raise ApiError("conflicto", "El usuario ya no tiene el rol ESTANDAR.", 409)

    if rol == "JUGADOR":
        cur.execute(
            """
            UPDATE jugador SET id_usuario = %s
            WHERE id_jugador = %s AND id_usuario IS NULL AND activo = true
            RETURNING id_jugador
            """,
            (id_usuario, id_jugador),
        )
        ocupado = "La ficha ya no está disponible (vinculada a otra cuenta o dada de baja)."
    else:
        cur.execute(
            """
            UPDATE equipo SET id_entrenador = %s
            WHERE id_equipo = %s AND id_entrenador IS NULL AND es_propio = true
            RETURNING id_equipo
            """,
            (id_usuario, id_equipo),
        )
        ocupado = "El equipo ya no está disponible (ya tiene entrenador)."
    if cur.fetchone() is None:
        raise ApiError("conflicto", ocupado, 409)

    cur.execute("UPDATE usuarios SET rol = %s WHERE id_usuario = %s", (rol, id_usuario))


@bp.route("/<int:solicitud_id>", methods=["PATCH"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def resolver(solicitud_id):
    estado, comentario = validar_resolucion(leer_json())

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id_usuario, rol_solicitado, id_jugador, id_equipo, estado
                FROM solicitud_acceso WHERE id_solicitud = %s FOR UPDATE
                """,
                (solicitud_id,),
            )
            fila = cur.fetchone()
            if fila is None:
                raise ApiError("no_encontrado", "La solicitud no existe.", 404)
            id_usuario, rol, id_jugador, id_equipo, estado_actual = fila
            if estado_actual != "pendiente":
                raise ApiError("conflicto", "La solicitud ya está resuelta.", 409)

            if estado == "aprobada":
                _aprobar(cur, id_usuario, rol, id_jugador, id_equipo)

            cur.execute(
                """
                UPDATE solicitud_acceso
                SET estado = %s, comentario_resolucion = %s, resuelta_en = NOW()
                WHERE id_solicitud = %s
                """,
                (estado, comentario, solicitud_id),
            )
            cur.execute(_SELECT + " WHERE s.id_solicitud = %s", (solicitud_id,))
            resultado = cur.fetchone()
    finally:
        conn.close()

    return jsonify(solicitud_a_dict(resultado)), 200
