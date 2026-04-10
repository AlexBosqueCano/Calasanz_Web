package com.cd_calasanz.backend.model;

// Cambiamos 'Integer' por 'Number'. 
// Number es un comodín que acepta tanto números pequeños como los números gigantes (Long) que devuelve SUM() y COUNT()
public interface EstadisticasTotales {
    Number getPartidosJugados();
    Number getTitular();
    Number getSuplente();
    Number getMinutosTotales();
    Number getGolesTotales();
    Number getAsistenciasTotales();
    Number getAmarillasTotales();
    Number getRojasTotales();
}