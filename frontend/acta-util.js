/*
 * acta-util.js — Cálculos del acta (los comparten acta.js y panel-entrenador.js)
 * ===============================================================================
 * Implementa en el navegador las MISMAS reglas que docs/API_CONTRATO.md §3 y §5 piden al
 * servidor. El servidor es quien manda (vuelve a calcular y validar todo); aquí solo sirve
 * para enseñar al usuario el resultado al instante y avisarle de errores antes de enviar.
 *
 * Idea clave: los EVENTOS son la única fuente de verdad. Del acta salen, ya calculados:
 *   - marcador (nº de goles propios y del rival)
 *   - goles, asistencias y tarjetas de cada jugador
 *   - minutos jugados (entrada − salida) y goles recibidos de los porteros
 * Regla de los minutos: una sustitución o expulsión del minuto m se aplica AL EMPEZAR ese minuto.
 */
(function (global) {
    'use strict';

    /* Marcador a partir de los eventos: { propio, rival } */
    function marcador(eventos) {
        const lista = eventos || [];
        return {
            propio: lista.filter(e => e.tipo === 'gol').length,
            rival: lista.filter(e => e.tipo === 'gol_rival').length
        };
    }

    /* Eventos ordenados por minuto (a igual minuto se respeta el orden en que se escribieron). */
    function ordenar(eventos) {
        return (eventos || []).map((e, i) => ({ e, i }))
            .sort((a, b) => (a.e.minuto - b.e.minuto) || (a.i - b.i))
            .map(x => x.e);
    }

    /*
     * Estadísticas de cada jugador de la alineación.
     * alineacion: [{ jugador_id, estado: 'titular'|'suplente', posicion? }]
     * Devuelve un objeto indexado por jugador_id:
     *   { minutos, goles, asistencias, amarillas, rojas, golesRecibidos, entro }
     */
    function estadisticas(alineacion, eventos, duracion) {
        const total = Number(duracion) || 90;
        const res = {};
        alineacion.forEach(a => {
            res[a.jugador_id] = {
                entrada: a.estado === 'titular' ? 0 : null, salida: null,
                goles: 0, asistencias: 0, amarillas: 0, rojas: 0, posicion: a.posicion
            };
        });

        const ordenados = ordenar(eventos);
        ordenados.forEach(e => {
            if (e.tipo === 'gol' && res[e.jugador_id]) {
                res[e.jugador_id].goles++;
                if (e.asistente_id && res[e.asistente_id]) res[e.asistente_id].asistencias++;
            } else if (e.tipo === 'tarjeta' && res[e.jugador_id]) {
                const r = res[e.jugador_id];
                if (e.color === 'roja') { r.rojas++; if (r.salida === null) r.salida = e.minuto; }
                else {
                    r.amarillas++;
                    // Dos amarillas cuentan como una roja: se expulsa al jugador
                    if (r.amarillas === 2) { r.rojas++; if (r.salida === null) r.salida = e.minuto; }
                }
            } else if (e.tipo === 'sustitucion') {
                if (res[e.sale_id] && res[e.sale_id].salida === null) res[e.sale_id].salida = e.minuto;
                if (res[e.entra_id] && res[e.entra_id].entrada === null) res[e.entra_id].entrada = e.minuto;
            }
        });

        Object.values(res).forEach(r => {
            // Un suplente que no llega a entrar tiene 0 minutos
            r.entro = r.entrada !== null;
            const hasta = r.salida !== null ? r.salida : total;
            r.minutos = r.entro ? Math.max(0, Math.min(hasta, total) - r.entrada) : 0;
            r.golesRecibidos = 0;
            // Solo los porteros "reciben" goles: los rivales marcados mientras estaban en el campo
            if (r.entro && r.posicion === 'Portero') {
                ordenados.filter(e => e.tipo === 'gol_rival').forEach(g => {
                    if (g.minuto >= r.entrada && g.minuto < hasta) r.golesRecibidos++;
                });
            }
        });
        return res;
    }

    /*
     * Comprueba el acta con las reglas del contrato (§5). Devuelve una lista de textos de error
     * (vacía si todo está bien). No sustituye al servidor: es solo una ayuda antes de enviar.
     */
    function validar(alineacion, eventos, duracion) {
        const errores = [];
        const ids = alineacion.map(a => a.jugador_id);
        if (new Set(ids).size !== ids.length) errores.push('Un jugador está repetido en la alineación.');
        if (alineacion.filter(a => a.estado === 'titular').length > 11) errores.push('Solo puede haber 11 titulares como máximo.');

        const limite = Number(duracion) || 90;
        const enCampo = {};   // jugador_id → true mientras está jugando
        const yaJugo = {};    // suplentes que ya han entrado
        const amarillas = {}; const expulsado = {};
        alineacion.forEach(a => { enCampo[a.jugador_id] = a.estado === 'titular'; yaJugo[a.jugador_id] = a.estado === 'titular'; });

        ordenar(eventos).forEach((e, n) => {
            const donde = `Evento ${n + 1} (minuto ${e.minuto})`;
            if (!Number.isInteger(e.minuto) || e.minuto < 0 || e.minuto > 120) { errores.push(`${donde}: el minuto debe estar entre 0 y 120.`); return; }
            if (e.minuto > limite + 15) errores.push(`${donde}: pasa mucho de la duración del partido (${limite}').`);
            if (e.tipo === 'gol') {
                if (!(e.jugador_id in enCampo)) errores.push(`${donde}: el goleador no está en la alineación.`);
                else if (!enCampo[e.jugador_id]) errores.push(`${donde}: el goleador no está en el campo en ese minuto.`);
                if (e.asistente_id && e.asistente_id === e.jugador_id) errores.push(`${donde}: el asistente no puede ser el goleador.`);
                if (e.asistente_id && !(e.asistente_id in enCampo)) errores.push(`${donde}: el asistente no está en la alineación.`);
            } else if (e.tipo === 'tarjeta') {
                if (!(e.jugador_id in enCampo)) { errores.push(`${donde}: el jugador amonestado no está en la alineación.`); return; }
                if (expulsado[e.jugador_id]) errores.push(`${donde}: el jugador ya había sido expulsado.`);
                if (e.color === 'roja') expulsado[e.jugador_id] = true;
                else {
                    amarillas[e.jugador_id] = (amarillas[e.jugador_id] || 0) + 1;
                    if (amarillas[e.jugador_id] > 2) errores.push(`${donde}: un jugador no puede tener más de 2 amarillas.`);
                    if (amarillas[e.jugador_id] === 2) expulsado[e.jugador_id] = true;
                }
                if (expulsado[e.jugador_id]) enCampo[e.jugador_id] = false;
            } else if (e.tipo === 'sustitucion') {
                if (!enCampo[e.sale_id]) errores.push(`${donde}: el jugador que sale no estaba en el campo.`);
                if (!(e.entra_id in enCampo) || yaJugo[e.entra_id]) errores.push(`${donde}: el jugador que entra debe ser un suplente que aún no haya jugado.`);
                if (e.sale_id === e.entra_id) errores.push(`${donde}: entra y sale el mismo jugador.`);
                enCampo[e.sale_id] = false;
                if (e.entra_id in enCampo) { enCampo[e.entra_id] = true; yaJugo[e.entra_id] = true; }
            } else if (e.tipo !== 'gol_rival') {
                errores.push(`${donde}: tipo de evento no válido.`);
            }
        });
        return errores;
    }

    /* "Apellidos, Nombre" en mayúsculas, como en las actas oficiales. */
    function nombreActa(j) {
        const apellidos = [j.ap1, j.ap2].filter(Boolean).join(' ');
        return `${apellidos}, ${j.nombre}`.toUpperCase();
    }

    global.ActaUtil = { marcador, ordenar, estadisticas, validar, nombreActa };
})(window);
