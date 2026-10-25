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
        500: 'Ha ocurrido un error en el servidor. Inténtalo más tarde.',
        502: 'El servidor no está disponible ahora mismo. Inténtalo más tarde.',
        503: 'El servidor no está disponible ahora mismo. Inténtalo más tarde.',
        504: 'El servidor ha tardado demasiado en responder. Inténtalo más tarde.'
    };

    /*
     * Tiempo máximo (en milisegundos) que esperamos a que el servidor conteste.
     * Sin esto, si el servidor no responde (típico en el móvil: wifi distinta, firewall,
     * túnel caído...) la página se quedaba en "Cargando…" o en blanco para siempre.
     * Al agotarse el tiempo se trata igual que "sin conexión" (ApiError con status 0).
     */
    const TIEMPO_MAXIMO_MS = 8000;

    class ApiError extends Error {
        constructor(status, codigo, mensaje, detalles) {
            super(mensaje);
            this.name = 'ApiError';
            this.mensaje = mensaje;   // mismo texto que .message; api.js y las páginas usan .mensaje
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

    /*
     * Opciones (todas opcionales):
     *   params        → parámetros de la URL (?clave=valor)
     *   cuerpo        → objeto que se envía como JSON
     *   silencioso    → true = no enseñar el cartel "Cargando…"
     *   tiempoMaximo  → milisegundos de espera máxima (por defecto TIEMPO_MAXIMO_MS)
     */
    async function peticion(metodo, ruta, { params, cuerpo, silencioso, tiempoMaximo } = {}) {
        // AbortController permite cancelar el fetch si el servidor tarda demasiado
        const cancelador = new AbortController();
        const opciones = {
            method: metodo,
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' },
            signal: cancelador.signal
        };
        if (cuerpo !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(cuerpo);
        }
        if (metodo !== 'GET' && csrfToken) {
            opciones.headers['X-CSRF-Token'] = csrfToken;
        }

        if (!silencioso) { pendientes++; actualizarIndicador(); }
        // Si pasa el tiempo máximo sin respuesta, cancelamos la petición (fetch lanza un error)
        const temporizador = setTimeout(() => cancelador.abort(), tiempoMaximo || TIEMPO_MAXIMO_MS);

        let respuesta;
        try {
            respuesta = await fetch(construirUrl(ruta, params), opciones);
        } catch (e) {
            // Sin red, servidor caído o tiempo agotado: para la interfaz es lo mismo
            throw new ApiError(0, 'sin_conexion', MENSAJES_POR_STATUS[0]);
        } finally {
            clearTimeout(temporizador);   // ya hay respuesta (o error): el reloj ya no hace falta
            if (!silencioso) { pendientes--; actualizarIndicador(); }
        }

        if (respuesta.status === 204) return null;

        let datos = null;
        try { datos = await respuesta.json(); } catch (e) { /* cuerpo vacío o no JSON */ }

        // Un "200 OK" que trae una página HTML no es nuestra API: es un servidor estático,
        // un túnel o un proxy que contesta con su propia página. Lo tratamos como "sin servidor"
        // en lugar de dejar que el código falle más adelante con datos == null.
        if (respuesta.ok && datos === null && (respuesta.headers.get('content-type') || '').includes('text/html')) {
            throw new ApiError(0, 'respuesta_invalida', MENSAJES_POR_STATUS[0]);
        }

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

    /* "Nombre Ap1 Ap2" a partir de un jugador (ignora los apellidos que falten). */
    function nombreCompleto(j) {
        if (!j) return '';
        if (j.nombre_completo) return j.nombre_completo;
        return [j.nombre, j.ap1, j.ap2].filter(Boolean).join(' ');
    }

    /* "2026-10-17" o "2026-10-17T20:00:00+02:00" → "17 oct 2026" (en español). */
    function formatearFecha(texto) {
        if (!texto) return '';
        const fecha = new Date(texto.length <= 10 ? texto + 'T12:00:00' : texto);   // T12:00 evita saltos de día por zona horaria
        if (isNaN(fecha)) return '';
        return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /*
     * TARJETAS DE FÚTBOL (amarilla / roja)
     * ------------------------------------
     * Devuelve un <span> con el dibujo de la tarjeta (un rectángulo de color, definido en
     * estilos.css con las clases .tarjeta-futbol, .tarjeta-amarilla y .tarjeta-roja) seguido
     * del texto. Se dibuja con CSS y no con emojis para que se vea igual en todos los móviles.
     *   tipo     → 'amarilla' o 'roja'
     *   cantidad → número que se escribe al lado (opcional; si no se pasa, solo el dibujo)
     *   texto    → texto visible al lado (opcional), p. ej. 'Amarilla'
     * Para lectores de pantalla el rectángulo se oculta y se lee el texto "2 amarillas".
     */
    function tarjeta(tipo, cantidad, texto) {
        const clase = tipo === 'roja' ? 'tarjeta-roja' : 'tarjeta-amarilla';
        const hijos = [el('span', { clase: 'tarjeta-futbol ' + clase, atributos: { 'aria-hidden': 'true' } })];
        if (cantidad !== undefined) hijos.push(el('span', { texto: String(cantidad), clase: 'tarjeta-numero' }));
        if (texto) hijos.push(el('span', { texto }));
        else if (cantidad !== undefined) {
            // sin texto visible: añadimos uno solo para lectores de pantalla
            const plural = tipo === 'roja' ? (cantidad === 1 ? 'roja' : 'rojas') : (cantidad === 1 ? 'amarilla' : 'amarillas');
            hijos.push(el('span', { texto: ' ' + plural, clase: 'solo-lectores' }));
        }
        return el('span', { clase: 'tarjeta-grupo', hijos });
    }

    /* Par "amarillas + rojas" para resúmenes (KPI del jugador, tabla de estadísticas). */
    function tarjetasResumen(amarillas, rojas) {
        return el('span', { clase: 'tarjetas-resumen', hijos: [
            tarjeta('amarilla', amarillas ?? 0),
            tarjeta('roja', rojas ?? 0)
        ]});
    }

    /*
     * Texto del servidor ('', 'Amarilla', 'Roja', 'Doble amarilla') → tarjetas dibujadas con su texto.
     * Si no hay tarjetas devuelve un guion.
     */
    function tarjetasDeTexto(textoServidor) {
        const t = String(textoServidor || '').toLowerCase();
        if (!t) return document.createTextNode('—');
        const grupo = el('span', { clase: 'tarjetas-resumen' });
        if (t.includes('doble')) {
            // doble amarilla = dos amarillas que acaban en expulsión
            grupo.appendChild(tarjeta('amarilla'));
            grupo.appendChild(tarjeta('amarilla'));
            grupo.appendChild(tarjeta('roja', undefined, 'Doble amarilla'));
        } else if (t.includes('roja')) {
            grupo.appendChild(tarjeta('roja', undefined, 'Roja'));
        } else if (t.includes('amarilla')) {
            grupo.appendChild(tarjeta('amarilla', undefined, 'Amarilla'));
        } else {
            return document.createTextNode(String(textoServidor));   // texto desconocido: se enseña tal cual
        }
        return grupo;
    }

    global.Api = {
        tarjeta,
        tarjetasResumen,
        tarjetasDeTexto,
        get: (ruta, params, opts) => peticion('GET', ruta, { params, ...opts }),
        post: (ruta, cuerpo, opts) => peticion('POST', ruta, { cuerpo, ...opts }),
        put: (ruta, cuerpo, opts) => peticion('PUT', ruta, { cuerpo, ...opts }),
        patch: (ruta, cuerpo, opts) => peticion('PATCH', ruta, { cuerpo, ...opts }),
        delete: (ruta, opts) => peticion('DELETE', ruta, { ...opts }),
        setCsrfToken,
        getCsrfToken,
        ApiError,
        escapar,
        nombreCompleto,
        formatearFecha,
        el,
        anunciar,
        mostrarError
    };
})(window);
