/*
 * pestanas.js — Pestañas accesibles (patrón ARIA "tabs") compartidas por los paneles
 * ====================================================================================
 * Uso:  const t = Pestanas.iniciar({ botones: '.pe-tab', paneles: ['pe-partidos', 'pe-acta'],
 *                                    porHash: { '#acta': 'pe-acta' }, inicial: 'pe-partidos' });
 *       t.activar('pe-acta');
 * Cada botón lleva data-target="id-del-panel". Teclado: flechas izquierda/derecha, Inicio y Fin.
 */
(function (global) {
    'use strict';

    function iniciar(opciones) {
        const botones = [...document.querySelectorAll(opciones.botones)];
        const paneles = opciones.paneles.map(id => document.getElementById(id));

        function activar(destino) {
            botones.forEach(b => {
                const esta = b.dataset.target === destino;
                b.classList.toggle('active', esta);
                b.setAttribute('aria-selected', String(esta));
                b.setAttribute('tabindex', esta ? '0' : '-1');
                // En móvil la barra de pestañas se desplaza: dejamos la activa a la vista
                if (esta) { try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* navegador antiguo */ } }
            });
            paneles.forEach(p => {
                const es = p.id === destino;
                p.classList.toggle('active', es);
                p.hidden = !es;
            });
        }

        botones.forEach((b, i) => {
            b.addEventListener('click', () => activar(b.dataset.target));
            b.addEventListener('keydown', (e) => {
                const teclas = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: botones.length - 1 };
                if (!(e.key in teclas)) return;
                e.preventDefault();
                const sig = botones[(teclas[e.key] + botones.length) % botones.length];
                activar(sig.dataset.target);
                sig.focus();
            });
        });

        // Un enlace con #algo abre directamente la pestaña que corresponda
        activar((opciones.porHash && opciones.porHash[window.location.hash]) || opciones.inicial);
        return { activar };
    }

    global.Pestanas = { iniciar };
})(window);
