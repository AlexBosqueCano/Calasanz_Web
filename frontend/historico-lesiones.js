/*
 * historico-lesiones.js — Histórico de lesiones (historico-lesiones.html)
 * ========================================================================
 *   JUGADOR                              → sus propias lesiones: GET /api/lesiones?jugador={id}
 *   ENTRENADOR                           → las de SU equipo: GET /api/lesiones?equipo={id}
 *   COORDINADOR / DESARROLLADOR          → las de cualquier equipo propio
 * Sin el filtro `activa` el servidor devuelve también las ya recuperadas (docs/API_CONTRATO.md §4).
 * Solo se enseñan estado y fechas: no existe diagnóstico (son datos de salud de menores).
 *
 * SEGURIDAD: nada de innerHTML con datos; todo con Api.el() / textContent.
 */
(function () {
    'use strict';

    // `el` crea elementos sin innerHTML; `U` agrupa utilidades de paneles (panel-util.js).
    const { el } = Api;
    const U = PanelUtil;
    // Atajo para document.getElementById.
    const $ = (id) => document.getElementById(id);

    /*
     * Dibuja la tabla del histórico.
     * @param {Array}   lesiones   lista de lesiones del servidor
     * @param {boolean} verJugador true = mostrar la columna "Jugador" (entrenador/coordinación);
     *                             false = el propio jugador, que solo ve las suyas
     */
    function pintar(lesiones, verJugador) {
        const cuerpo = $('hl-tabla');
        cuerpo.textContent = '';
        $('hl-col-jugador').hidden = !verJugador;
        if (!lesiones.length) { U.filaVacia(cuerpo, 'No hay lesiones registradas.', verJugador ? 4 : 3); return; }
        // Las más recientes primero
        lesiones.slice().sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)).forEach(l => {
            // Activa = sigue lesionado; si no, enseñamos la fecha real de alta cuando existe.
            const estado = l.activa ? 'Activa' : `Recuperado${l.fecha_alta ? ' el ' + Api.formatearFecha(l.fecha_alta) : ''}`;
            // Las celdas se construyen en un array porque la primera (jugador) es opcional.
            const celdas = [];
            if (verJugador) celdas.push(el('td', { hijos: [el('strong', { texto: l.jugador.nombre_completo })] }));
            celdas.push(el('td', { texto: Api.formatearFecha(l.fecha_inicio) }));
            celdas.push(el('td', { texto: Api.formatearFecha(l.fecha_estimada_vuelta) }));
            celdas.push(el('td', { texto: estado }));
            cuerpo.appendChild(el('tr', { hijos: celdas }));
        });
    }

    // Pide el histórico del equipo elegido en el desplegable y lo pinta (con la columna de jugador).
    async function cargarEquipo() {
        try {
            const r = await Demo.obtener('/lesiones', { equipo: $('hl-equipo').value }, Demo.historicoLesiones);
            pintar(U.comoLista(r), true);
        } catch (error) {
            Api.mostrarError($('hl-mensajes'), error);
        }
    }

    // Decide qué histórico mostrar según el rol del usuario (reglas de visibilidad del contrato).
    // Es solo comodidad de interfaz: el servidor aplica los mismos permisos.
    async function iniciar() {
        const usuario = Sesion.actual();
        try {
            if (usuario && usuario.rol === 'JUGADOR') {
                $('hl-lead').textContent = 'Tus lesiones, activas y ya recuperadas.';
                const r = await Demo.obtener('/lesiones', { jugador: usuario.jugador_id }, Demo.historicoLesiones);
                // En modo demostración los datos de ejemplo traen todas: nos quedamos con las del jugador
                const mias = U.comoLista(r).filter(l => !Sesion.enModoDemo() || l.jugador.id === usuario.jugador_id);
                pintar(mias, false);
            } else if (usuario && ['ENTRENADOR', 'COORDINADOR', 'DESARROLLADOR'].includes(usuario.rol)) {
                $('hl-lead').textContent = 'Lesiones activas y ya recuperadas del equipo.';
                let equipos = U.comoLista(await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos));
                // Un entrenador solo ve el histórico de los jugadores de SU equipo (el servidor también lo exige)
                if (usuario.rol === 'ENTRENADOR' && usuario.equipo_id) equipos = equipos.filter(e => e.id === usuario.equipo_id);
                U.rellenarSelect($('hl-equipo'), equipos.map(e => ({ valor: e.id, texto: e.nombre })));
                $('hl-grupo-equipo').hidden = false;
                $('hl-equipo').addEventListener('change', cargarEquipo);
                await cargarEquipo();
            } else {
                // Usuario estándar: aún no pertenece a ningún equipo
                Api.mostrarError($('hl-mensajes'), new Api.ApiError(403, 'sin_permiso', 'Este apartado es para jugadores y cuerpo técnico del club.'));
            }
        } catch (error) {
            Api.mostrarError($('hl-mensajes'), error);
        }
    }

    // layout.js avisa con este evento cuando la sesión y los permisos ya están comprobados.
    document.addEventListener('layout:listo', iniciar);
})();
