/*
 * panel-jugador.js — Panel del jugador (panel-jugador.html)
 * ==========================================================
 * Resumen personal para el rol JUGADOR: sus estadísticas, si tiene una lesión activa,
 * sus próximos partidos y sus datos físicos (estatura y peso; solo los ve él).
 * Su ficha es `usuario.jugador_id` (GET /api/auth/yo).
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET /api/jugadores/{id}                  → datos (y estatura/peso si es el propio jugador)
 *   GET /api/jugadores/{id}/estadisticas     → totales (404 si aún no ha jugado)
 *   GET /api/equipos/{id}/partidos?estado=programado
 *   GET /api/lesiones?equipo=&activa=true    → para saber si él está lesionado
 *
 * SEGURIDAD: nada de innerHTML con datos; todo con Api.el() / textContent.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;
    const $ = (id) => document.getElementById(id);

    function pintarEstadisticas(s) {
        s = s || {};
        $('pj-pj').textContent = String(s.partidos_jugados ?? 0);
        $('pj-pj-sub').textContent = s.titular !== undefined ? `(${s.titular} titular)` : '';
        $('pj-min').textContent = (s.minutos_totales ?? 0) + "'";
        $('pj-goles').textContent = String(s.goles_totales ?? 0);
        $('pj-asist').textContent = String(s.asistencias_totales ?? 0);
        const caja = $('pj-tarjetas');
        caja.textContent = '';
        caja.appendChild(Api.tarjetasResumen(s.amarillas_totales, s.rojas_totales));
    }

    function pintarProximos(partidos) {
        const caja = $('pj-proximos');
        caja.textContent = '';
        const futuros = partidos.filter(p => p.estado === 'programado').sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 3);
        if (!futuros.length) { caja.appendChild(el('p', { texto: 'No hay partidos programados.', clase: 'texto-vacio' })); return; }
        futuros.forEach(p => {
            caja.appendChild(el('article', { clase: 'news-card', hijos: [
                el('div', { clase: 'news-card-meta', hijos: [el('span', { texto: `JORNADA ${p.jornada}` }), el('span', { texto: p.lugar || Api.formatearFecha(p.fecha) })] }),
                el('h3', { texto: `${p.local.nombre} vs. ${p.visitante.nombre}` }),
                el('p', { texto: Api.formatearFecha(p.fecha), clase: 'acta-etiqueta' })
            ]}));
        });
    }

    async function iniciar() {
        const usuario = Sesion.actual();
        // En modo demostración no hay usuario: enseñamos la ficha de ejemplo n.º 4
        const id = usuario && usuario.jugador_id ? usuario.jugador_id : (Sesion.enModoDemo() ? 4 : null);
        if (!id) {
            $('pj-nombre').textContent = 'Sin ficha vinculada';
            Api.mostrarError($('pj-mensajes'), new Api.ApiError(404, 'sin_ficha', 'Tu cuenta todavía no está vinculada a una ficha de jugador. Pídelo a coordinación.'));
            return;
        }
        try {
            const j = await Demo.obtener(`/jugadores/${id}`, null, () => Demo.jugador(id));
            $('pj-nombre').textContent = nombreCompleto(j);
            document.title = `Mi panel - ${nombreCompleto(j)} - CD. Calasanz Santander`;
            $('pj-kicker').textContent = [j.posicion, j.dorsal ? 'Dorsal #' + j.dorsal : null].filter(Boolean).join(' · ').toUpperCase() || 'MI PANEL';
            $('pj-equipo').textContent = j.equipo ? j.equipo.nombre + ' · C.D. Calasanz' : 'C.D. Calasanz';
            $('pj-ficha').href = 'jugador.html?id=' + encodeURIComponent(j.id);

            // Datos físicos: solo si el servidor los manda
            if (j.estatura || j.peso) {
                $('pj-estatura').textContent = j.estatura ? `Estatura: ${String(j.estatura).replace('.', ',')} m` : '';
                $('pj-peso').textContent = j.peso ? `Peso: ${String(j.peso).replace('.', ',')} kg` : '';
                $('pj-fisico').hidden = false;
            }

            // Estadísticas: dentro del jugador (demo) o en su propio endpoint
            let stats = j.estadisticas;
            if (!stats) {
                try { stats = await Api.get(`/jugadores/${id}/estadisticas`); }
                catch (error) { if (!(error instanceof Api.ApiError) || error.status !== 404) throw error; }
            }
            pintarEstadisticas(stats);

            if (j.equipo) {
                const [partidos, lesiones] = await Promise.all([
                    Demo.obtener(`/equipos/${j.equipo.id}/partidos`, { estado: 'programado' }, Demo.partidos),
                    Demo.obtener('/lesiones', { equipo: j.equipo.id, activa: 'true' }, Demo.lesiones)
                ]);
                pintarProximos(Array.isArray(partidos) ? partidos : (partidos.items || []));
                const mia = (Array.isArray(lesiones) ? lesiones : (lesiones.items || [])).find(l => l.jugador.id === j.id);
                if (mia) {
                    $('pj-lesion').textContent = `Tienes una lesión activa. Vuelta estimada: ${Api.formatearFecha(mia.fecha_estimada_vuelta)}.`;
                    $('pj-lesion').hidden = false;
                }
            }
        } catch (error) {
            $('pj-nombre').textContent = 'No se pudo cargar tu panel';
            Api.mostrarError($('pj-mensajes'), error);
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
