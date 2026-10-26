/*
 * lesiones-ui.js — Pestaña "Lesiones" compartida (panel de coordinación y del entrenador)
 * ========================================================================================
 * Lesiones activas de un equipo: registrar, editar fechas, dar de alta (recuperado) y, si el rol
 * lo permite, borrar. Por privacidad NO hay campo de diagnóstico: son datos de salud de menores.
 *
 *   GET /api/lesiones?equipo=&activa=true · POST /api/lesiones · PATCH/DELETE /api/lesiones/{id}
 *   GET /api/equipos/{id}/plantilla       → jugadores entre los que elegir
 *
 * Uso:   const l = Lesiones.iniciar({ prefijo: 'pc', equipoId: () => ..., puedeBorrar: true });  l.cargar();
 * Los elementos del HTML se llaman  <prefijo>-form-lesion, <prefijo>-l-jugador, <prefijo>-l-inicio,
 * <prefijo>-l-vuelta, <prefijo>-feedback-lesion, <prefijo>-modo-lesion, <prefijo>-cancelar-lesion
 * y <prefijo>-tabla-lesiones.
 */
(function (global) {
    'use strict';

    const { el, nombreCompleto } = Api;
    const U = PanelUtil;
    const $ = (id) => document.getElementById(id);

    function iniciar(config) {
        const p = config.prefijo;
        const id = (nombre) => `${p}-${nombre}`;
        let lesiones = [], plantilla = [], enEdicion = null;

        const mensaje = (texto, tipo) => U.mensaje(id('feedback-lesion'), texto, tipo);

        async function cargar() {
            const equipoId = config.equipoId();
            try {
                plantilla = U.comoLista(await Demo.obtener(`/equipos/${equipoId}/plantilla`, null, Demo.plantilla));
                lesiones = U.comoLista(await Demo.obtener('/lesiones', { equipo: equipoId, activa: 'true' }, Demo.lesiones));
            } catch (error) {
                plantilla = []; lesiones = [];
                mensaje(U.textoError(error), 'error');
            }
            U.rellenarSelect($(id('l-jugador')), plantilla.map(j => ({ valor: j.id, texto: `${j.dorsal ?? '-'} ${nombreCompleto(j)}` })));
            pintar();
        }

        function pintar() {
            const cuerpo = $(id('tabla-lesiones'));
            cuerpo.textContent = '';
            if (!lesiones.length) { U.filaVacia(cuerpo, 'No hay lesiones activas en este equipo.', 4); return; }
            lesiones.forEach(l => {
                const nombre = l.jugador.nombre_completo;
                const acciones = [
                    U.boton('Editar', 'Editar la lesión de ' + nombre, () => empezarEdicion(l)),
                    U.boton('Dar de alta', nombre + ' se ha recuperado', () => darDeAlta(l))
                ];
                // Borrar: solo coordinador y desarrollador
                if (config.puedeBorrar) acciones.push(U.boton('Eliminar', 'Eliminar la lesión de ' + nombre, () => eliminar(l), true));
                cuerpo.appendChild(el('tr', { hijos: [
                    el('td', { hijos: [el('strong', { texto: nombre })] }),
                    el('td', { texto: Api.formatearFecha(l.fecha_inicio) }),
                    el('td', { texto: Api.formatearFecha(l.fecha_estimada_vuelta) }),
                    el('td', { clase: 'celda-acciones', hijos: acciones })
                ]}));
            });
        }

        function empezarEdicion(l) {
            enEdicion = l;
            $(id('l-jugador')).value = String(l.jugador.id);
            $(id('l-jugador')).disabled = true;     // la lesión no cambia de jugador
            $(id('l-inicio')).value = l.fecha_inicio;
            $(id('l-vuelta')).value = l.fecha_estimada_vuelta;
            $(id('modo-lesion')).textContent = 'Editando';
            $(id('cancelar-lesion')).hidden = false;
            $(id('l-vuelta')).focus();
        }

        function terminarEdicion() {
            enEdicion = null;
            $(id('l-jugador')).disabled = false;
            $(id('l-inicio')).value = ''; $(id('l-vuelta')).value = '';
            $(id('modo-lesion')).textContent = 'Nueva';
            $(id('cancelar-lesion')).hidden = true;
        }

        async function guardar(evento) {
            evento.preventDefault();
            U.limpiar(id('feedback-lesion'));
            const inicio = $(id('l-inicio')).value, vuelta = $(id('l-vuelta')).value;
            const jugadorId = Number($(id('l-jugador')).value);
            if (!jugadorId) return mensaje('Elige el jugador.', 'error');
            if (!inicio || !vuelta) return mensaje('Indica la fecha de inicio y la de vuelta estimada.', 'error');
            if (vuelta < inicio) return mensaje('La vuelta estimada no puede ser anterior al inicio.', 'error');
            if (!enEdicion && lesiones.some(l => l.jugador.id === jugadorId)) {
                return mensaje('Ese jugador ya tiene una lesión activa. Edítala o dale de alta primero.', 'error');
            }
            try {
                if (enEdicion) {
                    await U.enviar('patch', `/lesiones/${enEdicion.id}`, { fecha_inicio: inicio, fecha_estimada_vuelta: vuelta });
                    Object.assign(enEdicion, { fecha_inicio: inicio, fecha_estimada_vuelta: vuelta });
                } else {
                    const creada = await U.enviar('post', '/lesiones', { jugador_id: jugadorId, fecha_inicio: inicio, fecha_estimada_vuelta: vuelta });
                    const j = plantilla.find(x => x.id === jugadorId);
                    lesiones.push(creada || { id: Date.now(), jugador: { id: j.id, nombre_completo: nombreCompleto(j) },
                        equipo_id: config.equipoId(), fecha_inicio: inicio, fecha_estimada_vuelta: vuelta, activa: true });
                }
                terminarEdicion();
                pintar();
                mensaje('Lesión guardada.' + U.avisoDemo(), 'ok');
            } catch (error) {
                mensaje(U.textoError(error), 'error');
            }
        }

        async function darDeAlta(l) {
            try {
                await U.enviar('patch', `/lesiones/${l.id}`, { activa: false });
                lesiones = lesiones.filter(x => x.id !== l.id);
                pintar();
                mensaje(`${l.jugador.nombre_completo} vuelve a estar disponible.` + U.avisoDemo(), 'ok');
            } catch (error) {
                mensaje(U.textoError(error), 'error');
            }
        }

        async function eliminar(l) {
            if (!window.confirm(`¿Seguro que quieres eliminar la lesión de ${l.jugador.nombre_completo}?`)) return;
            try {
                await U.enviar('delete', `/lesiones/${l.id}`);
                lesiones = lesiones.filter(x => x.id !== l.id);
                if (enEdicion === l) terminarEdicion();
                pintar();
                mensaje('Lesión eliminada.' + U.avisoDemo(), 'ok');
            } catch (error) {
                mensaje(U.textoError(error), 'error');
            }
        }

        $(id('form-lesion')).addEventListener('submit', guardar);
        $(id('cancelar-lesion')).addEventListener('click', terminarEdicion);
        return { cargar, cancelar: terminarEdicion };
    }

    global.Lesiones = { iniciar };
})(window);
