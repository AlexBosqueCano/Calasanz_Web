/*
 * session.js — Estado de sesión, redirección por rol y logout (B3)
 *
 * La autorización REAL se comprueba en el servidor; esto solo mejora la experiencia
 * (redirigir al login, ocultar enlaces que el servidor rechazaría igualmente).
 *
 * Una página puede declarar en <body>:
 *   data-requiere-sesion            → exige estar identificado
 *   data-roles="COORDINADOR,DESARROLLADOR"  → además exige uno de estos roles
 * layout.js lo aplica automáticamente.
 */
(function (global) {
    'use strict';

    const ROLES = ['ESTANDAR', 'JUGADOR', 'ENTRENADOR', 'COORDINADOR', 'DESARROLLADOR'];

    // Página de "mi panel" según el rol (ver B8). Ajustar nombres al crear cada panel.
    const PANEL_POR_ROL = {
        ESTANDAR: 'solicitud-acceso.html',
        JUGADOR: 'panel-jugador.html',
        ENTRENADOR: 'panel-entrenador.html',
        COORDINADOR: 'panel-coordinador.html',
        DESARROLLADOR: 'panel-coordinador.html'
    };

    const ETIQUETA_ROL = {
        ESTANDAR: 'Usuario',
        JUGADOR: 'Jugador',
        ENTRENADOR: 'Entrenador',
        COORDINADOR: 'Coordinador',
        DESARROLLADOR: 'Desarrollador'
    };

    let usuario = null;
    let cargada = false;
    let promesa = null;

    /* Pregunta al servidor quién es el usuario actual. Devuelve usuario o null. */
    function cargar(forzar) {
        if (promesa && !forzar) return promesa;
        promesa = (async () => {
            try {
                const datos = await Api.get('/auth/yo', null, { silencioso: true });
                usuario = datos.usuario;
                Api.setCsrfToken(datos.csrf_token);
            } catch (e) {
                usuario = null;
                Api.setCsrfToken(null);
                if (!(e instanceof Api.ApiError) || (e.status !== 401 && e.status !== 0)) throw e;
            }
            cargada = true;
            return usuario;
        })();
        return promesa;
    }

    function actual() { return usuario; }
    function estaIdentificado() { return usuario !== null; }
    function tieneRol(...roles) { return usuario !== null && roles.includes(usuario.rol); }
    function panelUrl() { return usuario ? PANEL_POR_ROL[usuario.rol] : 'login.html'; }
    function etiquetaRol(rol) { return ETIQUETA_ROL[rol] || rol; }

    function irALogin(motivo) {
        const destino = window.location.pathname.split('/').pop() + window.location.search;
        const params = new URLSearchParams({ next: destino });
        if (motivo) params.set('motivo', motivo);
        window.location.replace('login.html?' + params.toString());
    }

    /* Tras iniciar sesión: volver a la página pedida o ir al panel del rol. */
    function destinoTrasLogin() {
        const next = new URLSearchParams(window.location.search).get('next');
        // Solo rutas relativas del propio sitio (evita redirecciones abiertas)
        if (next && /^[\w\-./?=&%]+$/.test(next) && !next.startsWith('/') && !next.includes('..')) return next;
        return 'index.html';
    }

    /*
     * Exige sesión y, opcionalmente, un rol. Devuelve true si se puede continuar.
     * Sin sesión → login. Con sesión pero rol insuficiente → inicio con aviso.
     */
    async function requerir(roles) {
        await cargar();
        if (!usuario) { irALogin('sesion'); return false; }
        if (roles && roles.length && !roles.includes(usuario.rol)) {
            window.location.replace('index.html?aviso=sin_permiso');
            return false;
        }
        return true;
    }

    async function logout() {
        try {
            await Api.post('/auth/logout');
        } catch (e) {
            // Aunque falle, limpiamos el estado local y mandamos al login
        }
        usuario = null;
        Api.setCsrfToken(null);
        window.location.href = 'login.html?motivo=logout';
    }

    // Cualquier 401 de la API durante el uso = sesión caducada
    document.addEventListener('api:no-autenticado', () => {
        if (cargada && usuario) { usuario = null; irALogin('caducada'); }
    });

    global.Sesion = {
        ROLES, cargar, actual, estaIdentificado, tieneRol, requerir, logout,
        panelUrl, etiquetaRol, destinoTrasLogin
    };
})(window);
