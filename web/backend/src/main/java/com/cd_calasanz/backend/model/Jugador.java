package com.cd_calasanz.backend.model;

import jakarta.persistence.*;

@Entity
@Table(name = "jugador")
public class Jugador {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_jugador")
    private Integer idJugador;

    @Column(name = "nombre")
    private String nombre;

    @Column(name = "ap1")
    private String ap1;

    @Column(name = "ap2")
    private String ap2;

    @Column(name = "posicion")
    private String posicion;

    @Column(name = "equipo")
    private Integer equipo;

    // Constructor vacío
    public Jugador() {}

    // Getters y Setters limpios
    public Integer getIdJugador() { return idJugador; }
    public void setIdJugador(Integer idJugador) { this.idJugador = idJugador; }
    public String getNombre() { return nombre; }
    public void setNombre(String nombre) { this.nombre = nombre; }
    public String getAp1() { return ap1; }
    public void setAp1(String ap1) { this.ap1 = ap1; }
    public String getAp2() { return ap2; }
    public void setAp2(String ap2) { this.ap2 = ap2; }
    public String getPosicion() { return posicion; }
    public void setPosicion(String posicion) { this.posicion = posicion; }
    public Integer getEquipo() { return equipo; }
    public void setEquipo(Integer equipo) { this.equipo = equipo; }
}