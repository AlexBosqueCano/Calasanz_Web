/*
 * session.js — Estado de sesión, redirección por rol y logout (tarea B3)
 * ======================================================================
 * IMPORTANTE PARA TODO EL EQUIPO
 *   La autorización REAL (quién puede hacer qué) la decide SIEMPRE el servidor.
 *   Este fichero solo mejora la experiencia: redirige al login, esconde enlaces
 *   que el servidor rechazaría igualmente... Nunca guardamos aquí "quién es el usuario"
 *   en localStorage: cualquiera podría editarlo. La fuente de la verdad es la cookie
 *   de sesión (HttpOnly) y la respuesta de GET /api/auth/yo.
 *
 * CÓMO SE USA EN UNA PÁGINA (lo hace layout.js solo, leyendo atributos de <body>):
 *   <body data-requiere-sesion>                       → hay que estar identificado
 *   <body data-roles="COORDINADOR,DESARROLLADOR">     → además, tener uno de esos roles
 *
 * MODO DEMOSTRACIÓN
 *   Mientras el backend no esté listo (o si el servidor está apagado) /api/auth/yo
 *   no responde (error de red) o devuelve 404. En ese caso NO redirigimos al login:
 *   activamos el "modo demostración", las páginas enseñan datos de ejemplo y se avisa
 *   con un banner. Cuando el backend exista y responda, este modo se desactiva solo.
 */
(function (global) {
    'use strict';

    // Los 5 roles del contrato (docs/API_CONTRATO.md §2)
    const ROLES = ['ESTANDAR', 'JUGADOR', 'ENTRENADOR', 'COORDINADOR', 'DESARROLLADOR'];

    // A qué "panel" va cada rol. null = ese rol aún no tiene panel propio.
    // Cuando se creen más paneles (tarea B8) solo hay que cambiar esta tabla.
    const PANEL_POR_ROL = {
        ESTANDAR: null,
        JUGADOR: null,
        ENTRENADOR: 'admin-plantilla.html',
        COORDINADOR: 'admin-plantilla.html',
        DESARROLLADOR: 'admin-plantilla.html'
    };

    // Cómo se llama cada rol cuando se lo enseñamos a una persona
    const ETIQUETA_ROL = {
        ESTANDAR: 'Usuario',
        JUGADOR: 'Jugador',
        ENTRENADOR: 'Entrenador',
        COORDINADOR: 'Coordinador',
        DESARROLLADOR: 'Desarrollador'
    };

    // ---- Estado interno (solo vive mientras la página está abierta) ----
    let usuario = null;      // objeto usuario del servidor, o null si no hay sesión
    let modoDemo = false;    // true si el servidor no está disponible
    let promesa = null;      // para no preguntar al servidor varias veces a la vez
    let servidorInalcanzable = false;   // true si ni siquiera hemos podido hablar con el servidor

    /*
     * Códigos con los que damos por hecho que NO hay backend funcionando y pasamos a modo demo:
     *   0   → sin conexión, tiempo agotado o respuesta que no es de nuestra API (api.js)
     *   404 → la ruta /api/auth/yo todavía no existe (servidor solo de ficheros estáticos)
     *   502, 503, 504 → el proxy/túnel que hay delante del servidor no consigue llegar a él
     * Un 500 NO está aquí a propósito: es un fallo real del backend y debe verse como error.
     */
    const SERVIDOR_NO_DISPONIBLE = [0, 404, 502, 503, 504];

    /*
     * Pregunta al servidor quién es el usuario actual (GET /api/auth/yo).
     * Devuelve el usuario o null. `forzar = true` vuelve a preguntar (p. ej. tras el login).
     */
    function cargar(forzar) {
        if (promesa && !forzar) return promesa;

        promesa = (async () => {
            try {
                // silencioso: no enseñamos el indicador "Cargando…" por esta petición
                // tiempoMaximo corto: las páginas esperan esta respuesta para arrancar, así que
                // no podemos tener al usuario mirando una pantalla vacía más de unos segundos
                const datos = await Api.get('/auth/yo', null, { silencioso: true, tiempoMaximo: 5000 });
                usuario = datos.usuario;
                modoDemo = false;
                Api.setCsrfToken(datos.csrf_token);
            } catch (e) {
                usuario = null;
                Api.setCsrfToken(null);

                if (e instanceof Api.ApiError && SERVIDOR_NO_DISPONIBLE.includes(e.status)) {
                    // El backend no está disponible (ver SERVIDOR_NO_DISPONIBLE): modo demostración
                    modoDemo = true;
                    // Con 404 hay servidor y puede que otras rutas sí existan (backend a medias).
                    // Con el resto no hemos podido hablar con él: no tiene sentido insistir.
                    servidorInalcanzable = e.status !== 404;
                } else if (!(e instanceof Api.ApiError) || e.status !== 401) {
                    // 401 = "no hay sesión", es normal. Cualquier otro fallo sí es un problema.
                    throw e;
                }
            }
            return usuario;
        })();
        return promesa;
    }

    // ---- Consultas rápidas (útiles para layout.js y el resto de páginas) ----
    function actual() { return usuario; }
    function estaIdentificado() { return usuario !== null; }
    function enModoDemo() { return modoDemo; }
    /* true si el servidor no ha contestado (sin red, tiempo agotado, 502/503/504, HTML en vez de JSON). */
    function servidorNoResponde() { return modoDemo && servidorInalcanzable; }
    function tieneRol(...roles) { return usuario !== null && roles.includes(usuario.rol); }
    function etiquetaRol(rol) { return ETIQUETA_ROL[rol] || rol; }
    /* Devuelve la URL del panel del usuario actual, o null si no tiene. */
    function panelUrl() { return usuario ? PANEL_POR_ROL[usuario.rol] : null; }

    /* Manda al login recordando a qué página quería ir (?next=...). */
    function irALogin(motivo) {
        const destino = window.location.pathname.split('/').pop() + window.location.search;
        const params = new URLSearchParams({ next: destino });
        if (motivo) params.set('motivo', motivo);
        window.location.replace('login.html?' + params.toString());
    }

    /*
     * Tras iniciar sesión: ¿a dónde vamos? A la página pedida (?next=) o al inicio.
     * Solo aceptamos rutas del propio sitio (si no, alguien podría mandarnos a una web falsa:
     * "redirección abierta").
     */
    function destinoTrasLogin() {
        const next = new URLSearchParams(window.location.search).get('next');
        if (next && /^[\w\-./?=&%]+$/.test(next) && !next.startsWith('/') && !next.includes('..')) return next;
        return 'index.html';
    }

    /*
     * Exige sesión y, opcionalmente, uno de los roles indicados.
     * Devuelve true si se puede continuar; false si estamos redirigiendo.
     *   - Modo demostración → se deja pasar (solo hay datos de ejemplo).
     *   - Sin sesión        → al login.
     *   - Rol insuficiente  → al inicio con un aviso.
     */
    async function requerir(roles) {
        await cargar();
        if (modoDemo) return true;
        if (!usuario) { irALogin('sesion'); return false; }
        if (roles && roles.length && !roles.includes(usuario.rol)) {
            window.location.replace('index.html?aviso=sin_permiso');
            return false;
        }
        return true;
    }

    /* Cierra la sesión en el servidor y vuelve al login. */
    async function logout() {
        try {
            await Api.post('/auth/logout');
        } catch (e) {
            // Aunque falle (servidor caído), limpiamos el estado local igualmente
        }
        usuario = null;
        Api.setCsrfToken(null);
        window.location.href = 'login.html?motivo=logout';
    }

    // Si cualquier petición recibe 401 mientras usábamos la web, la sesión caducó
    document.addEventListener('api:no-autenticado', () => {
        if (usuario) { usuario = null; irALogin('caducada'); }
    });

    global.Sesion = {
        ROLES, cargar, actual, estaIdentificado, enModoDemo, servidorNoResponde, tieneRol,
        requerir, logout, panelUrl, etiquetaRol, destinoTrasLogin
    };
})(window);
