/*
 * auth.js — Lógica de las páginas de LOGIN y REGISTRO
 * ====================================================
 * Este fichero lo cargan login.html y registro.html (después de api.js, session.js y layout.js).
 *
 * ¿Qué hace?
 *   1. Login:    envía usuario y contraseña a POST /api/auth/login.
 *                Si va bien, guarda el token CSRF y redirige a la página que se pidió
 *                (o al inicio).
 *   2. Registro: envía usuario, email y contraseña a POST /api/auth/registro.
 *                Si va bien, hace login automático.
 *
 * ¿Por qué validamos aquí si el servidor ya valida?
 *   El cliente valida SOLO para dar una respuesta rápida al usuario (UX).
 *   La validación que cuenta (seguridad) es la del servidor, que es la que
 *   nunca debemos saltarnos. Por eso las reglas de aquí se copian de
 *   docs/API_CONTRATO.md §5 y, si el servidor rechaza algo, mostramos SU mensaje.
 */
(function () {
    'use strict';

    // Atajo: Api.el() crea elementos HTML de forma segura (usa textContent, nunca innerHTML)
    const { el } = Api;

    // ------------------------------------------------------------------
    // 1. REGLAS DE VALIDACIÓN (copia de API_CONTRATO.md §5 "Usuarios")
    // ------------------------------------------------------------------
    // Cada función recibe el valor del campo y devuelve:
    //   - un texto con el error si NO es válido
    //   - null si es válido
    const REGLAS = {
        username(valor) {
            // 3–30 caracteres; solo letras, números, "_", "." y "-"
            if (!/^[A-Za-z0-9_.-]{3,30}$/.test(valor)) {
                return 'Entre 3 y 30 caracteres: solo letras, números, guion bajo, punto y guion.';
            }
            return null;
        },
        email(valor) {
            // Comprobación sencilla de formato; el servidor hace la definitiva (máx. 254)
            if (valor.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
                return 'Escribe un correo electrónico válido, por ejemplo nombre@dominio.com.';
            }
            return null;
        },
        password(valor, todos) {
            // 10–128 caracteres y distinta del nombre de usuario
            if (valor.length < 10 || valor.length > 128) {
                return 'La contraseña debe tener entre 10 y 128 caracteres.';
            }
            if (todos.username && valor.toLowerCase() === todos.username.toLowerCase()) {
                return 'La contraseña no puede ser igual que el nombre de usuario.';
            }
            return null;
        },
        password2(valor, todos) {
            // Solo en el registro: la repetición debe coincidir
            if (valor !== todos.password) return 'Las contraseñas no coinciden.';
            return null;
        }
    };

    // ------------------------------------------------------------------
    // 2. FUNCIONES AUXILIARES PARA MOSTRAR ERRORES (accesibles)
    // ------------------------------------------------------------------

    /* Borra todos los errores que hubiera en el formulario (los de campo y el general). */
    function limpiarErrores(form, zonaMensajes) {
        zonaMensajes.textContent = '';
        // aria-invalid le dice a un lector de pantalla que el campo tiene un error
        form.querySelectorAll('[aria-invalid]').forEach(c => {
            c.removeAttribute('aria-invalid');
            c.removeAttribute('aria-describedby');
        });
        form.querySelectorAll('.error-campo').forEach(n => n.remove());
    }

    /*
     * Pone un mensaje de error justo debajo de un campo.
     * - aria-invalid="true": marca el campo como erróneo.
     * - aria-describedby: enlaza el campo con el texto del error, para que el lector
     *   de pantalla lo lea al enfocar el campo.
     */
    function errorEnCampo(campo, mensaje) {
        const idError = 'error-' + campo.id;
        campo.setAttribute('aria-invalid', 'true');
        campo.setAttribute('aria-describedby', idError);
        // En el diseño nuevo algunos campos van dentro de .input-with-icon (con iconos
        // colocados encima). El mensaje se pone DESPUÉS de ese envoltorio para no romper el diseño.
        const referencia = campo.closest('.input-with-icon') || campo;
        referencia.insertAdjacentElement('afterend',
            el('span', { texto: mensaje, clase: 'error-campo', atributos: { id: idError } }));
    }

    /*
     * Botón del "ojo" del campo contraseña: alterna entre ocultar y mostrar.
     * Antes este código estaba escrito dentro de login.html; los scripts van en ficheros .js.
     * aria-pressed + aria-label permiten a un lector de pantalla saber qué hace y en qué estado está.
     */
    function iniciarOjoContrasena() {
        const boton = document.getElementById('toggle-pass');
        const campo = document.getElementById('password');
        if (!boton || !campo) return;

        boton.addEventListener('click', () => {
            const mostrar = campo.type === 'password';
            campo.type = mostrar ? 'text' : 'password';
            boton.setAttribute('aria-pressed', String(mostrar));
            boton.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    }

    /*
     * Valida los campos indicados con REGLAS. Devuelve true si todo está bien.
     * Si hay errores, los pinta y pone el foco en el PRIMER campo con error
     * (así quien usa teclado o lector de pantalla sabe dónde corregir).
     */
    function validarCampos(form, nombresCampos) {
        // Recogemos los valores actuales en un objeto { username: '...', email: '...' }
        const valores = {};
        nombresCampos.forEach(n => { valores[n] = form.elements[n].value.trim(); });
        // La contraseña NO se recorta (los espacios al final podrían ser parte de ella)
        if (form.elements.password) valores.password = form.elements.password.value;
        if (form.elements.password2) valores.password2 = form.elements.password2.value;

        let primerError = null;
        nombresCampos.forEach(nombre => {
            const mensaje = REGLAS[nombre](valores[nombre], valores);
            if (mensaje) {
                errorEnCampo(form.elements[nombre], mensaje);
                if (!primerError) primerError = form.elements[nombre];
            }
        });
        if (primerError) { primerError.focus(); return false; }
        return true;
    }

    /*
     * Pinta los errores que devuelve el SERVIDOR.
     * El contrato dice que un error 422 trae: detalles: [{ campo, mensaje }, ...]
     */
    function mostrarErrorServidor(form, zonaMensajes, error) {
        // Mensaje general arriba (con role="alert" para que se lea enseguida)
        Api.mostrarError(zonaMensajes, error);
        // Y además marcamos cada campo concreto que el servidor señale
        (error.detalles || []).forEach(d => {
            const campo = form.elements[d.campo];
            if (campo) errorEnCampo(campo, d.mensaje);
        });
        const primero = form.querySelector('[aria-invalid="true"]');
        if (primero) primero.focus();
    }

    /*
     * Bloquea el botón mientras se espera la respuesta.
     * Así evitamos que el usuario pulse dos veces y se envíe el formulario duplicado.
     */
    function esperando(boton, activo, textoNormal) {
        boton.disabled = activo;
        // El botón tiene el texto en <span class="btn-texto"> y la flecha decorativa aparte:
        // así cambiamos solo el texto y la flecha del diseño se conserva.
        const etiqueta = boton.querySelector('.btn-texto') || boton;
        etiqueta.textContent = activo ? 'Enviando…' : textoNormal;
    }

    // ------------------------------------------------------------------
    // 3. LOGIN
    // ------------------------------------------------------------------
    function iniciarLogin() {
        const form = document.getElementById('form-login');
        if (!form) return; // esta página no es el login: no hacemos nada

        const zona = document.getElementById('mensajes-formulario');
        const boton = form.querySelector('button[type="submit"]');

        // Mensajes informativos según cómo llegó el usuario aquí (?motivo=...)
        // Ejemplo: session.js redirige con ?motivo=sesion si hacía falta iniciar sesión.
        const motivo = new URLSearchParams(window.location.search).get('motivo');
        const textosMotivo = {
            sesion: 'Necesitas iniciar sesión para ver esa página.',
            caducada: 'Tu sesión ha caducado. Inicia sesión de nuevo.',
            logout: 'Has cerrado sesión correctamente.',
            registrado: 'Cuenta creada. Ya puedes iniciar sesión.'
        };
        if (textosMotivo[motivo]) {
            zona.appendChild(el('p', {
                texto: textosMotivo[motivo],
                clase: 'mensaje ' + (motivo === 'logout' || motivo === 'registrado' ? 'mensaje-ok' : 'mensaje-aviso'),
                atributos: { role: 'status' }
            }));
        }

        form.addEventListener('submit', async (evento) => {
            // preventDefault: evita que el navegador recargue la página al enviar
            evento.preventDefault();
            limpiarErrores(form, zona);

            // En el login solo comprobamos que no estén vacíos. NO aplicamos las reglas
            // de formato: no queremos dar pistas sobre qué usuarios o contraseñas existen.
            const username = form.elements.username.value.trim();
            const password = form.elements.password.value;
            let hayError = false;
            if (!username) { errorEnCampo(form.elements.username, 'Escribe tu nombre de usuario.'); hayError = true; }
            if (!password) { errorEnCampo(form.elements.password, 'Escribe tu contraseña.'); hayError = true; }
            if (hayError) { form.querySelector('[aria-invalid="true"]').focus(); return; }

            esperando(boton, true, 'Iniciar sesión');
            try {
                // El servidor responde { usuario, csrf_token } si las credenciales son correctas
                const datos = await Api.post('/auth/login', { username, password });
                Api.setCsrfToken(datos.csrf_token);
                // Forzamos recargar el estado de sesión y vamos a la página de destino
                await Sesion.cargar(true);
                window.location.href = Sesion.destinoTrasLogin();
            } catch (error) {
                // 401 = credenciales incorrectas (mensaje genérico a propósito)
                // 429 = demasiados intentos (el servidor limita a 5 cada 15 min)
                Api.mostrarError(zona, error);
                // Vaciamos la contraseña y devolvemos el foco para volver a intentarlo
                form.elements.password.value = '';
                form.elements.password.focus();
            } finally {
                esperando(boton, false, 'Iniciar sesión');
            }
        });
    }

    // ------------------------------------------------------------------
    // 4. REGISTRO
    // ------------------------------------------------------------------
    function iniciarRegistro() {
        const form = document.getElementById('form-registro');
        if (!form) return;

        const zona = document.getElementById('mensajes-formulario');
        const boton = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', async (evento) => {
            evento.preventDefault();
            limpiarErrores(form, zona);

            // 1) Validación rápida en el cliente
            if (!validarCampos(form, ['username', 'email', 'password', 'password2'])) return;

            esperando(boton, true, 'Crear cuenta');
            try {
                // 2) Enviamos al servidor. OJO: password2 NO se envía, solo sirve en el cliente.
                await Api.post('/auth/registro', {
                    username: form.elements.username.value.trim(),
                    email: form.elements.email.value.trim(),
                    password: form.elements.password.value
                });
                // 3) Cuenta creada: llevamos al login con un aviso de éxito
                window.location.href = 'login.html?motivo=registrado';
            } catch (error) {
                // 409 = usuario o email ya existen; 422 = datos inválidos; 429 = demasiados registros
                mostrarErrorServidor(form, zona, error);
            } finally {
                esperando(boton, false, 'Crear cuenta');
            }
        });
    }

    // Si ya hay sesión iniciada, no tiene sentido ver login/registro: vamos al inicio.
    // 'layout:listo' lo lanza layout.js cuando ya sabe si hay sesión.
    document.addEventListener('layout:listo', (evento) => {
        if (evento.detail.usuario) {
            window.location.replace('index.html');
            return;
        }
        iniciarLogin();
        iniciarRegistro();
        iniciarOjoContrasena();
    });
})();
