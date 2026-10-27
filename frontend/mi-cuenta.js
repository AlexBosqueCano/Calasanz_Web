/*
 * mi-cuenta.js — Mis datos y cambio de contraseña (mi-cuenta.html)
 * =================================================================
 * Datos: salen del usuario de la sesión (GET /api/auth/yo, ya cargado por session.js).
 * Cambio de contraseña: POST /api/auth/cambiar-password { password_actual, password_nueva }
 *   → 204 · 403 (la contraseña actual no es correcta) · 422 (la nueva no cumple las reglas) · 429.
 *
 * Las reglas de la contraseña nueva son las de docs/API_CONTRATO.md §5 (10-128 caracteres y distinta
 * del nombre de usuario). El cliente las comprueba solo para responder rápido: manda el servidor.
 * Las contraseñas NUNCA se recortan, ni se guardan, ni se escriben en la página.
 */
(function () {
    'use strict';

    // `el` crea elementos sin innerHTML; `U` agrupa utilidades de paneles (mensajes, envío a la API...).
    const { el } = Api;
    const U = PanelUtil;
    // Atajo para document.getElementById.
    const $ = (id) => document.getElementById(id);

    /* Marca un campo como erróneo (aria-invalid) para lectores de pantalla. */
    function marcar(campo, activo) {
        if (activo) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid');
    }

    // Valida el formulario de cambio de contraseña y, si es correcto, lo envía a la API.
    async function cambiar(evento) {
        evento.preventDefault();   // evita que el navegador recargue la página
        U.limpiar('mc-feedback');
        const errores = $('mc-errores');
        errores.textContent = ''; errores.hidden = true;
        // Referencias a los tres campos de contraseña para marcarlos y vaciarlos después.
        const campos = { actual: $('mc-actual'), nueva: $('mc-nueva'), repetir: $('mc-repetir') };
        Object.values(campos).forEach(c => marcar(c, false));

        const usuario = Sesion.actual();
        const actual = campos.actual.value, nueva = campos.nueva.value, repetir = campos.repetir.value;
        const fallos = [];   // [{ campo, texto }]
        // Reglas de la contraseña nueva (contrato §5). Se recogen TODOS los fallos para mostrarlos a la vez.
        if (!actual) fallos.push({ campo: campos.actual, texto: 'Escribe tu contraseña actual.' });
        if (nueva.length < 10 || nueva.length > 128) fallos.push({ campo: campos.nueva, texto: 'La contraseña nueva debe tener entre 10 y 128 caracteres.' });
        else if (usuario && nueva.toLowerCase() === usuario.username.toLowerCase()) fallos.push({ campo: campos.nueva, texto: 'La contraseña nueva no puede ser igual que tu nombre de usuario.' });
        else if (nueva === actual) fallos.push({ campo: campos.nueva, texto: 'La contraseña nueva debe ser distinta de la actual.' });
        if (repetir !== nueva) fallos.push({ campo: campos.repetir, texto: 'Las contraseñas nuevas no coinciden.' });

        // Si hay fallos: lista visible, campos marcados y foco en el primero (accesibilidad con teclado/lector).
        if (fallos.length) {
            errores.appendChild(el('ul', { hijos: fallos.map(f => el('li', { texto: f.texto })) }));
            errores.hidden = false;
            fallos.forEach(f => marcar(f.campo, true));
            fallos[0].campo.focus();
            return;
        }

        const boton = $('mc-form').querySelector('button[type="submit"]');
        boton.disabled = true;   // evita envíos duplicados
        try {
            // En modo demostración U.enviar no llama al servidor. Tras el éxito se vacían los campos:
            // la contraseña no debe quedarse escrita en la página.
            await U.enviar('post', '/auth/cambiar-password', { password_actual: actual, password_nueva: nueva });
            Object.values(campos).forEach(c => { c.value = ''; });
            U.mensaje('mc-feedback', 'Contraseña cambiada correctamente.' + U.avisoDemo(), 'ok');
        } catch (error) {
            // 403 = la contraseña actual no es correcta; 422 = la nueva no cumple las reglas
            if (error.status === 403) marcar(campos.actual, true);
            U.mensaje('mc-feedback', U.textoError(error), 'error');
            campos.actual.value = '';
            campos.actual.focus();
        } finally {
            boton.disabled = false;
        }
    }

    // Pinta los datos de la sesión y engancha el formulario. No pide nada al servidor: el usuario ya está cargado.
    function iniciar() {
        const usuario = Sesion.actual();
        if (usuario) {
            $('mc-usuario').textContent = usuario.username;
            $('mc-email').textContent = usuario.email || '—';
            $('mc-rol').textContent = Sesion.etiquetaRol(usuario.rol);
        }
        $('mc-form').addEventListener('submit', cambiar);
        // Con #password en la dirección, el foco va directo al formulario
        if (window.location.hash === '#password') $('mc-actual').focus();
    }

    // layout.js avisa con este evento cuando la sesión ya está comprobada.
    document.addEventListener('layout:listo', iniciar);
})();
