---------------------------------------------------------------------------------------------------------
-- Inserción de datos en PostgreSQL del CD. CALASANZ
-----------------------------------------------------------------------------------------------------------

-- 1. Insertamos Temporadas
INSERT INTO temporada (id_temporada, año) VALUES 
(1, '2024-2025'),
(2, '2025-2026');

-- 2. Insertamos Categorías
INSERT INTO categoria (id_categoria, nombre) VALUES 
(1, 'Juvenil'),
(2, 'Cadete'),
(3, 'Infantil');

-- 3. Insertamos Equipos Propios (CD. Calasanz)
INSERT INTO equipo_calasanz (id_equipo, nombre, categoria, entrenador) VALUES 
(1, 'Juvenil A', 1, 'Míster X'),
(2, 'Cadete B', 2, 'Míster Y');

-- 4. Insertamos Equipos Rivales
INSERT INTO equipo (id_equipo, nombre, categoria) VALUES 
(1, 'CD. Laredo Juvenil', 1),
(2, 'Racing de Santander Juvenil B', 1);

-- 5. Insertamos Jugadores del Calasanz
INSERT INTO jugador (id_jugador, nombre, ap1, ap2, estatura, peso, equipo, dorsal, posicion) VALUES 
(1, 'David', 'López', 'Martínez', 1.80, 75.00, 1, 9, 'Delantero'),
(2, 'Juan', 'Pérez', NULL, 1.85, 80.00, 1, 1, 'Portero'),
(3, 'Carlos', 'García', 'Fernández', 1.75, 70.00, 1, 4, 'Defensa');

-- 6. Insertamos un Partido (Jornada 1: Calasanz Juvenil A vs Laredo)
INSERT INTO partido (id_partido, temporada, jornada, fecha_ini, local, visitante, resultado_local, resultado_visitante, ganador) VALUES 
(1, 2, 1, '2025-09-06', 1, 1, 2, 0, 1); -- Gana local (Calasanz)

-- 7. Insertamos las Estadísticas de ese Partido para los jugadores del Calasanz
INSERT INTO estadisticas_partido (partido, id_jugador, id_equipo, estado, mins__jugados, goles, asistencias, amarillas, roja) VALUES 
(1, 1, 1, 'titular', 90, 2, 0, 0, false), -- David marca 2 goles
(1, 2, 1, 'titular', 90, 0, 0, 0, false), -- Juan portería a cero
(1, 3, 1, 'titular', 90, 0, 1, 1, false); -- Carlos da una asistencia y le sacan amarilla