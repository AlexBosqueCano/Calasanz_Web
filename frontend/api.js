/*
 * api.js — Cliente central de la API (B1)
 * Contrato: docs/API_CONTRATO.md
 *
 * Uso:
 *   const jugadores = await Api.get('/jugadores', { equipo: 1 });
 *   await Api.post('/jugadores', datos);
 *
 * Todos los errores se lanzan como ApiError con { status, codigo, mensaje, detalles }.
 * La interfaz nunca debe asumir que una petición tiene éxito.
 */
(function (global) {
    'use strict';

    const BASE = '/api'; // mismo origen que el frontend (Flask sirve ambos)

    // Mensajes comprensibles por código HTTP cuando el servidor no manda uno propio
    const MENSAJES_POR_STATUS = {
        0: 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
        400: 'La petición no es válida.',
        401: 'Tu sesión ha caducado. Inicia sesión de nuevo.',
        403: 'No tienes permiso para realizar esta acción.',
        404: 'No se ha encontrado lo que buscas.',
        409: 'La operación entra en conflicto con el estado actual de los datos.',
        422: 'Hay datos que no son válidos.',
        429: 'Demasiados intentos. Espera un momento antes de volver a probar.',
        500: 'Ha ocurrido un error en el servidor. Inténtalo más tarde.'
    };

    class ApiError extends Error {
        constructor(status, codigo, mensaje, detalles) {
            super(mensaje);
            this.name = 'ApiError';
            this.status = status;
            this.codigo = codigo;
            this.detalles = detalles || [];
        }
    }

    // --- Token CSRF (lo devuelven login y /auth/yo) ---
    let csrfToken = null;
    function setCsrfToken(token) { csrfToken = token || null; }
    function getCsrfToken() { return csrfToken; }

    // --- Indicador de carga global (contador por si hay peticiones en paralelo) ---
    let pendientes = 0;
    function actualizarIndicador() {
        const el = document.getElementById('indicador-carga');
        if (el) el.hidden = pendientes === 0;
        document.body && document.body.classList.toggle('cargando', pendientes > 0);
    }

    function construirUrl(ruta, params) {
        const url = new URL(BASE + ruta, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([clave, valor]) => {
                if (valor !== undefined && valor !== null && valor !== '') {
                    url.searchParams.set(clave, valor);
                }
            });
        }
        return url.pathname + url.search;
    }

    async function peticion(metodo, ruta, { params, cuerpo, silencioso } = {}) {
        const opciones = {
            method: metodo,
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        };
        if (cuerpo !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(cuerpo);
        }
        if (metodo !== 'GET' && csrfToken) {
            opciones.headers['X-CSRF-Token'] = csrfToken;
        }

        if (!silencioso) { pendientes++; actualizarIndicador(); }
        let respuesta;
        try {
            respuesta = await fetch(construirUrl(ruta, params), opciones);
        } catch (e) {
            throw new ApiError(0, 'sin_conexion', MENSAJES_POR_STATUS[0]);
        } finally {
            if (!silencioso) { pendientes--; actualizarIndicador(); }
        }

        if (respuesta.status === 204) return null;

        let datos = null;
        try { datos = await respuesta.json(); } catch (e) { /* cuerpo vacío o no JSON */ }

        if (!respuesta.ok) {
            const err = datos && datos.error ? datos.error : {};
            const error = new ApiError(
                respuesta.status,
                err.codigo || 'error',
                err.mensaje || MENSAJES_POR_STATUS[respuesta.status] || 'Ha ocurrido un error inesperado.',
                err.detalles
            );
            // Sesión caducada: avisar a session.js para redirigir al login
            if (respuesta.status === 401) {
                document.dispatchEvent(new CustomEvent('api:no-autenticado'));
            }
            throw error;
        }
        return datos;
    }

    // --- Utilidades de seguridad/DOM: nunca innerHTML con datos del servidor ---
    function escapar(texto) {
        return String(texto ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* Crea un elemento con texto seguro (textContent) y atributos opcionales. */
    function el(etiqueta, { texto, clase, atributos, hijos } = {}) {
        const nodo = document.createElement(etiqueta);
        if (texto !== undefined) nodo.textContent = texto;
        if (clase) nodo.className = clase;
        if (atributos) Object.entries(atributos).forEach(([k, v]) => nodo.setAttribute(k, v));
        if (hijos) hijos.forEach(h => nodo.appendChild(h));
        return nodo;
    }

    /* Anuncia un mensaje a tecnologías de apoyo (región aria-live de la plantilla). */
    function anunciar(mensaje, urgente) {
        const region = document.getElementById(urgente ? 'avisos-urgentes' : 'avisos');
        if (!region) return;
        region.textContent = '';
        // pequeño retardo para que el lector de pantalla detecte el cambio
        setTimeout(() => { region.textContent = mensaje; }, 50);
    }

    /* Muestra un error de API dentro de un contenedor (y lo anuncia). */
    function mostrarError(contenedor, error) {
        const msg = error instanceof ApiError ? error.mensaje : 'Ha ocurrido un error inesperado.';
        if (contenedor) {
            contenedor.textContent = '';
            const p = el('p', { texto: msg, clase: 'mensaje mensaje-error', atributos: { role: 'alert' } });
            contenedor.appendChild(p);
            if (error.detalles && error.detalles.length) {
                const ul = el('ul', { clase: 'mensaje-detalles' });
                error.detalles.forEach(d => ul.appendChild(
                    el('li', { texto: (d.campo ? d.campo + ': ' : '') + d.mensaje })));
                contenedor.appendChild(ul);
            }
        }
        anunciar(msg, true);
    }

    global.Api = {
        get: (ruta, params, opts) => peticion('GET', ruta, { params, ...opts }),
        post: (ruta, cuerpo, opts) => peticion('POST', ruta, { cuerpo, ...opts }),
        put: (ruta, cuerpo, opts) => peticion('PUT', ruta, { cuerpo, ...opts }),
        patch: (ruta, cuerpo, opts) => peticion('PATCH', ruta, { cuerpo, ...opts }),
        delete: (ruta, opts) => peticion('DELETE', ruta, { ...opts }),
        setCsrfToken,
        getCsrfToken,
        ApiError,
        escapar,
        el,
        anunciar,
        mostrarError
    };
})(window);
