/*
 * noticias.js — Lista de noticias y eventos con filtro (noticias.html)
 * =====================================================================
 * GET /api/noticias?tipo=   → { items: [...], page, por_pagina, total } (más recientes primero)
 * Cada noticia: { id, titulo, cuerpo, tipo: 'noticia' | 'evento', fecha_evento?, publicada_en }
 *
 * El filtro (Todas / Noticias / Eventos) se aplica en el navegador con los datos ya
 * descargados, sin nuevas peticiones.
 * SEGURIDAD: los textos se escriben con Api.el() (textContent), nunca con innerHTML.
 */
(function () {
    'use strict';

    const { el } = Api;

    // Nombre visible de cada tipo
    const ETIQUETA_TIPO = { noticia: 'NOTICIA', evento: 'EVENTO', cronica: 'CRÓNICA' };

    function crearTarjeta(n) {
        const fecha = n.tipo === 'evento' && n.fecha_evento ? n.fecha_evento : n.publicada_en;
        const meta = el('div', { clase: 'news-card-meta', hijos: [
            el('span', { texto: ETIQUETA_TIPO[n.tipo] || 'NOTICIA' }),
            el('span', { texto: Api.formatearFecha(fecha) })
        ]});

        const contenido = el('div', { hijos: [meta, el('h3', { texto: n.titulo }), el('p', { texto: n.cuerpo, clase: 'news-card-texto' })] });
        const hijos = [contenido];

        // "enlace" y "texto_enlace" no están en el contrato (solo existen en los datos de ejemplo):
        // los usamos únicamente si llegan, y solo para rutas internas del propio sitio
        if (n.enlace && /^[\w\-./?=&]+$/.test(n.enlace)) {
            hijos.push(el('a', { clase: 'link-arrow', atributos: { href: n.enlace }, hijos: [
                document.createTextNode((n.texto_enlace || 'Leer más') + ' '),
                el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } })
            ]}));
        }
        return el('article', { clase: 'news-card', atributos: { 'data-tipo': n.tipo }, hijos });
    }

    /*
     * Las crónicas (GET /api/cronicas) las escriben los entrenadores y se enseñan aquí junto a las
     * noticias. Las convertimos al mismo formato que una noticia para pintarlas con la misma tarjeta.
     * Si la petición de crónicas falla, las noticias se siguen viendo (no es un error grave).
     */
    async function cargarCronicas() {
        try {
            const r = await Demo.obtener('/cronicas', null, Demo.cronicas);
            const lista = Array.isArray(r) ? r : (r.items || []);
            return lista.map(c => ({
                id: 'c' + c.id, tipo: 'cronica', titulo: c.titulo, cuerpo: c.texto, publicada_en: c.creada_en,
                enlace: 'acta.html?id=' + encodeURIComponent(c.partido.id), texto_enlace: 'Consultar el acta del partido'
            }));
        } catch (error) {
            return [];
        }
    }

    async function iniciar() {
        const lista = document.getElementById('lista-noticias');
        const contador = document.getElementById('contador-noticias');
        const botones = document.querySelectorAll('[data-news-filter]');

        try {
            const datos = await Demo.obtener('/noticias', null, Demo.noticias);
            // Noticias + crónicas, de la más reciente a la más antigua
            const noticias = (datos.items || []).concat(await cargarCronicas())
                .sort((a, b) => String(b.publicada_en).localeCompare(String(a.publicada_en)));

            lista.textContent = '';
            if (!noticias.length) {
                lista.appendChild(el('p', { texto: 'Todavía no hay noticias publicadas.' }));
                contador.textContent = '';
                return;
            }
            noticias.forEach(n => lista.appendChild(crearTarjeta(n)));

            /* Muestra solo las tarjetas del tipo elegido y actualiza el contador. */
            const aplicarFiltro = (filtro) => {
                let visibles = 0;
                lista.querySelectorAll('.news-card').forEach(t => {
                    const mostrar = filtro === 'todas' || t.dataset.tipo === filtro;
                    t.hidden = !mostrar;
                    if (mostrar) visibles++;
                });
                contador.textContent = `Mostrando ${visibles} ${visibles === 1 ? 'noticia' : 'noticias'}`;
                Api.anunciar(contador.textContent);
            };

            botones.forEach(boton => boton.addEventListener('click', () => {
                botones.forEach(b => {
                    b.classList.toggle('active', b === boton);
                    b.setAttribute('aria-pressed', String(b === boton));
                });
                aplicarFiltro(boton.dataset.newsFilter);
            }));
            aplicarFiltro('todas');
        } catch (error) {
            Api.mostrarError(lista, error);
            contador.textContent = '';
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
