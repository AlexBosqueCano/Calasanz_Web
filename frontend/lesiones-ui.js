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
    // Modo estricto: JavaScript avisa de errores típicos (variables sin declarar, etc.).
    'use strict';

    // Atajos a utilidades de api.js: `el` crea elementos del DOM sin innerHTML (seguro ante XSS)
    // y `nombreCompleto` une nombre y apellidos de un jugador.
    const { el, nombreCompleto } = Api;
    // Utilidades comunes de los paneles (mensajes, selects, botones, envío con modo demo...).
    const U = PanelUtil;
    // Atajo para document.getElementById.
    const $ = (id) => document.getElementById(id);

    /**
     * Prepara la pestaña de lesiones dentro de una página concreta.
     * @param {object} config  { prefijo, equipoId, puedeBorrar }
     *   - prefijo: texto que antecede a los ids del HTML (p. ej. 'pc' o 'pe').
     *   - equipoId: función que devuelve el id del equipo elegido en ese momento.
     *   - puedeBorrar: true solo para coordinador y desarrollador.
     * @returns {{cargar: Function, cancelar: Function}} funciones que la página llama.
     */
    function iniciar(config) {
        // Con el prefijo construimos los ids reales: id('form-lesion') -> 'pc-form-lesion'.
        const p = config.prefijo;
        const id = (nombre) => `${p}-${nombre}`;
        // Estado local: lesiones activas del equipo, jugadores entre los que elegir y,
        // si estamos editando, la lesión concreta (null = estamos creando una nueva).
        let lesiones = [], plantilla = [], enEdicion = null;

        // Muestra un aviso (tipo 'ok' o 'error') en el hueco de feedback de esta pestaña.
        const mensaje = (texto, tipo) => U.mensaje(id('feedback-lesion'), texto, tipo);

        // Pide al servidor (o a los datos de demostración) la plantilla y las lesiones activas
        // del equipo seleccionado, y rellena el selector de jugador y la tabla.
        async function cargar() {
            // El equipo lo decide la página que nos usa (el select de equipo del panel).
            const equipoId = config.equipoId();
            try {
                // Demo.obtener intenta la API real; si el servidor no responde, usa los datos de ejemplo.
                // comoLista admite tanto un array como una respuesta paginada {items: [...]}.
                plantilla = U.comoLista(await Demo.obtener(`/equipos/${equipoId}/plantilla`, null, Demo.plantilla));
                lesiones = U.comoLista(await Demo.obtener('/lesiones', { equipo: equipoId, activa: 'true' }, Demo.lesiones));
            } catch (error) {
                plantilla = []; lesiones = [];
                mensaje(U.textoError(error), 'error');
            }
            // Texto de cada opción: dorsal + nombre, p. ej. "7 Daniel Orbe".
            U.rellenarSelect($(id('l-jugador')), plantilla.map(j => ({ valor: j.id, texto: `${j.dorsal ?? '-'} ${nombreCompleto(j)}` })));
            pintar();
        }

        // Dibuja la tabla de lesiones activas. Se llama tras cada cambio para reflejar el estado.
        function pintar() {
            const cuerpo = $(id('tabla-lesiones'));
            // Vaciar con textContent es seguro y rápido (no interpreta HTML).
            cuerpo.textContent = '';
            // Sin lesiones: una fila informativa que ocupa las 4 columnas.
            if (!lesiones.length) { U.filaVacia(cuerpo, 'No hay lesiones activas en este equipo.', 4); return; }
            lesiones.forEach(l => {
                const nombre = l.jugador.nombre_completo;
                // Botones de la fila. Cada uno lleva una etiqueta accesible larga para lectores de pantalla.
                const acciones = [
                    U.boton('Editar', 'Editar la lesión de ' + nombre, () => empezarEdicion(l)),
                    U.boton('Dar de alta', nombre + ' se ha recuperado', () => darDeAlta(l))
                ];
                // Borrar: solo coordinador y desarrollador
                if (config.puedeBorrar) acciones.push(U.boton('Eliminar', 'Eliminar la lesión de ' + nombre, () => eliminar(l), true));
                // Una fila: jugador, fecha de inicio, vuelta estimada y botones de acción.
                cuerpo.appendChild(el('tr', { hijos: [
                    el('td', { hijos: [el('strong', { texto: nombre })] }),
                    el('td', { texto: Api.formatearFecha(l.fecha_inicio) }),
                    el('td', { texto: Api.formatearFecha(l.fecha_estimada_vuelta) }),
                    el('td', { clase: 'celda-acciones', hijos: acciones })
                ]}));
            });
        }

        // Pasa el formulario a modo "edición": carga los datos de la lesión elegida en los campos.
        function empezarEdicion(l) {
            // Guardamos qué lesión se edita; `guardar` lo usa para decidir entre PATCH (editar) y POST (crear).
            enEdicion = l;
            $(id('l-jugador')).value = String(l.jugador.id);
            $(id('l-jugador')).disabled = true;     // la lesión no cambia de jugador
            $(id('l-inicio')).value = l.fecha_inicio;
            $(id('l-vuelta')).value = l.fecha_estimada_vuelta;
            $(id('modo-lesion')).textContent = 'Editando';
            $(id('cancelar-lesion')).hidden = false;
            $(id('l-vuelta')).focus();
        }

        // Devuelve el formulario al modo "nueva lesión" y limpia los campos.
        function terminarEdicion() {
            enEdicion = null;
            $(id('l-jugador')).disabled = false;
            $(id('l-inicio')).value = ''; $(id('l-vuelta')).value = '';
            $(id('modo-lesion')).textContent = 'Nueva';
            $(id('cancelar-lesion')).hidden = true;
        }

        // Gestiona el envío del formulario: valida, y crea o actualiza la lesión.
        async function guardar(evento) {
            // Evita que el navegador recargue la página al enviar el formulario.
            evento.preventDefault();
            U.limpiar(id('feedback-lesion'));
            // Las fechas llegan como texto ISO (AAAA-MM-DD), por lo que se pueden comparar como texto.
            const inicio = $(id('l-inicio')).value, vuelta = $(id('l-vuelta')).value;
            const jugadorId = Number($(id('l-jugador')).value);
            // Validaciones en el cliente para dar respuesta inmediata (el servidor vuelve a validar).
            if (!jugadorId) return mensaje('Elige el jugador.', 'error');
            if (!inicio || !vuelta) return mensaje('Indica la fecha de inicio y la de vuelta estimada.', 'error');
            if (vuelta < inicio) return mensaje('La vuelta estimada no puede ser anterior al inicio.', 'error');
            // Regla de negocio: un jugador solo puede tener una lesión activa a la vez.
            if (!enEdicion && lesiones.some(l => l.jugador.id === jugadorId)) {
                return mensaje('Ese jugador ya tiene una lesión activa. Edítala o dale de alta primero.', 'error');
            }
            try {
                // Editar: PATCH solo con los campos que cambian; luego actualizamos nuestra copia local.
                if (enEdicion) {
                    await U.enviar('patch', `/lesiones/${enEdicion.id}`, { fecha_inicio: inicio, fecha_estimada_vuelta: vuelta });
                    Object.assign(enEdicion, { fecha_inicio: inicio, fecha_estimada_vuelta: vuelta });
                } else {
                    // Crear: POST. Si el servidor no responde (demo) `creada` es null y fabricamos la lesión
                    // en memoria para poder enseñarla en la tabla.
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

        // "Dar de alta" = el jugador se ha recuperado: la lesión pasa a activa:false y deja de listarse.
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

        // Borrar de verdad (solo coordinador/desarrollador). Acción destructiva: siempre pedimos confirmación.
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

        // Conectamos los eventos (en lugar de onclick en el HTML, que no permitimos).
        $(id('form-lesion')).addEventListener('submit', guardar);
        $(id('cancelar-lesion')).addEventListener('click', terminarEdicion);
        // API pública de este módulo para la página que lo usa.
        return { cargar, cancelar: terminarEdicion };
    }

    // Publicamos el módulo en window para que lo vean los demás scripts.
    global.Lesiones = { iniciar };
})(window);
