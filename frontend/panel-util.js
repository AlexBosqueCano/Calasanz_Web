/*
 * panel-util.js — Utilidades comunes de los paneles (entrenador, coordinación, lesiones...)
 * ==========================================================================================
 * Funciones pequeñas que repetían todos los paneles: mensajes de resultado, botones de tabla,
 * rellenar desplegables y enviar datos al servidor (menos en modo demostración).
 * SEGURIDAD: todo se escribe con Api.el() / textContent; nunca innerHTML con datos.
 */
(function (global) {
    'use strict';

    const { el } = Api;
    const $ = (id) => document.getElementById(id);

    /* Respuesta paginada ({ items }) o lista simple → siempre una lista. */
    const comoLista = (r) => Array.isArray(r) ? r : ((r && r.items) || []);

    /* Sufijo para los mensajes de éxito cuando no hay servidor. */
    const avisoDemo = () => Sesion.enModoDemo() ? ' (modo demostración: no se ha enviado al servidor)' : '';

    /* Envía a la API salvo en modo demostración (devuelve null: el panel guarda el cambio en memoria). */
    async function enviar(metodo, ruta, cuerpo) {
        if (Sesion.enModoDemo()) return null;
        return Api[metodo](ruta, cuerpo);
    }

    /* Escribe un mensaje en una zona <p class="feedback"> y lo anuncia. tipo = 'ok' | 'error' */
    function mensaje(idZona, texto, tipo) {
        const zona = $(idZona);
        zona.textContent = texto;
        zona.className = 'feedback feedback-' + tipo;
        zona.hidden = false;
        Api.anunciar(texto, tipo === 'error');
    }
    function limpiar(idZona) { const z = $(idZona); z.textContent = ''; z.hidden = true; }

    /* Texto de error con los detalles de validación del servidor (422). */
    function textoError(error) {
        const detalle = (error.detalles || []).map(d => d.mensaje).join(' ');
        return detalle ? `${error.message} ${detalle}` : (error.message || 'Ha ocurrido un error.');
    }

    /* Sustituye las opciones de un <select>. opciones: [{ valor, texto }] */
    function rellenarSelect(select, opciones, seleccionado) {
        select.textContent = '';
        opciones.forEach(o => select.appendChild(el('option', { texto: o.texto, atributos: { value: String(o.valor) } })));
        if (seleccionado !== undefined && seleccionado !== null) select.value = String(seleccionado);
    }

    /* Botón pequeño con aria-label (sin él, un lector de pantalla oiría "Editar, Editar, Editar…"). */
    function boton(texto, etiqueta, alPulsar, peligro) {
        const b = el('button', { texto, clase: 'btn-outline btn-pequeno' + (peligro ? ' btn-peligro' : ''),
                                  atributos: { type: 'button', 'aria-label': etiqueta } });
        b.addEventListener('click', alPulsar);
        return b;
    }

    /* Fila que ocupa toda la tabla con un texto ("No hay datos"). */
    function filaVacia(cuerpo, texto, columnas) {
        cuerpo.appendChild(el('tr', { hijos: [el('td', { texto, clase: 'celda-mensaje', atributos: { colspan: String(columnas) } })] }));
    }

    global.PanelUtil = { comoLista, avisoDemo, enviar, mensaje, limpiar, textoError, rellenarSelect, boton, filaVacia };
})(window);
