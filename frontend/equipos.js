/*
 * equipos.js — Lista de equipos con filtro por categoría (equipos.html)
 * =====================================================================
 * 1. Pide los equipos del club a la API (GET /api/equipos?propios=true).
 * 2. Pinta una tarjeta por equipo con el diseño de Figma.
 * 3. Los botones "Todos / Juvenil / Cadete…" muestran u ocultan tarjetas.
 *
 * Los botones de categoría se generan a partir de los datos: si mañana se crea la
 * categoría "Benjamín", aparece sola, sin tocar el HTML.
 *
 * SEGURIDAD: todo lo que viene del servidor se escribe con Api.el() (textContent),
 * nunca con innerHTML.
 */
(function () {
    'use strict';

    const { el } = Api;

    /* Crea la tarjeta de un equipo (misma estructura que el diseño de Figma). */
    function crearTarjeta(equipo) {
        const categoria = equipo.categoria ? equipo.categoria.nombre : 'Otros';

        const enlace = el('a', { clase: 'link-arrow', atributos: { href: 'equipo.html?id=' + encodeURIComponent(equipo.id) }, hijos: [
            document.createTextNode('Ver equipo '),
            el('span', { texto: '→', atributos: { 'aria-hidden': 'true' } })
        ]});

        // "competicion" no está aún en el contrato de API: se muestra solo si existe
        const info = [
            el('span', { texto: categoria.toUpperCase(), clase: 'team-cat-tag' }),
            el('h2', { texto: equipo.nombre })
        ];
        if (equipo.competicion) info.push(el('p', { texto: equipo.competicion }));
        info.push(enlace);

        return el('article', {
            clase: 'team-card-figma',
            // data-cat se usa para filtrar sin volver a pedir datos
            atributos: { 'data-cat': categoria },
            hijos: [
                // Insignia decorativa (aria-hidden: los lectores de pantalla la saltan)
                el('div', { clase: 'team-badge-box', atributos: { 'aria-hidden': 'true' }, hijos: [
                    el('span', { clase: 'stripe-v' }), el('span', { clase: 'dot-gold' })
                ]}),
                el('div', { clase: 'team-card-info', hijos: info })
            ]
        });
    }

    /* Crea los botones de filtro: "Todos" + uno por cada categoría que exista. */
    function crearFiltros(categorias, aplicarFiltro) {
        const contenedor = document.getElementById('filtros-categoria');
        contenedor.textContent = '';

        ['Todos', ...categorias].forEach((nombre, indice) => {
            const boton = el('button', {
                texto: nombre, clase: 'filter-pill' + (indice === 0 ? ' active' : ''),
                // aria-pressed: el lector de pantalla anuncia qué filtro está activo
                atributos: { type: 'button', 'aria-pressed': String(indice === 0) }
            });
            boton.addEventListener('click', () => {
                contenedor.querySelectorAll('.filter-pill').forEach(b => {
                    b.classList.toggle('active', b === boton);
                    b.setAttribute('aria-pressed', String(b === boton));
                });
                aplicarFiltro(nombre);
            });
            contenedor.appendChild(boton);
        });
    }

    async function iniciar() {
        const lista = document.getElementById('lista-equipos');
        const contador = document.getElementById('contador-equipos');

        try {
            const equipos = await Demo.obtener('/equipos', { propios: 'true' }, Demo.equipos);

            lista.textContent = '';
            if (!equipos.length) {
                lista.appendChild(el('p', { texto: 'Todavía no hay equipos registrados.' }));
                contador.textContent = '';
                return;
            }

            equipos.forEach(e => lista.appendChild(crearTarjeta(e)));

            // Categorías sin repetir y en el orden en que aparecen
            const categorias = [...new Set(equipos.map(e => e.categoria ? e.categoria.nombre : 'Otros'))];

            /* Muestra solo las tarjetas del filtro elegido y actualiza el contador. */
            const aplicarFiltro = (filtro) => {
                let visibles = 0;
                lista.querySelectorAll('.team-card-figma').forEach(tarjeta => {
                    const mostrar = filtro === 'Todos' || tarjeta.dataset.cat === filtro;
                    tarjeta.hidden = !mostrar;   // el atributo hidden oculta también para lectores de pantalla
                    if (mostrar) visibles++;
                });
                const texto = (filtro === 'Todos' ? 'Todos los equipos' : filtro) + ' · ' + visibles;
                contador.textContent = texto;
                Api.anunciar(texto);
            };

            crearFiltros(categorias, aplicarFiltro);
            aplicarFiltro('Todos');
        } catch (error) {
            // Nunca asumimos que la petición sale bien (requisito del enunciado)
            Api.mostrarError(lista, error);
            contador.textContent = '';
        }
    }

    document.addEventListener('layout:listo', iniciar);
})();
