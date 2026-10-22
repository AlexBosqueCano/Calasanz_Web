/*
 * main.js — Lógica de las páginas de jugadores (plantilla, perfil, alta).
 * Usa el cliente central (api.js). Regla: los datos del servidor se pintan con
 * textContent / Api.el(), nunca con innerHTML.
 * Se ejecuta cuando la plantilla común (layout.js) ha terminado y la sesión está comprobada.
 */
(function () {
    'use strict';

    const { el } = Api;

    function nombreCompleto(j) {
        return [j.nombre, j.ap1, j.ap2].filter(Boolean).join(' ');
    }

    function filaMensaje(columnas, texto) {
        const td = el('td', { texto, clase: 'celda-centrada', atributos: { colspan: String(columnas) } });
        return el('tr', { hijos: [td] });
    }

    // ==========================================
    // 1. PLANTILLA DE UN EQUIPO
    // ==========================================
    async function cargarPlantilla() {
        const cuerpo = document.getElementById('contenedor-jugadores');
        if (!cuerpo) return;
        const equipoId = cuerpo.dataset.equipo;

        try {
            const jugadores = await Api.get(`/equipos/${encodeURIComponent(equipoId)}/plantilla`);
            cuerpo.textContent = '';
            if (!jugadores.length) {
                cuerpo.appendChild(filaMensaje(2, 'Este equipo aún no tiene jugadores.'));
                return;
            }
            jugadores.forEach(j => {
                const enlace = el('a', {
                    texto: nombreCompleto(j),
                    atributos: { href: `jugador.html?id=${encodeURIComponent(j.id)}` }
                });
                cuerpo.appendChild(el('tr', { hijos: [
                    el('td', { hijos: [enlace] }),
                    el('td', { texto: j.posicion })
                ]}));
            });
            Api.anunciar(`Plantilla cargada: ${jugadores.length} jugadores.`);
        } catch (error) {
            cuerpo.textContent = '';
            const td = el('td', { atributos: { colspan: '2' } });
            Api.mostrarError(td, error);
            cuerpo.appendChild(el('tr', { hijos: [td] }));
        }
    }

    // ==========================================
    // 2. PERFIL INDIVIDUAL Y ESTADÍSTICAS
    // ==========================================
    async function cargarPerfilJugador() {
        const titulo = document.getElementById('nombre-perfil-principal');
        if (!titulo) return;

        const idJugador = new URLSearchParams(window.location.search).get('id');
        const lista = document.getElementById('lista-ficha-tecnica');
        const tablaStats = document.getElementById('cuerpo-estadisticas-jugador');

        if (!idJugador || !/^\d+$/.test(idJugador)) {
            titulo.textContent = 'Jugador no encontrado';
            Api.mostrarError(lista, new Api.ApiError(404, 'no_encontrado', 'No se ha indicado un jugador válido.'));
            tablaStats.textContent = '';
            return;
        }

        // --- Datos personales ---
        try {
            const j = await Api.get(`/jugadores/${idJugador}`);
            titulo.textContent = nombreCompleto(j);
            document.title = `${nombreCompleto(j)} - CD. Calasanz`;

            lista.textContent = '';
            const datos = [
                ['Posición', j.posicion],
                ['Dorsal', j.dorsal],
                ['Equipo', j.equipo ? j.equipo.nombre : null],
                // Estatura y peso solo llegan si el servidor concede permiso
                ['Estatura', j.estatura !== undefined ? `${j.estatura} m` : null],
                ['Peso', j.peso !== undefined ? `${j.peso} kg` : null]
            ];
            datos.forEach(([etiqueta, valor]) => {
                if (valor === null || valor === undefined) return;
                lista.appendChild(el('li', { hijos: [
                    el('strong', { texto: etiqueta + ': ' }),
                    document.createTextNode(String(valor))
                ]}));
            });
        } catch (error) {
            titulo.textContent = 'No se pudo cargar el jugador';
            Api.mostrarError(lista, error);
            tablaStats.textContent = '';
            return;
        }

        // --- Estadísticas ---
        try {
            const s = await Api.get(`/jugadores/${idJugador}/estadisticas`);
            const valores = [
                s.partidos_jugados, s.titular, s.suplente,
                `${s.minutos_totales || 0}'`,
                s.goles_totales, s.asistencias_totales, s.amarillas_totales, s.rojas_totales
            ].map(v => v === undefined || v === null ? 0 : v);

            tablaStats.textContent = '';
            tablaStats.appendChild(el('tr', {
                clase: 'fila-destacada',
                hijos: valores.map(v => el('td', { texto: String(v) }))
            }));
        } catch (error) {
            tablaStats.textContent = '';
            if (error.status === 404) {
                tablaStats.appendChild(filaMensaje(8, 'No hay datos de estadísticas para este jugador aún.'));
            } else {
                const td = el('td', { atributos: { colspan: '8' } });
                Api.mostrarError(td, error);
                tablaStats.appendChild(el('tr', { hijos: [td] }));
            }
        }
    }

    // ==========================================
    // 3. ALTA DE JUGADOR (COORDINADOR / DESARROLLADOR)
    // ==========================================
    function inicializarFormularioAlta() {
        const form = document.getElementById('form-nuevo-jugador');
        if (!form) return;

        const zonaMensajes = document.getElementById('mensajes-formulario');
        const boton = form.querySelector('button[type="submit"]');

        // Limpia errores previos de campo
        function limpiarErrores() {
            zonaMensajes.textContent = '';
            form.querySelectorAll('[aria-invalid]').forEach(c => c.removeAttribute('aria-invalid'));
            form.querySelectorAll('.error-campo').forEach(n => n.remove());
        }

        // Marca los campos que el servidor rechazó (detalles[].campo)
        function marcarErrores(detalles) {
            let primero = null;
            detalles.forEach(d => {
                const campo = form.elements[d.campo === 'equipo_id' ? 'equipo' : d.campo];
                if (!campo) return;
                campo.setAttribute('aria-invalid', 'true');
                const idError = `error-${campo.id}`;
                campo.setAttribute('aria-describedby', idError);
                campo.insertAdjacentElement('afterend',
                    el('span', { texto: d.mensaje, clase: 'error-campo', atributos: { id: idError } }));
                if (!primero) primero = campo;
            });
            if (primero) primero.focus();
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            limpiarErrores();

            // Validación en cliente (el servidor vuelve a validar siempre)
            if (!form.checkValidity()) { form.reportValidity(); return; }

            const cuerpo = {
                nombre: form.elements.nombre.value.trim(),
                ap1: form.elements.ap1.value.trim(),
                posicion: form.elements.posicion.value,
                equipo_id: parseInt(form.elements.equipo.value, 10)
            };
            const ap2 = form.elements.ap2.value.trim();
            if (ap2) cuerpo.ap2 = ap2;
            const dorsal = form.elements.dorsal && form.elements.dorsal.value;
            if (dorsal) cuerpo.dorsal = parseInt(dorsal, 10);

            boton.disabled = true;
            boton.textContent = 'Guardando…';
            try {
                const creado = await Api.post('/jugadores', cuerpo);
                form.reset();
                const aviso = el('p', {
                    texto: `Jugador registrado: ${nombreCompleto(creado)}.`,
                    clase: 'mensaje mensaje-ok', atributos: { role: 'status' }
                });
                zonaMensajes.appendChild(aviso);
                Api.anunciar('Jugador registrado correctamente.');
                form.elements.nombre.focus();
            } catch (error) {
                Api.mostrarError(zonaMensajes, error);
                if (error.status === 422 || error.status === 409) marcarErrores(error.detalles);
            } finally {
                boton.disabled = false;
                boton.textContent = 'Guardar jugador';
            }
        });
    }

    // Esperamos a que layout.js haya comprobado la sesión y permisos de la página
    document.addEventListener('layout:listo', () => {
        cargarPlantilla();
        cargarPerfilJugador();
        inicializarFormularioAlta();
    });
})();
