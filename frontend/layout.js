/*
 * layout.js — Plantilla común de TODAS las páginas (tarea B2)
 * ============================================================
 * Cada página HTML solo trae <header></header>, <main> y <footer></footer> vacíos de
 * navegación. Este fichero rellena la cabecera y el pie con el diseño de Figma, así
 * cualquier cambio de menú se hace en UN solo sitio.
 *
 * ORDEN DE SCRIPTS en cada página (importante: cada uno usa los anteriores):
 *     <script src="api.js"></script>       peticiones al servidor
 *     <script src="session.js"></script>   quién es el usuario
 *     <script src="layout.js"></script>    cabecera, pie y permisos de la página
 *     <script src="loQueHagaLaPagina.js"></script>
 *
 * ATRIBUTOS QUE UNA PÁGINA PUEDE PONER EN <body>:
 *     (nada)                                    → hay que haber iniciado sesión (TODAS las páginas lo exigen)
 *     data-publica                              → página abierta sin sesión (solo login y registro)
 *     data-roles="COORDINADOR,ENTRENADOR"       → además, tener uno de esos roles
 *
 * AVISO A LAS DEMÁS PÁGINAS:
 *   Cuando la cabecera está lista y se ha comprobado la sesión, este fichero lanza el
 *   evento 'layout:listo'. Los scripts de cada página esperan a ese evento antes de
 *   pedir datos:   document.addEventListener('layout:listo', iniciar);
 */
(function () {
    'use strict';

    const { el } = Api;   // Api.el() crea elementos HTML de forma segura (usa textContent)

    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // 2. TEMA CLARO / OSCURO
    //    Se guarda en localStorage solo como comodidad (si el navegador lo bloquea, no pasa nada).
    // ------------------------------------------------------------------
    const CLAVE_TEMA = 'calasanz_tema';

    function leerTemaGuardado() {
        try { return localStorage.getItem(CLAVE_TEMA); } catch (e) { return null; }
    }

    function esTemaOscuro() {
        const guardado = leerTemaGuardado();
        if (guardado) return guardado === 'dark';
        // Sin preferencia guardada: respetamos la del sistema operativo
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    /* Aplica el tema: el CSS usa la clase .dark-mode en <html> y en <body>. */
    function aplicarTema(oscuro) {
        document.documentElement.classList.toggle('dark-mode', oscuro);
        document.body.classList.toggle('dark-mode', oscuro);
    }

    // Lo aplicamos YA (antes de pintar la cabecera) para evitar un parpadeo blanco
    aplicarTema(esTemaOscuro());

    // ------------------------------------------------------------------
    // 3. ELEMENTOS AUXILIARES DE ACCESIBILIDAD
    // ------------------------------------------------------------------

    /*
     * Crea (una sola vez) las zonas que leen en voz alta los lectores de pantalla:
     *   #avisos            → mensajes normales ("Plantilla cargada")
     *   #avisos-urgentes   → errores
     * Api.anunciar() escribe en ellas.
     */
    function crearZonasDeAvisos() {
        if (document.getElementById('avisos')) return;
        document.body.appendChild(el('div', {
            clase: 'solo-lectores',
            atributos: { id: 'avisos', role: 'status', 'aria-live': 'polite' }
        }));
        document.body.appendChild(el('div', {
            clase: 'solo-lectores',
            atributos: { id: 'avisos-urgentes', role: 'alert', 'aria-live': 'assertive' }
        }));
        // Cartel "Cargando…" que api.js enseña mientras hay peticiones en curso
        document.body.appendChild(el('div', {
            texto: 'Cargando…', clase: 'indicador-carga',
            atributos: { id: 'indicador-carga', hidden: '' }
        }));
    }

    // ------------------------------------------------------------------
    // 4. CABECERA
    // ------------------------------------------------------------------

    /* Un enlace del menú principal. `activa` marca la página actual con aria-current. */
    function itemMenu(texto, href, activa) {
        const a = el('a', { texto, clase: 'nav-item' + (activa ? ' active' : ''), atributos: { href } });
        if (activa) a.setAttribute('aria-current', 'page');
        return el('li', { hijos: [a] });
    }

    /* Construye la cabecera completa (logo, menú, botón de tema y zona de sesión). */
    function construirCabecera(cabecera) {
        const pagina = window.location.pathname.split('/').pop() || 'index.html';
        // "Equipos" también debe verse activo en las páginas que cuelgan de ella
        const esEquipos = ['equipos.html', 'equipo.html', 'jugador.html', 'acta.html'].includes(pagina);

        cabecera.className = 'site-header';
        cabecera.textContent = '';   // borra lo que hubiera dentro

        // "Saltar al contenido": primer elemento enfocable para quien navega con teclado
        const saltar = el('a', { texto: 'Saltar al contenido', clase: 'skip-link', atributos: { href: '#main-content' } });

        const marca = el('a', { clase: 'brand-link', atributos: { href: 'index.html' }, hijos: [
            el('img', { atributos: { src: 'escudo.jpg', alt: 'Escudo del CD. Calasanz' } }),
            el('div', { clase: 'brand-text', hijos: [
                el('span', { texto: 'CD. CALASANZ', clase: 'brand-title' }),
                el('span', { texto: 'SANTANDER', clase: 'brand-subtitle' })
            ]})
        ]});

        const menu = el('nav', { clase: 'main-nav', atributos: { 'aria-label': 'Navegación principal' }, hijos: [
            el('ul', { hijos: [
                itemMenu('Inicio', 'index.html', pagina === 'index.html'),
                itemMenu('Equipos', 'equipos.html', esEquipos),
                itemMenu('Noticias', 'noticias.html', pagina === 'noticias.html'),
                itemMenu('Contacto', 'contacto.html', pagina === 'contacto.html')
            ]})
        ]});

        // Zona de la cuenta (inicial del usuario + menú, o enlaces de acceso): se rellena en
        // pintarZonaSesion() cuando sabemos quién es el usuario. El cambio de tema está dentro de ese menú.
        const acciones = el('div', { clase: 'header-actions', atributos: { id: 'zona-sesion' } });

        cabecera.appendChild(saltar);
        // En login y registro no hay menú: todavía no se puede navegar sin cuenta
        const publica = document.body.hasAttribute('data-publica');
        cabecera.appendChild(el('div', { clase: 'header-inner', hijos: publica ? [marca, acciones] : [marca, menu, acciones] }));
    }

    /*
     * MENÚ DE LA CUENTA
     * -----------------
     * Botón redondo con la inicial del usuario. Al pulsarlo se abre un panel con sus opciones.
     * Patrón accesible "desplegable": el botón lleva aria-expanded y aria-controls; Escape lo cierra
     * y devuelve el foco al botón; también se cierra al hacer clic fuera o al salir con Tab.
     * Los datos del usuario (su nombre) se escriben con textContent: nunca como HTML.
     */
    function opcionesCuenta(usuario) {
        const rol = usuario.rol;
        const o = [];
        // Cada opción: { texto, href }  (o { texto, accion } para botones)
        if (rol === 'JUGADOR') {
            o.push({ texto: 'Mi panel', href: 'panel-jugador.html' });
            if (usuario.jugador_id) o.push({ texto: 'Mis estadísticas', href: 'jugador.html?id=' + encodeURIComponent(usuario.jugador_id) });
            if (usuario.equipo_id) o.push({ texto: 'Mi equipo', href: 'equipo.html?id=' + encodeURIComponent(usuario.equipo_id) });
            o.push({ texto: 'Histórico de lesiones', href: 'historico-lesiones.html' });
        } else if (rol === 'ENTRENADOR') {
            // "Mi equipo" reúne todo lo del entrenador: partidos, actas, crónicas, lesiones y apuntes
            o.push({ texto: 'Mi equipo', href: 'panel-entrenador.html' });
            if (usuario.equipo_id) o.push({ texto: 'Ver la web de mi equipo', href: 'equipo.html?id=' + encodeURIComponent(usuario.equipo_id) });
            o.push({ texto: 'Histórico de lesiones', href: 'historico-lesiones.html' });
        } else if (rol === 'COORDINADOR' || rol === 'DESARROLLADOR') {
            o.push({ texto: 'Gestión del club', href: 'panel-coordinador.html' });
            o.push({ texto: 'Partidos, actas y crónicas', href: 'panel-entrenador.html' });
            o.push({ texto: 'Histórico de lesiones', href: 'historico-lesiones.html' });
        } else {
            // ESTANDAR: aún no está vinculado al club
            o.push({ texto: 'Solicitar acceso como jugador o entrenador', href: 'solicitud.html' });
        }
        o.push({ texto: 'Mi cuenta', href: 'mi-cuenta.html' });
        o.push({ texto: 'Cambiar contraseña', href: 'mi-cuenta.html#password' });
        return o;
    }

    function construirMenuCuenta(usuario) {
        const inicial = (usuario.username || '?').charAt(0).toUpperCase();
        const boton = el('button', { clase: 'cuenta-boton', atributos: {
            type: 'button', id: 'cuenta-boton', 'aria-expanded': 'false', 'aria-controls': 'cuenta-panel',
            'aria-label': 'Mi cuenta: ' + usuario.username
        }, hijos: [el('span', { texto: inicial, atributos: { 'aria-hidden': 'true' } })] });

        const lista = el('ul', { clase: 'cuenta-lista' });
        opcionesCuenta(usuario).forEach(op => {
            lista.appendChild(el('li', { hijos: [el('a', { texto: op.texto, clase: 'cuenta-opcion', atributos: { href: op.href } })] }));
        });

        // Cambiar tema (claro / oscuro): el botón dice a qué tema se pasa
        const botonTema = el('button', { clase: 'cuenta-opcion', atributos: { type: 'button' } });
        const pintarTema = () => {
            const oscuro = document.documentElement.classList.contains('dark-mode');
            botonTema.textContent = oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
        };
        pintarTema();
        botonTema.addEventListener('click', () => {
            const oscuro = !document.documentElement.classList.contains('dark-mode');
            try { localStorage.setItem(CLAVE_TEMA, oscuro ? 'dark' : 'light'); } catch (e) { /* sin almacenamiento */ }
            aplicarTema(oscuro);
            pintarTema();
            Api.anunciar(oscuro ? 'Tema oscuro activado.' : 'Tema claro activado.');
        });
        lista.appendChild(el('li', { hijos: [botonTema] }));

        const salir = el('button', { texto: 'Cerrar sesión', clase: 'cuenta-opcion cuenta-salir', atributos: { type: 'button' } });
        salir.addEventListener('click', () => Sesion.logout());
        lista.appendChild(el('li', { hijos: [salir] }));

        const hijosPanel = [
            el('div', { clase: 'cuenta-cabecera', hijos: [
                el('strong', { texto: usuario.username }),
                el('span', { texto: Sesion.etiquetaRol(usuario.rol) })
            ]}),
            lista
        ];

        // Solo en modo demostración: elegir con qué rol se ve la web (para probar cada versión)
        if (Sesion.enModoDemo()) {
            const selector = el('select', { atributos: { id: 'cuenta-rol-demo' } });
            Sesion.ROLES.forEach(r => selector.appendChild(el('option', { texto: Sesion.etiquetaRol(r), atributos: { value: r } })));
            selector.value = usuario.rol;
            selector.addEventListener('change', () => {
                Sesion.establecerRolDemo(selector.value);
                // Al cambiar de rol la página actual puede no estar permitida: volvemos al inicio
                window.location.href = 'index.html';
            });
            hijosPanel.push(el('div', { clase: 'cuenta-demo', hijos: [
                el('label', { texto: 'Modo demostración: ver como', atributos: { for: 'cuenta-rol-demo' } }), selector
            ]}));
        }

        const panel = el('div', { clase: 'cuenta-panel', atributos: { id: 'cuenta-panel', hidden: '', role: 'group', 'aria-label': 'Opciones de la cuenta' }, hijos: hijosPanel });
        const caja = el('div', { clase: 'cuenta', hijos: [boton, panel] });

        function abrir(abierto) {
            panel.hidden = !abierto;
            boton.setAttribute('aria-expanded', String(abierto));
        }
        boton.addEventListener('click', () => abrir(panel.hidden));
        caja.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.hidden) { abrir(false); boton.focus(); }
        });
        // Si el foco sale del menú (Tab) o se hace clic fuera, se cierra
        caja.addEventListener('focusout', (e) => { if (!panel.hidden && !caja.contains(e.relatedTarget)) abrir(false); });
        document.addEventListener('click', (e) => { if (!panel.hidden && !caja.contains(e.target)) abrir(false); });
        return caja;
    }

    /* Rellena la parte derecha de la cabecera: menú de la cuenta, o (en login/registro) el enlace a la otra página. */
    function pintarZonaSesion() {
        const zona = document.getElementById('zona-sesion');
        if (!zona) return;
        zona.textContent = '';

        const usuario = Sesion.actual();
        if (usuario) {
            zona.appendChild(construirMenuCuenta(usuario));
        } else if (document.body.hasAttribute('data-publica')) {
            const pagina = window.location.pathname.split('/').pop();
            if (pagina === 'registro.html') zona.appendChild(el('a', { texto: 'Iniciar sesión', clase: 'btn-login-header', atributos: { href: 'login.html' } }));
            else zona.appendChild(el('a', { texto: 'Crear cuenta', clase: 'btn-login-header', atributos: { href: 'registro.html' } }));
        }
    }

    // ------------------------------------------------------------------
    // 5. PIE
    // ------------------------------------------------------------------
    function construirPie(pie) {
        pie.className = 'site-footer';
        pie.textContent = '';
        pie.appendChild(el('div', { clase: 'footer-inner', hijos: [
            el('span', { texto: '© ' + new Date().getFullYear() + ' CD. Calasanz Santander', clase: 'footer-copy' }),
            // En login y registro no se enseñan enlaces: el resto de la web exige haber iniciado sesión
            el('div', { clase: 'footer-links', hijos: document.body.hasAttribute('data-publica') ? [] : [
                enlaceFlecha('Noticias', 'noticias.html'),
                enlaceFlecha('Contacto', 'contacto.html')
            ]}),
            el('span', { texto: 'VERDE Y BLANCO. SIEMPRE.', clase: 'footer-motto' })
        ]}));
    }

    /* Enlace con la flecha "→" del diseño. La flecha es decorativa: aria-hidden. */
    function enlaceFlecha(texto, href) {
        return el('a', { clase: 'link-arrow', atributos: { href }, hijos: [
            document.createTextNode(texto + ' '),
            el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } })
        ]});
    }

    // ------------------------------------------------------------------
    // 6. OTROS AJUSTES COMUNES
    // ------------------------------------------------------------------

    /* Envuelve cada tabla en un contenedor que desliza en horizontal en móvil. */
    function envolverTablas() {
        document.querySelectorAll('table.modern-table').forEach(tabla => {
            if (tabla.parentElement.classList.contains('table-responsive')) return;
            const envoltorio = el('div', { clase: 'table-responsive' });
            tabla.parentNode.insertBefore(envoltorio, tabla);
            envoltorio.appendChild(tabla);
        });
    }

    /* Avisos que llegan por la URL (?aviso=sin_permiso) o por estar en modo demostración. */
    function mostrarAvisosDePagina(main) {
        const avisos = [];

        if (new URLSearchParams(window.location.search).get('aviso') === 'sin_permiso') {
            avisos.push({ clase: 'banner-aviso banner-error', texto: 'No tienes permiso para acceder a esa página.', urgente: true });
        }
        if (Sesion.enModoDemo()) {
            avisos.push({
                clase: 'banner-aviso banner-demo',
                texto: 'Modo demostración: no hay conexión con el servidor, así que se muestran datos de ejemplo.'
            });
        }
        // El banner va al principio de <main>, antes del resto del contenido
        avisos.reverse().forEach(a => {
            main.insertBefore(el('p', { texto: a.texto, clase: a.clase, atributos: { role: a.urgente ? 'alert' : 'status' } }), main.firstChild);
        });
    }

    // ------------------------------------------------------------------
    // 7. ARRANQUE
    // ------------------------------------------------------------------
    async function iniciar() {
        const body = document.body;

        // Las páginas traen <header></header> y <footer></footer> vacíos; si faltan, los creamos
        let cabecera = body.querySelector(':scope > header');
        if (!cabecera) { cabecera = el('header'); body.prepend(cabecera); }
        let pie = body.querySelector(':scope > footer');
        if (!pie) { pie = el('footer'); body.appendChild(pie); }

        const main = body.querySelector('main');
        if (main && !main.id) main.id = 'main-content';
        if (main) main.setAttribute('tabindex', '-1');   // para que "Saltar al contenido" pueda enfocarlo

        // ¿Esta página exige un rol concreto?
        const roles = (body.dataset.roles || '').split(',').map(s => s.trim()).filter(Boolean);
        // Toda la web exige sesión salvo login y registro (marcadas con data-publica)
        const exige = !body.hasAttribute('data-publica');
        if (exige) body.classList.add('comprobando-sesion');   // oculta el contenido hasta saber si hay permiso

        crearZonasDeAvisos();
        construirCabecera(cabecera);
        construirPie(pie);
        envolverTablas();

        // Preguntamos al servidor quién es el usuario
        try {
            await Sesion.cargar();
        } catch (error) {
            // Fallo raro del servidor (500...): seguimos como visitante y avisamos
            Api.anunciar('No se pudo comprobar la sesión.', true);
        }
        pintarZonaSesion();

        // Comprobamos permisos de la página
        if (exige) {
            const permitido = await Sesion.requerir(roles);
            if (!permitido) return;   // ya se está redirigiendo
            body.classList.remove('comprobando-sesion');
        }

        if (main) mostrarAvisosDePagina(main);

        // Avisamos al resto de scripts de la página de que ya pueden pedir datos
        document.dispatchEvent(new CustomEvent('layout:listo', { detail: { usuario: Sesion.actual() } }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
