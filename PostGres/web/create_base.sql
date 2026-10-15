------------------------------------------------------------------
-- Proyecto Web CD. CALASANZ
-- Creación de Base de Datos
------------------------------------------------------------------

-- Cierra toda conexión abierta contra la base de datos a borrar
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'cd_calasanz';

-- Elimina la base de datos si ya existe
DROP DATABASE IF EXISTS cd_calasanz;

-- Crea la base de datos
CREATE DATABASE cd_calasanz;