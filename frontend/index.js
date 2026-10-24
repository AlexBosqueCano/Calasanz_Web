/*
 * index.js — Portada (index.html)
 * ================================
 * GET /api/inicio → { proximos_partidos (máx. 3), resultados_semana, ultimas_noticias (máx. 3) }
 *
 * Rellena la tarjeta "Próximo partido" y las noticias de "Actualidad del club".
 * Si algo falla, el HTML ya trae un texto de reserva, así que la portada nunca queda vacía.
 * SEGURIDAD: textContent / Api.el(), nunca innerHTML con datos del servidor.
 */
(function () {
    'use strict';

    const { el } = Api;

    /* Rellena la tarjeta verde del próximo partido (o dice que no hay ninguno). */
    function pintarProximoPartido(partido) {
        const local = document.getElementById('match-local');
        const rival = document.getElementById('match-rival');
        const cuando = document.getElementById('match-cuando');
        const donde = document.getElementById('match-donde');

        if (!partido) {
            local.textContent = 'Sin partidos programados';
            rival.textContent = '';
            cuando.textContent = 'Consulta los equipos para ver el calendario';
            donde.textContent = '';
            return;
        }
        local.textContent = partido.local ? partido.local.nombre : '';
        // El "vs." decorativo lo pone el HTML; aquí solo el nombre del rival
        rival.textContent = partido.visitante ? partido.visitante.nombre : '';
        cuando.textContent = Api.formatearFecha(partido.fecha) + (partido.hora ? ', ' + partido.hora : '');
        // "lugar" no está aún en el contrato: se muestra solo si llega
        donde.textContent = partido.lugar || '';
    }

    /* Tarjetas de noticias de la portada (máximo 2 para respetar el diseño). */
    function pintarNoticias(noticias) {
        const cont = document.getElementById('home-noticias');
        if (!noticias.length) return;   // se queda el texto de reserva del HTML
        cont.textContent = '';
        noticias.slice(0, 2).forEach(n => {
            cont.appendChild(el('article', { clase: 'news-card', hijos: [
                el('div', { clase: 'news-card-meta', hijos: [
                    el('span', { texto: n.tipo === 'evento' ? 'EVENTO' : 'NOTICIA' }),
                    el('span', { texto: Api.formatearFecha(n.publicada_en) })
                ]}),
                el('h3', { texto: n.titulo }),
                el('a', { clase: 'link-arrow', atributos: { href: 'noticias.html' }, hijos: [
                    document.createTextNode('Leer noticia '), el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } })
                ]})
            ]}));
        });
    }

    async function iniciar() {
        // La portada es pública en el diseño; si el servidor exige sesión (401), dejamos los textos de reserva
        try {
            const datos = await Demo.obtener('/inicio', null, Demo.inicio);
            pintarProximoPartido((datos.proximos_partidos || [])[0]);
            pintarNoticias(datos.ultimas_noticias || []);
        } catch (error) {
            // Sin datos: se quedan los textos de reserva del HTML. No es un error grave en la portada.
            Api.anunciar('No se pudieron cargar los datos actualizados de la portada.');
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
