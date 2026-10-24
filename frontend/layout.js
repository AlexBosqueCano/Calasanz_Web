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
 *     data-requiere-sesion                      → hay que haber iniciado sesión
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
    // 1. ICONOS (SVG fijos del propio código; no contienen datos de usuarios)
    // ------------------------------------------------------------------
    const ICONO_SOL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    const ICONO_LUNA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

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

    /* Actualiza el botón de tema: icono, etiqueta y estado (aria-pressed). */
    function pintarBotonTema(boton) {
        const oscuro = document.documentElement.classList.contains('dark-mode');
        boton.innerHTML = oscuro ? ICONO_LUNA : ICONO_SOL;   // iconos fijos: es seguro
        boton.setAttribute('aria-pressed', String(oscuro));
        boton.setAttribute('aria-label', oscuro ? 'Activar tema claro' : 'Activar tema oscuro');
    }

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

        // Botón de tema
        const botonTema = el('button', { clase: 'btn-theme-icon', atributos: { type: 'button', id: 'btn-tema' } });
        pintarBotonTema(botonTema);
        botonTema.addEventListener('click', () => {
            const oscuro = !document.documentElement.classList.contains('dark-mode');
            try { localStorage.setItem(CLAVE_TEMA, oscuro ? 'dark' : 'light'); } catch (e) { /* sin almacenamiento */ }
            aplicarTema(oscuro);
            pintarBotonTema(botonTema);
            Api.anunciar(oscuro ? 'Tema oscuro activado.' : 'Tema claro activado.');
        });

        // Zona de sesión: se rellena en pintarZonaSesion() cuando sabemos quién es el usuario
        const acciones = el('div', { clase: 'header-actions', atributos: { id: 'zona-sesion' }, hijos: [botonTema] });

        cabecera.appendChild(saltar);
        cabecera.appendChild(el('div', { clase: 'header-inner', hijos: [marca, menu, acciones] }));
    }

    /*
     * Rellena la parte derecha de la cabecera según haya sesión o no.
     * Los datos del usuario (su nombre) se escriben con textContent: nunca como HTML.
     */
    function pintarZonaSesion() {
        const zona = document.getElementById('zona-sesion');
        if (!zona) return;
        // Quitamos lo anterior, salvo el botón de tema (el primer hijo)
        while (zona.children.length > 1) zona.removeChild(zona.lastChild);

        const usuario = Sesion.actual();
        if (usuario) {
            const panel = Sesion.panelUrl();
            if (panel) {
                zona.appendChild(el('a', {
                    texto: 'Mi panel', clase: 'link-register-header link-panel-header',
                    atributos: { href: panel }
                }));
            }
            // El nombre y el rol van como texto para lectores de pantalla y visible en pantallas anchas
            zona.appendChild(el('span', {
                texto: usuario.username + ' · ' + Sesion.etiquetaRol(usuario.rol), clase: 'usuario-activo'
            }));
            const salir = el('button', { texto: 'Cerrar sesión', clase: 'btn-login-header', atributos: { type: 'button' } });
            salir.addEventListener('click', () => Sesion.logout());
            zona.appendChild(salir);
        } else {
            zona.appendChild(el('a', { texto: 'Registrarse', clase: 'link-register-header', atributos: { href: 'registro.html' } }));
            zona.appendChild(el('a', { texto: 'Iniciar sesión', clase: 'btn-login-header', atributos: { href: 'login.html' } }));
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
            el('div', { clase: 'footer-links', hijos: [
                enlaceFlecha('Noticias', 'noticias.html'),
                enlaceFlecha('Contacto', 'contacto.html'),
                enlaceFlecha('Registrarse', 'registro.html')
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

        // ¿Esta página exige sesión o un rol concreto?
        const roles = (body.dataset.roles || '').split(',').map(s => s.trim()).filter(Boolean);
        const exige = body.hasAttribute('data-requiere-sesion') || roles.length > 0;
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
