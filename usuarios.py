"""Gestión de usuarios del CD. Calasanz (E5).

Endpoints (docs/API_CONTRATO.md, apartados 2 y 4):
    GET    /api/usuarios?rol=&q=   COORDINADOR, DESARROLLADOR   200 paginado · 403 · 422
    PATCH  /api/usuarios/<id>      COORDINADOR (limitado), DESARROLLADOR
                                   200 · 403 · 404 · 409 · 422
    DELETE /api/usuarios/<id>      DESARROLLADOR                204 · 403 · 404 · 409

Jerarquía (quién asigna qué):
    * DESARROLLADOR: cualquier rol, a cualquier usuario.
    * COORDINADOR: solo entre ESTANDAR, JUGADOR y ENTRENADOR. No toca a otros
      coordinadores ni a desarrolladores (ni para cambiarles el rol ni para
      desactivarlos), y no puede ascender a nadie a COORDINADOR/DESARROLLADOR.
    * Nadie se cambia el rol a sí mismo (409).
    * Nadie desactiva, degrada ni elimina al último DESARROLLADOR activo (409).

Notas de diseño (para el examen oral):
    * Se leen/bloquean primero los desarrolladores (SELECT ... FOR UPDATE, en
      orden de id) y después el usuario objetivo. Todas las operaciones siguen
      el mismo orden, así que dos desarrolladores que se degradan a la vez se
      serializan y no pueden dejar el sistema sin ninguno (y no hay deadlocks).
    * Al quitar el rol JUGADOR o ENTRENADOR se DESVINCULA la ficha o el equipo
      (jugador.id_usuario / equipo.id_entrenador = NULL) en la misma
      transacción: si no, esa ficha o ese equipo quedarían «ocupados» por una
      cuenta que ya no es jugador/entrenador y nadie más podría solicitarlos.
      Desactivar una cuenta NO toca los vínculos (es reversible).
    * Al eliminar un usuario, la BD pone a NULL sus vínculos y borra sus
      solicitudes (ON DELETE SET NULL / CASCADE). Si ha escrito noticias,
      crónicas o apuntes, la FK lo impide y se responde 409: hay que
      desactivarlo en su lugar.
"""
from flask import Blueprint, g, jsonify, request
from psycopg2 import errors as pg_errors

from comun import (
    ApiError,
    get_db_connection,
    leer_json,
    parametros_paginacion,
    respuesta_paginada,
    usuario_a_dict,
)
from permisos import ROLES, rol_requerido

bp = Blueprint("usuarios", __name__, url_prefix="/api/usuarios")

# Roles entre los que puede mover el coordinador (matriz de permisos).
ROLES_DEL_COORDINADOR = ("ESTANDAR", "JUGADOR", "ENTRENADOR")
Q_MAX = 100

# Misma consulta que /api/auth/yo (permisos.cargar_usuario): así el recurso
# Usuario es idéntico en todas partes.
_SELECT = """
    SELECT u.id_usuario, u.username, u.email, u.rol, u.activo,
           j.id_jugador, e.id_equipo
    FROM usuarios u
    LEFT JOIN jugador j ON j.id_usuario = u.id_usuario AND j.activo = true
    LEFT JOIN equipo e ON e.id_entrenador = u.id_usuario
"""


def _validacion(detalles):
    return ApiError("validacion", "Hay datos que no son válidos.", 422, detalles)


def _sin_permiso():
    return ApiError("sin_permiso", "No tienes permiso para esta acción.", 403)


def _leer_usuario(cur, id_usuario):
    cur.execute(_SELECT + " WHERE u.id_usuario = %s", (id_usuario,))
    return usuario_a_dict(cur.fetchone())


def _bloquear(cur, id_usuario):
    """Bloquea a los desarrolladores y al usuario objetivo (siempre en este orden).

    Devuelve (objetivo, hay_otro_desarrollador_activo). `objetivo` es una tupla
    (id, rol, activo) o None si el usuario no existe.
    """
    cur.execute(
        "SELECT id_usuario FROM usuarios WHERE rol = 'DESARROLLADOR' "
        "ORDER BY id_usuario FOR UPDATE"
    )
    cur.execute(
        "SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = %s FOR UPDATE",
        (id_usuario,),
    )
    objetivo = cur.fetchone()
    if objetivo is None:
        return None, False
    cur.execute(
        "SELECT 1 FROM usuarios "
        "WHERE rol = 'DESARROLLADOR' AND activo = true AND id_usuario <> %s LIMIT 1",
        (id_usuario,),
    )
    return objetivo, cur.fetchone() is not None


# ----------------------------------------------------------------------------
# GET /api/usuarios
# ----------------------------------------------------------------------------
@bp.route("", methods=["GET"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def listar():
    errores = []
    rol = request.args.get("rol") or None
    if rol is not None and rol not in ROLES:
        errores.append({"campo": "rol", "mensaje": "Debe ser " + ", ".join(ROLES) + "."})
    q = (request.args.get("q") or "").strip() or None
    if q is not None and len(q) > Q_MAX:
        errores.append({"campo": "q", "mensaje": f"Máximo {Q_MAX} caracteres."})
    if errores:
        raise _validacion(errores)
    page, por_pagina, offset = parametros_paginacion()

    condiciones, params = [], []
    if rol is not None:
        condiciones.append("u.rol = %s")
        params.append(rol)
    if q is not None:
        # Se escapan % y _ para que se busquen como texto, no como comodines.
        patron = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        condiciones.append("(u.username ILIKE %s ESCAPE '\\' OR u.email ILIKE %s ESCAPE '\\')")
        params += [patron, patron]
    donde = (" WHERE " + " AND ".join(condiciones)) if condiciones else ""

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM usuarios u" + donde, params)
            total = cur.fetchone()[0]
            cur.execute(
                _SELECT + donde + " ORDER BY LOWER(u.username), u.id_usuario LIMIT %s OFFSET %s",
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    items = [usuario_a_dict(f) for f in filas]
    return jsonify(respuesta_paginada(items, page, por_pagina, total)), 200


# ----------------------------------------------------------------------------
# PATCH /api/usuarios/<id>
# ----------------------------------------------------------------------------
def validar_cambio(datos):
    """Devuelve (rol, activo); None en lo que no se envía. Lanza 422 si no vale."""
    errores = []
    rol = activo = None

    if "rol" in datos:
        rol = datos["rol"]
        if not isinstance(rol, str) or rol not in ROLES:
            errores.append({"campo": "rol", "mensaje": "Debe ser " + ", ".join(ROLES) + "."})
    if "activo" in datos:
        activo = datos["activo"]
        if not isinstance(activo, bool):
            errores.append({"campo": "activo", "mensaje": "Debe ser true o false."})
    if "rol" not in datos and "activo" not in datos:
        errores.append({"campo": "rol", "mensaje": "Indica rol y/o activo."})

    if errores:
        raise _validacion(errores)
    return rol, activo


@bp.route("/<int:usuario_id>", methods=["PATCH"])
@rol_requerido("COORDINADOR", "DESARROLLADOR")
def modificar(usuario_id):
    nuevo_rol, nuevo_activo = validar_cambio(leer_json())
    es_coordinador = g.usuario["rol"] == "COORDINADOR"

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            objetivo, hay_otro_dev = _bloquear(cur, usuario_id)
            if objetivo is None:
                raise ApiError("no_encontrado", "El usuario no existe.", 404)
            _, rol_actual, activo_actual = objetivo

            # Nadie se cambia el rol a sí mismo (también el coordinador: 409).
            if usuario_id == g.usuario["id"] and nuevo_rol not in (None, rol_actual):
                raise ApiError("conflicto", "No puedes cambiarte el rol a ti mismo.", 409)

            # Jerarquía: el coordinador solo mueve a ESTANDAR/JUGADOR/ENTRENADOR
            # y solo entre ellos.
            if es_coordinador:
                if rol_actual not in ROLES_DEL_COORDINADOR:
                    raise _sin_permiso()
                if nuevo_rol is not None and nuevo_rol not in ROLES_DEL_COORDINADOR:
                    raise _sin_permiso()

            cambia_rol = nuevo_rol is not None and nuevo_rol != rol_actual
            cambia_activo = nuevo_activo is not None and nuevo_activo != activo_actual

            # El último desarrollador activo no puede perder el rol ni desactivarse.
            deja_de_ser_dev_activo = (
                rol_actual == "DESARROLLADOR" and activo_actual
                and ((cambia_rol) or (cambia_activo and nuevo_activo is False))
            )
            if deja_de_ser_dev_activo and not hay_otro_dev:
                raise ApiError(
                    "conflicto",
                    "No se puede dejar al sistema sin ningún desarrollador activo.",
                    409,
                )

            cambios, params = [], []
            if cambia_rol:
                cambios.append("rol = %s")
                params.append(nuevo_rol)
            if cambia_activo:
                cambios.append("activo = %s")
                params.append(nuevo_activo)
            if cambios:
                cur.execute(
                    "UPDATE usuarios SET " + ", ".join(cambios) + " WHERE id_usuario = %s",
                    params + [usuario_id],
                )

            # Si deja de ser JUGADOR/ENTRENADOR, se libera su ficha / su equipo.
            if cambia_rol and rol_actual == "JUGADOR":
                cur.execute("UPDATE jugador SET id_usuario = NULL WHERE id_usuario = %s",
                            (usuario_id,))
            if cambia_rol and rol_actual == "ENTRENADOR":
                cur.execute("UPDATE equipo SET id_entrenador = NULL WHERE id_entrenador = %s",
                            (usuario_id,))

            resultado = _leer_usuario(cur, usuario_id)
    finally:
        conn.close()

    return jsonify(resultado), 200


# ----------------------------------------------------------------------------
# DELETE /api/usuarios/<id>
# ----------------------------------------------------------------------------
@bp.route("/<int:usuario_id>", methods=["DELETE"])
@rol_requerido("DESARROLLADOR")
def eliminar(usuario_id):
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            objetivo, hay_otro_dev = _bloquear(cur, usuario_id)
            if objetivo is None:
                raise ApiError("no_encontrado", "El usuario no existe.", 404)
            _, rol_actual, activo_actual = objetivo

            if rol_actual == "DESARROLLADOR" and activo_actual and not hay_otro_dev:
                raise ApiError(
                    "conflicto",
                    "No se puede eliminar al último desarrollador activo.",
                    409,
                )
            try:
                cur.execute("DELETE FROM usuarios WHERE id_usuario = %s", (usuario_id,))
            except pg_errors.ForeignKeyViolation:
                # Tiene noticias, crónicas o apuntes escritos por él.
                raise ApiError(
                    "conflicto",
                    "No se puede eliminar: tiene contenido publicado. Desactívalo en su lugar.",
                    409,
                )
    finally:
        conn.close()

    return "", 204
