package com.cd_calasanz.backend.repository;

import com.cd_calasanz.backend.model.EstadisticaPartido;
import com.cd_calasanz.backend.model.EstadisticaPartidoId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface EstadisticaPartidoRepository extends JpaRepository<EstadisticaPartido, EstadisticaPartidoId> {

    // AHORA SÍ: Usamos nativeQuery = true para que el comando vaya directo a PostgreSQL
    // sin que Spring Boot intente traducir los nombres y explote con los guiones bajos.
    @Query(value = "SELECT COUNT(partido), " +
           "SUM(CASE WHEN LOWER(estado) = 'titular' THEN 1 ELSE 0 END), " +
           "SUM(CASE WHEN LOWER(estado) = 'suplente' THEN 1 ELSE 0 END), " +
           "SUM(mins_jugados), " +
           "SUM(goles), " +
           "SUM(asistencias), " +
           "SUM(amarillas), " +
           "SUM(CASE WHEN roja = true THEN 1 ELSE 0 END) " +
           "FROM estadisticas_partido " +
           "WHERE id_jugador = :idJugador", nativeQuery = true)
    List<Object[]> calcularEstadisticasCrudas(@Param("idJugador") Integer idJugador);
}