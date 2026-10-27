/*
 * acta.js — Acta de un partido (acta.html?id=N)
 * ==============================================
 * GET /api/partidos/{id} → datos del partido + `acta` (null si aún no se ha registrado).
 * Formato del acta: docs/API_CONTRATO.md §3 (arbitros, cuerpo_tecnico, alineacion, eventos).
 *
 * Qué se enseña
 *   - Marcador, competición, fecha y lugar.
 *   - Árbitros y goles con su minuto (también los del rival, solo minuto y autor opcional).
 *   - Solo la alineación de NUESTRO equipo: del rival nunca se guarda (decisión D7).
 *   - Minutos, goles y tarjetas de cada jugador: se calculan con ActaUtil a partir de los eventos.
 *
 * SEGURIDAD: todo se escribe con Api.el() (textContent); nada de innerHTML con datos.
 */
(function () {
    'use strict';

    // `el` (api.js) crea elementos del DOM con textContent: nunca interpreta HTML de los datos.
    const { el } = Api;
    // Atajo para document.getElementById.
    const $ = (id) => document.getElementById(id);

    /* Vacía un contenedor para volver a pintarlo. */
    function vaciar(id) { const n = $(id); n.textContent = ''; return n; }

    /* Una fila de dos partes: etiqueta pequeña y valor (árbitros, delegados). */
    function filaEtiqueta(etiqueta, valor) {
        return el('div', { clase: 'acta-row', hijos: [el('div', { hijos: [
            el('span', { texto: etiqueta, clase: 'acta-etiqueta' }),
            el('strong', { texto: valor, clase: 'acta-player-name' })
        ]})]});
    }

    /* Escudo: el nuestro es la imagen del club; el del rival, un círculo con sus iniciales. */
    function escudo(equipo) {
        if (equipo.es_propio) return el('img', { atributos: { src: 'escudo.jpg', alt: 'Escudo del C.D. Calasanz' } });
        const iniciales = equipo.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
        return el('div', { clase: 'rival-shield-placeholder', texto: iniciales, atributos: { 'aria-hidden': 'true' } });
    }

    // Dibuja la cabecera: equipo local, marcador (o "vs" si no se ha jugado) y equipo visitante.
    function pintarMarcador(p) {
        const caja = vaciar('acta-marcador');
        // Un lado del marcador: nombre en mayúsculas y escudo.
        const lado = (equipo) => el('div', { clase: 'acta-score-team', hijos: [el('span', { texto: equipo.nombre.toUpperCase() }), escudo(equipo)] });
        // resultado null/undefined = partido sin jugar. Ojo: un 0 es un resultado válido.
        const jugado = p.resultado_local !== null && p.resultado_local !== undefined;
        caja.appendChild(lado(p.local));
        caja.appendChild(el('div', { clase: 'acta-score-numbers',
            texto: jugado ? `${p.resultado_local} - ${p.resultado_visitante}` : 'vs',
            atributos: jugado ? { 'aria-label': `${p.resultado_local} a ${p.resultado_visitante}` } : {} }));
        caja.appendChild(lado(p.visitante));
    }

    /* Cronología de goles con el marcador parcial, de nuestro equipo y del rival. */
    /**
     * @param {object} p        partido completo
     * @param {object} acta     acta del partido (alineación, eventos...)
     * @param {object} jugadores índice {jugador_id: datos} para traducir ids a nombres
     */
    function pintarGoles(p, acta, jugadores) {
        // ActaUtil.ordenar devuelve los eventos por minuto; nos quedamos con los goles (nuestros y del rival).
        const goles = ActaUtil.ordenar(acta.eventos).filter(e => e.tipo === 'gol' || e.tipo === 'gol_rival');
        $('acta-bloque-goles').hidden = !goles.length;
        const caja = vaciar('acta-goles');
        // Contadores para escribir el marcador parcial tras cada gol.
        let propio = 0, rival = 0;
        goles.forEach(g => {
            if (g.tipo === 'gol') propio++; else rival++;
            // El marcador parcial se escribe en el orden local - visitante
            const parcial = p.local.es_propio ? `${propio} - ${rival}` : `${rival} - ${propio}`;
            let autor;
            if (g.tipo === 'gol') {
                const j = jugadores[g.jugador_id];
                autor = `(${g.minuto}') ${j ? ActaUtil.nombreActa(j) : 'JUGADOR'}`;
                const asis = g.asistente_id && jugadores[g.asistente_id];
                if (asis) autor += ` · asist. ${ActaUtil.nombreActa(asis)}`;
            } else {
                autor = `(${g.minuto}') ${g.autor ? g.autor.toUpperCase() : 'GOL DEL RIVAL'}`;
            }
            caja.appendChild(el('div', { clase: 'acta-row', hijos: [el('div', { clase: 'acta-row-left', hijos: [
                el('span', { texto: '⚽ ' + parcial, clase: 'acta-goal-badge' }),
                el('span', { texto: autor, clase: 'acta-player-name' })
            ]})]}));
        });
    }

    /* Fila de un jugador: dorsal, nombre (enlace a su ficha), minutos y, si procede, goles y tarjetas. */
    // `a` = entrada de la alineación; `st` = estadísticas calculadas de ese jugador (ActaUtil).
    function filaJugador(a, st) {
        // Etiquetas opcionales a la derecha: minutos, goles, goles recibidos (porteros) y tarjetas.
        const extras = [];
        if (st.entro) extras.push(el('span', { texto: `${st.minutos}'`, clase: 'acta-etiqueta' }));
        if (st.goles) extras.push(el('span', { texto: `⚽ ${st.goles}`, clase: 'acta-etiqueta' }));
        if (st.golesRecibidos) extras.push(el('span', { texto: `recibidos ${st.golesRecibidos}`, clase: 'acta-etiqueta' }));
        // Dos amarillas = roja; evitamos enseñar tres iconos para un mismo jugador.
        for (let i = 0; i < Math.min(st.amarillas, 1 + (st.rojas && st.amarillas === 2 ? 1 : 0)); i++) extras.push(Api.tarjeta('amarilla', undefined, 'Amarilla'));
        if (st.rojas && st.amarillas < 2) extras.push(Api.tarjeta('roja', undefined, 'Roja'));
        return el('div', { clase: 'acta-row', hijos: [
            el('div', { clase: 'acta-row-left', hijos: [
                el('span', { texto: String(a.dorsal ?? ''), clase: 'acta-dorsal' }),
                el('a', { texto: ActaUtil.nombreActa(a), clase: 'acta-player-name enlace-subrayado',
                          atributos: { href: 'jugador.html?id=' + encodeURIComponent(a.jugador_id) } })
            ]}),
            el('div', { clase: 'acta-row-left', hijos: extras })
        ]});
    }

    // Dibuja titulares, suplentes, delegados, sustituciones y tarjetas de NUESTRO equipo.
    // Devuelve el índice de jugadores para que pintarGoles lo reutilice.
    function pintarEquipoPropio(p, acta) {
        const propio = p.local.es_propio ? p.local : p.visitante;
        $('acta-nombre-propio').textContent = propio.nombre.toUpperCase();

        // Índice por id para encontrar rápido los datos de cada jugador
        const jugadores = {};
        acta.alineacion.forEach(a => { jugadores[a.jugador_id] = a; });
        // Minutos, goles y tarjetas se calculan a partir de los eventos (fuente única de verdad).
        const stats = ActaUtil.estadisticas(acta.alineacion, acta.eventos, p.duracion);

        const titulares = vaciar('acta-titulares'), suplentes = vaciar('acta-suplentes');
        // slice() copia el array para no alterar el original al ordenar por dorsal.
        acta.alineacion.slice().sort((a, b) => (a.dorsal || 0) - (b.dorsal || 0)).forEach(a => {
            (a.estado === 'titular' ? titulares : suplentes).appendChild(filaJugador(a, stats[a.jugador_id]));
        });
        if (!suplentes.children.length) suplentes.appendChild(el('p', { texto: 'Sin suplentes.', clase: 'texto-vacio' }));

        // Cuerpo técnico (delegados): solo si se rellenó
        const ct = acta.cuerpo_tecnico || {};
        const delegados = vaciar('acta-delegados');
        if (ct.delegado_campo) delegados.appendChild(filaEtiqueta('DEL. CAMPO', ct.delegado_campo));
        if (ct.delegado_equipo) delegados.appendChild(filaEtiqueta('DEL. EQUIPO', ct.delegado_equipo));
        $('acta-bloque-delegados').hidden = !delegados.children.length;

        // (Cada sustitución se pinta como dos líneas: quién entra y quién sale.)
        // Sustituciones: pareja "entra / sale" con su minuto
        const subs = ActaUtil.ordenar(acta.eventos).filter(e => e.tipo === 'sustitucion');
        $('acta-bloque-sustituciones').hidden = !subs.length;
        const cajaSubs = vaciar('acta-sustituciones');
        subs.forEach(s => {
            const entra = jugadores[s.entra_id], sale = jugadores[s.sale_id];
            if (!entra || !sale) return;
            cajaSubs.appendChild(el('div', { clase: 'acta-sub-pair', hijos: [
                el('div', { clase: 'acta-sub-line', hijos: [
                    el('span', { texto: `${entra.dorsal ?? ''} ${ActaUtil.nombreActa(entra)}` }),
                    el('span', { texto: '← Entra', clase: 'sub-in' })
                ]}),
                el('div', { clase: 'acta-sub-line', hijos: [
                    el('span', { texto: `${sale.dorsal ?? ''} (${s.minuto}') ${ActaUtil.nombreActa(sale)}` }),
                    el('span', { texto: '→ Sale', clase: 'sub-out' })
                ]})
            ]}));
        });

        // Tarjetas
        const tarjetas = ActaUtil.ordenar(acta.eventos).filter(e => e.tipo === 'tarjeta');
        $('acta-bloque-tarjetas').hidden = !tarjetas.length;
        const cajaT = vaciar('acta-tarjetas');
        tarjetas.forEach(t => {
            const j = jugadores[t.jugador_id];
            cajaT.appendChild(el('div', { clase: 'acta-row', hijos: [el('div', { clase: 'acta-row-left', hijos: [
                Api.tarjeta(t.color === 'roja' ? 'roja' : 'amarilla', undefined, t.color === 'roja' ? 'Roja' : 'Amarilla'),
                el('span', { texto: `(${t.minuto}') ${j ? ActaUtil.nombreActa(j) : 'JUGADOR'}`, clase: 'acta-player-name' })
            ]})]}));
        });
        $('acta-equipo-propio').hidden = false;
        return jugadores;
    }

    // Pinta toda la página a partir del partido recibido del servidor.
    function pintar(p) {
        document.title = `${p.local.nombre} - ${p.visitante.nombre} - Acta - CD. Calasanz Santander`;
        $('acta-competicion').textContent = (p.competicion || 'Competición').toUpperCase();

        // Línea de fecha: "Temporada · Jornada · fecha · hora"
        const fecha = vaciar('acta-fecha');
        const partes = [p.temporada ? `Temporada ${p.temporada}` : null, `Jornada ${p.jornada}`, Api.formatearFecha(p.fecha), p.hora ? `${p.hora} h` : null].filter(Boolean);
        fecha.appendChild(el('strong', { texto: partes[0] }));
        if (partes.length > 1) fecha.appendChild(document.createTextNode(' · ' + partes.slice(1).join(' · ')));

        $('acta-lugar').textContent = p.lugar || '';
        $('acta-bloque-lugar').hidden = !p.lugar;

        // El enlace "Volver" lleva al equipo propio (si el partido es de uno de los nuestros)
        const propio = p.local.es_propio ? p.local : (p.visitante.es_propio ? p.visitante : null);
        if (propio) $('acta-volver').href = 'equipo.html?id=' + encodeURIComponent(propio.id) + '#resultados';

        pintarMarcador(p);

        // Crónica enlazada (si existe)
        $('acta-bloque-cronica').hidden = !p.cronica_id;
        if (p.cronica_id) $('acta-enlace-cronica').href = 'noticias.html?cronica=' + encodeURIComponent(p.cronica_id) + '#cronicas';

        // `acta` es null si el partido está pendiente o es entre rivales (solo se guarda el resultado).
        const acta = p.acta;
        if (!acta) {
            // Sin acta: partido pendiente, o partido entre rivales (solo resultado)
            ['acta-bloque-arbitros', 'acta-bloque-goles'].forEach(id => { $(id).hidden = true; });
            $('acta-equipo-propio').hidden = true;
            const hay = p.resultado_local !== null && p.resultado_local !== undefined;
            $('acta-mensajes').textContent = '';
            $('acta-mensajes').appendChild(el('p', { clase: 'mensaje', atributos: { role: 'status' },
                texto: hay ? 'Este partido no tiene acta detallada: solo se registra el resultado.'
                           : 'El acta de este partido todavía no se ha registrado.' }));
            return;
        }

        // Árbitros
        const arb = acta.arbitros || {};
        const cajaArb = vaciar('acta-arbitros');
        if (arb.principal) cajaArb.appendChild(filaEtiqueta('ÁRBITRO PRINCIPAL', arb.principal));
        (arb.asistentes || []).forEach(a => cajaArb.appendChild(filaEtiqueta('ÁRBITRO ASISTENTE', a)));
        $('acta-bloque-arbitros').hidden = !cajaArb.children.length;

        const jugadores = pintarEquipoPropio(p, acta);
        pintarGoles(p, acta, jugadores);
    }

    // Lee el id de la URL (?id=N), lo valida y pide el partido.
    async function iniciar() {
        const id = new URLSearchParams(window.location.search).get('id');
        // Solo dígitos: evitamos meter en la ruta de la API cualquier texto raro.
        if (!id || !/^\d+$/.test(id)) {
            Api.mostrarError($('acta-mensajes'), new Api.ApiError(404, 'no_encontrado', 'No se ha indicado un partido válido.'));
            return;
        }
        try {
            const p = await Demo.obtener(`/partidos/${id}`, null, () => Demo.partido(id));
            $('acta-contenido').hidden = false;
            pintar(p);
        } catch (error) {
            Api.mostrarError($('acta-mensajes'), error);
        }
    }

    // layout.js avisa con este evento cuando la sesión ya está comprobada.
    document.addEventListener('layout:listo', iniciar);
})();
