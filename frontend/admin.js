/*
 * admin.js — Panel de gestión (admin-plantilla.html)
 * ===================================================
 * Dos pestañas:
 *   1. Gestión de plantilla: alta, edición y baja de jugadores.
 *   2. Registrar acta de partido.
 * Acceso: COORDINADOR, ENTRENADOR y DESARROLLADOR (lo exige <body data-roles="...">).
 * Recordatorio: la comprobación de permisos REAL la hace el servidor; esto es comodidad.
 *
 * ENDPOINTS (docs/API_CONTRATO.md §4)
 *   GET    /api/equipos?propios=true           → rellena el desplegable de equipos
 *   GET    /api/equipos/{id}/plantilla         → tabla de jugadores del equipo elegido
 *   POST   /api/jugadores                      → alta
 *   PATCH  /api/jugadores/{id}                 → edición
 *   DELETE /api/jugadores/{id}                 → baja lógica (el jugador deja de estar activo)
 *   PUT    /api/partidos/{id}/acta             → acta (pendiente: necesita el listado de partidos)
 *
 * MODO DEMOSTRACIÓN
 *   Si el servidor no responde, la plantilla de ejemplo se edita SOLO en memoria (se pierde
 *   al recargar) y se avisa con un mensaje. Nada se envía a ningún sitio.
 *
 * SEGURIDAD: tabla y mensajes con Api.el() / textContent. Los botones de la tabla llevan
 * addEventListener, no onclick="..." en el HTML.
 */
(function () {
    'use strict';

    const { el, nombreCompleto } = Api;

    // Estado de la página
    let jugadores = [];          // plantilla del equipo elegido
    let enEdicion = null;        // jugador que se está editando (null = alta nueva)

    // Referencias a elementos (se buscan una sola vez)
    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------------
    // Mensajes de la zona CRUD
    // ------------------------------------------------------------------

    /* Enseña un mensaje bajo el formulario. tipo = 'ok' | 'error'. */
    function mensaje(texto, tipo) {
        const zona = $('crud-feedback');
        zona.textContent = texto;
        zona.className = 'feedback feedback-' + tipo;
        zona.hidden = false;
        Api.anunciar(texto, tipo === 'error');
    }

    // ------------------------------------------------------------------
    // Tabla de jugadores
    // ------------------------------------------------------------------
    function pintarTabla() {
        const cuerpo = $('tabla-admin-jugadores');
        cuerpo.textContent = '';

        if (!jugadores.length) {
            cuerpo.appendChild(el('tr', { hijos: [el('td', { texto: 'Este equipo no tiene jugadores todavía.', clase: 'celda-mensaje', atributos: { colspan: '4' } })] }));
            return;
        }

        jugadores.slice().sort((a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999)).forEach(j => {
            const nombre = nombreCompleto(j);

            // aria-label con el nombre: sin él, un lector de pantalla oiría "Editar, Editar, Editar…"
            const editar = el('button', { texto: 'Editar', clase: 'btn-outline btn-pequeno', atributos: { type: 'button', 'aria-label': 'Editar a ' + nombre } });
            editar.addEventListener('click', () => empezarEdicion(j));

            const borrar = el('button', { texto: 'Eliminar', clase: 'btn-outline btn-pequeno btn-peligro', atributos: { type: 'button', 'aria-label': 'Eliminar a ' + nombre } });
            borrar.addEventListener('click', () => eliminar(j));

            cuerpo.appendChild(el('tr', { hijos: [
                el('td', { hijos: [el('strong', { texto: j.dorsal ? '#' + j.dorsal : '—' })] }),
                el('td', { texto: nombre }),
                el('td', { texto: j.posicion || '' }),
                el('td', { clase: 'celda-acciones', hijos: [editar, borrar] })
            ]}));
        });
    }

    /* Carga la plantilla del equipo elegido en el desplegable. */
    async function cargarPlantilla() {
        const equipoId = $('j-equipo').value;
        try {
            jugadores = await Demo.obtener(`/equipos/${equipoId}/plantilla`, null, Demo.plantilla);
        } catch (error) {
            jugadores = [];
            Api.mostrarError($('crud-feedback'), error);
            $('crud-feedback').hidden = false;
        }
        pintarTabla();
    }

    // ------------------------------------------------------------------
    // Formulario de alta / edición
    // ------------------------------------------------------------------
    function empezarEdicion(j) {
        enEdicion = j;
        $('j-nombre').value = j.nombre || '';
        $('j-ap1').value = j.ap1 || '';
        $('j-ap2').value = j.ap2 || '';
        $('j-dorsal').value = j.dorsal || '';
        $('j-posicion').value = j.posicion || 'Mediocentro';
        $('modo-form-label').textContent = 'Editando ' + nombreCompleto(j);
        $('btn-cancelar-edicion').hidden = false;
        $('j-nombre').focus();   // el foco va al formulario para seguir escribiendo
    }

    function terminarEdicion() {
        enEdicion = null;
        $('form-jugador').reset();
        $('modo-form-label').textContent = 'Alta nueva';
        $('btn-cancelar-edicion').hidden = true;
    }

    /* Elimina (baja lógica) un jugador, pidiendo confirmación antes. */
    async function eliminar(j) {
        // Acción destructiva: SIEMPRE confirmar (requisito de usabilidad del enunciado)
        if (!window.confirm(`¿Seguro que quieres dar de baja a ${nombreCompleto(j)}? Se conservarán sus estadísticas.`)) return;

        try {
            if (!Sesion.enModoDemo()) await Api.delete(`/jugadores/${j.id}`);
            jugadores = jugadores.filter(x => x.id !== j.id);
            pintarTabla();
            mensaje(`${nombreCompleto(j)} se ha dado de baja.`, 'ok');
        } catch (error) {
            mensaje(error.message, 'error');
        }
    }

    function iniciarFormulario() {
        const form = $('form-jugador');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();   // evita que el navegador recargue la página
            $('crud-feedback').hidden = true;

            // Valida los atributos required/min/max del HTML
            if (!form.checkValidity()) { form.reportValidity(); return; }

            const datos = {
                nombre: $('j-nombre').value.trim(),
                ap1: $('j-ap1').value.trim(),
                posicion: $('j-posicion').value,
                dorsal: parseInt($('j-dorsal').value, 10),
                equipo_id: parseInt($('j-equipo').value, 10)
            };
            const ap2 = $('j-ap2').value.trim();
            if (ap2) datos.ap2 = ap2;

            // Regla de negocio (la repite el servidor): un dorsal no puede repetirse en el equipo
            const repetido = jugadores.find(x => x.dorsal === datos.dorsal && (!enEdicion || x.id !== enEdicion.id));
            if (repetido) {
                mensaje(`El dorsal #${datos.dorsal} ya lo lleva ${nombreCompleto(repetido)}.`, 'error');
                $('j-dorsal').focus();
                return;
            }

            const boton = form.querySelector('button[type="submit"]');
            boton.disabled = true;   // evita envíos duplicados
            try {
                if (Sesion.enModoDemo()) {
                    // Sin servidor: solo en memoria
                    if (enEdicion) Object.assign(enEdicion, datos);
                    else jugadores.push({ id: Date.now(), ...datos });
                } else if (enEdicion) {
                    Object.assign(enEdicion, await Api.patch(`/jugadores/${enEdicion.id}`, datos));
                } else {
                    jugadores.push(await Api.post('/jugadores', datos));
                }
                mensaje('Jugador guardado correctamente.', 'ok');
                terminarEdicion();
                pintarTabla();
            } catch (error) {
                // 409 = dorsal repetido, 422 = datos inválidos: el servidor explica qué campo falla
                const detalle = (error.detalles || []).map(d => d.mensaje).join(' ');
                mensaje(detalle ? `${error.message} ${detalle}` : error.message, 'error');
            } finally {
                boton.disabled = false;
            }
        });

        $('btn-cancelar-edicion').addEventListener('click', terminarEdicion);
        $('j-equipo').addEventListener('change', () => { terminarEdicion(); cargarPlantilla(); });
    }

    // ------------------------------------------------------------------
    // Equipos del desplegable
    // ------------------------------------------------------------------
    async function cargarEquipos() {
        const select = $('j-equipo');
        try {
            const equipos = await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos);
            select.textContent = '';
            equipos.forEach(e => select.appendChild(el('option', { texto: e.nombre, atributos: { value: String(e.id) } })));
        } catch (error) {
            select.textContent = '';
            select.appendChild(el('option', { texto: 'No se pudieron cargar los equipos' }));
        }
    }

    // ------------------------------------------------------------------
    // Pestañas (misma idea que equipo.js)
    // ------------------------------------------------------------------
    function activarPestana(destino) {
        document.querySelectorAll('.admin-tab').forEach(b => {
            const esta = b.dataset.target === destino;
            b.classList.toggle('active', esta);
            b.setAttribute('aria-selected', String(esta));
            b.setAttribute('tabindex', esta ? '0' : '-1');
        });
        document.querySelectorAll('.tab-pane').forEach(p => {
            const es = p.id === destino;
            p.classList.toggle('active', es);
            p.hidden = !es;
        });
    }

    function iniciarPestanas() {
        const botones = [...document.querySelectorAll('.admin-tab')];
        botones.forEach((b, i) => {
            b.addEventListener('click', () => activarPestana(b.dataset.target));
            // Flechas izquierda/derecha para moverse entre pestañas
            b.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const sig = botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length];
                activarPestana(sig.dataset.target);
                sig.focus();
            });
        });
        // Un enlace con #acta abre directamente la segunda pestaña
        activarPestana(window.location.hash === '#acta' ? 'tab-crear-acta' : 'tab-crud-plantilla');
    }

    // ------------------------------------------------------------------
    // Formulario de acta
    // ------------------------------------------------------------------
    function iniciarActa() {
        $('form-acta').addEventListener('submit', (e) => {
            e.preventDefault();
            // PENDIENTE (B8): el acta completa necesita elegir un partido y listar jugadores
            // (PUT /api/partidos/{id}/acta). De momento solo comprobamos los datos y avisamos.
            const aviso = $('acta-feedback');
            aviso.textContent = 'El guardado de actas se conectará con el servidor en la siguiente fase. Por ahora no se ha enviado nada.';
            aviso.className = 'feedback feedback-aviso';
            aviso.hidden = false;
            Api.anunciar(aviso.textContent);
        });
    }

    // ------------------------------------------------------------------
    // Arranque (cuando layout.js ya comprobó la sesión y los permisos)
    // ------------------------------------------------------------------
    document.addEventListener('layout:listo', async () => {
        iniciarPestanas();
        iniciarFormulario();
        iniciarActa();
        await cargarEquipos();
        await cargarPlantilla();
    });
})();
