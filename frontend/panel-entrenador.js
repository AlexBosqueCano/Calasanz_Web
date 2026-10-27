/*
 * panel-entrenador.js — Panel del entrenador (panel-entrenador.html)
 * ====================================================================
 * Tres pestañas:
 *   1. Partidos  → crear/editar partidos de la liga del equipo (también entre rivales) y
 *                  registrar el resultado de los partidos entre rivales.
 *   2. Acta      → acta completa de un partido de NUESTRO equipo (alineación, árbitros,
 *                  eventos con minuto). El marcador y los minutos se calculan solos.
 *   3. Crónicas  → texto público sobre un partido jugado; aparece en Noticias.
 *   4. Lesiones  → lesiones activas del equipo (lesiones-ui.js, compartido con coordinación).
 *   5. Apuntes   → notas privadas sobre rivales o partidos (no las ve el coordinador).
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

    // Api.el() construye elementos del DOM de forma segura (usa textContent, nunca innerHTML),
    // así que ningún dato del servidor puede inyectar HTML en la página.
    const { el } = Api;
    // Atajo para document.getElementById: $('pe-local') == document.getElementById('pe-local').
    // Todos los ids de este panel empiezan por 'pe-' (panel entrenador) para no chocar con otros.
    const $ = (id) => document.getElementById(id);

    // Duración total (minutos) por categoría — misma tabla que docs/API_CONTRATO.md §3.
    // El servidor la manda en `partido.duracion`; esta tabla es solo el plan B.
    const DURACION = { 'Prebenjamín': 40, 'Benjamín': 50, 'Alevín': 60, 'Infantil': 70, 'Cadete': 80, 'Juvenil': 90 };

    // ------------------------------------------------------------------
    // Estado de la página
    // ------------------------------------------------------------------
    // Estas variables guardan lo que la página tiene 'en la cabeza'. Cada vez que cambian
    // se vuelve a pintar la parte de pantalla afectada (no hay framework: lo hacemos a mano).
    let equipos = [];          // equipos propios
    let equipo = null;         // equipo elegido
    let ligaEquipos = [];      // equipos de su liga (propios y rivales)
    let partidos = [];         // partidos de la liga
    let plantilla = [];        // jugadores del equipo elegido
    let cronicas = [];         // crónicas publicadas
    // Las variables *EnEdicion valen null cuando el formulario está en modo 'Nuevo'
    // y contienen el objeto cuando está en modo 'Editando'. Así un mismo formulario sirve para crear y editar.
    let partidoEnEdicion = null;   // partido que se está editando en el formulario de partidos (o null)
    let cronicaEnEdicion = null;   // crónica que se está editando (o null)
    let partidoActa = null;        // partido cuyo acta está abierta
    let resultadoDe = null;        // partido entre rivales cuyo resultado se está escribiendo
    let pestanas = null;
    let lesiones = null;           // pestaña Lesiones (lesiones-ui.js)
    let apuntes = [];              // apuntes privados del equipo
    let apunteEnEdicion = null;           // controlador de las pestañas (pestanas.js)
    // En modo demostración no hay servidor: las actas se guardan aquí (se pierden al recargar).
    const actasDemo = {};          // actas guardadas en memoria (solo modo demostración)
    // Contador para dar ids falsos a lo que creamos en demostración (el servidor real asigna los suyos).
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
    // Funciones pequeñas de ayuda para decidir cosas sobre un partido `p` (devuelven true/false):
    // yaLlego: ¿la fecha ya pasó (o es hoy)? Comparar textos AAAA-MM-DD funciona porque ordenan igual que las fechas.
    const yaLlego = (p) => p.fecha <= hoy();
    // esPropio: ¿alguno de los dos equipos es de nuestro club? (si no, es un partido entre rivales: solo resultado).
    const esPropio = (p) => !!((p.local && p.local.es_propio) || (p.visitante && p.visitante.es_propio));
    // esDelEquipo: ¿juega el equipo que hemos elegido en el desplegable? (!equipo = aún no hay ninguno elegido).
    const esDelEquipo = (p) => !equipo || p.local.id === equipo.id || p.visitante.id === equipo.id;
    // hayResultado: ¿ya tiene marcador? Se comprueba null/undefined porque un 0-0 es un resultado válido (0 es falsy).
    const hayResultado = (p) => p.resultado_local !== null && p.resultado_local !== undefined;

    /* "Jornada 7 · C.D. Calasanz 4-2 Marina Norte C.F." (o con "vs" si no se ha jugado). */
    function titulo(p) {
        const medio = hayResultado(p) ? ` ${p.resultado_local}-${p.resultado_visitante} ` : ' vs ';
        return `J${p.jornada} · ${p.local.nombre}${medio}${p.visitante.nombre}`;
    }

    // Funciones comunes de los paneles (panel-util.js)
    // Desestructuración: sacamos de PanelUtil (panel-util.js) las funciones que comparten todos los paneles:
    //   comoLista     → convierte la respuesta del servidor ({items:[...]} o [...]) en un array
    //   avisoDemo     → texto ' (modo demostración: no se ha guardado)' si no hay servidor, o '' si lo hay
    //   enviar        → hace POST/PUT/PATCH/DELETE (en demo no envía nada y devuelve null)
    //   mensaje/limpiar → pintan o borran el aviso verde/rojo bajo un formulario
    //   rellenarSelect→ rellena un <select> con opciones {valor, texto}
    //   textoError    → convierte un error de la API en un texto legible
    const { comoLista, avisoDemo, enviar, mensaje, limpiar: limpiarMensaje, rellenarSelect, textoError } = PanelUtil;

    // ------------------------------------------------------------------
    // Carga de datos
    // ------------------------------------------------------------------
    // Descarga los partidos de la liga del equipo elegido. Demo.obtener intenta el servidor y, si no
    // responde, usa los datos de ejemplo (Demo.partidosLiga). No recibe nada y no devuelve nada: deja el resultado en `partidos`.
    async function cargarPartidos() {
        const comp = equipo && equipo.competicion;
        const r = await Demo.obtener('/partidos', { competicion: comp, por_pagina: 100 }, Demo.partidosLiga);
        // En modo demostración los cambios hechos en memoria se conservan entre cargas
        // Solo sustituimos la lista si está vacía o si hay servidor: en demo conservaría los cambios hechos a mano.
        if (!partidos.length || !Sesion.enModoDemo()) partidos = comoLista(r);
        // Orden cronológico; si coincide la fecha, por id (localeCompare compara textos y devuelve <0, 0 o >0).
        partidos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    }

    // Se ejecuta al abrir la página y cada vez que se cambia de equipo en el desplegable:
    // recarga liga, plantilla, partidos, crónicas, lesiones y apuntes de ESE equipo y repinta todo.
    async function cargarEquipoElegido() {
        $('pe-liga').textContent = equipo.competicion ? `Liga: ${equipo.competicion}` : '';
        partidos = [];
        const comp = equipo.competicion;
        // Equipos de la misma competición: sirven para elegir local/visitante (incluye rivales).
        ligaEquipos = comoLista(await Demo.obtener('/equipos', { competicion: comp }, Demo.equiposLiga));
        // Plantilla = jugadores del equipo; se necesita para la alineación del acta.
        plantilla = comoLista(await Demo.obtener(`/equipos/${equipo.id}/plantilla`, null, Demo.plantilla));
        await cargarPartidos();
        pintarFormularioPartido();
        pintarTablaPartidos();
        pintarSelectorActa();
        pintarSelectorCronica();
        // Las demás pestañas se cargan después: si una falla, las anteriores ya están pintadas.
        await cargarCronicas();
        // Reiniciamos la pestaña Lesiones por si veníamos de otro equipo (cancela una edición abierta).
        lesiones.cancelar();
        await lesiones.cargar();
        // Los apuntes solo existen en el DOM si el rol puede verlos (ver iniciar()); por eso se comprueba el elemento.
        if ($('pe-apuntes')) { pintarSelectoresApunte(); await cargarApuntes(); }
    }

    // ==================================================================
    // PESTAÑA 1: PARTIDOS
    // ==================================================================
    // Rellena los dos desplegables del formulario de partido (local y visitante) con los equipos de la liga.
    // El local por defecto es nuestro equipo; el visitante, el primer equipo distinto.
    function pintarFormularioPartido() {
        const opciones = ligaEquipos.map(e => ({ valor: e.id, texto: e.nombre }));
        rellenarSelect($('pe-local'), opciones, equipo.id);
        // El visitante por defecto es el primer equipo distinto del local
        const otro = ligaEquipos.find(e => e.id !== equipo.id);
        rellenarSelect($('pe-visitante'), opciones, otro ? otro.id : undefined);
    }

    // Crea un botón de acción (Editar, Eliminar...) con su manejador de clic.
    // Recibe el texto del botón y la función `alPulsar` que se ejecutará al hacer clic; devuelve el <button>.
    // No usamos onclick en el HTML: el evento se añade desde JavaScript con addEventListener.
    function botonAccion(texto, alPulsar) {
        const b = el('button', { texto, clase: 'btn-outline boton-pequeno', atributos: { type: 'button' } });
        b.addEventListener('click', alPulsar);
        return b;
    }

    // Pinta la tabla de partidos de la liga. Para cada partido decide qué botones se ofrecen según las reglas:
    //   · Editar: siempre.
    //   · Partido NUESTRO ya jugado y de nuestro equipo → Registrar/Editar acta (acta extensa).
    //   · Partido ENTRE RIVALES ya jugado → Registrar/Corregir resultado (solo marcador, para la clasificación).
    //   · Eliminar: solo coordinador y desarrollador (el servidor lo vuelve a exigir).
    function pintarTablaPartidos() {
        // textContent = '' vacía el elemento sin usar innerHTML.
        const cuerpo = $('pe-tabla-partidos');
        cuerpo.textContent = '';
        if (!partidos.length) {
            // colspan=4: la fila de aviso ocupa las 4 columnas de la tabla.
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

    // Pasa el formulario a modo edición: rellena los campos con los datos del partido `p`
    // y enseña el botón Cancelar. Mover el foco al primer campo ayuda a quien usa teclado o lector de pantalla.
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

    // Sale del modo edición: vacía el formulario, restaura los desplegables y vuelve al texto 'Nuevo'.
    function terminarEdicionPartido() {
        partidoEnEdicion = null;
        $('pe-form-partido').reset();
        pintarFormularioPartido();
        $('pe-modo-partido').textContent = 'Nuevo';
        $('pe-cancelar-partido').hidden = true;
    }

    // El servidor exige `temporada_id` al crear un partido (docs/API_CONTRATO.md).
    /* Id de la temporada en curso: la de los partidos existentes o, si no hay, la última de la lista. */
    async function temporadaActual() {
        const conTemporada = partidos.find(p => p.temporada_id);
        if (conTemporada) return conTemporada.temporada_id;
        const lista = comoLista(await Api.get('/temporadas'));
        return lista.length ? lista[lista.length - 1].id : null;
    }

    // Manejador del envío del formulario de partidos: sirve para CREAR (POST) y para EDITAR (PATCH).
    // Primero valida en el cliente (comodidad para el usuario) y luego envía; el servidor valida otra vez
    // porque nunca hay que fiarse de lo que llega del navegador.
    async function guardarPartido(evento) {
        // preventDefault evita que el navegador recargue la página al enviar el formulario.
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

        // Buscamos los objetos de equipo completos para pintar los nombres sin volver a pedirlos al servidor.
        const local = ligaEquipos.find(e => e.id === localId), visitante = ligaEquipos.find(e => e.id === visitanteId);
        try {
            // MODO EDICIÓN: PATCH solo con los campos que cambian; después actualizamos el objeto local con Object.assign.
            if (partidoEnEdicion) {
                const p = partidoEnEdicion;
                await enviar('patch', `/partidos/${p.id}`, { jornada, fecha, local_id: localId, visitante_id: visitanteId, lugar: lugar || null });
                Object.assign(p, { jornada, fecha, lugar: lugar || null, local: { ...local, es_propio: !!local.es_propio }, visitante: { ...visitante, es_propio: !!visitante.es_propio } });
            // MODO CREACIÓN: POST. `enviar` devuelve el partido creado (servidor) o null (demo); en demo lo montamos nosotros.
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
            // Éxito: avisamos, salimos del modo edición y refrescamos listas y tablas que dependen de los partidos.
            mensaje('pe-feedback-partido', 'Partido guardado.' + avisoDemo(), 'ok');
            terminarEdicionPartido();
            if (!Sesion.enModoDemo()) await cargarPartidos();
            partidos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
            pintarTablaPartidos(); pintarSelectorActa(); pintarSelectorCronica();
        // Cualquier error de la API (permisos, validación...) llega aquí y se muestra bajo el formulario.
        } catch (error) {
            mensaje('pe-feedback-partido', error.message || 'No se ha podido guardar el partido.', 'error');
        }
    }

    // Borra un partido (solo coordinador/desarrollador ven el botón). El servidor borra también su acta.
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
    // Estos partidos NO llevan acta: solo se guardan los dos marcadores, que alimentan la clasificación de la liga.
    // --- Resultado de un partido entre rivales ---
    // Muestra el pequeño formulario de resultado con los datos del partido elegido.
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

    // Valida (enteros 0-99) y guarda el resultado con PUT; el servidor recalcula la clasificación.
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
    // ACTA: la parte más compleja. Los EVENTOS (goles, tarjetas, sustituciones) son la FUENTE ÚNICA de verdad:
    // el marcador, los goles recibidos y los minutos jugados se CALCULAN a partir de ellos (ver acta-util.js);
    // por eso nunca se teclea el marcador a mano y no puede haber incoherencias.
    // Cada fila de evento guarda sus controles aquí para poder leerlos y repintarlos
    let filasEvento = [];

    // Partidos que admiten acta: nuestros, del equipo elegido y ya jugados.
    function partidosParaActa() { return partidos.filter(p => esPropio(p) && esDelEquipo(p) && yaLlego(p)); }

    // Rellena el desplegable de partidos con acta posible; marca los que ya la tienen o están pendientes.
    function pintarSelectorActa(seleccion) {
        const lista = partidosParaActa();
        const sel = $('pe-acta-partido');
        rellenarSelect(sel, [{ valor: '', texto: lista.length ? 'Elige un partido…' : 'No hay partidos jugados pendientes de acta' }]
            .concat(lista.map(p => ({ valor: p.id, texto: titulo(p) + (p.estado === 'finalizado' ? ' (con acta)' : ' (pendiente)') }))),
            seleccion || (partidoActa ? partidoActa.id : ''));
    }

    /* Opciones de "jugador" para los eventos: solo los convocados (titulares y suplentes). */
    // Convocados = jugadores de la plantilla cuyo desplegable de convocatoria no está en 'No convocado'.
    // Solo ellos pueden aparecer en goles, tarjetas o sustituciones.
    function convocados() {
        return plantilla.filter(j => {
            const s = $('pe-conv-' + j.id);
            return s && s.value !== '';
        });
    }
    // Texto de un jugador en los desplegables: 'dorsal nombre apellido' (?? '-' si no tiene dorsal).
    const etiquetaJugador = (j) => `${j.dorsal ?? '-'} ${j.nombre} ${j.ap1}`;

    // Lee la alineación de la pantalla con el formato del contrato: [{jugador_id, estado, posicion}].
    function leerAlineacion() {
        return convocados().map(j => ({ jugador_id: j.id, estado: $('pe-conv-' + j.id).value, posicion: j.posicion }));
    }

    // Pinta una fila por jugador de la plantilla con su desplegable (No convocado / Titular / Suplente).
    // Si hay un acta guardada (`acta`), preselecciona lo que se eligió entonces.
    function pintarAlineacion(acta) {
        const cuerpo = $('pe-alineacion');
        cuerpo.textContent = '';
        const previa = {};
        if (acta) acta.alineacion.forEach(a => { previa[a.jugador_id] = a.estado; });
        // slice() copia el array para no reordenar la plantilla original; ordenamos por dorsal.
        plantilla.slice().sort((a, b) => (a.dorsal || 0) - (b.dorsal || 0)).forEach(j => {
            // aria-label: los lectores de pantalla necesitan saber de qué jugador es cada desplegable.
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

    // Al cambiar la convocatoria hay que actualizar las opciones de los eventos y el marcador.
    function alCambiarAlineacion() { refrescarJugadoresEventos(); actualizarMarcador(); }

    /* Vuelve a rellenar los desplegables de jugador de cada evento sin perder lo que estaba elegido. */
    // Mantiene coherentes los desplegables de jugador de las filas de evento con los convocados actuales.
    function refrescarJugadoresEventos() {
        const opciones = convocados().map(j => ({ valor: j.id, texto: etiquetaJugador(j) }));
        filasEvento.forEach(f => {
            [[f.jugador, false], [f.asistente, true], [f.sale, false], [f.entra, false]].forEach(([sel, opcional]) => {
                // Guardamos lo elegido (`actual`) y solo lo restauramos si ese jugador sigue convocado.
                const actual = sel.value;
                const todas = (opcional ? [{ valor: '', texto: 'Sin asistente' }] : [{ valor: '', texto: 'Elige jugador…' }]).concat(opciones);
                rellenarSelect(sel, todas, todas.some(o => String(o.valor) === actual) ? actual : '');
            });
        });
    }

    // Cada tipo de evento necesita campos distintos: gol → jugador+asistente; tarjeta → jugador+color;
    // gol del rival → autor opcional; sustitución → quién sale y quién entra. El resto se oculta con `hidden`.
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
    // Contador para generar ids únicos de campo (pe-ev-1, pe-ev-2...) y poder enlazar label con su control.
    let contadorCampos = 0;
    function campo(textoEtiqueta, control) {
        const id = 'pe-ev-' + (++contadorCampos);
        control.id = id;
        return el('div', { clase: 'field-group pe-evento-campo', hijos: [el('label', { texto: textoEtiqueta, atributos: { for: id } }), control] });
    }

    // Crea una fila de evento (tipo, minuto, jugador...) y la añade a la pantalla.
    // `ev` (opcional) es un evento ya guardado cuyos valores se rellenan al editar un acta existente.
    // Devuelve el objeto `f` con todos los controles de la fila para poder leerlos después.
    function crearFilaEvento(ev) {
        const f = {};
        // Creamos todos los controles; luego se muestran u ocultan según el tipo elegido.
        f.tipo = el('select');
        rellenarSelect(f.tipo, [{ valor: 'gol', texto: 'Gol nuestro' }, { valor: 'gol_rival', texto: 'Gol del rival' },
                                { valor: 'tarjeta', texto: 'Tarjeta' }, { valor: 'sustitucion', texto: 'Sustitución' }], ev ? ev.tipo : 'gol');
        f.minuto = el('input', { clase: 'clean-input', atributos: { type: 'number', min: '0', max: '120', inputmode: 'numeric' } });
        f.jugador = el('select'); f.asistente = el('select'); f.sale = el('select'); f.entra = el('select');
        f.color = el('select');
        rellenarSelect(f.color, [{ valor: 'amarilla', texto: 'Amarilla' }, { valor: 'roja', texto: 'Roja' }], 'amarilla');
        f.autor = el('input', { clase: 'clean-input', atributos: { type: 'text', maxlength: '100', autocomplete: 'off' } });

        // Cada campo va envuelto con su <label> asociada (accesibilidad).
        f.grupoTipo = campo('Evento', f.tipo);
        f.grupoMinuto = campo('Minuto', f.minuto);
        f.grupoJugador = campo('Jugador', f.jugador);
        f.grupoAsistente = campo('Asistente', f.asistente);
        f.grupoColor = campo('Tarjeta', f.color);
        f.grupoAutor = campo('Autor (opcional)', f.autor);
        f.grupoSale = campo('Sale', f.sale);
        f.grupoEntra = campo('Entra', f.entra);

        // Botón para quitar la fila completa.
        const quitar = el('button', { texto: 'Quitar', clase: 'btn-outline boton-pequeno', atributos: { type: 'button' } });
        f.fila = el('div', { clase: 'pe-evento', atributos: { role: 'group' }, hijos: [
            f.grupoTipo, f.grupoMinuto, f.grupoJugador, f.grupoAsistente, f.grupoColor, f.grupoAutor, f.grupoSale, f.grupoEntra, quitar
        ]});

        // Cualquier cambio en la fila recalcula el marcador en directo.
        f.tipo.addEventListener('change', () => { ajustarCamposEvento(f); actualizarMarcador(); });
        [f.jugador, f.asistente, f.sale, f.entra, f.color, f.minuto, f.autor].forEach(c => c.addEventListener('change', actualizarMarcador));
        // Quitar: sacamos la fila del array y del DOM, renumeramos y devolvemos el foco al botón 'Añadir evento'.
        quitar.addEventListener('click', () => {
            filasEvento = filasEvento.filter(x => x !== f);
            f.fila.remove(); numerarEventos(); actualizarMarcador();
            $('pe-anadir-evento').focus();
        });

        // Registramos la fila en el array `filasEvento` y la mostramos.
        filasEvento.push(f);
        $('pe-eventos').appendChild(f.fila);
        refrescarJugadoresEventos();
        // Si venimos de un acta guardada, rellenamos los valores del evento (el evento solo trae ids).
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

    // Pone aria-label 'Evento 1', 'Evento 2'... a cada fila para que un lector de pantalla las distinga.
    function numerarEventos() {
        filasEvento.forEach((f, i) => f.fila.setAttribute('aria-label', `Evento ${i + 1}`));
    }

    // Lee los eventos de pantalla. Solo se incluyen los campos de cada tipo (p. ej. una tarjeta no lleva asistente).
    // Un minuto vacío se convierte en NaN a propósito: la validación posterior lo detecta como error.
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

    // Duración total del partido en minutos: la que manda el servidor, si no la de la categoría, si no 90.
    function duracionDelPartido() {
        return (partidoActa && partidoActa.duracion) || (equipo && equipo.categoria && DURACION[equipo.categoria.nombre]) || 90;
    }

    // Recalcula el marcador a partir de los eventos (ActaUtil.marcador replica las reglas del servidor).
    // Devuelve {propio, rival}; hay que colocarlos como local/visitante según quién juegue en casa.
    /* Marcador en directo, calculado a partir de los eventos. */
    function actualizarMarcador() {
        if (!partidoActa) return;
        const m = ActaUtil.marcador(leerEventos());
        const p = partidoActa;
        // Desestructuración con array: si jugamos de local, local=propio y visitante=rival; si no, al revés.
        const [gl, gv] = p.local.es_propio ? [m.propio, m.rival] : [m.rival, m.propio];
        $('pe-acta-marcador').textContent = `${p.local.nombre} ${gl} - ${gv} ${p.visitante.nombre}`;
    }

    // Abre la pestaña Acta con el partido elegido (se usa desde el botón 'Registrar acta' de la tabla).
    async function abrirActa(id) {
        pestanas.activar('pe-acta');
        pintarSelectorActa(id);
        await cargarActa(id);
    }

    // Carga el partido y su acta (si existe) y rellena todo el formulario.
    // Si `id` está vacío se oculta el formulario.
    async function cargarActa(id) {
        const form = $('pe-form-acta');
        limpiarMensaje('pe-feedback-acta'); $('pe-errores-acta').hidden = true;
        if (!id) { form.hidden = true; partidoActa = null; $('pe-acta-estado').textContent = ''; return; }
        try {
            // Demo.obtener: intenta GET al servidor y, si no hay, usa datos de ejemplo.
            const p = await Demo.obtener(`/partidos/${id}`, null, () => Demo.partido(id));
            // En modo demostración, si hay un acta guardada en memoria, tiene preferencia
            const base = partidos.find(x => String(x.id) === String(id)) || p;
            partidoActa = { ...base, ...p, local: base.local, visitante: base.visitante };
            if (actasDemo[id]) partidoActa.acta = actasDemo[id];
            const acta = partidoActa.acta;

            $('pe-acta-estado').textContent = acta ? 'Acta ya registrada: se reemplazará' : 'Sin acta todavía';
            // Árbitros y cuerpo técnico pueden no existir aún: usamos objetos vacíos para no fallar al leer.
            const arb = (acta && acta.arbitros) || {}, ct = (acta && acta.cuerpo_tecnico) || {};
            $('pe-arb-principal').value = arb.principal || '';
            $('pe-arb-as1').value = (arb.asistentes || [])[0] || '';
            $('pe-arb-as2').value = (arb.asistentes || [])[1] || '';
            $('pe-del-campo').value = ct.delegado_campo || '';
            $('pe-del-equipo').value = ct.delegado_equipo || '';

            pintarAlineacion(acta);
            filasEvento = []; $('pe-eventos').textContent = '';
            // Los eventos se pintan ordenados por minuto (ActaUtil.ordenar).
            if (acta) ActaUtil.ordenar(acta.eventos).forEach(crearFilaEvento);
            form.hidden = false;
            actualizarMarcador();
        } catch (error) {
            form.hidden = true;
            mensaje('pe-feedback', error.message, 'error');
        }
    }

    // Guarda el acta completa con PUT (reemplaza la anterior). Pasos: validar → calcular marcador → enviar → actualizar pantalla.
    async function guardarActa(evento) {
        evento.preventDefault();
        limpiarMensaje('pe-feedback-acta');
        const cajaErrores = $('pe-errores-acta');
        const p = partidoActa;
        if (!p) return;

        const alineacion = leerAlineacion(), eventos = leerEventos();
        // ActaUtil.validar devuelve una lista de textos de error (minutos fuera de rango, sustituciones imposibles, etc.).
        const errores = ActaUtil.validar(alineacion, eventos, duracionDelPartido());
        if (!alineacion.some(a => a.estado === 'titular')) errores.unshift('Marca al menos un jugador como titular.');
        // El marcador sale de los eventos, así que coincide siempre; solo avisamos si falta algún dato obligatorio
        if (errores.length) {
            // Mostramos los errores en una lista y lo anunciamos con Api.anunciar (región aria-live para lectores de pantalla).
            cajaErrores.textContent = '';
            cajaErrores.appendChild(el('p', { texto: 'Revisa estos puntos antes de guardar:' }));
            cajaErrores.appendChild(el('ul', { hijos: errores.map(e => el('li', { texto: e })) }));
            cajaErrores.hidden = false;
            Api.anunciar('Hay errores en el acta.', true);
            return;
        }
        cajaErrores.hidden = true;

        // El marcador enviado se calcula de los eventos, no se teclea: así siempre es coherente con el acta.
        const m = ActaUtil.marcador(eventos);
        const [rl, rv] = p.local.es_propio ? [m.propio, m.rival] : [m.rival, m.propio];
        const v = (id) => $(id).value.trim();
        const asistentes = [v('pe-arb-as1'), v('pe-arb-as2')].filter(Boolean);
        // Cuerpo con el formato exacto de docs/API_CONTRATO.md. Los eventos solo llevan ids; los nombres los pone el servidor.
        const cuerpo = {
            resultado_local: rl, resultado_visitante: rv,
            arbitros: { principal: v('pe-arb-principal'), asistentes },
            cuerpo_tecnico: { delegado_campo: v('pe-del-campo'), delegado_equipo: v('pe-del-equipo') },
            alineacion: alineacion.map(a => ({ jugador_id: a.jugador_id, estado: a.estado })),
            eventos
        };
        try {
            await enviar('put', `/partidos/${p.id}/acta`, cuerpo);
            // Actualizamos la tabla local para que el partido pase a 'finalizado' sin recargar.
            // Actualizamos lo que se ve en pantalla
            const enLista = partidos.find(x => x.id === p.id);
            if (enLista) Object.assign(enLista, { resultado_local: rl, resultado_visitante: rv, estado: 'finalizado' });
            // Solo en demostración: guardamos el acta en memoria incluyendo nombre y dorsal, como la devolvería el servidor.
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

    // CRÓNICAS: texto público sobre un partido jugado. Aparece en la página Noticias.
    // Un partido solo puede tener una crónica (p.cronica_id).
    // ==================================================================
    // PESTAÑA 3: CRÓNICAS
    // ==================================================================
    /* Partidos propios, jugados y sin crónica (más el de la crónica que se está editando). */
    // Partidos que pueden recibir crónica: propios, finalizados y sin crónica (más el de la crónica en edición).
    function partidosParaCronica() {
        return partidos.filter(p => esPropio(p) && esDelEquipo(p) && p.estado === 'finalizado' &&
            (!p.cronica_id || (cronicaEnEdicion && p.id === cronicaEnEdicion.partido.id)));
    }

    // Rellena el desplegable de partidos para crónica. Al editar se bloquea (disabled) porque el partido no cambia.
    function pintarSelectorCronica() {
        const lista = partidosParaCronica();
        const sel = $('pe-cr-partido');
        rellenarSelect(sel, lista.length ? lista.map(p => ({ valor: p.id, texto: titulo(p) })) : [{ valor: '', texto: 'No hay partidos jugados sin crónica' }],
            cronicaEnEdicion ? cronicaEnEdicion.partido.id : undefined);
        sel.disabled = !!cronicaEnEdicion;   // el partido de una crónica no se cambia
    }

    // Descarga las crónicas del equipo y las pinta.
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

    // Regla de permisos de la interfaz: ¿puede el usuario editar/borrar esta crónica?
    // (El servidor lo comprueba otra vez: esto solo decide si se muestran los botones.)
    function puedeEditarCronica(c) {
        const u = Sesion.actual();
        // El entrenador solo toca las suyas; coordinador y desarrollador, todas. En demostración se permite.
        return Sesion.enModoDemo() || Sesion.tieneRol('COORDINADOR', 'DESARROLLADOR') || (u && c.autor && c.autor.username === u.username);
    }

    // Pinta las tarjetas de crónica con el mismo estilo que en Noticias (news-card).
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

    // Contador de caracteres del texto de la crónica (50-3000) para guiar al usuario mientras escribe.
    function actualizarContador() {
        const n = $('pe-cr-texto').value.length;
        $('pe-cr-contador').textContent = `${n} / 3000 caracteres (mínimo 50)`;
    }

    // Pasa el formulario de crónica a modo edición con los datos de `c`.
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

    // Vuelve el formulario de crónica a modo 'Nueva' y lo limpia.
    function terminarEdicionCronica() {
        cronicaEnEdicion = null;
        $('pe-form-cronica').reset();
        $('pe-modo-cronica').textContent = 'Nueva';
        $('pe-cancelar-cronica').hidden = true;
        pintarSelectorCronica(); actualizarContador();
    }

    // Guarda la crónica: PATCH si se está editando, POST si es nueva. Valida longitudes (título 3-120, texto 50-3000).
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
            // terminarEdicionCronica borra los mensajes; guardamos el aviso de éxito y lo volvemos a mostrar después.
            mensaje('pe-feedback-cronica', 'Crónica guardada. Ya aparece en Noticias.' + avisoDemo(), 'ok');
            const feedback = $('pe-feedback-cronica').textContent;
            terminarEdicionCronica();
            mensaje('pe-feedback-cronica', feedback, 'ok');
            pintarCronicas();
        } catch (error) {
            mensaje('pe-feedback-cronica', error.message || 'No se ha podido guardar la crónica.', 'error');
        }
    }

    // Elimina una crónica (con confirmación) y libera el partido para que pueda tener otra.
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
    // PESTAÑA: APUNTES (privados del entrenador)
    // ==================================================================
    // Notas sobre un rival o un partido. No son públicas: solo las ve el entrenador del equipo.
    // Rellena los desplegables opcionales del apunte: rival y partido al que se refiere.
    function pintarSelectoresApunte() {
        const rivales = ligaEquipos.filter(e => !e.es_propio);
        rellenarSelect($('pe-ap-rival'), [{ valor: '', texto: 'Sin rival concreto' }].concat(rivales.map(r => ({ valor: r.id, texto: r.nombre }))));
        rellenarSelect($('pe-ap-partido'), [{ valor: '', texto: 'Sin partido concreto' }].concat(partidos.filter(esDelEquipo).map(p => ({ valor: p.id, texto: titulo(p) }))));
    }

    // Descarga los apuntes privados del equipo (el servidor solo los entrega al entrenador de ese equipo).
    async function cargarApuntes() {
        try {
            apuntes = comoLista(await Demo.obtener(`/equipos/${equipo.id}/apuntes`, null, Demo.apuntes));
            pintarApuntes();
        } catch (error) {
            Api.mostrarError($('pe-lista-apuntes'), error);
        }
    }

    // Pinta cada apunte indicando a qué rival o partido se refiere ('Nota general' si a ninguno).
    function pintarApuntes() {
        const caja = $('pe-lista-apuntes');
        caja.textContent = '';
        if (!apuntes.length) { caja.appendChild(el('p', { texto: 'Todavía no has escrito apuntes.', clase: 'texto-vacio' })); return; }
        apuntes.forEach(a => {
            const rival = a.rival_id && ligaEquipos.find(e => e.id === a.rival_id);
            const partido = a.partido_id && partidos.find(p => p.id === a.partido_id);
            const sobre = [rival ? `Rival: ${rival.nombre}` : null, partido ? titulo(partido) : null].filter(Boolean).join(' · ') || 'Nota general';
            caja.appendChild(el('article', { clase: 'news-card', hijos: [
                el('div', { clase: 'news-card-meta', hijos: [el('span', { texto: 'APUNTE PRIVADO' }), el('span', { texto: Api.formatearFecha(a.creado_en) })] }),
                el('p', { texto: sobre, clase: 'acta-etiqueta' }),
                el('p', { texto: a.texto, clase: 'news-card-texto' }),
                el('div', { clase: 'fila-botones', hijos: [
                    PanelUtil.boton('Editar', 'Editar apunte', () => empezarEdicionApunte(a)),
                    PanelUtil.boton('Eliminar', 'Eliminar apunte', () => eliminarApunte(a), true)
                ]})
            ]}));
        });
    }

    // Modo edición del apunte: rival y partido quedan bloqueados, solo se cambia el texto.
    function empezarEdicionApunte(a) {
        apunteEnEdicion = a;
        $('pe-ap-rival').value = a.rival_id ? String(a.rival_id) : '';
        $('pe-ap-partido').value = a.partido_id ? String(a.partido_id) : '';
        $('pe-ap-rival').disabled = true; $('pe-ap-partido').disabled = true;   // solo se edita el texto
        $('pe-ap-texto').value = a.texto;
        $('pe-modo-apunte').textContent = 'Editando';
        $('pe-cancelar-apunte').hidden = false;
        $('pe-ap-texto').focus();
    }

    // Vuelve el formulario de apuntes al modo 'Nuevo'.
    function terminarEdicionApunte() {
        apunteEnEdicion = null;
        $('pe-form-apunte').reset();
        $('pe-ap-rival').disabled = false; $('pe-ap-partido').disabled = false;
        $('pe-modo-apunte').textContent = 'Nuevo';
        $('pe-cancelar-apunte').hidden = true;
    }

    // Guarda un apunte (1-2000 caracteres): PATCH si se edita, POST si es nuevo.
    async function guardarApunte(evento) {
        evento.preventDefault();
        limpiarMensaje('pe-feedback-apunte');
        const texto = $('pe-ap-texto').value.trim();
        if (texto.length < 1 || texto.length > 2000) return mensaje('pe-feedback-apunte', 'El apunte debe tener entre 1 y 2000 caracteres.', 'error');
        try {
            if (apunteEnEdicion) {
                await enviar('patch', `/apuntes/${apunteEnEdicion.id}`, { texto });
                apunteEnEdicion.texto = texto;
            } else {
                const cuerpo = { equipo_id: equipo.id, texto };
                if ($('pe-ap-rival').value) cuerpo.rival_id = Number($('pe-ap-rival').value);
                if ($('pe-ap-partido').value) cuerpo.partido_id = Number($('pe-ap-partido').value);
                const creado = await enviar('post', '/apuntes', cuerpo);
                apuntes.unshift(creado || { id: siguienteIdDemo++, ...cuerpo, creado_en: new Date().toISOString() });
            }
            terminarEdicionApunte();
            pintarApuntes();
            mensaje('pe-feedback-apunte', 'Apunte guardado.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pe-feedback-apunte', textoError(error), 'error');
        }
    }

    // Elimina un apunte previa confirmación.
    async function eliminarApunte(a) {
        if (!window.confirm('¿Seguro que quieres eliminar este apunte?')) return;
        try {
            await enviar('delete', `/apuntes/${a.id}`);
            apuntes = apuntes.filter(x => x.id !== a.id);
            if (apunteEnEdicion === a) terminarEdicionApunte();
            pintarApuntes();
            mensaje('pe-feedback-apunte', 'Apunte eliminado.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pe-feedback-apunte', textoError(error), 'error');
        }
    }

    // Conecta los eventos del formulario de apuntes (solo si el rol puede verlos).
    function iniciarApuntes() {
        $('pe-form-apunte').addEventListener('submit', guardarApunte);
        $('pe-cancelar-apunte').addEventListener('click', terminarEdicionApunte);
    }


    // ==================================================================
    // Arranque
    // ==================================================================
    // Punto de entrada: monta pestañas, enlaza los eventos de todos los formularios y carga los datos.
    // Se llama cuando layout.js avisa con el evento 'layout:listo' (ya hay cabecera y sesión comprobada).
    async function iniciar() {
        // Los apuntes son privados del entrenador (y del desarrollador): al coordinador no se le enseñan
        const verApuntes = Sesion.tieneRol('ENTRENADOR', 'DESARROLLADOR');
        // Quitamos del DOM la pestaña de apuntes si el rol no puede verla (no basta con ocultarla).
        if (!verApuntes) { $('pe-tab-apuntes').remove(); $('pe-apuntes').remove(); }
        // Pestanas (pestanas.js) gestiona las pestañas ARIA: flechas de teclado, enlaces con #hash, etc.
        const paneles = ['pe-partidos', 'pe-acta', 'pe-cronicas', 'pe-lesiones'].concat(verApuntes ? ['pe-apuntes'] : []);
        pestanas = Pestanas.iniciar({ botones: '.pe-tab', paneles,
            porHash: { '#acta': 'pe-acta', '#cronicas': 'pe-cronicas', '#lesiones': 'pe-lesiones', '#apuntes': 'pe-apuntes' }, inicial: 'pe-partidos' });
        // El entrenador registra y edita lesiones, pero no las borra (solo coordinador y desarrollador)
        lesiones = Lesiones.iniciar({ prefijo: 'pe', equipoId: () => equipo.id, puedeBorrar: false });
        if (verApuntes) iniciarApuntes();
        // Enlazamos cada formulario con su manejador (no hay onclick/onsubmit en el HTML).
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

        // Carga inicial: primero los equipos propios y luego todo lo del equipo elegido.
        try {
            equipos = comoLista(await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos));
            // Un entrenador solo trabaja con SU equipo (el servidor también lo exige); coordinador y desarrollador, con todos
            const yo = Sesion.actual();
            if (yo && yo.rol === 'ENTRENADOR' && yo.equipo_id) equipos = equipos.filter(e => e.id === yo.equipo_id);
            if (!equipos.length) {
                $('pe-equipo').textContent = '';
                Api.mostrarError($('pe-mensajes'), new Api.ApiError(404, 'sin_equipo', 'No tienes ningún equipo asignado.'));
                return;
            }
            rellenarSelect($('pe-equipo'), equipos.map(e => ({ valor: e.id, texto: e.nombre })));
            equipo = equipos[0];
            // Si el usuario cambia de equipo, reiniciamos el acta abierta y recargamos los datos.
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

    // layout:listo lo lanza layout.js cuando la cabecera y la sesión están listas: ahí arrancamos.
    document.addEventListener('layout:listo', iniciar);
})();
