package com.cd_calasanz.backend.model;

import java.io.Serializable;
import java.util.Objects;

// Esta clase representa la Clave Primaria Compuesta (partido + id_jugador)
public class EstadisticaPartidoId implements Serializable {
    
    private Integer partido;
    private Integer idJugador;

    public EstadisticaPartidoId() {}

    public Integer getPartido() { return partido; }
    public void setPartido(Integer partido) { this.partido = partido; }

    public Integer getIdJugador() { return idJugador; }
    public void setIdJugador(Integer idJugador) { this.idJugador = idJugador; }

    // En llaves compuestas, Java exige estos dos métodos para comparar IDs
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        EstadisticaPartidoId that = (EstadisticaPartidoId) o;
        return Objects.equals(partido, that.partido) && Objects.equals(idJugador, that.idJugador);
    }

    @Override
    public int hashCode() {
        return Objects.hash(partido, idJugador);
    }
}