/*
 * solicitud.js — Solicitud de acceso como jugador o entrenador (solicitud.html)
 * ==============================================================================
 * Un usuario ESTANDAR pide a coordinación que vincule su cuenta con:
 *   - JUGADOR    → una ficha de jugador (jugador_id) de un equipo del club.
 *   - ENTRENADOR → un equipo del club (equipo_id).
 * Solo puede tener UNA solicitud pendiente (el servidor responde 409 si hay otra).
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET  /api/equipos?propios=true · GET /api/equipos/{id}/plantilla
 *   GET  /api/solicitudes/mias
 *   POST /api/solicitudes { rol_solicitado, jugador_id?, equipo_id?, mensaje }
 *
 * MODO DEMOSTRACIÓN: sin servidor, la solicitud se queda solo en memoria.
 * SEGURIDAD: nada de innerHTML con datos; todo con Api.el() / textContent.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;
    const U = PanelUtil;
    const $ = (id) => document.getElementById(id);

    let equipos = [];
    let plantilla = [];
    let mias = [];

    const ESTADO_TEXTO = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

    /* El selector de jugador solo tiene sentido si se pide ser jugador. */
    function ajustarRol() {
        $('sol-grupo-jugador').hidden = $('sol-rol').value !== 'JUGADOR';
    }

    async function cargarPlantilla() {
        if ($('sol-rol').value !== 'JUGADOR') return;
        try {
            plantilla = U.comoLista(await Demo.obtener(`/equipos/${$('sol-equipo').value}/plantilla`, null, Demo.plantilla));
        } catch (error) {
            plantilla = [];
            U.mensaje('sol-feedback', U.textoError(error), 'error');
        }
        U.rellenarSelect($('sol-jugador'), plantilla.map(j => ({ valor: j.id, texto: `${j.dorsal ?? '-'} ${nombreCompleto(j)}` })));
    }

    /* Texto de lo que se pidió: "Jugador: Daniel Orbe" / "Entrenador: Cadete A" */
    function textoSolicitud(s) {
        const rol = s.rol_solicitado === 'JUGADOR' ? 'Jugador' : 'Entrenador';
        const vinculo = s.jugador ? s.jugador.nombre_completo : (s.equipo ? s.equipo.nombre : '');
        return vinculo ? `${rol}: ${vinculo}` : rol;
    }

    function pintarMias() {
        const caja = $('sol-lista');
        caja.textContent = '';
        if (!mias.length) { caja.appendChild(el('p', { texto: 'Todavía no has enviado ninguna solicitud.', clase: 'texto-vacio' })); return; }
        mias.forEach(s => {
            const hijos = [
                el('div', { clase: 'news-card-meta', hijos: [el('span', { texto: (ESTADO_TEXTO[s.estado] || s.estado).toUpperCase() }), el('span', { texto: Api.formatearFecha(s.creada_en) })] }),
                el('h3', { texto: textoSolicitud(s) }),
                el('p', { texto: s.mensaje || '', clase: 'news-card-texto' })
            ];
            // El motivo del rechazo lo escribe coordinación: se enseña como texto
            if (s.comentario_resolucion) hijos.push(el('p', { texto: 'Respuesta de coordinación: ' + s.comentario_resolucion, clase: 'acta-etiqueta' }));
            caja.appendChild(el('article', { clase: 'news-card', hijos }));
        });

        // Con una solicitud pendiente no se puede enviar otra
        const pendiente = mias.some(s => s.estado === 'pendiente');
        $('sol-form').hidden = pendiente;
        $('sol-estado-form').textContent = pendiente ? 'Ya tienes una pendiente' : '';
        if (pendiente) {
            $('sol-form').parentNode.appendChild(el('p', { texto: 'Ya tienes una solicitud pendiente. Espera a que coordinación la resuelva.', clase: 'mensaje', atributos: { role: 'status', id: 'sol-aviso-pendiente' } }));
        } else if ($('sol-aviso-pendiente')) {
            $('sol-aviso-pendiente').remove();
        }
    }

    async function enviarSolicitud(evento) {
        evento.preventDefault();
        U.limpiar('sol-feedback');
        const rol = $('sol-rol').value;
        const mensajeTxt = $('sol-mensaje').value.trim();
        if (mensajeTxt.length < 5 || mensajeTxt.length > 500) return U.mensaje('sol-feedback', 'El mensaje debe tener entre 5 y 500 caracteres.', 'error');

        const cuerpo = { rol_solicitado: rol, mensaje: mensajeTxt };
        let jugador = null, equipo = null;
        if (rol === 'JUGADOR') {
            const id = Number($('sol-jugador').value);
            if (!id) return U.mensaje('sol-feedback', 'Elige tu ficha de jugador.', 'error');
            cuerpo.jugador_id = id;
            jugador = plantilla.find(j => j.id === id);
        } else {
            cuerpo.equipo_id = Number($('sol-equipo').value);
            equipo = equipos.find(e => e.id === cuerpo.equipo_id);
        }

        const boton = $('sol-form').querySelector('button[type="submit"]');
        boton.disabled = true;   // evita envíos duplicados
        try {
            const creada = await U.enviar('post', '/solicitudes', cuerpo);
            mias.unshift(creada || { id: Date.now(), rol_solicitado: rol, estado: 'pendiente', mensaje: mensajeTxt, creada_en: new Date().toISOString(),
                jugador: jugador ? { id: jugador.id, nombre_completo: nombreCompleto(jugador) } : null,
                equipo: equipo ? { id: equipo.id, nombre: equipo.nombre } : null });
            $('sol-form').reset(); ajustarRol();
            pintarMias();
            U.mensaje('sol-feedback', 'Solicitud enviada. Coordinación la revisará.' + U.avisoDemo(), 'ok');
        } catch (error) {
            // 409: ya hay una pendiente, o esa ficha / ese equipo ya está vinculado a otra cuenta
            U.mensaje('sol-feedback', U.textoError(error), 'error');
        } finally {
            boton.disabled = false;
        }
    }

    async function iniciar() {
        const usuario = Sesion.actual();
        // Solo los usuarios ESTANDAR (o el modo demostración, sin usuario) pueden solicitar
        if (usuario && usuario.rol !== 'ESTANDAR') {
            $('sol-ya-tiene-titulo').textContent = `Tu cuenta ya tiene acceso como ${Sesion.etiquetaRol(usuario.rol).toLowerCase()}.`;
            const panel = Sesion.panelUrl();
            if (panel) $('sol-ya-tiene-enlace').href = panel; else $('sol-ya-tiene-enlace').hidden = true;
            $('sol-ya-tiene').hidden = false;
            document.querySelector('.admin-grid-2').hidden = true;
            return;
        }

        $('sol-form').addEventListener('submit', enviarSolicitud);
        $('sol-rol').addEventListener('change', () => { ajustarRol(); cargarPlantilla(); });
        $('sol-equipo').addEventListener('change', cargarPlantilla);
        ajustarRol();

        try {
            equipos = U.comoLista(await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos));
            U.rellenarSelect($('sol-equipo'), equipos.map(e => ({ valor: e.id, texto: e.nombre })));
            await cargarPlantilla();
            mias = U.comoLista(await Demo.obtener('/solicitudes/mias', null, Demo.misSolicitudes));
            pintarMias();
        } catch (error) {
            Api.mostrarError($('sol-mensajes'), error);
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
