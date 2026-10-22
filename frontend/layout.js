/*
 * layout.js — Plantilla común (B2)
 * Inserta en todas las páginas: enlace «Saltar al contenido», cabecera, navegación
 * (según la sesión), regiones aria-live, indicador de carga, pie y selector de tema.
 *
 * Cada página solo necesita:
 *   <body data-pagina="equipos"  [data-requiere-sesion] [data-roles="COORDINADOR,DESARROLLADOR"]>
 *     <main id="contenido" tabindex="-1"> ... </main>
 *     <script src="api.js"></script><script src="session.js"></script><script src="layout.js"></script>
 */
(function () {
    'use strict';

    // ---------- Tema claro/oscuro (se aplica antes de pintar para evitar parpadeo) ----------
    const CLAVE_TEMA = 'calasanz-tema';
    function temaGuardado() {
        try { return localStorage.getItem(CLAVE_TEMA); } catch (e) { return null; }
    }
    function temaActual() {
        return temaGuardado() ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    function aplicarTema(tema) {
        document.documentElement.setAttribute('data-tema', tema);
    }
    aplicarTema(temaActual());

    function alternarTema(boton) {
        const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(CLAVE_TEMA, nuevo); } catch (e) { /* sin almacenamiento */ }
        aplicarTema(nuevo);
        actualizarBotonTema(boton);
        Api.anunciar(nuevo === 'dark' ? 'Tema oscuro activado' : 'Tema claro activado');
    }
    function actualizarBotonTema(boton) {
        const oscuro = temaActual() === 'dark';
        boton.setAttribute('aria-pressed', String(oscuro));
        boton.textContent = oscuro ? 'Tema claro' : 'Tema oscuro';
    }

    // ---------- Construcción de la plantilla ----------
    const { el } = Api;

    function enlaceNav(texto, href, paginaActual, clave) {
        const a = el('a', { texto, atributos: { href } });
        if (clave && clave === paginaActual) a.setAttribute('aria-current', 'page');
        return el('li', { hijos: [a] });
    }

    function construirCabecera() {
        const img = el('img', { atributos: { src: 'escudo.jpg', alt: 'Escudo del CD. Calasanz' } });
        const h1 = el('p', { texto: 'CD. Calasanz', clase: 'marca' });
        const enlaceMarca = el('a', { hijos: [img, h1], clase: 'marca-enlace', atributos: { href: 'index.html' } });

        const botonTema = el('button', { clase: 'boton boton-secundario', atributos: { type: 'button' } });
        actualizarBotonTema(botonTema);
        botonTema.addEventListener('click', () => alternarTema(botonTema));

        const cab = el('header', { clase: 'cabecera', hijos: [enlaceMarca, botonTema] });
        return cab;
    }

    function construirNav(paginaActual) {
        const lista = el('ul');
        lista.appendChild(enlaceNav('Inicio', 'index.html', paginaActual, 'inicio'));
        lista.appendChild(enlaceNav('Equipos', 'equipos.html', paginaActual, 'equipos'));
        lista.appendChild(enlaceNav('Noticias', 'noticias.html', paginaActual, 'noticias'));
        lista.appendChild(enlaceNav('Contacto', 'contacto.html', paginaActual, 'contacto'));

        const u = Sesion.actual();
        if (u) {
            lista.appendChild(enlaceNav('Mi panel', Sesion.panelUrl(), paginaActual, 'panel'));
            const salir = el('button', { texto: 'Cerrar sesión', clase: 'boton-enlace', atributos: { type: 'button' } });
            salir.addEventListener('click', () => Sesion.logout());
            lista.appendChild(el('li', { hijos: [salir] }));
        } else {
            lista.appendChild(enlaceNav('Iniciar sesión', 'login.html', paginaActual, 'login'));
            lista.appendChild(enlaceNav('Registrarse', 'registro.html', paginaActual, 'registro'));
        }

        const nav = el('nav', { clase: 'nav-principal', atributos: { 'aria-label': 'Principal' } });
        // Botón de menú para móvil (alternativa accesible, no solo CSS)
        const toggle = el('button', {
            texto: 'Menú', clase: 'nav-toggle',
            atributos: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nav-lista' }
        });
        lista.id = 'nav-lista';
        toggle.addEventListener('click', () => {
            const abierto = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!abierto));
            lista.classList.toggle('abierto', !abierto);
        });
        nav.appendChild(toggle);
        nav.appendChild(lista);

        if (u) {
            nav.appendChild(el('p', {
                texto: u.username + ' · ' + Sesion.etiquetaRol(u.rol), clase: 'nav-usuario'
            }));
        }
        return nav;
    }

    function construirPie() {
        const anio = new Date().getFullYear();
        return el('footer', { clase: 'pie', hijos: [
            el('p', { texto: '© ' + anio + ' CD. Calasanz. Todos los derechos reservados.' })
        ]});
    }

    function construirAuxiliares() {
        const salto = el('a', { texto: 'Saltar al contenido', clase: 'saltar', atributos: { href: '#contenido' } });
        salto.addEventListener('click', () => {
            const main = document.getElementById('contenido');
            if (main) main.focus();
        });
        const avisos = el('div', { clase: 'solo-lectores', atributos: { id: 'avisos', role: 'status', 'aria-live': 'polite' } });
        const urgentes = el('div', { clase: 'solo-lectores', atributos: { id: 'avisos-urgentes', role: 'alert', 'aria-live': 'assertive' } });
        const carga = el('div', { texto: 'Cargando…', clase: 'indicador-carga', atributos: { id: 'indicador-carga', hidden: '' } });
        return [salto, avisos, urgentes, carga];
    }

    async function iniciar() {
        const body = document.body;
        const pagina = body.dataset.pagina || '';
        const roles = (body.dataset.roles || '').split(',').map(s => s.trim()).filter(Boolean);
        const exige = body.hasAttribute('data-requiere-sesion') || roles.length > 0;

        // Oculto el contenido protegido hasta saber si hay permiso
        if (exige) body.classList.add('comprobando-sesion');

        let usuario = null;
        try {
            usuario = await Sesion.cargar();
        } catch (e) {
            // Error de servidor al comprobar la sesión: seguimos como anónimo y avisamos
        }

        construirAuxiliares().reverse().forEach(n => body.insertBefore(n, body.firstChild));
        const cab = construirCabecera();
        const nav = construirNav(pagina);
        const main = document.getElementById('contenido');
        if (main) {
            body.insertBefore(nav, main);
            body.insertBefore(cab, nav);
            body.appendChild(construirPie());
        }

        if (exige) {
            const ok = await Sesion.requerir(roles);
            if (!ok) return; // se está redirigiendo
            body.classList.remove('comprobando-sesion');
        }

        // Avisos por parámetro (p. ej. ?aviso=sin_permiso tras una redirección)
        const aviso = new URLSearchParams(window.location.search).get('aviso');
        if (aviso === 'sin_permiso') {
            Api.anunciar('No tienes permiso para acceder a esa página.', true);
            if (main) main.prepend(el('p', {
                texto: 'No tienes permiso para acceder a esa página.',
                clase: 'mensaje mensaje-error', atributos: { role: 'alert' }
            }));
        }

        document.dispatchEvent(new CustomEvent('layout:listo', { detail: { usuario } }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
