package com.cd_calasanz.backend.controller;

import com.cd_calasanz.backend.model.Jugador;
import com.cd_calasanz.backend.repository.JugadorRepository;
import com.cd_calasanz.backend.repository.EstadisticaPartidoRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/jugadores")
@CrossOrigin(origins = "*") 
public class JugadorController {

    @Autowired
    private JugadorRepository jugadorRepository;

    @Autowired
    private EstadisticaPartidoRepository estadisticaRepository;

    @GetMapping
    public List<Jugador> obtenerTodosLosJugadores() {
        return jugadorRepository.findAll();
    }

    @GetMapping("/{id}")
    public Jugador obtenerJugadorPorId(@PathVariable Integer id) {
        return jugadorRepository.findById(id).orElse(null);
    }

    @GetMapping("/{id}/estadisticas")
    public Map<String, Object> obtenerEstadisticasJugador(@PathVariable Integer id) {
        List<Object[]> resultados = estadisticaRepository.calcularEstadisticasCrudas(id);
        Map<String, Object> stats = new HashMap<>();
        
        if (resultados != null && !resultados.isEmpty() && resultados.get(0) != null) {
            Object[] fila = resultados.get(0);
            stats.put("partidos_jugados", fila[0] != null ? fila[0] : 0);
            stats.put("titular", fila[1] != null ? fila[1] : 0);
            stats.put("suplente", fila[2] != null ? fila[2] : 0);
            stats.put("minutos_totales", fila[3] != null ? fila[3] : 0);
            stats.put("goles_totales", fila[4] != null ? fila[4] : 0);
            stats.put("asistencias_totales", fila[5] != null ? fila[5] : 0);
            stats.put("amarillas_totales", fila[6] != null ? fila[6] : 0);
            stats.put("rojas_totales", fila[7] != null ? fila[7] : 0);
        } else {
            stats.put("partidos_jugados", 0);
            stats.put("titular", 0);
            stats.put("suplente", 0);
            stats.put("minutos_totales", 0);
            stats.put("goles_totales", 0);
            stats.put("asistencias_totales", 0);
            stats.put("amarillas_totales", 0);
            stats.put("rojas_totales", 0);
        }
        return stats;
    }

    // RUTA CLAVE PARA GUARDAR
    @PostMapping("/nuevo")
    public Jugador crearJugador(@RequestBody Jugador nuevoJugador) {
        return jugadorRepository.save(nuevoJugador);
    }
}