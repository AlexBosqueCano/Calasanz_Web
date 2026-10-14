---------------------------------------------------------------------------------------------------------
-- Estructura de base de datos del CD. CALASANZ
---------------------------------------------------------------------------------------------------------

-- Borrado de triggers y funciones (si existen)
DROP TRIGGER IF EXISTS trg_check_goles_recibidos ON estadisticas_partido;
DROP FUNCTION IF EXISTS verificar_goles_portero();

-- Borrado de tablas (en orden inverso para no romper las Foreign Keys)
DROP TABLE IF EXISTS estadisticas_partido;
DROP TABLE IF EXISTS partido;
DROP TABLE IF EXISTS jugador;
DROP TABLE IF EXISTS equipo_calasanz;
DROP TABLE IF EXISTS equipo;
DROP TABLE IF EXISTS categoria;
DROP TABLE IF EXISTS temporada;
DROP TABLE IF EXISTS usuarios;

-- Tabla Temporada
CREATE TABLE temporada(
    id_temporada int NOT NULL,
    año varchar(20) NOT NULL,
    CONSTRAINT pk_temporada PRIMARY KEY(id_temporada)
);

-- Tabla Categoria
CREATE TABLE categoria(
    id_categoria int NOT NULL,
    nombre varchar(50) NOT NULL,
    CONSTRAINT pk_categoria PRIMARY KEY(id_categoria),
    CONSTRAINT uq_nombre_categoria UNIQUE(nombre)
);

-- Tabla Equipo (Para equipos rivales)
CREATE TABLE equipo(
    id_equipo int NOT NULL,
    nombre varchar(100) NOT NULL,
    categoria int NOT NULL,
    CONSTRAINT pk_equipo PRIMARY KEY(id_equipo),
    CONSTRAINT fk_equipo_categoria FOREIGN KEY (categoria) REFERENCES categoria(id_categoria)
);

-- Tabla Equipo_Calasanz (Para vuestros equipos propios)
CREATE TABLE equipo_calasanz(
    id_equipo int NOT NULL,
    nombre varchar(100) NOT NULL,
    categoria int NOT NULL,
    entrenador varchar(100),
    CONSTRAINT pk_equipo_calasanz PRIMARY KEY(id_equipo),
    CONSTRAINT fk_calasanz_categoria FOREIGN KEY (categoria) REFERENCES categoria(id_categoria)
);

-- Tabla Jugador (Solo del Calasanz)
CREATE TABLE jugador(
    id_jugador int NOT NULL,
    nombre varchar(50) NOT NULL,
    ap1 varchar(100) NOT NULL,
    ap2 varchar(100) NULL,
    estatura decimal(3,2) NULL, 
    peso decimal(5,2) NULL,
    equipo int NOT NULL,
    dorsal int NULL,
    posicion varchar(30) NULL,
    CONSTRAINT pk_jugador PRIMARY KEY(id_jugador),
    CONSTRAINT fk_jugador_equipo FOREIGN KEY (equipo) REFERENCES equipo_calasanz(id_equipo)
);

-- Tabla Partido
CREATE TABLE partido(
    id_partido int NOT NULL,
    temporada int NOT NULL,
    jornada int NOT NULL,
    fecha_ini date NOT NULL,
    local int NOT NULL, 
    visitante int NOT NULL,
    resultado_local int DEFAULT 0,
    resultado_visitante int DEFAULT 0,
    ganador int NULL,
    evento varchar(255) NULL,
    CONSTRAINT pk_partido PRIMARY KEY(id_partido),
    CONSTRAINT fk_partido_temporada FOREIGN KEY (temporada) REFERENCES temporada(id_temporada),
    CONSTRAINT ck_jornada_positiva CHECK (jornada > 0)
);

-- Tabla Estadisticas_Partido (ACTUALIZADA con goles_recibidos)
CREATE TABLE estadisticas_partido(
    partido int NOT NULL,
    id_jugador int NOT NULL,
    id_equipo int NOT NULL,
    estado varchar(10) NOT NULL, 
    mins_jugados int DEFAULT 0,
    goles int DEFAULT 0,
    goles_recibidos int DEFAULT 0, -- ¡AQUÍ ESTÁ LA NUEVA COLUMNA!
    asistencias int DEFAULT 0,
    amarillas int DEFAULT 0,
    roja boolean DEFAULT false,
    CONSTRAINT pk_estadisticas_partido PRIMARY KEY(partido, id_jugador),
    CONSTRAINT fk_estadisticas_partido FOREIGN KEY (partido) REFERENCES partido(id_partido),
    CONSTRAINT fk_estadisticas_jugador FOREIGN KEY (id_jugador) REFERENCES jugador(id_jugador),
    CONSTRAINT fk_estadisticas_equipo FOREIGN KEY (id_equipo) REFERENCES equipo_calasanz(id_equipo),
    CONSTRAINT ck_estado CHECK (estado IN ('titular', 'suplente')),
    CONSTRAINT ck_minutos CHECK (mins_jugados >= 0),
    CONSTRAINT ck_goles CHECK (goles >= 0),
    CONSTRAINT ck_goles_recibidos CHECK (goles_recibidos >= 0), -- Validación básica
    CONSTRAINT ck_asistencias CHECK (asistencias >= 0),
    CONSTRAINT ck_amarillas CHECK (amarillas >= 0)
);

-- Tabla Usuarios
CREATE TABLE usuarios(
    id_usuario int NOT NULL,
    username varchar(50) NOT NULL,
    password_hash varchar(255) NOT NULL,
    rol varchar(20) DEFAULT 'EDITOR',
    CONSTRAINT pk_usuarios PRIMARY KEY(id_usuario),
    CONSTRAINT uq_username UNIQUE(username)
);


---------------------------------------------------------------------------------------------------------
-- TRIGGERS Y FUNCIONES
---------------------------------------------------------------------------------------------------------

-- Función para verificar que solo los porteros reciben goles
CREATE OR REPLACE FUNCTION verificar_goles_portero()
RETURNS TRIGGER AS $$
DECLARE
    v_posicion varchar;
BEGIN
    SELECT posicion INTO v_posicion FROM jugador WHERE id_jugador = NEW.id_jugador;

    IF v_posicion != 'Portero' AND NEW.goles_recibidos > 0 THEN
        RAISE EXCEPTION 'Operación denegada: Solo los jugadores con posición "Portero" pueden registrar goles recibidos.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger asociado a la tabla estadisticas_partido
CREATE TRIGGER trg_check_goles_recibidos
BEFORE INSERT OR UPDATE ON estadisticas_partido
FOR EACH ROW EXECUTE FUNCTION verificar_goles_portero();

-- Esto convierte la columna en una que se rellena sola (Identity)
-- Empezará a contar a partir del número 10 para no chocar con los que ya tienes
ALTER TABLE jugador 
ALTER COLUMN id_jugador ADD GENERATED BY DEFAULT AS IDENTITY (START WITH 10);