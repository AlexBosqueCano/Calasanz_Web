---------------------------------------------------------------------------------------------------------
-- Datos iniciales (seed) en PostgreSQL del CD. CALASANZ (M1 + M2)
---------------------------------------------------------------------------------------------------------

-- 1. Usuarios iniciales (uno por rol; hash argon2id válido para 'calasanz1234')
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

-- 3. Categorías con su duración total en minutos (Prebenjamín 40, Benjamín 50, Alevín 60, Infantil 70, Cadete 80, Juvenil 90)
INSERT INTO categoria (id_categoria, nombre, duracion_minutos) VALUES
(1, 'Juvenil', 90),
(2, 'Cadete', 80),
(3, 'Infantil', 70),
(4, 'Alevín', 60),
(5, 'Benjamín', 50),
(6, 'Prebenjamín', 40);

-- 4. Equipos Propios (es_propio = true) y Equipos Rivales (es_propio = false)
INSERT INTO equipo (id_equipo, nombre, categoria, competicion, es_propio, id_entrenador) VALUES
(1, 'Juvenil A', 1, 1, true, 3),
(2, 'Cadete B', 2, 2, true, NULL),
(11, 'CD. Laredo Juvenil', 1, 1, false, NULL),
(12, 'Racing de Santander Juvenil B', 1, 1, false, NULL);

-- 5. Jugadores del Calasanz
INSERT INTO jugador (id_jugador, nombre, ap1, ap2, estatura, peso, equipo, dorsal, posicion, id_usuario, activo) VALUES
(1, 'David', 'López', 'Martínez', 1.80, 75.00, 1, 9, 'Delantero', 4, true),
(2, 'Juan', 'Pérez', NULL, 1.85, 80.00, 1, 1, 'Portero', NULL, true),
(3, 'Carlos', 'García', 'Fernández', 1.75, 70.00, 1, 4, 'Defensa', NULL, true);

-- 6. Partidos (Jornada 1 finalizada y Jornada 2 programada)
INSERT INTO partido (id_partido, temporada, jornada, fecha_ini, lugar, local, visitante, resultado_local, resultado_visitante, ganador, evento) VALUES
(1, 2, 1, '2025-09-06', 'Instalaciones CD. Calasanz', 1, 11, 2, 0, 1, NULL),
(2, 2, 2, '2026-11-15', 'Campos de Sport de El Sardinero (Anexo)', 12, 1, NULL, NULL, NULL, NULL);

-- 7. Estadísticas del Partido 1
INSERT INTO estadisticas_partido (partido, id_jugador, id_equipo, estado, mins_jugados, goles, goles_recibidos, asistencias, amarillas, roja) VALUES
(1, 1, 1, 'titular', 90, 2, 0, 0, 0, false),
(1, 2, 1, 'titular', 90, 0, 0, 0, 0, false),
(1, 3, 1, 'titular', 90, 0, 0, 1, 1, false);

-- 8. Noticias, Eventos y Crónicas de ejemplo
INSERT INTO noticia (id_noticia, titulo, cuerpo, tipo, fecha_evento, id_partido, id_autor) VALUES
(1, 'Inicio de temporada 2025-2026', 'Arranca la competición oficial para todas las categorías del CD. Calasanz.', 'noticia', NULL, NULL, 2),
(2, 'Torneo de Navidad CD. Calasanz', 'Jornada de convivencia y torneo triangular en nuestras instalaciones.', 'evento', '2026-12-20', NULL, 2),
(3, 'Victoria sólida en el debut liguero', 'El Juvenil A se impuso por 2-0 ante el CD. Laredo con doblete de David.', 'cronica', NULL, 1, 3);

-- 9. Lesión activa de ejemplo
INSERT INTO lesion (id_lesion, id_jugador, fecha_inicio, fecha_estimada_vuelta, fecha_alta, activa) VALUES
(1, 3, '2026-10-20', '2026-11-20', NULL, true);

-- 10. Apunte del entrenador de ejemplo
INSERT INTO apunte_entrenador (id_apunte, id_equipo, id_rival, id_partido, texto, id_autor) VALUES
(1, 1, 11, 1, 'Bloque bajo muy sólido; buscar superioridad por bandas.', 3);

-- 11. Sincronización de secuencias IDENTITY
SELECT setval(pg_get_serial_sequence('usuarios', 'id_usuario'), COALESCE((SELECT MAX(id_usuario) FROM usuarios), 1));
SELECT setval(pg_get_serial_sequence('temporada', 'id_temporada'), COALESCE((SELECT MAX(id_temporada) FROM temporada), 1));
SELECT setval(pg_get_serial_sequence('categoria', 'id_categoria'), COALESCE((SELECT MAX(id_categoria) FROM categoria), 1));
SELECT setval(pg_get_serial_sequence('equipo', 'id_equipo'), COALESCE((SELECT MAX(id_equipo) FROM equipo), 1));
SELECT setval(pg_get_serial_sequence('jugador', 'id_jugador'), COALESCE((SELECT MAX(id_jugador) FROM jugador), 1));
SELECT setval(pg_get_serial_sequence('partido', 'id_partido'), COALESCE((SELECT MAX(id_partido) FROM partido), 1));
SELECT setval(pg_get_serial_sequence('noticia', 'id_noticia'), COALESCE((SELECT MAX(id_noticia) FROM noticia), 1));
SELECT setval(pg_get_serial_sequence('lesion', 'id_lesion'), COALESCE((SELECT MAX(id_lesion) FROM lesion), 1));
SELECT setval(pg_get_serial_sequence('apunte_entrenador', 'id_apunte'), COALESCE((SELECT MAX(id_apunte) FROM apunte_entrenador), 1));
SELECT setval(pg_get_serial_sequence('solicitud_acceso', 'id_solicitud'), COALESCE((SELECT MAX(id_solicitud) FROM solicitud_acceso), 1));
