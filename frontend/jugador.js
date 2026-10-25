/*
 * jugador.js — Ficha de un jugador (jugador.html?id=N)
 * =====================================================
 * Enseña: nombre, posición y dorsal, 4 tarjetas de estadísticas (KPI) y, si el servidor
 * lo envía, el historial de participación por jornada.
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET /api/jugadores/{id}            → datos del jugador
 *   GET /api/jugadores/{id}/estadisticas → totales (404 si aún no ha jugado)
 *
 * NOTA PARA MATEO: el historial "participaciones" (una fila por partido) NO está en el
 * contrato todavía. La tabla se oculta sola si el servidor no lo envía.
 *
 * SEGURIDAD: nada de innerHTML con datos del servidor; todo con Api.el() / textContent.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;

    /* Escribe un número en una tarjeta KPI; el texto pequeño de debajo es opcional. */
    function pintarKpi(idValor, valor, idSub, sub) {
        document.getElementById(idValor).textContent = String(valor ?? 0);
        const subEl = document.getElementById(idSub);
        if (subEl) subEl.textContent = sub || '';
    }

    /* Rellena las 4 tarjetas con las estadísticas (o ceros si no hay). */
    function pintarEstadisticas(s) {
        s = s || {};
        pintarKpi('kpi-pj', s.partidos_jugados, 'kpi-pj-sub', s.titular !== undefined ? `(${s.titular} titular)` : '');
        pintarKpi('kpi-min', (s.minutos_totales ?? 0) + "'", 'kpi-min-sub', '');
        pintarKpi('kpi-goles', s.goles_totales, 'kpi-goles-sub', '');
        pintarKpi('kpi-asist', s.asistencias_totales, 'kpi-asist-sub', '');
        // Debajo de las asistencias: tarjeta amarilla y roja dibujadas con su número
        const sub = document.getElementById('kpi-asist-sub');
        if (sub) sub.appendChild(Api.tarjetasResumen(s.amarillas_totales, s.rojas_totales));
    }

    /* Tabla "participación por jornada". Si no hay datos, se oculta toda la sección. */
    function pintarParticipaciones(lista) {
        const seccion = document.getElementById('seccion-participaciones');
        if (!lista || !lista.length) { seccion.hidden = true; return; }

        seccion.hidden = false;
        const cuerpo = document.getElementById('tabla-participaciones');
        cuerpo.textContent = '';
        lista.forEach(p => {
            const enlace = el('a', { clase: 'link-arrow', atributos: { href: 'acta.html?id=' + encodeURIComponent(p.partido_id) }, hijos: [
                document.createTextNode('Ver acta '), el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } })
            ]});
            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: 'Jornada ' + p.jornada })] }),
                el('td', { texto: p.encuentro }),
                el('td', { texto: p.condicion }),
                el('td', { texto: (p.minutos ?? 0) + "'" }),
                el('td', { texto: String(p.goles ?? 0) }),
                el('td', { hijos: [Api.tarjetasDeTexto(p.tarjetas)] }),
                el('td', { hijos: [enlace] })
            ]}));
        });
    }

    async function iniciar() {
        const mensajes = document.getElementById('mensajes-jugador');
        const nombreEl = document.getElementById('jugador-nombre');

        // Leemos ?id= y comprobamos que son solo dígitos
        const id = new URLSearchParams(window.location.search).get('id');
        if (!id || !/^\d+$/.test(id)) {
            nombreEl.textContent = 'Jugador no encontrado';
            Api.mostrarError(mensajes, new Api.ApiError(404, 'no_encontrado', 'No se ha indicado un jugador válido.'));
            return;
        }

        try {
            // 1) Datos del jugador
            const j = await Demo.obtener(`/jugadores/${id}`, null, () => Demo.jugador(id));
            nombreEl.textContent = nombreCompleto(j);
            document.title = `${nombreCompleto(j)} - CD. Calasanz Santander`;

            const partes = [j.posicion, j.dorsal ? 'Dorsal #' + j.dorsal : null].filter(Boolean);
            document.getElementById('jugador-posicion-kicker').textContent = partes.join(' · ').toUpperCase();
            document.getElementById('jugador-equipo').textContent = j.equipo ? j.equipo.nombre + ' · C.D. Calasanz' : 'C.D. Calasanz';

            // El enlace "Volver" lleva al equipo del jugador (pestaña Plantilla)
            if (j.equipo) document.getElementById('enlace-volver').href = `equipo.html?id=${encodeURIComponent(j.equipo.id)}#plantilla`;

            // 2) Estadísticas: pueden venir dentro (modo demo) o en su propio endpoint
            let stats = j.estadisticas;
            if (!stats) {
                try {
                    stats = await Api.get(`/jugadores/${id}/estadisticas`);
                } catch (error) {
                    // 404 aquí no es un fallo: simplemente aún no ha jugado
                    if (!(error instanceof Api.ApiError) || error.status !== 404) throw error;
                }
            }
            pintarEstadisticas(stats);
            pintarParticipaciones(j.participaciones);
        } catch (error) {
            nombreEl.textContent = 'No se pudo cargar el jugador';
            Api.mostrarError(mensajes, error);
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
