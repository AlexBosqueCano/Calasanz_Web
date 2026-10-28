"""Control de acceso del CD. Calasanz.

E2: login_required.
E3: rol_requerido, comprobaciones de propiedad y la matriz de permisos
    del contrato (docs/API_CONTRATO.md, apartado 2).

Cómo se usa en una ruta (ejemplo: PUT /api/partidos/<id>/acta)
-----------------------------------------------------------------
    @bp.route("/api/partidos/<int:partido_id>/acta", methods=["PUT"])
    @rol_requerido("ENTRENADOR", "COORDINADOR", "DESARROLLADOR")
    def guardar_acta(partido_id):
        partido = buscar_partido(partido_id)
        if partido is None:                       # 1.º ¿existe?  -> 404
            return error("no_encontrado", "El partido no existe.", 404)
        if not puede_sobre_equipo(g.usuario, partido["equipo_propio_id"]):
            return sin_permiso()                  # 2.º ¿es suyo?  -> 403
        ...

Orden de respuestas (lo pide el contrato):
    sin sesión -> 401 · rol que no vale -> 403 · no existe -> 404 ·
    existe pero no es suyo -> 403.
El decorador resuelve los dos primeros; los dos últimos los decide la ruta,
porque solo ella sabe si el recurso existe.
"""
from functools import wraps

from flask import g, session

from comun import error, get_db_connection, usuario_a_dict

ROLES = ("ESTANDAR", "JUGADOR", "ENTRENADOR", "COORDINADOR", "DESARROLLADOR")

# Roles que, por defecto, se saltan la comprobación de propiedad.
STAFF = ("COORDINADOR", "DESARROLLADOR")


# ----------------------------------------------------------------------------
# Respuesta de error de permisos
# ----------------------------------------------------------------------------
def sin_permiso():
    return error("sin_permiso", "No tienes permiso para esta acción.", 403)


# ----------------------------------------------------------------------------
# E2: sesión
# ----------------------------------------------------------------------------
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


# ----------------------------------------------------------------------------
# E3: roles
# ----------------------------------------------------------------------------
def rol_requerido(*roles):
    """Exige sesión y que el rol del usuario esté entre los indicados.

    Sin sesión -> 401. Con sesión pero rol no permitido -> 403.
    Un error al escribir el nombre de un rol falla al arrancar la app,
    no en silencio cuando alguien pruebe la ruta.
    """
    desconocidos = set(roles) - set(ROLES)
    if not roles or desconocidos:
        raise ValueError(f"Roles no válidos en rol_requerido: {sorted(desconocidos) or 'ninguno indicado'}")

    def decorador(f):
        @login_required
        @wraps(f)
        def wrapper(*args, **kwargs):
            if g.usuario["rol"] not in roles:
                return sin_permiso()
            return f(*args, **kwargs)

        return wrapper

    return decorador


# ----------------------------------------------------------------------------
# E3: consultas de propiedad
#
# Las tres funciones de abajo son las ÚNICAS que tocan la BD y dependen del
# esquema nuevo (contrato, apartado 6): equipo.id_entrenador, equipo.competicion
# y jugador.id_usuario. Si Mateo (M2) usa otros nombres, solo hay que ajustar
# el SQL de estas tres.
# ----------------------------------------------------------------------------
def _existe(sql, params):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone() is not None
    finally:
        conn.close()


def es_entrenador_de(usuario, equipo_id):
    """¿Es este usuario el entrenador de ese equipo?"""
    return _existe(
        "SELECT 1 FROM equipo WHERE id_equipo = %s AND id_entrenador = %s",
        (equipo_id, usuario["id"]),
    )


def es_de_su_liga(usuario, *equipos_ids):
    """¿Todos esos equipos juegan en la competición del equipo del usuario?"""
    ids = sorted(set(equipos_ids))
    if not ids:
        return False
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(DISTINCT otro.id_equipo)
                FROM equipo propio
                JOIN equipo otro ON otro.competicion = propio.competicion
                WHERE propio.id_entrenador = %s AND otro.id_equipo = ANY(%s)
                """,
                (usuario["id"], ids),
            )
            return cur.fetchone()[0] == len(ids)
    finally:
        conn.close()


def es_su_ficha(usuario, jugador_id):
    """¿Es esta la ficha de jugador vinculada a este usuario?"""
    return _existe(
        "SELECT 1 FROM jugador WHERE id_jugador = %s AND id_usuario = %s",
        (jugador_id, usuario["id"]),
    )


# ----------------------------------------------------------------------------
# E3: reglas de la matriz de permisos (devuelven True/False)
#
# El parámetro `globales` son los roles que no necesitan ser "dueños".
# Casi siempre son COORDINADOR y DESARROLLADOR (valor por defecto), pero hay
# excepciones en el contrato: los apuntes los ve el DESARROLLADOR y no el
# coordinador -> globales=("DESARROLLADOR",).
# ----------------------------------------------------------------------------
def puede_sobre_equipo(usuario, equipo_id, globales=STAFF):
    """Acta, crónicas, lesiones, apuntes... de un equipo concreto."""
    rol = usuario["rol"]
    if rol in globales:
        return True
    if rol == "ENTRENADOR":
        return es_entrenador_de(usuario, equipo_id)
    return False


def puede_sobre_liga(usuario, *equipos_ids, globales=STAFF):
    """Crear o editar partidos y registrar resultados entre rivales.

    Un entrenador solo puede si TODOS los equipos del partido son de la
    competición de su equipo.
    """
    rol = usuario["rol"]
    if rol in globales:
        return True
    if rol == "ENTRENADOR":
        return es_de_su_liga(usuario, *equipos_ids)
    return False


def puede_ver_datos_fisicos(usuario, jugador_id, equipo_id):
    """Estatura y peso: jugador solo el suyo; entrenador, los de su equipo."""
    rol = usuario["rol"]
    if rol in STAFF:
        return True
    if rol == "ENTRENADOR":
        return es_entrenador_de(usuario, equipo_id)
    if rol == "JUGADOR":
        return es_su_ficha(usuario, jugador_id)
    return False


def puede_modificar_propio(usuario, autor_id, globales=STAFF):
    """Editar o borrar crónicas y apuntes: su autor y, según el caso, el staff."""
    return usuario["rol"] in globales or usuario["id"] == autor_id
