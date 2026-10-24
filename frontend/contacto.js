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
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();   // evita recargar la página

        if (!form.checkValidity()) { form.reportValidity(); return; }

        const nombre = form.elements.nombre.value.trim();
        const email = form.elements.email.value.trim();
        const motivo = form.elements.motivo.selectedOptions[0].textContent;
        const mensaje = form.elements.mensaje.value.trim();

        // encodeURIComponent convierte los caracteres especiales para que viajen bien en la URL
        const asunto = encodeURIComponent('Consulta web: ' + motivo);
        const cuerpo = encodeURIComponent(`${mensaje}\n\nNombre: ${nombre}\nCorreo de contacto: ${email}`);
        window.location.href = `mailto:${CORREO_CLUB}?subject=${asunto}&body=${cuerpo}`;

        aviso.textContent = 'Se ha abierto tu programa de correo con el mensaje preparado. Pulsa "Enviar" allí para que nos llegue.';
        aviso.hidden = false;
        Api.anunciar(aviso.textContent);
    });
})();
