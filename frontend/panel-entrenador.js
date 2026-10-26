/*
 * panel-entrenador.js — Panel del entrenador (panel-entrenador.html)
 * ====================================================================
 * Tres pestañas:
 *   1. Partidos  → crear/editar partidos de la liga del equipo (también entre rivales) y
 *                  registrar el resultado de los partidos entre rivales.
 *   2. Acta      → acta completa de un partido de NUESTRO equipo (alineación, árbitros,
 *                  eventos con minuto). El marcador y los minutos se calculan solos.
 *   3. Crónicas  → texto público sobre un partido jugado; aparece en Noticias.
 * Acceso: ENTRENADOR, COORDINADOR y DESARROLLADOR (lo exige <body data-roles="...">).
 * La comprobación REAL de permisos la hace el servidor; esto es solo comodidad.
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET  /api/equipos?propios=true            → desplegable de equipos
 *   GET  /api/equipos?competicion=X           → equipos de la liga (propios y rivales)
 *   GET  /api/partidos?competicion=X          → partidos de la liga
 *   GET  /api/partidos/{id}                   → partido con su acta
 *   POST /api/partidos · PATCH /api/partidos/{id} · DELETE /api/partidos/{id} (solo COORD/DEV)
 *   PUT  /api/partidos/{id}/acta              → guarda el acta completa
 *   PUT  /api/partidos/{id}/resultado         → resultado de un partido entre rivales
 *   GET/POST/PATCH/DELETE /api/cronicas       → crónicas
 *
 * MODO DEMOSTRACIÓN: si el servidor no responde, todo se guarda SOLO en memoria (se pierde al
 * recargar) y se avisa. Nunca se envía nada a ningún sitio.
 *
 * SEGURIDAD: nada de innerHTML con datos; todo con Api.el() / textContent.
 */
(function () {
    'use strict';

    const { el } = Api;
    const $ = (id) => document.getElementById(id);

    // Duración total (minutos) por categoría — misma tabla que docs/API_CONTRATO.md §3.
    // El servidor la manda en `partido.duracion`; esta tabla es solo el plan B.
    const DURACION = { 'Prebenjamín': 40, 'Benjamín': 50, 'Alevín': 60, 'Infantil': 70, 'Cadete': 80, 'Juvenil': 90 };

    // ------------------------------------------------------------------
    // Estado de la página
    // ------------------------------------------------------------------
    let equipos = [];          // equipos propios
    let equipo = null;         // equipo elegido
    let ligaEquipos = [];      // equipos de su liga (propios y rivales)
    let partidos = [];         // partidos de la liga
    let plantilla = [];        // jugadores del equipo elegido
    let cronicas = [];         // crónicas publicadas
    let partidoEnEdicion = null;   // partido que se está editando en el formulario de partidos (o null)
    let cronicaEnEdicion = null;   // crónica que se está editando (o null)
    let partidoActa = null;        // partido cuyo acta está abierta
    let resultadoDe = null;        // partido entre rivales cuyo resultado se está escribiendo
    const actasDemo = {};          // actas guardadas en memoria (solo modo demostración)
    let siguienteIdDemo = 100;

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    /* Fecha de hoy en formato AAAA-MM-DD (hora local). Un partido "ya jugado" tiene fecha <= hoy. */
    function hoy() {
        const d = new Date();
        const dos = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
    }
    const yaLlego = (p) => p.fecha <= hoy();
    const esPropio = (p) => !!((p.local && p.local.es_propio) || (p.visitante && p.visitante.es_propio));
    const esDelEquipo = (p) => !equipo || p.local.id === equipo.id || p.visitante.id === equipo.id;
    const hayResultado = (p) => p.resultado_local !== null && p.resultado_local !== undefined;

    /* "Jornada 7 · C.D. Calasanz 4-2 Marina Norte C.F." (o con "vs" si no se ha jugado). */
    function titulo(p) {
        const medio = hayResultado(p) ? ` ${p.resultado_local}-${p.resultado_visitante} ` : ' vs ';
        return `J${p.jornada} · ${p.local.nombre}${medio}${p.visitante.nombre}`;
    }

    /* Escribe un mensaje en una zona <p class="feedback"> y lo anuncia a lectores de pantalla. */
    function mensaje(idZona, texto, tipo) {
        const zona = $(idZona);
        zona.textContent = texto;
        zona.className = 'feedback feedback-' + tipo;
        zona.hidden = false;
        Api.anunciar(texto, tipo === 'error');
    }
    function limpiarMensaje(idZona) { const z = $(idZona); z.textContent = ''; z.hidden = true; }

    /* Sustituye las opciones de un <select>. opciones: [{ valor, texto }] */
    function rellenarSelect(select, opciones, seleccionado) {
        select.textContent = '';
        opciones.forEach(o => select.appendChild(el('option', { texto: o.texto, atributos: { value: String(o.valor) } })));
        if (seleccionado !== undefined && seleccionado !== null) select.value = String(seleccionado);
    }

    /* Respuesta paginada ({ items }) o lista simple → siempre una lista. */
    const comoLista = (r) => Array.isArray(r) ? r : ((r && r.items) || []);

    /* Envía a la API salvo en modo demostración. Devuelve lo que responda el servidor (o null). */
    async function enviar(metodo, ruta, cuerpo) {
        if (Sesion.enModoDemo()) return null;
        return Api[metodo](ruta, cuerpo);
    }
    const avisoDemo = () => Sesion.enModoDemo() ? ' (modo demostración: no se ha enviado al servidor)' : '';

    // ------------------------------------------------------------------
    // Carga de datos
    // ------------------------------------------------------------------
    async function cargarPartidos() {
        const comp = equipo && equipo.competicion;
        const r = await Demo.obtener('/partidos', { competicion: comp, por_pagina: 100 }, Demo.partidosLiga);
        // En modo demostración los cambios hechos en memoria se conservan entre cargas
        if (!partidos.length || !Sesion.enModoDemo()) partidos = comoLista(r);
        partidos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    }

    async function cargarEquipoElegido() {
        $('pe-liga').textContent = equipo.competicion ? `Liga: ${equipo.competicion}` : '';
        partidos = [];
        const comp = equipo.competicion;
        ligaEquipos = comoLista(await Demo.obtener('/equipos', { competicion: comp }, Demo.equiposLiga));
        plantilla = comoLista(await Demo.obtener(`/equipos/${equipo.id}/plantilla`, null, Demo.plantilla));
        await cargarPartidos();
        pintarFormularioPartido();
        pintarTablaPartidos();
        pintarSelectorActa();
        pintarSelectorCronica();
        await cargarCronicas();
    }

    // ==================================================================
    // PESTAÑA 1: PARTIDOS
    // ==================================================================
    function pintarFormularioPartido() {
        const opciones = ligaEquipos.map(e => ({ valor: e.id, texto: e.nombre }));
        rellenarSelect($('pe-local'), opciones, equipo.id);
        // El visitante por defecto es el primer equipo distinto del local
        const otro = ligaEquipos.find(e => e.id !== equipo.id);
        rellenarSelect($('pe-visitante'), opciones, otro ? otro.id : undefined);
    }

    function botonAccion(texto, alPulsar) {
        const b = el('button', { texto, clase: 'btn-outline boton-pequeno', atributos: { type: 'button' } });
        b.addEventListener('click', alPulsar);
        return b;
    }

    function pintarTablaPartidos() {
        const cuerpo = $('pe-tabla-partidos');
        cuerpo.textContent = '';
        if (!partidos.length) {
            cuerpo.appendChild(el('tr', { hijos: [el('td', { texto: 'Todavía no hay partidos en esta liga.', atributos: { colspan: '4' } })] }));
            return;
        }
        partidos.forEach(p => {
            const acciones = [botonAccion('Editar', () => empezarEdicionPartido(p))];
            if (esPropio(p)) {
                if (yaLlego(p) && esDelEquipo(p)) acciones.push(botonAccion(p.estado === 'finalizado' ? 'Editar acta' : 'Registrar acta', () => abrirActa(p.id)));
            } else if (yaLlego(p)) {
                acciones.push(botonAccion(hayResultado(p) ? 'Corregir resultado' : 'Registrar resultado', () => abrirResultado(p)));
            }
            // Borrar: solo coordinador y desarrollador
            if (Sesion.tieneRol('COORDINADOR', 'DESARROLLADOR')) acciones.push(botonAccion('Eliminar', () => eliminarPartido(p)));

            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: String(p.jornada) })] }),
                el('td', { texto: `${p.local.nombre} ${hayResultado(p) ? p.resultado_local + ' - ' + p.resultado_visitante : 'vs'} ${p.visitante.nombre}` +
                                  (esPropio(p) ? '' : ' (rivales)') }),
                el('td', { texto: Api.formatearFecha(p.fecha) }),
                el('td', { hijos: [el('div', { clase: 'fila-botones', hijos: acciones })] })
            ]}));
        });
    }

    function empezarEdicionPartido(p) {
        partidoEnEdicion = p;
        $('pe-local').value = String(p.local.id);
        $('pe-visitante').value = String(p.visitante.id);
        $('pe-jornada').value = p.jornada;
        $('pe-fecha').value = p.fecha;
        $('pe-lugar').value = p.lugar || '';
        $('pe-modo-partido').textContent = `Editando jornada ${p.jornada}`;
        $('pe-cancelar-partido').hidden = false;
        limpiarMensaje('pe-feedback-partido');
        $('pe-local').focus();
    }

    function terminarEdicionPartido() {
        partidoEnEdicion = null;
        $('pe-form-partido').reset();
        pintarFormularioPartido();
        $('pe-modo-partido').textContent = 'Nuevo';
        $('pe-cancelar-partido').hidden = true;
    }

    /* Id de la temporada en curso: la de los partidos existentes o, si no hay, la última de la lista. */
    async function temporadaActual() {
        const conTemporada = partidos.find(p => p.temporada_id);
        if (conTemporada) return conTemporada.temporada_id;
        const lista = comoLista(await Api.get('/temporadas'));
        return lista.length ? lista[lista.length - 1].id : null;
    }

    async function guardarPartido(evento) {
        evento.preventDefault();
        limpiarMensaje('pe-feedback-partido');
        const localId = Number($('pe-local').value), visitanteId = Number($('pe-visitante').value);
        const jornada = Number($('pe-jornada').value), fecha = $('pe-fecha').value;
        const lugar = $('pe-lugar').value.trim();

        // Validaciones en el cliente (el servidor vuelve a comprobarlas)
        if (localId === visitanteId) return mensaje('pe-feedback-partido', 'El equipo local y el visitante deben ser distintos.', 'error');
        if (!Number.isInteger(jornada) || jornada < 1 || jornada > 99) return mensaje('pe-feedback-partido', 'La jornada debe ser un número entre 1 y 99.', 'error');
        if (!fecha) return mensaje('pe-feedback-partido', 'Indica la fecha del partido.', 'error');
        if (lugar.length > 150) return mensaje('pe-feedback-partido', 'El lugar no puede pasar de 150 caracteres.', 'error');

        const local = ligaEquipos.find(e => e.id === localId), visitante = ligaEquipos.find(e => e.id === visitanteId);
        try {
            if (partidoEnEdicion) {
                const p = partidoEnEdicion;
                await enviar('patch', `/partidos/${p.id}`, { jornada, fecha, local_id: localId, visitante_id: visitanteId, lugar: lugar || null });
                Object.assign(p, { jornada, fecha, lugar: lugar || null, local: { ...local, es_propio: !!local.es_propio }, visitante: { ...visitante, es_propio: !!visitante.es_propio } });
            } else {
                const temporada_id = Sesion.enModoDemo() ? 1 : await temporadaActual();
                const nuevo = await enviar('post', '/partidos', { temporada_id, jornada, fecha, local_id: localId, visitante_id: visitanteId, lugar: lugar || null });
                partidos.push(nuevo || {
                    id: siguienteIdDemo++, temporada_id, jornada, fecha, estado: 'programado', lugar: lugar || null, cronica_id: null,
                    local: { id: local.id, nombre: local.nombre, es_propio: !!local.es_propio },
                    visitante: { id: visitante.id, nombre: visitante.nombre, es_propio: !!visitante.es_propio },
                    resultado_local: null, resultado_visitante: null
                });
            }
            mensaje('pe-feedback-partido', 'Partido guardado.' + avisoDemo(), 'ok');
            terminarEdicionPartido();
            if (!Sesion.enModoDemo()) await cargarPartidos();
            partidos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
            pintarTablaPartidos(); pintarSelectorActa(); pintarSelectorCronica();
        } catch (error) {
            mensaje('pe-feedback-partido', error.message || 'No se ha podido guardar el partido.', 'error');
        }
    }

    async function eliminarPartido(p) {
        // Acción destructiva: SIEMPRE confirmar. Borra también el acta.
        if (!window.confirm(`¿Seguro que quieres eliminar el partido "${titulo(p)}"? Se borrará también su acta.`)) return;
        try {
            await enviar('delete', `/partidos/${p.id}`);
            partidos = partidos.filter(x => x.id !== p.id);
            pintarTablaPartidos(); pintarSelectorActa(); pintarSelectorCronica();
            mensaje('pe-feedback', 'Partido eliminado.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pe-feedback', error.message, 'error');
        }
    }

    // --- Resultado de un partido entre rivales ---
    function abrirResultado(p) {
        resultadoDe = p;
        $('pe-resultado-titulo').textContent = `Resultado: ${p.local.nombre} - ${p.visitante.nombre}`;
        $('pe-res-local-etq').textContent = `Goles de ${p.local.nombre}`;
        $('pe-res-visitante-etq').textContent = `Goles de ${p.visitante.nombre}`;
        $('pe-res-local').value = hayResultado(p) ? p.resultado_local : '';
        $('pe-res-visitante').value = hayResultado(p) ? p.resultado_visitante : '';
        $('pe-form-resultado').hidden = false;
        $('pe-res-local').focus();
    }

    async function guardarResultado(evento) {
        evento.preventDefault();
        const a = Number($('pe-res-local').value), b = Number($('pe-res-visitante').value);
        if (!resultadoDe || $('pe-res-local').value === '' || $('pe-res-visitante').value === '' ||
            !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 99 || b > 99) {
            return mensaje('pe-feedback', 'Escribe los goles de cada equipo (números enteros entre 0 y 99).', 'error');
        }
        try {
            await enviar('put', `/partidos/${resultadoDe.id}/resultado`, { resultado_local: a, resultado_visitante: b });
            Object.assign(resultadoDe, { resultado_local: a, resultado_visitante: b, estado: 'finalizado' });
            mensaje('pe-feedback', 'Resultado guardado: la clasificación se actualizará.' + avisoDemo(), 'ok');
            $('pe-form-resultado').hidden = true; resultadoDe = null;
            pintarTablaPartidos();
        } catch (error) {
            mensaje('pe-feedback', error.message, 'error');
        }
    }

    // ==================================================================
    // PESTAÑA 2: ACTA
    // ==================================================================
    // Cada fila de evento guarda sus controles aquí para poder leerlos y repintarlos
    let filasEvento = [];

    function partidosParaActa() { return partidos.filter(p => esPropio(p) && esDelEquipo(p) && yaLlego(p)); }

    function pintarSelectorActa(seleccion) {
        const lista = partidosParaActa();
        const sel = $('pe-acta-partido');
        rellenarSelect(sel, [{ valor: '', texto: lista.length ? 'Elige un partido…' : 'No hay partidos jugados pendientes de acta' }]
            .concat(lista.map(p => ({ valor: p.id, texto: titulo(p) + (p.estado === 'finalizado' ? ' (con acta)' : ' (pendiente)') }))),
            seleccion || (partidoActa ? partidoActa.id : ''));
    }

    /* Opciones de "jugador" para los eventos: solo los convocados (titulares y suplentes). */
    function convocados() {
        return plantilla.filter(j => {
            const s = $('pe-conv-' + j.id);
            return s && s.value !== '';
        });
    }
    const etiquetaJugador = (j) => `${j.dorsal ?? '-'} ${j.nombre} ${j.ap1}`;

    function leerAlineacion() {
        return convocados().map(j => ({ jugador_id: j.id, estado: $('pe-conv-' + j.id).value, posicion: j.posicion }));
    }

    function pintarAlineacion(acta) {
        const cuerpo = $('pe-alineacion');
        cuerpo.textContent = '';
        const previa = {};
        if (acta) acta.alineacion.forEach(a => { previa[a.jugador_id] = a.estado; });
        plantilla.slice().sort((a, b) => (a.dorsal || 0) - (b.dorsal || 0)).forEach(j => {
            const sel = el('select', { atributos: { id: 'pe-conv-' + j.id, 'aria-label': `Convocatoria de ${j.nombre} ${j.ap1}` } });
            rellenarSelect(sel, [{ valor: '', texto: 'No convocado' }, { valor: 'titular', texto: 'Titular' }, { valor: 'suplente', texto: 'Suplente' }], previa[j.id] || '');
            sel.addEventListener('change', alCambiarAlineacion);
            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { texto: String(j.dorsal ?? '') }),
                el('td', { texto: `${j.nombre} ${j.ap1}${j.ap2 ? ' ' + j.ap2 : ''}` }),
                el('td', { hijos: [sel] })
            ]}));
        });
    }

    function alCambiarAlineacion() { refrescarJugadoresEventos(); actualizarMarcador(); }

    /* Vuelve a rellenar los desplegables de jugador de cada evento sin perder lo que estaba elegido. */
    function refrescarJugadoresEventos() {
        const opciones = convocados().map(j => ({ valor: j.id, texto: etiquetaJugador(j) }));
        filasEvento.forEach(f => {
            [[f.jugador, false], [f.asistente, true], [f.sale, false], [f.entra, false]].forEach(([sel, opcional]) => {
                const actual = sel.value;
                const todas = (opcional ? [{ valor: '', texto: 'Sin asistente' }] : [{ valor: '', texto: 'Elige jugador…' }]).concat(opciones);
                rellenarSelect(sel, todas, todas.some(o => String(o.valor) === actual) ? actual : '');
            });
        });
    }

    /* Enseña/oculta los campos de una fila según el tipo de evento. */
    function ajustarCamposEvento(f) {
        const t = f.tipo.value;
        f.grupoJugador.hidden = !(t === 'gol' || t === 'tarjeta');
        f.grupoAsistente.hidden = t !== 'gol';
        f.grupoColor.hidden = t !== 'tarjeta';
        f.grupoAutor.hidden = t !== 'gol_rival';
        f.grupoSale.hidden = t !== 'sustitucion';
        f.grupoEntra.hidden = t !== 'sustitucion';
    }

    /* Un campo con su etiqueta visible pequeña (la etiqueta va asociada al control con for/id). */
    let contadorCampos = 0;
    function campo(textoEtiqueta, control) {
        const id = 'pe-ev-' + (++contadorCampos);
        control.id = id;
        return el('div', { clase: 'field-group pe-evento-campo', hijos: [el('label', { texto: textoEtiqueta, atributos: { for: id } }), control] });
    }

    function crearFilaEvento(ev) {
        const f = {};
        f.tipo = el('select');
        rellenarSelect(f.tipo, [{ valor: 'gol', texto: 'Gol nuestro' }, { valor: 'gol_rival', texto: 'Gol del rival' },
                                { valor: 'tarjeta', texto: 'Tarjeta' }, { valor: 'sustitucion', texto: 'Sustitución' }], ev ? ev.tipo : 'gol');
        f.minuto = el('input', { clase: 'clean-input', atributos: { type: 'number', min: '0', max: '120', inputmode: 'numeric' } });
        f.jugador = el('select'); f.asistente = el('select'); f.sale = el('select'); f.entra = el('select');
        f.color = el('select');
        rellenarSelect(f.color, [{ valor: 'amarilla', texto: 'Amarilla' }, { valor: 'roja', texto: 'Roja' }], 'amarilla');
        f.autor = el('input', { clase: 'clean-input', atributos: { type: 'text', maxlength: '100', autocomplete: 'off' } });

        f.grupoTipo = campo('Evento', f.tipo);
        f.grupoMinuto = campo('Minuto', f.minuto);
        f.grupoJugador = campo('Jugador', f.jugador);
        f.grupoAsistente = campo('Asistente', f.asistente);
        f.grupoColor = campo('Tarjeta', f.color);
        f.grupoAutor = campo('Autor (opcional)', f.autor);
        f.grupoSale = campo('Sale', f.sale);
        f.grupoEntra = campo('Entra', f.entra);

        const quitar = el('button', { texto: 'Quitar', clase: 'btn-outline boton-pequeno', atributos: { type: 'button' } });
        f.fila = el('div', { clase: 'pe-evento', atributos: { role: 'group' }, hijos: [
            f.grupoTipo, f.grupoMinuto, f.grupoJugador, f.grupoAsistente, f.grupoColor, f.grupoAutor, f.grupoSale, f.grupoEntra, quitar
        ]});

        f.tipo.addEventListener('change', () => { ajustarCamposEvento(f); actualizarMarcador(); });
        [f.jugador, f.asistente, f.sale, f.entra, f.color, f.minuto, f.autor].forEach(c => c.addEventListener('change', actualizarMarcador));
        quitar.addEventListener('click', () => {
            filasEvento = filasEvento.filter(x => x !== f);
            f.fila.remove(); numerarEventos(); actualizarMarcador();
            $('pe-anadir-evento').focus();
        });

        filasEvento.push(f);
        $('pe-eventos').appendChild(f.fila);
        refrescarJugadoresEventos();
        // Si venimos de un acta guardada, rellenamos los valores del evento
        if (ev) {
            f.minuto.value = ev.minuto;
            if (ev.jugador_id) f.jugador.value = String(ev.jugador_id);
            if (ev.asistente_id) f.asistente.value = String(ev.asistente_id);
            if (ev.sale_id) f.sale.value = String(ev.sale_id);
            if (ev.entra_id) f.entra.value = String(ev.entra_id);
            if (ev.color) f.color.value = ev.color;
            if (ev.autor) f.autor.value = ev.autor;
        }
        ajustarCamposEvento(f);
        numerarEventos();
        return f;
    }

    function numerarEventos() {
        filasEvento.forEach((f, i) => f.fila.setAttribute('aria-label', `Evento ${i + 1}`));
    }

    /* Lee los eventos de la pantalla con el formato del contrato (solo los campos que corresponden a cada tipo). */
    function leerEventos() {
        const num = (v) => (v === '' ? null : Number(v));
        return filasEvento.map(f => {
            const base = { tipo: f.tipo.value, minuto: f.minuto.value === '' ? NaN : Number(f.minuto.value) };
            if (base.tipo === 'gol') { base.jugador_id = num(f.jugador.value); if (f.asistente.value) base.asistente_id = Number(f.asistente.value); }
            else if (base.tipo === 'gol_rival') { if (f.autor.value.trim()) base.autor = f.autor.value.trim(); }
            else if (base.tipo === 'tarjeta') { base.jugador_id = num(f.jugador.value); base.color = f.color.value; }
            else { base.sale_id = num(f.sale.value); base.entra_id = num(f.entra.value); }
            return base;
        });
    }

    function duracionDelPartido() {
        return (partidoActa && partidoActa.duracion) || (equipo && equipo.categoria && DURACION[equipo.categoria.nombre]) || 90;
    }

    /* Marcador en directo, calculado a partir de los eventos. */
    function actualizarMarcador() {
        if (!partidoActa) return;
        const m = ActaUtil.marcador(leerEventos());
        const p = partidoActa;
        const [gl, gv] = p.local.es_propio ? [m.propio, m.rival] : [m.rival, m.propio];
        $('pe-acta-marcador').textContent = `${p.local.nombre} ${gl} - ${gv} ${p.visitante.nombre}`;
    }

    async function abrirActa(id) {
        activarPestana('pe-acta');
        pintarSelectorActa(id);
        await cargarActa(id);
    }

    async function cargarActa(id) {
        const form = $('pe-form-acta');
        limpiarMensaje('pe-feedback-acta'); $('pe-errores-acta').hidden = true;
        if (!id) { form.hidden = true; partidoActa = null; $('pe-acta-estado').textContent = ''; return; }
        try {
            const p = await Demo.obtener(`/partidos/${id}`, null, () => Demo.partido(id));
            // En modo demostración, si hay un acta guardada en memoria, tiene preferencia
            const base = partidos.find(x => String(x.id) === String(id)) || p;
            partidoActa = { ...base, ...p, local: base.local, visitante: base.visitante };
            if (actasDemo[id]) partidoActa.acta = actasDemo[id];
            const acta = partidoActa.acta;

            $('pe-acta-estado').textContent = acta ? 'Acta ya registrada: se reemplazará' : 'Sin acta todavía';
            const arb = (acta && acta.arbitros) || {}, ct = (acta && acta.cuerpo_tecnico) || {};
            $('pe-arb-principal').value = arb.principal || '';
            $('pe-arb-as1').value = (arb.asistentes || [])[0] || '';
            $('pe-arb-as2').value = (arb.asistentes || [])[1] || '';
            $('pe-del-campo').value = ct.delegado_campo || '';
            $('pe-del-equipo').value = ct.delegado_equipo || '';

            pintarAlineacion(acta);
            filasEvento = []; $('pe-eventos').textContent = '';
            if (acta) ActaUtil.ordenar(acta.eventos).forEach(crearFilaEvento);
            form.hidden = false;
            actualizarMarcador();
        } catch (error) {
            form.hidden = true;
            mensaje('pe-feedback', error.message, 'error');
        }
    }

    async function guardarActa(evento) {
        evento.preventDefault();
        limpiarMensaje('pe-feedback-acta');
        const cajaErrores = $('pe-errores-acta');
        const p = partidoActa;
        if (!p) return;

        const alineacion = leerAlineacion(), eventos = leerEventos();
        const errores = ActaUtil.validar(alineacion, eventos, duracionDelPartido());
        if (!alineacion.some(a => a.estado === 'titular')) errores.unshift('Marca al menos un jugador como titular.');
        // El marcador sale de los eventos, así que coincide siempre; solo avisamos si falta algún dato obligatorio
        if (errores.length) {
            cajaErrores.textContent = '';
            cajaErrores.appendChild(el('p', { texto: 'Revisa estos puntos antes de guardar:' }));
            cajaErrores.appendChild(el('ul', { hijos: errores.map(e => el('li', { texto: e })) }));
            cajaErrores.hidden = false;
            Api.anunciar('Hay errores en el acta.', true);
            return;
        }
        cajaErrores.hidden = true;

        const m = ActaUtil.marcador(eventos);
        const [rl, rv] = p.local.es_propio ? [m.propio, m.rival] : [m.rival, m.propio];
        const v = (id) => $(id).value.trim();
        const asistentes = [v('pe-arb-as1'), v('pe-arb-as2')].filter(Boolean);
        const cuerpo = {
            resultado_local: rl, resultado_visitante: rv,
            arbitros: { principal: v('pe-arb-principal'), asistentes },
            cuerpo_tecnico: { delegado_campo: v('pe-del-campo'), delegado_equipo: v('pe-del-equipo') },
            alineacion: alineacion.map(a => ({ jugador_id: a.jugador_id, estado: a.estado })),
            eventos
        };
        try {
            await enviar('put', `/partidos/${p.id}/acta`, cuerpo);
            // Actualizamos lo que se ve en pantalla
            const enLista = partidos.find(x => x.id === p.id);
            if (enLista) Object.assign(enLista, { resultado_local: rl, resultado_visitante: rv, estado: 'finalizado' });
            if (Sesion.enModoDemo()) {
                // Guardamos el acta en memoria con los datos de cada jugador, como la devolvería el servidor
                actasDemo[p.id] = { arbitros: cuerpo.arbitros, cuerpo_tecnico: cuerpo.cuerpo_tecnico, eventos,
                    alineacion: alineacion.map(a => { const j = plantilla.find(x => x.id === a.jugador_id);
                        return { jugador_id: j.id, estado: a.estado, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, dorsal: j.dorsal, posicion: j.posicion }; }) };
            }
            mensaje('pe-feedback-acta', `Acta guardada (${rl} - ${rv}). La clasificación y las estadísticas se actualizan.` + avisoDemo(), 'ok');
            $('pe-acta-estado').textContent = 'Acta registrada';
            pintarTablaPartidos(); pintarSelectorActa(p.id); pintarSelectorCronica();
        } catch (error) {
            // Si el servidor rechaza el acta, el anterior queda intacto
            mensaje('pe-feedback-acta', error.message || 'No se ha podido guardar el acta.', 'error');
        }
    }

    // ==================================================================
    // PESTAÑA 3: CRÓNICAS
    // ==================================================================
    /* Partidos propios, jugados y sin crónica (más el de la crónica que se está editando). */
    function partidosParaCronica() {
        return partidos.filter(p => esPropio(p) && esDelEquipo(p) && p.estado === 'finalizado' &&
            (!p.cronica_id || (cronicaEnEdicion && p.id === cronicaEnEdicion.partido.id)));
    }

    function pintarSelectorCronica() {
        const lista = partidosParaCronica();
        const sel = $('pe-cr-partido');
        rellenarSelect(sel, lista.length ? lista.map(p => ({ valor: p.id, texto: titulo(p) })) : [{ valor: '', texto: 'No hay partidos jugados sin crónica' }],
            cronicaEnEdicion ? cronicaEnEdicion.partido.id : undefined);
        sel.disabled = !!cronicaEnEdicion;   // el partido de una crónica no se cambia
    }

    async function cargarCronicas() {
        try {
            if (!cronicas.length || !Sesion.enModoDemo()) {
                cronicas = comoLista(await Demo.obtener('/cronicas', { equipo: equipo.id }, Demo.cronicas));
            }
            pintarCronicas();
        } catch (error) {
            Api.mostrarError($('pe-lista-cronicas'), error);
        }
    }

    function puedeEditarCronica(c) {
        const u = Sesion.actual();
        // El entrenador solo toca las suyas; coordinador y desarrollador, todas. En demostración se permite.
        return Sesion.enModoDemo() || Sesion.tieneRol('COORDINADOR', 'DESARROLLADOR') || (u && c.autor && c.autor.username === u.username);
    }

    function pintarCronicas() {
        const caja = $('pe-lista-cronicas');
        caja.textContent = '';
        if (!cronicas.length) { caja.appendChild(el('p', { texto: 'Todavía no hay crónicas de este equipo.', clase: 'texto-vacio' })); return; }
        cronicas.forEach(c => {
            const hijos = [
                el('div', { clase: 'news-card-meta', hijos: [el('span', { texto: 'CRÓNICA' }), el('span', { texto: Api.formatearFecha(c.creada_en) })] }),
                el('h3', { texto: c.titulo }),
                el('p', { texto: titulo(c.partido), clase: 'acta-etiqueta' }),
                el('p', { texto: c.texto, clase: 'news-card-texto' })
            ];
            if (puedeEditarCronica(c)) {
                const editar = botonAccion('Editar', () => empezarEdicionCronica(c));
                const borrar = botonAccion('Eliminar', () => eliminarCronica(c));
                hijos.push(el('div', { clase: 'fila-botones', hijos: [editar, borrar] }));
            }
            caja.appendChild(el('article', { clase: 'news-card', hijos }));
        });
    }

    function actualizarContador() {
        const n = $('pe-cr-texto').value.length;
        $('pe-cr-contador').textContent = `${n} / 3000 caracteres (mínimo 50)`;
    }

    function empezarEdicionCronica(c) {
        cronicaEnEdicion = c;
        pintarSelectorCronica();
        $('pe-cr-titulo').value = c.titulo;
        $('pe-cr-texto').value = c.texto;
        $('pe-modo-cronica').textContent = 'Editando';
        $('pe-cancelar-cronica').hidden = false;
        actualizarContador();
        $('pe-cr-titulo').focus();
    }

    function terminarEdicionCronica() {
        cronicaEnEdicion = null;
        $('pe-form-cronica').reset();
        $('pe-modo-cronica').textContent = 'Nueva';
        $('pe-cancelar-cronica').hidden = true;
        pintarSelectorCronica(); actualizarContador();
    }

    async function guardarCronica(evento) {
        evento.preventDefault();
        limpiarMensaje('pe-feedback-cronica');
        const tit = $('pe-cr-titulo').value.trim(), texto = $('pe-cr-texto').value.trim();
        const partidoId = Number($('pe-cr-partido').value);
        if (!cronicaEnEdicion && !partidoId) return mensaje('pe-feedback-cronica', 'Elige el partido de la crónica.', 'error');
        if (tit.length < 3 || tit.length > 120) return mensaje('pe-feedback-cronica', 'El título debe tener entre 3 y 120 caracteres.', 'error');
        if (texto.length < 50 || texto.length > 3000) return mensaje('pe-feedback-cronica', 'El texto debe tener entre 50 y 3000 caracteres.', 'error');

        try {
            if (cronicaEnEdicion) {
                const c = cronicaEnEdicion;
                await enviar('patch', `/cronicas/${c.id}`, { titulo: tit, texto });
                Object.assign(c, { titulo: tit, texto, actualizada_en: new Date().toISOString() });
            } else {
                const creada = await enviar('post', '/cronicas', { partido_id: partidoId, titulo: tit, texto });
                const p = partidos.find(x => x.id === partidoId);
                const u = Sesion.actual();
                const nueva = creada || { id: siguienteIdDemo++, titulo: tit, texto, creada_en: new Date().toISOString(), actualizada_en: null,
                    autor: { id: u ? u.id : 0, username: u ? u.username : 'demo' },
                    partido: { id: p.id, jornada: p.jornada, fecha: p.fecha, local: p.local, visitante: p.visitante,
                               resultado_local: p.resultado_local, resultado_visitante: p.resultado_visitante } };
                cronicas.unshift(nueva);
                p.cronica_id = nueva.id;
            }
            mensaje('pe-feedback-cronica', 'Crónica guardada. Ya aparece en Noticias.' + avisoDemo(), 'ok');
            const feedback = $('pe-feedback-cronica').textContent;
            terminarEdicionCronica();
            mensaje('pe-feedback-cronica', feedback, 'ok');
            pintarCronicas();
        } catch (error) {
            mensaje('pe-feedback-cronica', error.message || 'No se ha podido guardar la crónica.', 'error');
        }
    }

    async function eliminarCronica(c) {
        if (!window.confirm(`¿Seguro que quieres eliminar la crónica "${c.titulo}"?`)) return;
        try {
            await enviar('delete', `/cronicas/${c.id}`);
            cronicas = cronicas.filter(x => x.id !== c.id);
            const p = partidos.find(x => x.id === c.partido.id);
            if (p) p.cronica_id = null;
            if (cronicaEnEdicion === c) terminarEdicionCronica();
            pintarCronicas(); pintarSelectorCronica();
            mensaje('pe-feedback', 'Crónica eliminada.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pe-feedback', error.message, 'error');
        }
    }

    // ==================================================================
    // Pestañas (patrón ARIA: flechas, Inicio y Fin)
    // ==================================================================
    function activarPestana(destino) {
        document.querySelectorAll('.pe-tab').forEach(b => {
            const esta = b.dataset.target === destino;
            b.classList.toggle('active', esta);
            b.setAttribute('aria-selected', String(esta));
            b.setAttribute('tabindex', esta ? '0' : '-1');
        });
        document.querySelectorAll('#pe-partidos, #pe-acta, #pe-cronicas').forEach(p => {
            const es = p.id === destino;
            p.classList.toggle('active', es);
            p.hidden = !es;
        });
    }

    function iniciarPestanas() {
        const botones = [...document.querySelectorAll('.pe-tab')];
        botones.forEach((b, i) => {
            b.addEventListener('click', () => activarPestana(b.dataset.target));
            b.addEventListener('keydown', (e) => {
                const teclas = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: botones.length - 1 };
                if (!(e.key in teclas)) return;
                e.preventDefault();
                const sig = botones[(teclas[e.key] + botones.length) % botones.length];
                activarPestana(sig.dataset.target); sig.focus();
            });
        });
        const hash = window.location.hash;
        activarPestana(hash === '#acta' ? 'pe-acta' : hash === '#cronicas' ? 'pe-cronicas' : 'pe-partidos');
    }

    // ==================================================================
    // Arranque
    // ==================================================================
    async function iniciar() {
        iniciarPestanas();
        $('pe-form-partido').addEventListener('submit', guardarPartido);
        $('pe-cancelar-partido').addEventListener('click', terminarEdicionPartido);
        $('pe-form-resultado').addEventListener('submit', guardarResultado);
        $('pe-cancelar-resultado').addEventListener('click', () => { $('pe-form-resultado').hidden = true; resultadoDe = null; });
        $('pe-form-acta').addEventListener('submit', guardarActa);
        $('pe-anadir-evento').addEventListener('click', () => { const f = crearFilaEvento(); f.minuto.focus(); actualizarMarcador(); });
        $('pe-acta-partido').addEventListener('change', (e) => cargarActa(e.target.value));
        $('pe-form-cronica').addEventListener('submit', guardarCronica);
        $('pe-cancelar-cronica').addEventListener('click', terminarEdicionCronica);
        $('pe-cr-texto').addEventListener('input', actualizarContador);
        actualizarContador();

        try {
            equipos = comoLista(await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos));
            if (!equipos.length) {
                $('pe-equipo').textContent = '';
                Api.mostrarError($('pe-mensajes'), new Api.ApiError(404, 'sin_equipo', 'No tienes ningún equipo asignado.'));
                return;
            }
            rellenarSelect($('pe-equipo'), equipos.map(e => ({ valor: e.id, texto: e.nombre })));
            equipo = equipos[0];
            $('pe-equipo').addEventListener('change', async (e) => {
                equipo = equipos.find(x => String(x.id) === e.target.value);
                partidoActa = null; $('pe-form-acta').hidden = true;
                try { await cargarEquipoElegido(); } catch (error) { Api.mostrarError($('pe-mensajes'), error); }
            });
            await cargarEquipoElegido();

            // Enlace directo desde equipo.html: panel-entrenador.html?partido=4#acta
            const directo = new URLSearchParams(window.location.search).get('partido');
            if (directo && /^\d+$/.test(directo) && window.location.hash === '#acta') await cargarActa(directo), pintarSelectorActa(directo);
        } catch (error) {
            Api.mostrarError($('pe-mensajes'), error);
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
