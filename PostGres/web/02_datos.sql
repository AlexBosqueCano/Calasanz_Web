---------------------------------------------------------------------------------------------------------
-- Datos iniciales (seed) en PostgreSQL del CD. CALASANZ (M1 + M2)
---------------------------------------------------------------------------------------------------------

-- 1. Usuarios iniciales (uno por rol)
INSERT INTO usuarios (id_usuario, username, email, password_hash, rol, activo) VALUES
(1, 'dev_admin', 'dev@calasanz.es', '$argon2id$v=19$m=65536,t=3,p=4$HZa1K5bd3h0bRhRA7lk+EA$YM4utjWONf4prBVM9/w7kv9JswbJq484ZXUm43djIuM', 'DESARROLLADOR', true),
(2, 'coord', 'coordinador@calasanz.es', '$argon2id$v=19$m=65536,t=3,p=4$+eBrlwgsRPq9dHhLdH3XrA$9rDqxnwA7FpCJb2xfpUJl2bxlhOcH5ilmft+DatQqTQ', 'COORDINADOR', true),
(3, 'mister_juv', 'mister.juvenil@calasanz.es', '$argon2id$v=19$m=65536,t=3,p=4$zHnA1ucm8NgAfSVAOSroVQ$4/HdCSg7Lw7YZDl0CWRd7GIQKjgqXFqwY8nKDG6+2QI', 'ENTRENADOR', true),
(4, 'david9', 'david.lopez@calasanz.es', '$argon2id$v=19$m=65536,t=3,p=4$8p5Cthmx7Uizzp9zFmnqqQ$L6FSfBd5xGEtN+43l+OgWn3eMfCw/YVsSBWebBkfrSU', 'JUGADOR', true),
(5, 'aficionado', 'aficionado@calasanz.es', '$argon2id$v=19$m=65536,t=3,p=4$jj7yCcV3iMqNvg8GzKg8Lg$I4uxg2nAMWRZXKcD206xWkfMxaT29Dtg2tLfqqG6sg0', 'ESTANDAR', true);

-- 2. Temporadas
INSERT INTO temporada (id_temporada, año) VALUES
(1, '2024-2025'),
(2, '2025-2026');

-- 3. Categorías con su duración oficial (§3)
INSERT INTO categoria (id_categoria, nombre, duracion) VALUES
(1, 'Juvenil', 90),
(2, 'Cadete', 80),
(3, 'Infantil', 70),
(4, 'Alevín', 60),
(5, 'Benjamín', 50),
(6, 'Prebenjamín', 40);

-- 4. Equipos Propios y Equipos Rivales
INSERT INTO equipo (id_equipo, nombre, categoria, competicion, es_propio, id_entrenador) VALUES
(1, 'Juvenil A', 1, 'Liga Nacional Juvenil', true, 3),
(2, 'Cadete B', 2, 'Primera Cadete Cantabria', true, NULL),
(11, 'CD. Laredo Juvenil', 1, 'Liga Nacional Juvenil', false, NULL),
(12, 'Racing de Santander Juvenil B', 1, 'Liga Nacional Juvenil', false, NULL);

-- 5. Jugadores del Calasanz
INSERT INTO jugador (id_jugador, nombre, ap1, ap2, estatura, peso, equipo, dorsal, posicion, id_usuario, activo) VALUES
(1, 'David', 'López', 'Martínez', 1.80, 75.00, 1, 9, 'Delantero', 4, true),
(2, 'Juan', 'Pérez', NULL, 1.85, 80.00, 1, 1, 'Portero', NULL, true),
(3, 'Carlos', 'García', 'Fernández', 1.75, 70.00, 1, 4, 'Defensa', NULL, true);

-- 6. Partidos (Jornada 1 finalizada y Jornada 2 programada)
INSERT INTO partido (id_partido, temporada, jornada, fecha_ini, lugar, local, visitante, resultado_local, resultado_visitante, ganador, evento) VALUES
(1, 2, 1, '2025-09-06', 'Instalaciones CD. Calasanz', 1, 11, 2, 0, 1, NULL),
(2, 2, 2, '2026-11-15', 'Campos de Sport de El Sardinero (Anexo)', 12, 1, NULL, NULL, NULL, NULL);

-- 7. Acta del Partido 1 (cabecera, eventos y estadísticas calculadas)
INSERT INTO acta_partido (partido, arbitro_principal, arbitro_asistente_1, arbitro_asistente_2, delegado_campo, delegado_equipo) VALUES
(1, 'Gómez Ruiz, Alejandro', 'Sánchez Díaz, Marcos', 'Vega Ortiz, Pablo', 'Fernández Soto, Luis', 'Ruiz Cano, Miguel');

INSERT INTO acta_evento (id, partido, tipo, minuto, id_jugador, id_jugador_2, color, autor_rival) VALUES
(1, 1, 'gol', 24, 1, 3, NULL, NULL),
(2, 1, 'tarjeta', 58, 3, NULL, 'amarilla', NULL),
(3, 1, 'gol', 77, 1, NULL, NULL, NULL);

INSERT INTO estadisticas_partido (partido, id_jugador, id_equipo, estado, mins_jugados, goles, goles_recibidos, asistencias, amarillas, roja) VALUES
(1, 1, 1, 'titular', 90, 2, 0, 0, 0, false),
(1, 2, 1, 'titular', 90, 0, 0, 0, 0, false),
(1, 3, 1, 'titular', 90, 0, 0, 1, 1, false);

-- 8. Crónica del Partido 1 (mínimo 50 caracteres de texto plano)
INSERT INTO cronica (id, partido, titulo, texto, id_autor) VALUES
(1, 1, 'Victoria de prestigio en el debut ante el Laredo', 'Gran encuentro del Juvenil A en el estreno liguero. El equipo dominó ambas áreas desde el inicio y sentenció con un doblete de David López.', 3);

-- 9. Noticias y Eventos
INSERT INTO noticia (id_noticia, titulo, cuerpo, tipo, fecha_evento, id_autor) VALUES
(1, 'Inicio de temporada 2025-2026', 'Arranca la competición oficial para todas las categorías del CD. Calasanz.', 'noticia', NULL, 2),
(2, 'Torneo de Navidad CD. Calasanz', 'Jornada de convivencia y torneo triangular en nuestras instalaciones.', 'evento', '2026-12-20', 2);

-- 10. Lesión activa
INSERT INTO lesion (id_lesion, id_jugador, fecha_inicio, fecha_estimada_vuelta, fecha_alta, activa) VALUES
(1, 3, '2026-10-20', '2026-11-20', NULL, true);

-- 11. Apunte del entrenador
INSERT INTO apunte_entrenador (id_apunte, id_equipo, id_rival, id_partido, texto, id_autor) VALUES
(1, 1, 11, 1, 'Bloque bajo muy sólido; buscar superioridad por bandas.', 3);

-- 12. Sincronización de secuencias IDENTITY
SELECT setval(pg_get_serial_sequence('usuarios', 'id_usuario'), COALESCE((SELECT MAX(id_usuario) FROM usuarios), 1));
SELECT setval(pg_get_serial_sequence('temporada', 'id_temporada'), COALESCE((SELECT MAX(id_temporada) FROM temporada), 1));
SELECT setval(pg_get_serial_sequence('categoria', 'id_categoria'), COALESCE((SELECT MAX(id_categoria) FROM categoria), 1));
SELECT setval(pg_get_serial_sequence('equipo', 'id_equipo'), COALESCE((SELECT MAX(id_equipo) FROM equipo), 1));
SELECT setval(pg_get_serial_sequence('jugador', 'id_jugador'), COALESCE((SELECT MAX(id_jugador) FROM jugador), 1));
SELECT setval(pg_get_serial_sequence('partido', 'id_partido'), COALESCE((SELECT MAX(id_partido) FROM partido), 1));
SELECT setval(pg_get_serial_sequence('acta_evento', 'id'), COALESCE((SELECT MAX(id) FROM acta_evento), 1));
SELECT setval(pg_get_serial_sequence('cronica', 'id'), COALESCE((SELECT MAX(id) FROM cronica), 1));
SELECT setval(pg_get_serial_sequence('noticia', 'id_noticia'), COALESCE((SELECT MAX(id_noticia) FROM noticia), 1));
SELECT setval(pg_get_serial_sequence('lesion', 'id_lesion'), COALESCE((SELECT MAX(id_lesion) FROM lesion), 1));
SELECT setval(pg_get_serial_sequence('apunte_entrenador', 'id_apunte'), COALESCE((SELECT MAX(id_apunte) FROM apunte_entrenador), 1));
SELECT setval(pg_get_serial_sequence('solicitud_acceso', 'id_solicitud'), COALESCE((SELECT MAX(id_solicitud) FROM solicitud_acceso), 1));
