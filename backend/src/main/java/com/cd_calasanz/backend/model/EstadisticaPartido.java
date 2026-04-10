package com.cd_calasanz.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

@Entity
@Table(name = "estadisticas_partido")
@IdClass(EstadisticaPartidoId.class) // Le decimos que use la llave doble que acabamos de crear
public class EstadisticaPartido {

    @Id
    @Column(name = "partido")
    private Integer partido;

    @Id
    @Column(name = "id_jugador")
    private Integer idJugador;

    @Column(name = "id_equipo")
    private Integer idEquipo;

    @Column(name = "estado")
    private String estado; // Para saber si es "Titular" o "Suplente"

    @Column(name = "mins_jugados")
    private Integer minsJugados;

    @Column(name = "goles")
    private Integer goles;

    @Column(name = "goles_recibidos")
    private Integer golesRecibidos;

    @Column(name = "asistencias")
    private Integer asistencias;

    @Column(name = "amarillas")
    private Integer amarillas;

    @Column(name = "roja")
    private Boolean roja; // DBeaver lo muestra como un checkbox, así que es un Boolean en Java

    public EstadisticaPartido() {}

    // --- GETTERS Y SETTERS ---
    public Integer getPartido() { return partido; }
    public void setPartido(Integer partido) { this.partido = partido; }

    public Integer getIdJugador() { return idJugador; }
    public void setIdJugador(Integer idJugador) { this.idJugador = idJugador; }

    public Integer getIdEquipo() { return idEquipo; }
    public void setIdEquipo(Integer idEquipo) { this.idEquipo = idEquipo; }

    public String getEstado() { return estado; }
    public void setEstado(String estado) { this.estado = estado; }

    public Integer getMinsJugados() { return minsJugados; }
    public void setMinsJugados(Integer minsJugados) { this.minsJugados = minsJugados; }

    public Integer getGoles() { return goles; }
    public void setGoles(Integer goles) { this.goles = goles; }

    public Integer getGolesRecibidos() { return golesRecibidos; }
    public void setGolesRecibidos(Integer golesRecibidos) { this.golesRecibidos = golesRecibidos; }

    public Integer getAsistencias() { return asistencias; }
    public void setAsistencias(Integer asistencias) { this.asistencias = asistencias; }

    public Integer getAmarillas() { return amarillas; }
    public void setAmarillas(Integer amarillas) { this.amarillas = amarillas; }

    public Boolean getRoja() { return roja; }
    public void setRoja(Boolean roja) { this.roja = roja; }
}