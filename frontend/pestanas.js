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

    /*
     * @param {object} opciones
     *   botones: selector CSS de los botones de pestaña (cada uno con data-target)
     *   paneles: lista de ids de los paneles, en el mismo orden que los botones
     *   porHash: { '#acta': 'pe-acta' } para abrir una pestaña desde la URL (opcional)
     *   inicial: id del panel que se abre por defecto
     * @returns {{activar: Function}} permite a la página cambiar de pestaña por código
     */
    function iniciar(opciones) {
        const botones = [...document.querySelectorAll(opciones.botones)];
        const paneles = opciones.paneles.map(id => document.getElementById(id));

        // Muestra el panel `destino` y oculta los demás, actualizando también los atributos ARIA.
        function activar(destino) {
            botones.forEach(b => {
                const esta = b.dataset.target === destino;
                b.classList.toggle('active', esta);
                b.setAttribute('aria-selected', String(esta));
                // "Tabindex itinerante": con Tab solo se llega a la pestaña activa; las demás se mueven con flechas.
                b.setAttribute('tabindex', esta ? '0' : '-1');
                // En móvil la barra de pestañas se desplaza: dejamos la activa a la vista
                if (esta) { try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* navegador antiguo */ } }
            });
            paneles.forEach(p => {
                const es = p.id === destino;
                p.classList.toggle('active', es);
                p.hidden = !es;   // hidden también lo oculta a los lectores de pantalla
            });
        }

        botones.forEach((b, i) => {
            b.addEventListener('click', () => activar(b.dataset.target));
            b.addEventListener('keydown', (e) => {
                // Para cada tecla de navegación, índice de la pestaña a la que se salta.
                // El módulo (%) hace que tras la última se vuelva a la primera y viceversa.
                const teclas = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: botones.length - 1 };
                if (!(e.key in teclas)) return;   // otras teclas: no hacemos nada
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
