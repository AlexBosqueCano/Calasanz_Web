/*
 * contacto.js — Formulario de contacto (contacto.html)
 * =====================================================
 * El contrato de API dice que la página de contacto es ESTÁTICA y no tiene endpoint
 * (docs/API_CONTRATO.md, final del §4). Por eso este formulario NO envía nada a ningún
 * servidor y NO debe decir "mensaje recibido": sería mentira.
 *
 * Lo que hace: valida los campos y abre el programa de correo del usuario con el mensaje
 * ya redactado para info@cdcalasanz.es. Así la consulta llega de verdad.
 */
(function () {
    'use strict';

    const CORREO_CLUB = 'info@cdcalasanz.es';

    const form = document.getElementById('form-contacto');
    const aviso = document.getElementById('contacto-feedback');
    const alternativa = document.getElementById('contacto-alternativa');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();   // evita recargar la página

        if (!form.checkValidity()) { form.reportValidity(); return; }

        const nombre = form.elements.nombre.value.trim();
        const email = form.elements.email.value.trim();
        const motivo = form.elements.motivo.selectedOptions[0].textContent;
        const mensaje = form.elements.mensaje.value.trim();

        // encodeURIComponent convierte los caracteres especiales para que viajen bien en la URL
        const asuntoTexto = 'Consulta web: ' + motivo;
        const cuerpoTexto = `${mensaje}\n\nNombre: ${nombre}\nCorreo de contacto: ${email}`;
        const enlaceMailto = `mailto:${CORREO_CLUB}?subject=${encodeURIComponent(asuntoTexto)}&body=${encodeURIComponent(cuerpoTexto)}`;

        // ALTERNATIVA: rellenamos el bloque con el enlace y el texto para copiar, por si el
        // navegador no sabe abrir "mailto:" (pasa en vistas embebidas como la de Koder en iOS).
        document.getElementById('contacto-enlace-correo').href = enlaceMailto;
        document.getElementById('contacto-copia').value = `Para: ${CORREO_CLUB}\nAsunto: ${asuntoTexto}\n\n${cuerpoTexto}`;
        alternativa.hidden = false;

        aviso.textContent = 'Si tu programa de correo se ha abierto, pulsa "Enviar" allí para que nos llegue. Si no, usa el enlace o copia el mensaje de abajo.';
        aviso.hidden = false;
        Api.anunciar(aviso.textContent);

        window.location.href = enlaceMailto;   // intenta abrir el correo
    });

    /* Botón "Copiar mensaje": usa el portapapeles; si no está disponible, selecciona el texto. */
    document.getElementById('contacto-copiar').addEventListener('click', async () => {
        const caja = document.getElementById('contacto-copia');
        try {
            await navigator.clipboard.writeText(caja.value);
            Api.anunciar('Mensaje copiado.');
        } catch (e) {
            // Sin permiso de portapapeles: dejamos el texto seleccionado para copiarlo a mano
            caja.focus();
            caja.select();
            Api.anunciar('Selecciona el texto y cópialo con el menú del móvil.');
        }
    });
})();
