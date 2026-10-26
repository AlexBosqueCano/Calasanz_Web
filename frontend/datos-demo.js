/*
 * datos-demo.js — Datos de EJEMPLO para el "modo demostración"
 * =============================================================
 * ¿Para qué sirve?
 *   Mientras el backend no esté terminado (o el servidor esté apagado), la web no
 *   tendría nada que enseñar. Con este fichero las páginas se ven completas para
 *   poder diseñar, probar el móvil y grabar el vídeo.
 *
 * ¿Cuándo se usan estos datos?
 *   SOLO si Sesion.enModoDemo() es true (el servidor no responde). Si el servidor
 *   responde, se usan siempre los datos reales y este fichero se ignora.
 *
 * ¿Qué datos hay?
 *   TODOS los nombres, equipos y resultados son INVENTADOS. No pongáis aquí nombres
 *   de personas reales (y menos de menores): este repositorio es público.
 *
 * FORMATO
 *   Cada función devuelve lo mismo que devolvería la API según docs/API_CONTRATO.md,
 *   de modo que el código de las páginas es idéntico con datos reales o de ejemplo.
 *   (Algunos campos extra, como `competicion` o `lugar`, no están todavía en el contrato:
 *   las páginas los muestran solo si existen. Hay que acordarlos con Mateo.)
 */
(function (global) {
    'use strict';

    // ------------------------------------------------------------------
    // Datos base
    // ------------------------------------------------------------------
    const EQUIPOS = [
        { id: 1, nombre: 'Juvenil A', categoria: { id: 1, nombre: 'Juvenil' }, competicion: 'Liga Nacional Juvenil', es_propio: true },
        { id: 2, nombre: 'Juvenil B', categoria: { id: 1, nombre: 'Juvenil' }, competicion: 'Segunda Juvenil', es_propio: true },
        { id: 3, nombre: 'Cadete A', categoria: { id: 2, nombre: 'Cadete' }, competicion: 'Primera Cadete', es_propio: true },
        { id: 4, nombre: 'Cadete B', categoria: { id: 2, nombre: 'Cadete' }, competicion: 'Segunda Cadete', es_propio: true },
        { id: 5, nombre: 'Infantil A', categoria: { id: 3, nombre: 'Infantil' }, competicion: 'Primera Infantil', es_propio: true },
        { id: 6, nombre: 'Alevín A', categoria: { id: 4, nombre: 'Alevín' }, competicion: 'Primera Alevín', es_propio: true }
    ];

    // Jugadores inventados (se reutilizan en todos los equipos de ejemplo)
    const JUGADORES = [
        { id: 1, nombre: 'Hugo', ap1: 'Ferrer', ap2: 'Lasa', posicion: 'Portero', dorsal: 1,
          partidos: 8, minutos: 720, goles: 0, asistencias: 0, amarillas: 0, rojas: 0, titular: 8 },
        { id: 2, nombre: 'Iván', ap1: 'Roldán', ap2: 'Echevarría', posicion: 'Defensa', dorsal: 4,
          partidos: 8, minutos: 695, goles: 1, asistencias: 0, amarillas: 2, rojas: 0, titular: 8 },
        { id: 3, nombre: 'Daniel', ap1: 'Orbe', ap2: 'Santos', posicion: 'Centrocampista', dorsal: 6,
          partidos: 8, minutos: 710, goles: 3, asistencias: 2, amarillas: 1, rojas: 0, titular: 8 },
        { id: 4, nombre: 'Marcos', ap1: 'Villar', ap2: 'Pardo', posicion: 'Centrocampista', dorsal: 8,
          partidos: 8, minutos: 685, goles: 3, asistencias: 5, amarillas: 1, rojas: 0, titular: 7 },
        { id: 5, nombre: 'Álex', ap1: 'Mier', ap2: 'Cabal', posicion: 'Centrocampista', dorsal: 10,
          partidos: 7, minutos: 590, goles: 4, asistencias: 3, amarillas: 0, rojas: 0, titular: 6 },
        { id: 6, nombre: 'Samuel', ap1: 'Ruiz', ap2: 'Camino', posicion: 'Delantero', dorsal: 11,
          partidos: 8, minutos: 660, goles: 5, asistencias: 2, amarillas: 1, rojas: 0, titular: 8 }
    ];

    // ------------------------------------------------------------------
    // Funciones que imitan los endpoints de la API
    // ------------------------------------------------------------------

    /* GET /api/equipos?propios=true */
    function equipos() { return EQUIPOS.map(e => ({ ...e })); }

    /* GET /api/equipos/{id} */
    function equipo(id) {
        const e = EQUIPOS.find(x => String(x.id) === String(id));
        if (!e) throw new Api.ApiError(404, 'no_encontrado', 'No se ha encontrado el equipo.');
        return { ...e };
    }

    /* GET /api/equipos/{id}/plantilla */
    function plantilla() {
        return JUGADORES.map(j => ({ id: j.id, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, posicion: j.posicion, dorsal: j.dorsal }));
    }

    /* GET /api/equipos/{id}/estadisticas */
    function estadisticas() {
        return JUGADORES.map(j => ({
            jugador: { id: j.id, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, dorsal: j.dorsal, posicion: j.posicion },
            partidos: j.partidos, minutos: j.minutos, goles: j.goles,
            asistencias: j.asistencias, amarillas: j.amarillas, rojas: j.rojas
        }));
    }

    /* GET /api/equipos/{id}/partidos */
    function partidos() {
        return [
            { id: 1, jornada: 7, fecha: '2026-10-17', estado: 'finalizado', lugar: 'Campo municipal · Santander',
              local: { id: 1, nombre: 'C.D. Calasanz' }, visitante: { id: 11, nombre: 'Marina Norte C.F.' },
              resultado_local: 4, resultado_visitante: 2 },
            { id: 2, jornada: 6, fecha: '2026-10-10', estado: 'finalizado', lugar: 'Complejo Ruth Beitia',
              local: { id: 1, nombre: 'C.D. Calasanz' }, visitante: { id: 12, nombre: 'Peña Alta' },
              resultado_local: 3, resultado_visitante: 1 },
            { id: 3, jornada: 5, fecha: '2026-10-03', estado: 'finalizado', lugar: 'Campo de la Ribera',
              local: { id: 13, nombre: 'Ribera B' }, visitante: { id: 1, nombre: 'C.D. Calasanz' },
              resultado_local: 1, resultado_visitante: 1 },
            { id: 4, jornada: 8, fecha: '2026-10-25', estado: 'programado', lugar: 'Domingo 11:00 · Complejo Ruth Beitia',
              local: { id: 1, nombre: 'C.D. Calasanz' }, visitante: { id: 14, nombre: 'Textil Norte' },
              resultado_local: null, resultado_visitante: null },
            { id: 5, jornada: 9, fecha: '2026-11-01', estado: 'programado', lugar: 'Domingo 12:00 · Campo de la Ribera',
              local: { id: 13, nombre: 'Ribera B' }, visitante: { id: 1, nombre: 'C.D. Calasanz' },
              resultado_local: null, resultado_visitante: null }
        ];
    }

    /* GET /api/equipos/{id}/goleadores  → array { jugador, goles, partidos } ordenado por goles */
    function goleadores() {
        return JUGADORES.filter(j => j.goles > 0)
            .sort((a, b) => b.goles - a.goles)
            .map(j => ({
                jugador: { id: j.id, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, dorsal: j.dorsal, posicion: j.posicion },
                goles: j.goles, partidos: j.partidos
            }));
    }

    /*
     * GET /api/lesiones?equipo={id}&activa=true
     * Solo estado y fecha estimada de vuelta: SIN diagnóstico (son datos de salud de menores).
     */
    function lesiones() {
        return [
            { id: 1, jugador: { id: 2, nombre_completo: 'Iván Roldán Echevarría' }, equipo_id: 1,
              fecha_inicio: '2026-10-20', fecha_estimada_vuelta: '2026-11-12', activa: true },
            { id: 2, jugador: { id: 5, nombre_completo: 'Álex Mier Cabal' }, equipo_id: 1,
              fecha_inicio: '2026-10-23', fecha_estimada_vuelta: '2026-11-06', activa: true }
        ];
    }

    /* GET /api/equipos/{id}/clasificacion */
    function clasificacion() {
        return [
            { posicion: 1, equipo: { id: 15, nombre: 'Racing Cantabria B' }, puntos: 21, pj: 8, g: 7, e: 0, p: 1, gf: 24, gc: 6, dg: 18 },
            { posicion: 2, equipo: { id: 1, nombre: 'C.D. Calasanz' }, puntos: 19, pj: 8, g: 6, e: 1, p: 1, gf: 21, gc: 8, dg: 13 },
            { posicion: 3, equipo: { id: 13, nombre: 'Ribera B' }, puntos: 16, pj: 8, g: 5, e: 1, p: 2, gf: 17, gc: 10, dg: 7 },
            { posicion: 4, equipo: { id: 11, nombre: 'Marina Norte C.F.' }, puntos: 13, pj: 8, g: 4, e: 1, p: 3, gf: 14, gc: 14, dg: 0 },
            { posicion: 5, equipo: { id: 12, nombre: 'Peña Alta' }, puntos: 10, pj: 8, g: 3, e: 1, p: 4, gf: 11, gc: 15, dg: -4 }
        ];
    }

    /* GET /api/jugadores/{id}  (+ stats y participaciones, que el contrato aún no define) */
    function jugador(id) {
        const j = JUGADORES.find(x => String(x.id) === String(id));
        if (!j) throw new Api.ApiError(404, 'no_encontrado', 'No se ha encontrado al jugador.');
        return {
            id: j.id, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, posicion: j.posicion, dorsal: j.dorsal,
            equipo: { id: 1, nombre: 'Juvenil A' },
            estadisticas: {
                partidos_jugados: j.partidos, titular: j.titular, suplente: j.partidos - j.titular,
                minutos_totales: j.minutos, goles_totales: j.goles, asistencias_totales: j.asistencias,
                amarillas_totales: j.amarillas, rojas_totales: j.rojas
            },
            // Historial por jornada (campo propuesto; hay que acordarlo con Mateo)
            participaciones: [
                { partido_id: 1, jornada: 7, encuentro: 'C.D. Calasanz 4 - 2 Marina Norte C.F.', condicion: 'Titular', minutos: 68, goles: 1, tarjetas: '' },
                { partido_id: 2, jornada: 6, encuentro: 'C.D. Calasanz 3 - 1 Peña Alta', condicion: 'Titular', minutos: 90, goles: 1, tarjetas: 'Amarilla' },
                { partido_id: 3, jornada: 5, encuentro: 'Ribera B 1 - 1 C.D. Calasanz', condicion: 'Titular', minutos: 90, goles: 0, tarjetas: '' }
            ]
        };
    }

    // ------------------------------------------------------------------
    // Liga, actas y crónicas (panel del entrenador y acta.html)
    // ------------------------------------------------------------------

    /* GET /api/equipos?competicion=...  → equipos de la misma liga, propios y rivales */
    function equiposLiga() {
        return [
            { id: 1, nombre: 'C.D. Calasanz', es_propio: true, competicion: 'Liga Nacional Juvenil' },
            { id: 11, nombre: 'Marina Norte C.F.', es_propio: false, competicion: 'Liga Nacional Juvenil' },
            { id: 12, nombre: 'Peña Alta', es_propio: false, competicion: 'Liga Nacional Juvenil' },
            { id: 13, nombre: 'Ribera B', es_propio: false, competicion: 'Liga Nacional Juvenil' },
            { id: 14, nombre: 'Textil Norte', es_propio: false, competicion: 'Liga Nacional Juvenil' },
            { id: 15, nombre: 'Racing Cantabria B', es_propio: false, competicion: 'Liga Nacional Juvenil' }
        ];
    }

    /* GET /api/partidos?competicion=...  → todos los partidos de la liga (propios y entre rivales) */
    function partidosLiga() {
        return partidos().concat([
            { id: 6, jornada: 7, fecha: '2026-10-17', estado: 'finalizado', lugar: 'Campo de Peña Alta',
              local: { id: 12, nombre: 'Peña Alta' }, visitante: { id: 14, nombre: 'Textil Norte' },
              resultado_local: 2, resultado_visitante: 2 },
            // Fecha ya pasada y sin resultado: el entrenador puede registrarlo
            { id: 7, jornada: 8, fecha: '2026-10-25', estado: 'programado', lugar: null,
              local: { id: 15, nombre: 'Racing Cantabria B' }, visitante: { id: 11, nombre: 'Marina Norte C.F.' },
              resultado_local: null, resultado_visitante: null }
        ]).map(p => ({
            ...p,
            // es_propio indica de qué lado está nuestro club (para el escudo y para saber qué alineación mostrar)
            local: { ...p.local, es_propio: p.local.id === 1 },
            visitante: { ...p.visitante, es_propio: p.visitante.id === 1 },
            cronica_id: p.id === 1 ? 1 : null
        }));
    }

    /* GET /api/partidos/{id}  → partido + acta (si existe). Los eventos llevan ids; los nombres están en la alineación. */
    function partido(id) {
        const p = partidosLiga().find(x => String(x.id) === String(id));
        if (!p) throw new Api.ApiError(404, 'no_encontrado', 'No se ha encontrado el partido.');
        if (String(p.id) !== '1') return { ...p, acta: null };
        const al = (n, estado) => {
            const j = JUGADORES.find(x => x.id === n);
            return { jugador_id: j.id, estado, nombre: j.nombre, ap1: j.ap1, ap2: j.ap2, dorsal: j.dorsal, posicion: j.posicion };
        };
        return { ...p, temporada: '2026-2027', competicion: 'Liga Nacional Juvenil', duracion: 90, hora: '19:00',
            acta: {
                arbitros: { principal: 'Belda Moro, Nico', asistentes: ['Canal Rego, Hugo', 'Durán Soto, Leo'] },
                cuerpo_tecnico: { delegado_campo: 'Gil Prado, Sara', delegado_equipo: 'Lastra Vega, Tomás' },
                alineacion: [al(1, 'titular'), al(2, 'titular'), al(3, 'titular'), al(4, 'titular'), al(6, 'titular'), al(5, 'suplente')],
                eventos: [
                    { tipo: 'gol', minuto: 8, jugador_id: 4, asistente_id: 3 },
                    { tipo: 'gol_rival', minuto: 19, autor: 'Escudero Pinto, Mateo' },
                    { tipo: 'gol', minuto: 22, jugador_id: 3 },
                    { tipo: 'tarjeta', minuto: 40, jugador_id: 2, color: 'amarilla' },
                    { tipo: 'gol_rival', minuto: 53, autor: 'Escudero Pinto, Mateo' },
                    { tipo: 'gol', minuto: 61, jugador_id: 6, asistente_id: 4 },
                    { tipo: 'sustitucion', minuto: 68, sale_id: 6, entra_id: 5 },
                    { tipo: 'gol', minuto: 75, jugador_id: 5 }
                ]
            } };
    }

    /* GET /api/cronicas  → paginado, más recientes primero */
    function cronicas() {
        const p = partidosLiga()[0];
        return {
            items: [{ id: 1, partido: { id: p.id, jornada: p.jornada, fecha: p.fecha, local: p.local, visitante: p.visitante,
                                       resultado_local: p.resultado_local, resultado_visitante: p.resultado_visitante },
                      titulo: 'Victoria de prestigio ante el Marina Norte',
                      texto: 'Los goles tempraneros de Marcos y Daniel pusieron el partido de cara. En la segunda parte, el equipo supo sufrir y cerró el 4-2 con dos tantos más.',
                      autor: { id: 7, username: 'entrenador1' }, creada_en: '2026-10-18T10:00:00+02:00', actualizada_en: null }],
            page: 1, por_pagina: 20, total: 1
        };
    }

    /* GET /api/solicitudes?estado=pendiente  → paginado. Los objetos usuario/jugador/equipo son un añadido
       pedido a Mateo para poder enseñar nombres y no solo ids. */
    function solicitudes() {
        return {
            items: [
                { id: 5, usuario: { id: 12, username: 'familia_ejemplo' }, rol_solicitado: 'JUGADOR',
                  jugador: { id: 3, nombre_completo: 'Daniel Orbe Santos' }, equipo: null,
                  mensaje: 'Soy Daniel Orbe, del Juvenil A.', estado: 'pendiente', creada_en: '2026-10-24T09:00:00+02:00' },
                { id: 6, usuario: { id: 15, username: 'seguidor_ejemplo' }, rol_solicitado: 'ENTRENADOR',
                  jugador: null, equipo: { id: 3, nombre: 'Cadete A' },
                  mensaje: 'Entreno al Cadete A esta temporada.', estado: 'pendiente', creada_en: '2026-10-25T18:30:00+02:00' }
            ],
            page: 1, por_pagina: 20, total: 2
        };
    }

    /* GET /api/noticias */
    function noticias() {
        return {
            items: [
                { id: 1, titulo: 'Victoria de prestigio ante el Marina Norte (4-2)', tipo: 'noticia', publicada_en: '2026-10-17T20:00:00+02:00',
                  cuerpo: 'Los goles tempraneros y un doblete en la segunda parte sellaron los tres puntos en casa.', enlace: 'acta.html?id=1', texto_enlace: 'Consultar el acta del partido' },
                { id: 2, titulo: '¡Gran victoria del Cadete B!', tipo: 'noticia', publicada_en: '2026-10-11T19:00:00+02:00',
                  cuerpo: 'El equipo cadete firmó un encuentro muy completo en el Complejo Ruth Beitia.', enlace: 'equipo.html?id=4', texto_enlace: 'Ver plantilla y clasificación' },
                { id: 3, titulo: 'Abierto el plazo de inscripción para la próxima temporada', tipo: 'noticia', publicada_en: '2026-10-05T10:00:00+02:00',
                  cuerpo: 'Las familias interesadas ya pueden solicitar información y horarios de entrenamiento por categoría.', enlace: 'contacto.html', texto_enlace: 'Contactar con coordinación' },
                { id: 4, titulo: 'Torneo de Navidad del club', tipo: 'evento', fecha_evento: '2026-12-20', estado_evento: 'proximo',
                  publicada_en: '2026-10-01T10:00:00+02:00',
                  cuerpo: 'Jornada de convivencia con partidos de todas las categorías.', enlace: 'equipos.html', texto_enlace: 'Ver todos los equipos' }
            ],
            page: 1, por_pagina: 20, total: 4
        };
    }

    /* GET /api/inicio */
    function inicio() {
        const n = noticias().items;
        return {
            proximos_partidos: [{ id: 4, jornada: 8, fecha: '2026-10-25', estado: 'programado', lugar: 'Complejo Ruth Beitia',
                                  local: { id: 1, nombre: 'Juvenil A' }, visitante: { id: 14, nombre: 'Textil Norte' } }],
            resultados_semana: [],
            ultimas_noticias: n.slice(0, 2)
        };
    }

    // ------------------------------------------------------------------
    // Ayudante común: pide a la API y, si estamos en modo demo, usa estos datos
    // ------------------------------------------------------------------
    /*
     * Uso:   const lista = await Demo.obtener('/equipos/1/plantilla', null, Demo.plantilla);
     *   - Si el servidor responde: devuelve lo que diga el servidor.
     *   - Si no responde Y la sesión está en modo demo: devuelve datos de ejemplo.
     *   - Cualquier otro error (403, 500...) se propaga para mostrarlo al usuario.
     */
    async function obtener(ruta, params, demo) {
        // Si ya sabemos que el servidor no contesta (la comprobación de sesión falló por red,
        // tiempo agotado o 502/503/504), no gastamos otros 8 segundos por cada petición:
        // vamos directos a los datos de ejemplo.
        if (Sesion.servidorNoResponde()) return demo();

        try {
            return await Api.get(ruta, params);
        } catch (error) {
            if (Sesion.enModoDemo()) return demo();
            throw error;
        }
    }

    global.Demo = { obtener, equipos, equipo, plantilla, estadisticas, goleadores, lesiones, partidos, clasificacion, jugador, noticias, inicio,
                   equiposLiga, partidosLiga, partido, cronicas, solicitudes };
})(window);
