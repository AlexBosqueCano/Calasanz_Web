/*
 * panel-coordinador.js — Panel de coordinación (panel-coordinador.html)
 * ======================================================================
 * Cuatro pestañas (la de lesiones vive en lesiones-ui.js, compartida con el entrenador):
 *   1. Solicitudes       → aprobar o rechazar peticiones de acceso (jugador / entrenador).
 *   2. Jugadores         → alta, edición y baja (lógica) de jugadores de cada plantilla.
 *   3. Noticias y eventos→ crear, editar y borrar publicaciones.
 *   4. Lesiones          → registrar lesiones (sin diagnóstico), editarlas, darlas de alta o borrarlas.
 * Acceso: COORDINADOR y DESARROLLADOR (lo exige <body data-roles="...">). El servidor vuelve a comprobarlo.
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET /api/solicitudes?estado=pendiente · PATCH /api/solicitudes/{id} { estado, comentario? }
 *   GET /api/equipos?propios=true · GET /api/equipos/{id}/plantilla
 *   POST /api/jugadores · PATCH /api/jugadores/{id} · DELETE /api/jugadores/{id} (baja lógica)
 *   GET /api/noticias · POST /api/noticias · PATCH/DELETE /api/noticias/{id}
 *   GET /api/lesiones?equipo=&activa=true · POST /api/lesiones · PATCH/DELETE /api/lesiones/{id}
 *
 * MODO DEMOSTRACIÓN: si el servidor no responde, todo se guarda SOLO en memoria y se avisa.
 * SEGURIDAD: nada de innerHTML con datos; todo con Api.el() / textContent; sin onclick en el HTML.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;
    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------
    let equipos = [];
    let solicitudes = [];
    let jugadores = [];          // plantilla del equipo elegido en la pestaña Jugadores
    let jugadorEnEdicion = null;
    let noticias = [];
    let noticiaEnEdicion = null;
    let lesiones = null;         // pestaña Lesiones (lesiones-ui.js)
    let solicitudARechazar = null;
    let pestanas = null;

    // ------------------------------------------------------------------
    // Utilidades (compartidas con los demás paneles: panel-util.js)
    // ------------------------------------------------------------------
    const { comoLista, avisoDemo, enviar, mensaje, limpiar, textoError, rellenarSelect, boton, filaVacia } = PanelUtil;

    // ==================================================================
    // PESTAÑA 1: SOLICITUDES
    // ==================================================================
    const ROL_TEXTO = { JUGADOR: 'Jugador', ENTRENADOR: 'Entrenador' };

    async function cargarSolicitudes() {
        try {
            const r = await Demo.obtener('/solicitudes', { estado: 'pendiente' }, Demo.solicitudes);
            solicitudes = comoLista(r);
            pintarSolicitudes();
        } catch (error) {
            Api.mostrarError($('pc-mensajes'), error);
        }
    }

    /* "Jugador: Daniel Orbe Santos" / "Entrenador: Cadete A" (el servidor manda los nombres; si no, el id). */
    function textoSolicitud(s) {
        const rol = ROL_TEXTO[s.rol_solicitado] || s.rol_solicitado;
        let vinculo = '';
        if (s.rol_solicitado === 'JUGADOR') vinculo = s.jugador ? s.jugador.nombre_completo : (s.jugador_id ? `jugador n.º ${s.jugador_id}` : '');
        else vinculo = s.equipo ? s.equipo.nombre : (s.equipo_id ? `equipo n.º ${s.equipo_id}` : '');
        return vinculo ? `${rol}: ${vinculo}` : rol;
    }

    function pintarSolicitudes() {
        const cuerpo = $('pc-tabla-solicitudes');
        cuerpo.textContent = '';
        if (!solicitudes.length) { filaVacia(cuerpo, 'No hay solicitudes pendientes.', 5); return; }
        solicitudes.forEach(s => {
            const usuario = s.usuario ? s.usuario.username : `Usuario n.º ${s.usuario_id}`;
            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: usuario })] }),
                el('td', { texto: textoSolicitud(s) }),
                el('td', { texto: s.mensaje || '' }),
                el('td', { texto: Api.formatearFecha(s.creada_en) }),
                el('td', { clase: 'celda-acciones', hijos: [
                    boton('Aprobar', `Aprobar la solicitud de ${usuario}`, () => aprobar(s, usuario)),
                    boton('Rechazar', `Rechazar la solicitud de ${usuario}`, () => abrirRechazo(s, usuario), true)
                ]})
            ]}));
        });
    }

    async function resolver(s, cuerpo, textoOk) {
        try {
            await enviar('patch', `/solicitudes/${s.id}`, cuerpo);
            solicitudes = solicitudes.filter(x => x.id !== s.id);
            pintarSolicitudes();
            mensaje('pc-feedback', textoOk + avisoDemo(), 'ok');
        } catch (error) {
            // 409 = otra persona ya la resolvió; recargamos para ver el estado real
            mensaje('pc-feedback', textoError(error), 'error');
            if (error.status === 409) cargarSolicitudes();
        }
    }

    async function aprobar(s, usuario) {
        if (!window.confirm(`¿Aprobar la solicitud de ${usuario} (${textoSolicitud(s)})? Se le cambiará el rol.`)) return;
        await resolver(s, { estado: 'aprobada' }, `Solicitud de ${usuario} aprobada.`);
    }

    function abrirRechazo(s, usuario) {
        solicitudARechazar = s;
        $('pc-rechazo-titulo').textContent = `Rechazar la solicitud de ${usuario}`;
        $('pc-rechazo-motivo').value = '';
        $('pc-form-rechazo').hidden = false;
        $('pc-rechazo-motivo').focus();
    }

    async function rechazar(evento) {
        evento.preventDefault();
        const motivo = $('pc-rechazo-motivo').value.trim();
        if (!solicitudARechazar) return;
        if (!motivo) return mensaje('pc-feedback', 'Escribe el motivo del rechazo.', 'error');
        const s = solicitudARechazar;
        $('pc-form-rechazo').hidden = true; solicitudARechazar = null;
        await resolver(s, { estado: 'rechazada', comentario: motivo }, 'Solicitud rechazada.');
    }

    // ==================================================================
    // PESTAÑA 2: JUGADORES
    // ==================================================================
    function pintarJugadores() {
        const cuerpo = $('pc-tabla-jugadores');
        cuerpo.textContent = '';
        if (!jugadores.length) { filaVacia(cuerpo, 'Este equipo no tiene jugadores todavía.', 4); return; }
        jugadores.slice().sort((a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999)).forEach(j => {
            const nombre = nombreCompleto(j);
            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: j.dorsal ? '#' + j.dorsal : '—' })] }),
                el('td', { texto: nombre }),
                el('td', { texto: j.posicion || '' }),
                el('td', { clase: 'celda-acciones', hijos: [
                    boton('Editar', 'Editar a ' + nombre, () => empezarEdicionJugador(j)),
                    boton('Eliminar', 'Eliminar a ' + nombre, () => eliminarJugador(j), true)
                ]})
            ]}));
        });
    }

    async function cargarJugadores() {
        try {
            jugadores = comoLista(await Demo.obtener(`/equipos/${$('pc-j-equipo').value}/plantilla`, null, Demo.plantilla));
        } catch (error) {
            jugadores = [];
            mensaje('pc-feedback-jugador', textoError(error), 'error');
        }
        pintarJugadores();
    }

    function empezarEdicionJugador(j) {
        jugadorEnEdicion = j;
        $('pc-j-nombre').value = j.nombre || '';
        $('pc-j-ap1').value = j.ap1 || '';
        $('pc-j-ap2').value = j.ap2 || '';
        $('pc-j-dorsal').value = j.dorsal || '';
        $('pc-j-posicion').value = j.posicion || 'Centrocampista';
        $('pc-j-estatura').value = j.estatura || '';
        $('pc-j-peso').value = j.peso || '';
        $('pc-modo-jugador').textContent = 'Editando ' + nombreCompleto(j);
        $('pc-cancelar-jugador').hidden = false;
        $('pc-j-nombre').focus();
    }

    function terminarEdicionJugador() {
        jugadorEnEdicion = null;
        $('pc-form-jugador').reset();
        $('pc-modo-jugador').textContent = 'Alta nueva';
        $('pc-cancelar-jugador').hidden = true;
    }

    async function eliminarJugador(j) {
        // Acción destructiva: SIEMPRE confirmar
        if (!window.confirm(`¿Seguro que quieres dar de baja a ${nombreCompleto(j)}? Se conservarán sus estadísticas.`)) return;
        try {
            await enviar('delete', `/jugadores/${j.id}`);
            jugadores = jugadores.filter(x => x.id !== j.id);
            pintarJugadores();
            mensaje('pc-feedback-jugador', `${nombreCompleto(j)} se ha dado de baja.` + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pc-feedback-jugador', textoError(error), 'error');
        }
    }

    async function guardarJugador(evento) {
        evento.preventDefault();
        limpiar('pc-feedback-jugador');
        const form = $('pc-form-jugador');
        if (!form.checkValidity()) { form.reportValidity(); return; }

        const datos = {
            nombre: $('pc-j-nombre').value.trim(), ap1: $('pc-j-ap1').value.trim(),
            posicion: $('pc-j-posicion').value, dorsal: parseInt($('pc-j-dorsal').value, 10),
            equipo_id: parseInt($('pc-j-equipo').value, 10)
        };
        const ap2 = $('pc-j-ap2').value.trim();
        if (ap2) datos.ap2 = ap2;
        if ($('pc-j-estatura').value) datos.estatura = Number($('pc-j-estatura').value);
        if ($('pc-j-peso').value) datos.peso = Number($('pc-j-peso').value);

        // Regla de negocio (la repite el servidor): un dorsal no puede repetirse en el equipo
        const repetido = jugadores.find(x => x.dorsal === datos.dorsal && (!jugadorEnEdicion || x.id !== jugadorEnEdicion.id));
        if (repetido) {
            mensaje('pc-feedback-jugador', `El dorsal #${datos.dorsal} ya lo lleva ${nombreCompleto(repetido)}.`, 'error');
            $('pc-j-dorsal').focus();
            return;
        }

        const botonEnviar = form.querySelector('button[type="submit"]');
        botonEnviar.disabled = true;   // evita envíos duplicados
        try {
            if (jugadorEnEdicion) {
                const nuevo = await enviar('patch', `/jugadores/${jugadorEnEdicion.id}`, datos);
                Object.assign(jugadorEnEdicion, nuevo || datos);
            } else {
                const creado = await enviar('post', '/jugadores', datos);
                jugadores.push(creado || { id: Date.now(), ...datos });
            }
            terminarEdicionJugador();
            pintarJugadores();
            mensaje('pc-feedback-jugador', 'Jugador guardado correctamente.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pc-feedback-jugador', textoError(error), 'error');
        } finally {
            botonEnviar.disabled = false;
        }
    }

    // ==================================================================
    // PESTAÑA 3: NOTICIAS Y EVENTOS
    // ==================================================================
    async function cargarNoticias() {
        try {
            noticias = comoLista(await Demo.obtener('/noticias', null, Demo.noticias));
            pintarNoticias();
        } catch (error) {
            Api.mostrarError($('pc-mensajes'), error);
        }
    }

    function pintarNoticias() {
        const cuerpo = $('pc-tabla-noticias');
        cuerpo.textContent = '';
        if (!noticias.length) { filaVacia(cuerpo, 'Todavía no hay publicaciones.', 4); return; }
        noticias.forEach(n => {
            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: n.titulo })] }),
                el('td', { texto: n.tipo === 'evento' ? 'Evento' : 'Noticia' }),
                el('td', { texto: Api.formatearFecha(n.tipo === 'evento' ? n.fecha_evento : n.publicada_en) }),
                el('td', { clase: 'celda-acciones', hijos: [
                    boton('Editar', 'Editar ' + n.titulo, () => empezarEdicionNoticia(n)),
                    boton('Eliminar', 'Eliminar ' + n.titulo, () => eliminarNoticia(n), true)
                ]})
            ]}));
        });
    }

    /* El campo "fecha del evento" solo se enseña (y se exige) si el tipo es evento. */
    function ajustarTipoNoticia() {
        const esEvento = $('pc-n-tipo').value === 'evento';
        $('pc-n-grupo-fecha').hidden = !esEvento;
        $('pc-n-fecha').required = esEvento;
    }

    function empezarEdicionNoticia(n) {
        noticiaEnEdicion = n;
        $('pc-n-tipo').value = n.tipo || 'noticia';
        $('pc-n-titulo').value = n.titulo || '';
        $('pc-n-cuerpo').value = n.cuerpo || '';
        $('pc-n-fecha').value = n.fecha_evento || '';
        ajustarTipoNoticia();
        $('pc-modo-noticia').textContent = 'Editando';
        $('pc-cancelar-noticia').hidden = false;
        $('pc-n-titulo').focus();
    }

    function terminarEdicionNoticia() {
        noticiaEnEdicion = null;
        $('pc-form-noticia').reset();
        ajustarTipoNoticia();
        $('pc-modo-noticia').textContent = 'Nueva';
        $('pc-cancelar-noticia').hidden = true;
    }

    async function guardarNoticia(evento) {
        evento.preventDefault();
        limpiar('pc-feedback-noticia');
        const tipo = $('pc-n-tipo').value;
        const titulo = $('pc-n-titulo').value.trim(), cuerpoTxt = $('pc-n-cuerpo').value.trim();
        const fecha = $('pc-n-fecha').value;
        // Validaciones del contrato (§5): el servidor las repite
        if (titulo.length < 1 || titulo.length > 150) return mensaje('pc-feedback-noticia', 'El título debe tener entre 1 y 150 caracteres.', 'error');
        if (cuerpoTxt.length < 1 || cuerpoTxt.length > 10000) return mensaje('pc-feedback-noticia', 'El texto debe tener entre 1 y 10 000 caracteres.', 'error');
        if (tipo === 'evento' && !fecha) return mensaje('pc-feedback-noticia', 'Un evento necesita fecha.', 'error');

        const datos = { titulo, cuerpo: cuerpoTxt, tipo };
        if (tipo === 'evento') datos.fecha_evento = fecha;
        try {
            if (noticiaEnEdicion) {
                const nueva = await enviar('patch', `/noticias/${noticiaEnEdicion.id}`, datos);
                Object.assign(noticiaEnEdicion, nueva || datos);
                if (tipo !== 'evento') noticiaEnEdicion.fecha_evento = null;
            } else {
                const creada = await enviar('post', '/noticias', datos);
                noticias.unshift(creada || { id: Date.now(), ...datos, publicada_en: new Date().toISOString() });
            }
            terminarEdicionNoticia();
            pintarNoticias();
            mensaje('pc-feedback-noticia', 'Publicación guardada. Ya aparece en Noticias.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pc-feedback-noticia', textoError(error), 'error');
        }
    }

    async function eliminarNoticia(n) {
        if (!window.confirm(`¿Seguro que quieres eliminar "${n.titulo}"?`)) return;
        try {
            await enviar('delete', `/noticias/${n.id}`);
            noticias = noticias.filter(x => x.id !== n.id);
            if (noticiaEnEdicion === n) terminarEdicionNoticia();
            pintarNoticias();
            mensaje('pc-feedback-noticia', 'Publicación eliminada.' + avisoDemo(), 'ok');
        } catch (error) {
            mensaje('pc-feedback-noticia', textoError(error), 'error');
        }
    }

    // ==================================================================
    // Arranque (cuando layout.js ya comprobó la sesión y los permisos)
    // ==================================================================
    async function iniciar() {
        pestanas = Pestanas.iniciar({ botones: '.pc-tab', paneles: ['pc-solicitudes', 'pc-jugadores', 'pc-noticias', 'pc-lesiones'],
            porHash: { '#solicitudes': 'pc-solicitudes', '#jugadores': 'pc-jugadores', '#noticias': 'pc-noticias', '#lesiones': 'pc-lesiones' },
            inicial: 'pc-solicitudes' });

        $('pc-form-rechazo').addEventListener('submit', rechazar);
        $('pc-cancelar-rechazo').addEventListener('click', () => { $('pc-form-rechazo').hidden = true; solicitudARechazar = null; });
        $('pc-form-jugador').addEventListener('submit', guardarJugador);
        $('pc-cancelar-jugador').addEventListener('click', terminarEdicionJugador);
        $('pc-j-equipo').addEventListener('change', () => { terminarEdicionJugador(); cargarJugadores(); });
        $('pc-form-noticia').addEventListener('submit', guardarNoticia);
        $('pc-cancelar-noticia').addEventListener('click', terminarEdicionNoticia);
        $('pc-n-tipo').addEventListener('change', ajustarTipoNoticia);
        // Coordinador y desarrollador sí pueden borrar lesiones
        lesiones = Lesiones.iniciar({ prefijo: 'pc', equipoId: () => Number($('pc-l-equipo').value), puedeBorrar: true });
        $('pc-l-equipo').addEventListener('change', () => { lesiones.cancelar(); lesiones.cargar(); });
        ajustarTipoNoticia();

        try {
            equipos = comoLista(await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos));
            const opciones = equipos.map(e => ({ valor: e.id, texto: e.nombre }));
            rellenarSelect($('pc-j-equipo'), opciones);
            rellenarSelect($('pc-l-equipo'), opciones);
        } catch (error) {
            Api.mostrarError($('pc-mensajes'), error);
        }
        // Las cuatro pestañas cargan a la vez; un fallo en una no impide ver las demás
        await Promise.all([cargarSolicitudes(), cargarJugadores(), cargarNoticias(), lesiones.cargar()]);
    }

    document.addEventListener('layout:listo', iniciar);
})();
