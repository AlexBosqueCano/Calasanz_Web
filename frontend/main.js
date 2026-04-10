const API_URL = 'http://localhost:8080/api/jugadores';

// ==========================================
// 1. CARGAR PLANTILLA GENERAL
// ==========================================
async function cargarJugadores() {
    const contenedor = document.getElementById('contenedor-jugadores');
    if (!contenedor) return; 

    try {
        const respuesta = await fetch(API_URL);
        const jugadores = await respuesta.json();
        
        contenedor.innerHTML = '';

        jugadores.forEach(jugador => {
            const apellido2 = jugador.ap2 ? jugador.ap2 : '';
            const fila = document.createElement('tr');
            
            // Eliminamos la columna dorsal y ponemos strong en posición. 
            // El link ya es negrita en estilos.css o HTML.
            fila.innerHTML = `
                <td>
                    <a href="jugador.html?id=${jugador.idJugador}" style="font-weight: bold; color: inherit; text-decoration: none;">
                        ${jugador.nombre} ${jugador.ap1} ${apellido2}
                    </a>
                </td>
                <td><strong>${jugador.posicion}</strong></td>
            `;
            
            contenedor.appendChild(fila);
        });
    } catch (error) {
        console.error('Error al cargar la plantilla:', error);
    }
}

// ==========================================
// 2. CARGAR PERFIL INDIVIDUAL Y ESTADÍSTICAS
// ==========================================
async function cargarPerfilJugador() {
    const parametros = new URLSearchParams(window.location.search);
    const idJugador = parametros.get('id');

    if (!idJugador) return;

    try {
        // --- PETICIÓN 1: Datos Personales ---
        const respuesta = await fetch(`${API_URL}/${idJugador}`);
        const jugador = await respuesta.json();

        const tituloNombre = document.getElementById('nombre-perfil-principal');
        if (tituloNombre) {
            const apellido2 = jugador.ap2 ? jugador.ap2 : '';
            tituloNombre.textContent = `${jugador.nombre} ${jugador.ap1} ${apellido2}`;
        }

        const listaFicha = document.getElementById('lista-ficha-tecnica');
        if (listaFicha) {
            // Ficha técnica limpia de peso, estatura y dorsal.
            listaFicha.innerHTML = `
                <li><strong>Posición:</strong> ${jugador.posicion}</li>
                <li><strong>Equipo:</strong> Juvenil A</li>
            `;
        }

        // --- PETICIÓN 2: Estadísticas del jugador ---
        const respuestaStats = await fetch(`${API_URL}/${idJugador}/estadisticas`);
        
        if (!respuestaStats.ok) throw new Error('Error al cargar estadísticas');
        
        const stats = await respuestaStats.json();
        
        const tablaStats = document.getElementById('cuerpo-estadisticas-jugador');
        if (tablaStats) {
            // Mantenemos font-weight: bold al <tr> para resaltar todos los números
            tablaStats.innerHTML = `
                <tr style="font-weight: bold; font-size: 1.05em;">
                    <td>${stats.partidos_jugados || 0}</td>
                    <td>${stats.titular || 0}</td>
                    <td>${stats.suplente || 0}</td>
                    <td>${stats.minutos_totales || 0}'</td>
                    <td>${stats.goles_totales || 0}</td>
                    <td>${stats.asistencias_totales || 0}</td>
                    <td>${stats.amarillas_totales || 0}</td>
                    <td>${stats.rojas_totales || 0}</td>
                </tr>
            `;
        }

    } catch (error) {
        console.error('Error:', error);
        const tablaStats = document.getElementById('cuerpo-estadisticas-jugador');
        if (tablaStats) {
            tablaStats.innerHTML = '<tr><td colspan="8" style="text-align: center;">No hay datos de estadísticas para este jugador aún.</td></tr>';
        }
    }
}

// ==========================================
// 3. REGISTRAR NUEVO JUGADOR (ADMIN)
// ==========================================
function inicializarFormularioAdmin() {
    const formulario = document.getElementById('form-nuevo-jugador');
    if (!formulario) return;

    formulario.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        const nuevoJugador = {
            nombre: document.getElementById('nombre').value,
            ap1: document.getElementById('ap1').value,
            ap2: document.getElementById('ap2').value,
            posicion: document.getElementById('posicion').value,
            equipo: parseInt(document.getElementById('equipo').value) // Obtenemos el ID del desplegable
        };

        try {
            const respuesta = await fetch(`${API_URL}/nuevo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(nuevoJugador)
            });

            if (respuesta.ok) {
                alert('¡Jugador registrado con éxito en el CD. CALASANZ!');
                formulario.reset();
                window.location.href = 'juvenil-a-plantilla.html'; 
            } else {
                alert('Hubo un problema al guardar al jugador en el servidor.');
            }
        } catch (error) {
            console.error('Error al guardar:', error);
            alert('No se pudo conectar con el servidor.');
        }
    });
}

// ==========================================
// 4. EVENTOS AL CARGAR LA PÁGINA
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    cargarJugadores();
    cargarPerfilJugador();
    inicializarFormularioAdmin();
});