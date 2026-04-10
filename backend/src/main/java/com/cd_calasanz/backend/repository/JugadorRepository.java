package com.cd_calasanz.backend.repository;

import com.cd_calasanz.backend.model.Jugador;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface JugadorRepository extends JpaRepository<Jugador, Integer> {
    // Aquí no hace falta escribir nada más por ahora
}