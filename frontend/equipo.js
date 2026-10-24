/*
 * equipo.js — Página de un equipo con 4 pestañas (equipo.html?id=N)
 * ==================================================================
 * Una sola página sirve para TODOS los equipos. Pestañas:
 *   Plantilla · Estadísticas · Resultados y actas · Clasificación
 *
 * CÓMO FUNCIONA
 *   1. Leemos el id del equipo de la URL (?id=1).
 *   2. Cargamos el equipo (título y categoría).
 *   3. Cargamos los datos de una pestaña SOLO cuando se abre ("carga perezosa"):
 *      así no hacemos 4 peticiones si el usuario solo mira una.
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET /api/equipos/{id}                 GET /api/equipos/{id}/plantilla
 *   GET /api/equipos/{id}/estadisticas    GET /api/equipos/{id}/partidos
 *   GET /api/equipos/{id}/clasificacion
 *
 * SEGURIDAD: todo se pinta con Api.el() (textContent). Jamás innerHTML con datos del servidor.
 *
 * ACCESIBILIDAD: patrón "tabs" de WAI-ARIA. Con teclado: ← → cambian de pestaña,
 * Inicio y Fin saltan a la primera y a la última.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;

    let equipoId = null;      // id del equipo que estamos viendo
    const cargadas = {};      // qué pestañas ya tienen sus datos (para no repetir peticiones)

    // Qué función carga cada pestaña. El nombre es el data-target del botón.
    const cargadores = {
        plantilla: cargarPlantilla,
        estadisticas: cargarEstadisticas,
        resultados: cargarResultados,
        clasificacion: cargarClasificacion
    };

    // ------------------------------------------------------------------
    // Utilidades pequeñas
    // ------------------------------------------------------------------

    /* Celda de tabla con texto. */
    const td = (texto, clase) => el('td', { texto: String(texto ?? ''), clase });

    /* Texto de flecha decorativa para los enlaces. */
    const flecha = () => el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } });

    /* Mensaje cuando no hay datos: explica el vacío en vez de dejar la pantalla en blanco. */
    const vacio = (texto) => el('p', { texto, clase: 'texto-vacio' });

    /* Vacía un contenedor y escribe un mensaje de carga. */
    function cargando(contenedor, texto) {
        contenedor.textContent = '';
        contenedor.appendChild(vacio(texto));
    }

    /* Para tablas: pone un mensaje en una fila que ocupa todas las columnas. */
    function filaMensaje(cuerpo, columnas, texto) {
        cuerpo.textContent = '';
        cuerpo.appendChild(el('tr', { hijos: [el('td', { texto, clase: 'celda-mensaje', atributos: { colspan: String(columnas) } })] }));
    }

    // ------------------------------------------------------------------
    // PESTAÑA: PLANTILLA
    // ------------------------------------------------------------------
    async function cargarPlantilla() {
        const cont = document.getElementById('lista-plantilla');
        cargando(cont, 'Cargando plantilla…');
        try {
            const jugadores = await Demo.obtener(`/equipos/${equipoId}/plantilla`, null, Demo.plantilla);
            cont.textContent = '';
            if (!jugadores.length) { cont.appendChild(vacio('Este equipo todavía no tiene jugadores.')); return; }

            // Ordenamos por dorsal; los que no tienen dorsal, al final
            jugadores.slice().sort((a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999)).forEach(j => {
                const dorsal = j.dorsal ? '#' + j.dorsal : '—';
                cont.appendChild(el('article', { clase: 'team-card-figma', hijos: [
                    el('div', { clase: 'team-badge-box', hijos: [
                        el('strong', { texto: dorsal, clase: 'dorsal-num', atributos: { 'aria-hidden': 'true' } }),
                        el('span', { clase: 'dot-gold', atributos: { 'aria-hidden': 'true' } })
                    ]}),
                    el('div', { clase: 'team-card-info', hijos: [
                        el('span', { texto: j.posicion || '', clase: 'team-cat-tag' }),
                        el('h3', { texto: nombreCompleto(j) }),
                        // Dorsal en texto para lectores de pantalla (el círculo visual va con aria-hidden)
                        el('p', { texto: j.dorsal ? 'Dorsal ' + j.dorsal : 'Sin dorsal' }),
                        el('a', { clase: 'link-arrow', atributos: { href: 'jugador.html?id=' + encodeURIComponent(j.id) }, hijos: [
                            document.createTextNode('Ver ficha del jugador '), flecha()
                        ]})
                    ]})
                ]}));
            });
            cargadas.plantilla = true;
        } catch (error) { Api.mostrarError(cont, error); }
    }

    // ------------------------------------------------------------------
    // PESTAÑA: ESTADÍSTICAS
    // ------------------------------------------------------------------
    async function cargarEstadisticas() {
        const cuerpo = document.getElementById('tabla-estadisticas');
        filaMensaje(cuerpo, 8, 'Cargando estadísticas…');
        try {
            const filas = await Demo.obtener(`/equipos/${equipoId}/estadisticas`, null, Demo.estadisticas);
            if (!filas.length) { filaMensaje(cuerpo, 8, 'Todavía no hay estadísticas en esta temporada.'); return; }

            cuerpo.textContent = '';
            filas.forEach(f => {
                const j = f.jugador || {};
                const nombre = el('a', {
                    texto: nombreCompleto(j), clase: 'enlace-tabla',
                    atributos: { href: 'jugador.html?id=' + encodeURIComponent(j.id) }
                });
                cuerpo.appendChild(el('tr', { hijos: [
                    td(j.dorsal ? '#' + j.dorsal : '—'),
                    el('td', { hijos: [nombre] }),
                    td(j.posicion || ''),
                    td(f.partidos ?? 0),
                    td((f.minutos ?? 0) + "'"),
                    td(f.goles ?? 0),
                    td(f.asistencias ?? 0),
                    // En texto, no solo con emojis: así también se entiende con lector de pantalla
                    td(`${f.amarillas ?? 0} amarillas · ${f.rojas ?? 0} rojas`)
                ]}));
            });
            cargadas.estadisticas = true;
        } catch (error) { filaMensaje(cuerpo, 8, error.message || 'No se pudieron cargar las estadísticas.'); Api.mostrarError(null, error); }
    }

    // ------------------------------------------------------------------
    // PESTAÑA: RESULTADOS Y ACTAS
    // ------------------------------------------------------------------
    async function cargarResultados() {
        const cont = document.getElementById('lista-resultados');
        cargando(cont, 'Cargando resultados…');
        try {
            const datos = await Demo.obtener(`/equipos/${equipoId}/partidos`, null, Demo.partidos);
            // El contrato dice que puede ser un array directo o una página { items: [...] }
            const partidos = Array.isArray(datos) ? datos : (datos.items || []);
            cont.textContent = '';
            if (!partidos.length) { cont.appendChild(vacio('Todavía no hay partidos programados.')); return; }

            // Los más recientes primero
            partidos.slice().sort((a, b) => (b.jornada ?? 0) - (a.jornada ?? 0)).forEach(p => {
                const jugado = p.estado === 'finalizado';
                const local = p.local ? p.local.nombre : '';
                const visitante = p.visitante ? p.visitante.nombre : '';
                // "C.D. Calasanz 4 - 2 Rival" si se jugó; "C.D. Calasanz vs. Rival" si no
                const titulo = jugado
                    ? `${local} ${p.resultado_local} - ${p.resultado_visitante} ${visitante}`
                    : `${local} vs. ${visitante}`;

                const meta = [el('span', { texto: `JORNADA ${p.jornada} · ${jugado ? 'FINALIZADO' : 'PRÓXIMO ENCUENTRO'}` })];
                // "lugar" no está aún en el contrato: se muestra solo si el servidor lo envía
                meta.push(el('span', { texto: p.lugar || Api.formatearFecha(p.fecha) }));

                // Partido jugado → ver acta (todos). Pendiente → registrar acta (solo entrenador/dev)
                let enlace = null;
                if (jugado) {
                    enlace = el('a', { clase: 'link-arrow', atributos: { href: 'acta.html?id=' + encodeURIComponent(p.id) }, hijos: [
                        document.createTextNode('Ver acta oficial del partido '), flecha()
                    ]});
                } else if (Sesion.tieneRol('ENTRENADOR', 'DESARROLLADOR') || Sesion.enModoDemo()) {
                    enlace = el('a', { clase: 'link-arrow', atributos: { href: 'admin-plantilla.html#acta' }, hijos: [
                        document.createTextNode('Registrar acta (entrenador) '), flecha()
                    ]});
                }

                const hijos = [el('div', { clase: 'news-card-meta', hijos: meta }), el('h3', { texto: titulo })];
                if (enlace) hijos.push(enlace);
                cont.appendChild(el('article', { clase: 'news-card', hijos }));
            });
            cargadas.resultados = true;
        } catch (error) { Api.mostrarError(cont, error); }
    }

    // ------------------------------------------------------------------
    // PESTAÑA: CLASIFICACIÓN
    // ------------------------------------------------------------------
    async function cargarClasificacion() {
        const cuerpo = document.getElementById('tabla-clasificacion');
        filaMensaje(cuerpo, 9, 'Cargando clasificación…');
        try {
            const filas = await Demo.obtener(`/equipos/${equipoId}/clasificacion`, null, Demo.clasificacion);
            if (!filas.length) { filaMensaje(cuerpo, 9, 'Todavía no hay partidos jugados.'); return; }

            cuerpo.textContent = '';
            filas.forEach(f => {
                // "equipo" puede venir como objeto {id, nombre} o como texto
                const nombre = typeof f.equipo === 'object' ? f.equipo.nombre : f.equipo;
                const esNuestro = /calasanz/i.test(nombre);   // resaltamos al club

                const celdaNombre = td(nombre);
                // No dependemos solo del color/negrita: añadimos texto para lectores de pantalla
                if (esNuestro) celdaNombre.appendChild(el('span', { texto: ' (nuestro club)', clase: 'solo-lectores' }));

                cuerpo.appendChild(el('tr', { clase: esNuestro ? 'fila-propia' : undefined, hijos: [
                    td(f.posicion), celdaNombre, el('td', { hijos: [el('strong', { texto: String(f.puntos) })] }),
                    td(f.pj), td(f.g), td(f.e), td(f.p), td(f.gf), td(f.gc)
                ]}));
            });
            cargadas.clasificacion = true;
        } catch (error) { filaMensaje(cuerpo, 9, error.message || 'No se pudo cargar la clasificación.'); Api.mostrarError(null, error); }
    }

    // ------------------------------------------------------------------
    // PESTAÑAS: cambiar de una a otra (ratón, táctil y teclado)
    // ------------------------------------------------------------------
    function activarPestana(nombre, moverFoco) {
        document.querySelectorAll('.tab-btn').forEach(boton => {
            const esta = boton.dataset.target === nombre;
            boton.classList.toggle('active', esta);
            boton.setAttribute('aria-selected', String(esta));
            // Solo la pestaña activa entra en el orden del Tab; las demás se mueven con flechas
            boton.setAttribute('tabindex', esta ? '0' : '-1');
            if (esta && moverFoco) boton.focus();
        });
        document.querySelectorAll('.tab-pane').forEach(panel => {
            const es = panel.id === nombre;
            panel.classList.toggle('active', es);
            panel.hidden = !es;
        });

        // Guardamos la pestaña en la URL (#clasificacion) para poder compartir el enlace
        history.replaceState(null, '', '#' + nombre);

        // Carga perezosa: solo la primera vez que se abre
        if (!cargadas[nombre]) cargadores[nombre]();
    }

    function manejarTeclado(evento) {
        const nombres = Object.keys(cargadores);
        const actual = document.querySelector('.tab-btn.active').dataset.target;
        let i = nombres.indexOf(actual);

        if (evento.key === 'ArrowRight') i = (i + 1) % nombres.length;
        else if (evento.key === 'ArrowLeft') i = (i - 1 + nombres.length) % nombres.length;
        else if (evento.key === 'Home') i = 0;
        else if (evento.key === 'End') i = nombres.length - 1;
        else return;   // otra tecla: no hacemos nada

        evento.preventDefault();
        activarPestana(nombres[i], true);
    }

    // ------------------------------------------------------------------
    // INICIO
    // ------------------------------------------------------------------
    async function iniciar() {
        const mensajes = document.getElementById('mensajes-equipo');

        // 1) Leemos ?id= y comprobamos que son solo dígitos (no fiarse de lo que venga en la URL)
        equipoId = new URLSearchParams(window.location.search).get('id');
        if (!equipoId || !/^\d+$/.test(equipoId)) {
            document.getElementById('equipo-nombre').textContent = 'Equipo no encontrado';
            Api.mostrarError(mensajes, new Api.ApiError(404, 'no_encontrado', 'No se ha indicado un equipo válido.'));
            return;
        }

        // 2) Título de la página con los datos del equipo
        try {
            const equipo = await Demo.obtener(`/equipos/${equipoId}`, null, () => Demo.equipo(equipoId));
            const categoria = equipo.categoria ? equipo.categoria.nombre : '';
            document.getElementById('equipo-nombre').textContent = equipo.nombre;
            document.getElementById('equipo-categoria').textContent = equipo.competicion || (categoria ? 'Categoría ' + categoria : '');
            document.getElementById('equipo-kicker').textContent = (categoria ? categoria.toUpperCase() + ' · ' : '') + 'CD CALASANZ';
            document.title = `${equipo.nombre} - CD. Calasanz Santander`;
        } catch (error) {
            document.getElementById('equipo-nombre').textContent = 'No se pudo cargar el equipo';
            Api.mostrarError(mensajes, error);
            return;   // sin equipo no tiene sentido seguir
        }

        // 3) Eventos de las pestañas
        document.querySelectorAll('.tab-btn').forEach(boton => {
            boton.addEventListener('click', () => activarPestana(boton.dataset.target, false));
            boton.addEventListener('keydown', manejarTeclado);
        });

        // 4) Pestaña inicial: la de la URL (#clasificacion) si es válida; si no, Plantilla
        const hash = window.location.hash.replace('#', '');
        activarPestana(cargadores[hash] ? hash : 'plantilla', false);
    }

    document.addEventListener('layout:listo', iniciar);
})();
