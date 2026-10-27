# Contrato inicial de la API — CD. Calasanz

Versión 0.1 · 20/10/2026 · Borrador para acordar en la sesión conjunta (Fase 0).
Cualquier cambio se hace por PR y se actualiza este fichero en el mismo PR.

## 1. Convenciones

- **Base:** `/api`, mismo origen que el frontend (Flask sirve ambos, no hace falta CORS).
- **Formato:** JSON UTF-8. Campos en `snake_case`. Identificadores enteros llamados `id`.
- **Fechas:** `YYYY-MM-DD`; fecha-hora en ISO 8601 con zona (`2026-11-08T11:00:00+01:00`).
- **Autenticación:** cookie de sesión `HttpOnly`, `SameSite=Lax` (y `Secure` en producción). Todas las rutas exigen sesión salvo `POST /api/auth/registro`, `POST /api/auth/login` y `GET /api/salud`.
- **CSRF:** las peticiones `POST`, `PUT`, `PATCH` y `DELETE` llevan la cabecera `X-CSRF-Token` (valor devuelto en el login y en `GET /api/auth/yo`). Sin ella o inválida: `403 csrf_invalido`.
- **Paginación** (`?page=1&por_pagina=20`, máximo 100) en jugadores, partidos, noticias, usuarios y solicitudes:
  `{ "items": [...], "page": 1, "por_pagina": 20, "total": 134 }`. El resto de listados devuelven un array directo.
- **Códigos HTTP:** `200`, `201` (con cabecera `Location`), `204`, `400` (JSON mal formado), `401`, `403`, `404`, `409`, `422`, `429`, `500`.
- **Formato de error** (siempre el mismo, sin trazas internas):

```json
{
  "error": {
    "codigo": "validacion",
    "mensaje": "Hay datos que no son válidos.",
    "detalles": [{ "campo": "dorsal", "mensaje": "Debe estar entre 1 y 99." }]
  }
}
```

| `codigo` | HTTP |
|---|---|
| `json_invalido` | 400 |
| `no_autenticado` | 401 |
| `sin_permiso`, `csrf_invalido` | 403 |
| `no_encontrado` | 404 |
| `conflicto` | 409 |
| `validacion` | 422 |
| `demasiados_intentos` | 429 (con `Retry-After`) |
| `error_interno` | 500 |

## 2. Roles y permisos

Roles: `ESTANDAR`, `JUGADOR`, `ENTRENADOR`, `COORDINADOR`, `DESARROLLADOR`.
Un entrenador está vinculado a su equipo (`equipo.id_entrenador`) y un jugador a su ficha (`jugador.id_usuario`).
**Todo se comprueba en el servidor**, no solo ocultando botones.

| Acción | ESTANDAR | JUGADOR | ENTRENADOR | COORDINADOR | DESARROLLADOR |
|---|---|---|---|---|---|
| Registrarse, iniciar sesión | sí | sí | sí | sí | sí |
| Ver equipos, plantillas, partidos, clasificación, estadísticas, noticias, crónicas, lesiones | sí | sí | sí | sí | sí |
| Ver datos físicos de un jugador (estatura, peso) | no | solo el suyo | los de su equipo | sí | sí |
| Solicitar acceso como jugador o entrenador | sí | no | no | no | no |
| Gestionar solicitudes | no | no | no | JUGADOR y ENTRENADOR | todas |
| Crear, editar y dar de baja jugadores | no | no | no | sí | sí |
| Crear y editar partidos | no | no | solo de su liga (su equipo y rivales de su competición) | sí | sí |
| Borrar partidos | no | no | no | sí | sí |
| Rellenar o modificar el acta de un partido propio | no | no | solo su equipo | sí | sí |
| Registrar el resultado de un partido entre rivales (para la clasificación) | no | no | sí | sí | sí |
| Escribir crónicas de partidos propios ya jugados | no | no | solo su equipo | sí | sí |
| Editar o borrar una crónica | no | no | solo las suyas | sí | sí |
| Apuntes de rival/partido | no | no | solo su equipo | no | sí |
| Registrar y editar lesiones | no | no | solo su equipo | sí | sí |
| Borrar lesiones | no | no | no | sí | sí |
| Crear, editar y borrar noticias/eventos | no | no | no | sí | sí |
| Gestionar equipos rivales | no | no | no | sí | sí |
| Listar usuarios y cambiar roles | no | no | no | entre ESTANDAR/JUGADOR/ENTRENADOR | cualquiera |
| Eliminar usuarios | no | no | no | no | sí |

Notas:
- Nadie puede cambiarse el rol a sí mismo, ni desactivar o eliminar al último `DESARROLLADOR` (`409`).
- Si el recurso existe pero el usuario no tiene permiso: `403`. Si no existe: `404`.

## 3. Recursos

**Usuario**
```json
{ "id": 7, "username": "mgarcia", "email": "m@ejemplo.com", "rol": "ENTRENADOR",
  "activo": true, "jugador_id": null, "equipo_id": 1 }
```

**Equipo** (propio o rival; ver decisión abierta D1)
```json
{ "id": 1, "nombre": "Juvenil A", "categoria": { "id": 1, "nombre": "Juvenil", "duracion": 90 }, "competicion": "Liga Nacional Juvenil",
  "es_propio": true, "entrenador": { "id": 7, "username": "mgarcia" } }
```

La **competición** (`competicion`) es la liga en la que juega un equipo, propio o rival. Todos los equipos con la misma competición forman una liga:
la clasificación se calcula con los partidos finalizados entre ellos, y un entrenador solo puede crear o editar partidos de la competición de su equipo.

La **duración** de un partido (`categoria.duracion`, en minutos totales) la fija la categoría y no se envía en el acta:

| Categoría | Duración | Partes |
|---|---|---|
| Prebenjamín | 40 | 2 × 20 |
| Benjamín | 50 | 2 × 25 |
| Alevín | 60 | 2 × 30 |
| Infantil | 70 | 2 × 35 |
| Cadete | 80 | 2 × 40 |
| Juvenil | 90 | 2 × 45 |

**Jugador** (`estatura` y `peso` solo aparecen si el solicitante tiene permiso)
```json
{ "id": 1, "nombre": "David", "ap1": "López", "ap2": "Martínez", "posicion": "Delantero",
  "dorsal": 9, "equipo": { "id": 1, "nombre": "Juvenil A" }, "activo": true,
  "estatura": 1.80, "peso": 75.0 }
```

**Partido** (`ganador_id` lo calcula el servidor; `null` si empate o sin jugar)
```json
{ "id": 1, "temporada_id": 2, "jornada": 1, "fecha": "2026-11-08",
  "local": { "id": 1, "nombre": "Juvenil A" }, "visitante": { "id": 11, "nombre": "CD. Laredo Juvenil" },
  "resultado_local": null, "resultado_visitante": null, "ganador_id": null,
  "estado": "programado", "evento": null, "lugar": null, "cronica_id": null }
```
`local` y `visitante` incluyen `es_propio` (de qué lado juega el club). `estado` es `programado` hasta que se envía el acta (o el resultado) y `finalizado` después.

Hay dos tipos de partido, según los equipos:
- **Propio**: local o visitante es un equipo propio. Lleva **acta completa** (alineación, árbitros, eventos con minuto).
- **Entre rivales**: ninguno es propio. Solo se guarda el **resultado**, para que la clasificación se actualice. No tiene acta ni crónica.

En un partido propio, del equipo rival solo se registra el marcador y los minutos (y, si se quiere, el autor) de sus goles; nunca su alineación.

**Acta de un partido propio** (cuerpo de `PUT /api/partidos/{id}/acta`)
```json
{ "resultado_local": 4, "resultado_visitante": 2,
  "arbitros": { "principal": "Apellidos, Nombre", "asistentes": ["Apellidos, Nombre", "Apellidos, Nombre"] },
  "cuerpo_tecnico": { "delegado_campo": "Apellidos, Nombre", "delegado_equipo": "Apellidos, Nombre" },
  "alineacion": [
    { "jugador_id": 1, "estado": "titular" },
    { "jugador_id": 4, "estado": "titular" },
    { "jugador_id": 9, "estado": "suplente" }
  ],
  "eventos": [
    { "tipo": "gol",          "minuto": 8,  "jugador_id": 4, "asistente_id": 3 },
    { "tipo": "gol_rival",    "minuto": 19, "autor": "Apellidos, Nombre" },
    { "tipo": "tarjeta",      "minuto": 22, "jugador_id": 11, "color": "amarilla" },
    { "tipo": "sustitucion",  "minuto": 45, "sale_id": 7, "entra_id": 9 }
  ] }
```
- `arbitros` y `cuerpo_tecnico` son opcionales (texto libre, sin datos de contacto).
- `eventos` es la **fuente única** de goles, asistencias y tarjetas: el servidor calcula `goles`, `asistencias`, `amarillas` y `roja` de cada jugador a partir de ellos
  (dos amarillas cuentan como una roja) y los guarda en `estadisticas_partido`. El cliente **no** los envía.
- Los **minutos jugados** y los **goles recibidos** de cada jugador tampoco los envía el cliente: el servidor los calcula de los eventos.
  - Un jugador está en el campo desde su minuto de entrada (0 si es titular; el de la sustitución si es suplente) hasta su salida (la sustitución en la que sale, su roja, o el final del partido, según la duración de su categoría, si llega hasta él). `mins_jugados` = salida − entrada; un suplente que no entra tiene 0.
  - Las sustituciones y expulsiones del minuto *m* se aplican al empezar ese minuto.
  - `goles_recibidos` de un portero (`posicion` = `Portero`) = nº de `gol_rival` que se marcan mientras está en el campo. Los jugadores que no son porteros siempre tienen 0.
- `gol` es de un jugador propio; `gol_rival` lleva el minuto y, opcionalmente, `autor` (texto libre, el rival no tiene fichas de jugador).
- El marcador debe coincidir con los eventos: nº de `gol` = goles del equipo propio y nº de `gol_rival` = goles del rival.
- Las actas ya guardadas se leen con `GET /api/partidos/{id}` (devuelve el mismo formato, con nombre y dorsal de cada jugador).

**Resultado de un partido entre rivales** (cuerpo de `PUT /api/partidos/{id}/resultado`)
```json
{ "resultado_local": 1, "resultado_visitante": 3 }
```

**Crónica** (texto corto sobre un partido propio ya jugado; es distinta de los apuntes, que son privados del entrenador)
```json
{ "id": 3, "partido": { "id": 1, "jornada": 7, "fecha": "2026-10-17",
                         "local": { "id": 1, "nombre": "Juvenil A" }, "visitante": { "id": 11, "nombre": "CD. Laredo Juvenil" },
                         "resultado_local": 4, "resultado_visitante": 2 },
  "titulo": "Victoria de prestigio ante el Laredo", "texto": "Los goles tempraneros…",
  "autor": { "id": 7, "username": "mgarcia" },
  "creada_en": "2026-10-18T10:00:00+02:00", "actualizada_en": null }
```
Es texto plano: se muestra siempre con `textContent`, nunca como HTML. Hay como máximo **una crónica por partido**.

**Estadísticas agregadas de un jugador** (mismos nombres que usa ya `main.js`)
```json
{ "partidos_jugados": 12, "titular": 10, "suplente": 2, "minutos_totales": 980,
  "goles_totales": 7, "asistencias_totales": 3, "amarillas_totales": 2, "rojas_totales": 0,
  "goles_recibidos_totales": null }
```
`goles_recibidos_totales` solo tiene valor para porteros.

**Noticia / evento**
```json
{ "id": 3, "titulo": "Torneo de Navidad", "cuerpo": "…", "tipo": "evento",
  "fecha_evento": "2026-12-20", "estado_evento": "proximo",
  "publicada_en": "2026-11-02T10:00:00+01:00", "autor": { "id": 2, "username": "coord" } }
```
`tipo` es `noticia` o `evento`. `estado_evento` (`proximo` o `finalizado`) lo calcula el servidor a partir de `fecha_evento`; es `null` en las noticias.

**Lesión** (a propósito sin diagnóstico: son datos de salud de menores; solo estado y fecha estimada de vuelta)
```json
{ "id": 4, "jugador": { "id": 3, "nombre_completo": "Carlos García Fernández" },
  "equipo_id": 1, "fecha_inicio": "2026-10-30", "fecha_estimada_vuelta": "2026-11-20", "fecha_alta": null, "activa": true }
```

**Apunte del entrenador**
```json
{ "id": 9, "equipo_id": 1, "rival_id": 11, "partido_id": null,
  "texto": "Presiona alto; el lateral derecho se queda atrás.", "autor_id": 7,
  "creado_en": "2026-11-09T18:30:00+01:00" }
```

**Solicitud de acceso**
```json
{ "id": 5, "usuario": { "id": 12, "username": "cgarcia" }, "rol_solicitado": "JUGADOR",
  "jugador": { "id": 3, "nombre_completo": "Carlos García Fernández" }, "equipo": null,
  "mensaje": "Soy Carlos García, del Juvenil A.", "estado": "pendiente",
  "comentario_resolucion": null, "creada_en": "2026-10-28T09:00:00+01:00", "resuelta_en": null }
```

## 4. Endpoints

### Sistema y autenticación

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/salud` | público | 200 `{ "estado": "ok" }` (para Docker y CI) |
| POST | `/api/auth/registro` | público | 201 usuario (rol `ESTANDAR`) · 409 usuario/email ya existe · 422 · 429 |
| POST | `/api/auth/cambiar-password` `{ password_actual, password_nueva }` | autenticado | 204 · 403 (contraseña actual incorrecta) · 422 (nueva con menos de 10 o más de 128 caracteres, o igual al `username` o a la actual) · 429 |
| POST | `/api/auth/login` | público | 200 `{ usuario, csrf_token }` · 401 «Usuario o contraseña incorrectos» (mensaje genérico) · 422 · 429 |
| POST | `/api/auth/logout` | autenticado | 204 |
| GET | `/api/auth/yo` | autenticado | 200 `{ usuario, csrf_token }` · 401 |

Cuerpo de registro: `{ "username", "email", "password" }`. Cuerpo de login: `{ "username", "password" }`.

### Usuarios y solicitudes

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/usuarios?rol=&q=` | COORD, DEV | 200 paginado · 403 |
| PATCH | `/api/usuarios/{id}` `{ rol?, activo? }` | COORD (limitado), DEV | 200 · 403 · 404 · 409 · 422 |
| DELETE | `/api/usuarios/{id}` | DEV | 204 · 403 · 404 · 409 |
| POST | `/api/solicitudes` `{ rol_solicitado, jugador_id?, equipo_id?, mensaje }` | ESTANDAR | 201 · 403 · 409 (ya tiene una pendiente o el vínculo ya está ocupado) · 422 |
| GET | `/api/solicitudes/mias` | autenticado | 200 array |
| GET | `/api/solicitudes?estado=pendiente` | COORD, DEV | 200 paginado · 403 |
| PATCH | `/api/solicitudes/{id}` `{ estado: "aprobada"\|"rechazada", comentario? }` | COORD, DEV | 200 · 403 · 404 · 409 (ya resuelta) · 422 |

### Catálogos y equipos

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/temporadas` · `/api/categorias` | autenticado | 200 array |
| GET | `/api/equipos?categoria=&propios=true&competicion=` | autenticado | 200 array |
| GET | `/api/equipos/{id}` | autenticado | 200 · 404 |
| GET | `/api/equipos/{id}/plantilla` | autenticado | 200 array de jugadores activos |
| GET | `/api/equipos/{id}/clasificacion?temporada=` | autenticado | 200 array `{ posicion, equipo, pj, g, e, p, gf, gc, dg, puntos }` (3-1-0), con los equipos de la misma competición |
| GET | `/api/equipos/{id}/goleadores?temporada=` | autenticado | 200 array `{ jugador, goles, partidos }` ordenado por goles |
| GET | `/api/equipos/{id}/estadisticas?temporada=` | autenticado | 200 array por jugador: partidos, minutos, goles, asistencias, amarillas, rojas |
| GET | `/api/equipos/{id}/partidos?temporada=&estado=` | autenticado | 200 array |
| GET | `/api/rivales` · POST `/api/rivales` · PATCH/DELETE `/api/rivales/{id}` | lectura: autenticado; escritura: COORD, DEV | 200/201/204 · 403 · 404 · 409 (borrar un rival con partidos) · 422 |
| GET | `/api/inicio` | autenticado | 200 `{ proximos_partidos (máx. 3), resultados_semana, ultimas_noticias (máx. 3) }` |

### Jugadores

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/jugadores?equipo=&posicion=&q=&activos=true` | autenticado | 200 paginado |
| GET | `/api/jugadores/{id}` | autenticado | 200 · 404 |
| GET | `/api/jugadores/{id}/estadisticas?temporada=` | autenticado | 200 · 404 |
| POST | `/api/jugadores` | COORD, DEV | 201 · 403 · 409 (dorsal ya usado en el equipo) · 422 |
| PATCH | `/api/jugadores/{id}` | COORD, DEV | 200 · 403 · 404 · 409 · 422 |
| DELETE | `/api/jugadores/{id}` | COORD, DEV | 204 (**baja lógica**: `activo=false`, conserva estadísticas) · 403 · 404 |

Esto sustituye a `/api/jugadores/nuevo` que usa el `main.js` actual.

Cuerpo de alta: `{ "nombre", "ap1", "ap2"?, "posicion", "dorsal"?, "equipo_id", "estatura"?, "peso"? }`.

### Partidos y actas

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/partidos?temporada=&equipo=&competicion=&desde=&hasta=&estado=` | autenticado | 200 paginado |
| GET | `/api/partidos/{id}` | autenticado | 200 (incluye acta si existe) · 404 |
| POST | `/api/partidos` `{ temporada_id, jornada, fecha, local_id, visitante_id, lugar?, evento? }` | ENTRENADOR de su liga, COORD, DEV | 201 · 403 · 422 |
| PATCH | `/api/partidos/{id}` | ENTRENADOR de su liga, COORD, DEV | 200 · 403 · 404 · 409 (ya tiene acta y se cambia algo que la invalida) · 422 |
| DELETE | `/api/partidos/{id}` | COORD, DEV | 204 (borra también su acta; la interfaz pide confirmación) · 403 · 404 |
| PUT | `/api/partidos/{id}/acta` | ENTRENADOR del equipo, COORD, DEV | 200 (reemplaza el acta completa en una transacción) · 403 · 404 · 409 (partido en el futuro, o partido entre rivales) · 422 |
| PUT | `/api/partidos/{id}/resultado` | ENTRENADOR, COORD, DEV | 200 (solo partidos entre rivales; actualiza la clasificación) · 403 · 404 · 409 (partido propio, que necesita acta, o partido en el futuro) · 422 |

### Apuntes, lesiones y noticias

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/equipos/{id}/apuntes` | ENTRENADOR del equipo, DEV | 200 array · 403 |
| POST | `/api/apuntes` `{ equipo_id, rival_id?, partido_id?, texto }` | ENTRENADOR del equipo, DEV | 201 · 403 · 422 |
| PATCH / DELETE | `/api/apuntes/{id}` | su autor, DEV | 200/204 · 403 · 404 |
| GET | `/api/lesiones?equipo=&jugador=&activa=` | autenticado | 200 array |
| POST | `/api/lesiones` `{ jugador_id, fecha_inicio, fecha_estimada_vuelta }` | ENTRENADOR del equipo, COORD, DEV | 201 · 403 · 409 (el jugador ya tiene una lesión activa) · 422 |
| PATCH | `/api/lesiones/{id}` | ENTRENADOR del equipo, COORD, DEV | 200 · 403 · 404 · 422 |
| DELETE | `/api/lesiones/{id}` | COORD, DEV | 204 · 403 · 404 |
| GET | `/api/noticias?tipo=&estado_evento=&page=` | autenticado | 200 paginado (más recientes primero) |
| GET | `/api/noticias/{id}` | autenticado | 200 · 404 |
| POST / PATCH / DELETE | `/api/noticias[/{id}]` | COORD, DEV | 201/200/204 · 403 · 404 · 422 |

### Crónicas

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/cronicas?equipo=&temporada=&page=` | autenticado | 200 paginado (más recientes primero) |
| GET | `/api/cronicas/{id}` | autenticado | 200 · 404 |
| POST | `/api/cronicas` `{ partido_id, titulo, texto }` | ENTRENADOR del equipo, COORD, DEV | 201 · 403 · 404 · 409 (partido no jugado, entre rivales, o ya tiene crónica) · 422 |
| PATCH | `/api/cronicas/{id}` `{ titulo?, texto? }` | su autor, COORD, DEV | 200 · 403 · 404 · 422 |
| DELETE | `/api/cronicas/{id}` | su autor, COORD, DEV | 204 · 403 · 404 |

`GET /api/partidos/{id}` devuelve `cronica_id` (o `null`) para poder enlazar el partido con su crónica.

La página de **contacto** es estática, sin endpoint.

## 5. Validaciones y reglas de negocio

Todas se aplican **en el servidor**, aunque el cliente ya las compruebe.

**Usuarios**
- `username`: 3–30 caracteres, solo letras, números, `_`, `.` y `-`; único (sin distinguir mayúsculas).
- `email`: formato válido, máximo 254, único.
- `password`: 10–128 caracteres y distinta del `username`. Se guarda con hash (argon2id o bcrypt), nunca en claro.
- Límites: 5 intentos fallidos de login por 15 min (por usuario+IP) y 5 registros por hora por IP → `429`.

**Jugador**
- `nombre` 1–50 y `ap1` 1–100 obligatorios; `ap2` opcional, máximo 100.
- `posicion` ∈ {`Portero`, `Defensa`, `Centrocampista`, `Delantero`}.
- `dorsal` entero 1–99, único entre los jugadores activos de un mismo equipo.
- `estatura` entre 1,00 y 2,30 m; `peso` entre 20 y 200 kg.
- `equipo_id` debe existir y ser un equipo propio.

**Partido**
- `local_id` ≠ `visitante_id`; ambos de la misma `competicion`. Se permiten partidos **entre rivales** (ninguno propio): solo llevan resultado.
- `lugar`: texto opcional de hasta 150 caracteres (por ejemplo, el campo o el complejo).
- Un entrenador solo puede crear o editar partidos cuyos dos equipos sean de la competición de su equipo (`403` en otro caso). No puede borrarlos.
- `jornada` ≥ 1; `fecha` obligatoria y válida; la temporada debe existir.

**Acta (partido propio)**
- Solo se puede enviar si la fecha del partido ya ha llegado (`409` si es futura) y si el partido es propio (`409` si es entre rivales).
- Un entrenador solo puede enviar el acta de partidos de su equipo (`403` en otro caso); coordinador y desarrollador, de cualquiera.
- `resultado_*` entre 0 y 99.
- Cada jugador de `alineacion` pertenece al equipo propio del partido, está activo y no se repite. `estado` ∈ {`titular`, `suplente`}; como máximo 11 titulares.
- Los minutos jugados calculados nunca superan la duración de la categoría (ver §3). Los errores de BD (CHECK, trigger de goles recibidos de porteros) deben llegar como `422`, nunca como `500`.
- Eventos: `minuto` entero 0–120; `tipo` ∈ {`gol`, `gol_rival`, `tarjeta`, `sustitucion`}.
  - `gol`: `jugador_id` en la alineación; `asistente_id` opcional, en la alineación y distinto del goleador.
  - `tarjeta`: `color` ∈ {`amarilla`, `roja`}; un jugador no puede tener más de 2 amarillas, ni nada después de una roja.
  - `sustitucion`: `sale_id` estaba en el campo (titular, o suplente que ya había entrado) y `entra_id` es un suplente que aún no ha jugado.
- El marcador coincide con los eventos (nº de `gol` y de `gol_rival`), y la suma de goles de los jugadores es la de sus `gol`.
- `arbitros` y `cuerpo_tecnico`: texto de hasta 100 caracteres cada campo; `asistentes` máximo 2.
- El acta se reemplaza de forma atómica (alineación, eventos y datos del partido): si falla la validación, **el acta anterior queda intacta**.
- Al guardar el acta, `estado` pasa a `finalizado` y la clasificación se recalcula.

**Resultado (partido entre rivales)**
- Solo si ninguno de los dos equipos es propio (`409` si es propio) y la fecha ya ha llegado (`409` si es futura).
- `resultado_*` entre 0 y 99; se puede corregir después. Recalcula la clasificación.
- Un entrenador solo puede registrarlo en partidos de la competición de su equipo (`403` en otro caso).

**Crónicas**
- `titulo` 3–120 caracteres; `texto` 50–3 000 caracteres, texto plano.
- Solo de partidos propios con `estado` = `finalizado` (`409` en otro caso). Una por partido: crear otra devuelve `409`.
- Un entrenador solo puede crearla para partidos de su equipo (`403`); editar o borrar, solo las suyas. Coordinador y desarrollador, todas.

**Solicitudes de acceso**
- `mensaje` de 5 a 500 caracteres.
- Una sola solicitud pendiente por usuario (`409`).
- `JUGADOR`: exige `jugador_id` de un jugador activo sin usuario vinculado.
- `ENTRENADOR`: exige `equipo_id` de un equipo propio sin entrenador asignado.
- Aprobar es una única transacción: cambia el rol, crea el vínculo y cierra la solicitud. Rechazar exige `comentario`.
- Una solicitud ya resuelta no se puede volver a resolver (`409`).

**Apuntes**
- `texto` 1–2 000 caracteres; `rival_id` y `partido_id` opcionales (el rival debe ser de la liga del equipo). Solo los ve el entrenador del equipo (y el desarrollador), nunca el coordinador. `PATCH` solo cambia el `texto`.

**Lesiones**
- `GET /api/lesiones` sin `activa` devuelve también las ya recuperadas (histórico); `jugador=` filtra por jugador. `fecha_alta` es la fecha real de recuperación (`null` mientras `activa`); se rellena al pasar `activa` a `false`.
- `fecha_estimada_vuelta` ≥ `fecha_inicio`; un jugador no puede tener dos lesiones activas a la vez.

**Noticias**
- `titulo` 1–150, `cuerpo` 1–10 000; si `tipo` = `evento`, `fecha_evento` es obligatoria.

## 6. Cambios necesarios en la BD

Para implementar este contrato hay que modificar el esquema actual (`PostGres/web/tablas.sql`):

1. PKs autoincrementales (`GENERATED ... AS IDENTITY`) en todas las tablas.
2. `usuarios`: `rol` con los 5 valores del contrato (hoy el valor por defecto es `EDITOR`), `email` único, `activo`, `creado_en`.
3. `jugador`: añadir `id_usuario` (FK opcional y única) y `activo`; restricción única `(equipo, dorsal)` entre activos.
4. `equipo_calasanz.entrenador` (texto) pasa a ser `id_entrenador` (FK a `usuarios`).
5. `partido`: FKs de `local` y `visitante` (hoy no existen) y `resultado_*` en `NULL` hasta que haya acta (hoy valen 0, y no se distingue «sin jugar» de «0-0»). Ver D1.
6. Tablas nuevas: `noticia`, `lesion`, `apunte_entrenador`, `solicitud_acceso`, `cronica` y las del acta ampliada:
   - `acta_partido` (`partido` PK/FK, `arbitro_principal`, `arbitro_asistente_1`, `arbitro_asistente_2`, `delegado_campo`, `delegado_equipo`).
   - `acta_evento` (`id`, `partido` FK, `tipo`, `minuto`, `id_jugador` FK, `id_jugador_2` FK para asistente o jugador que entra, `color`, `autor_rival`), con CHECKs de `tipo`, `color` y `minuto`.
   - `cronica` (`id`, `partido` FK **única**, `titulo`, `texto`, `id_autor` FK a `usuarios`, `creada_en`, `actualizada_en`).
   - `estadisticas_partido` se conserva, pero `mins_jugados`, `goles`, `goles_recibidos`, `asistencias`, `amarillas` y `roja` se calculan desde `alineacion` y `acta_evento` (no los envía el cliente).
   - Quitar la restricción de que un partido tenga un equipo propio, para guardar partidos entre rivales.
   - `equipo.competicion` (texto, obligatorio), `partido.lugar` (texto, opcional) y `categoria.duracion` (minutos totales, con las categorías Prebenjamín 40, Benjamín 50, Alevín 60, Infantil 70, Cadete 80 y Juvenil 90).
7. Ordenar los scripts de `PostGres/web` (`01_tablas.sql`, `02_datos.sql`), corregir `mins__jugados` y eliminar o corregir `create_base.sql` (crea `cd_calasanz`, pero la app usa `calasanz_db`).

## 7. Decisiones abiertas (cerrar en la Fase 0)

- **D1. Equipos (DECIDIDA: una sola tabla `equipo` con `es_propio`).** Hoy hay dos tablas (`equipo` rivales y `equipo_calasanz`), y `partido.local/visitante` no puede apuntar a ambas. *Recomendación:* una sola tabla `equipo` con `es_propio`. Así los partidos entre rivales también se guardan y la clasificación puede ser de toda la liga y no solo de nuestro equipo.
- **D2. Sesión o JWT.** *Recomendación:* sesión con cookie (más sencillo y seguro para esta app, y encaja con el CSRF descrito).
- **D3. Quién crea partidos y calendario (DECIDIDA).** Entrenadores (los partidos de su equipo y los partidos entre rivales de su competición, para poder actualizar su clasificación), coordinadores y desarrolladores. El entrenador crea y edita, pero no borra. Los equipos rivales los da de alta el coordinador (o el desarrollador).
- **D4. Visibilidad.** Se asume que todo requiere sesión (el requisito dice que antes de la página principal hay login). ¿Se quiere algo público (por ejemplo, la página de contacto)?
- **D5. Datos de lesiones.** Son datos de salud de menores: se propone mostrar solo estado y fecha estimada, sin diagnóstico.
- **D6. Frameworks.** El frontend actual es JavaScript puro. Cualquier librería (React, framework CSS) hay que consensuarla con el profesor.
- **D7. Actas (DECIDIDA).** Acta completa solo en partidos propios; en los partidos entre rivales solo el resultado, para actualizar la clasificación. Del rival en un partido propio solo se guarda el marcador y los minutos de sus goles.
- **D8. Mejora futura (fuera de esta versión).** Más adelante se quiere traer calendario, actas y clasificación de la Federación Cántabra de Fútbol (scraping o importación). Habrá que revisar antes sus condiciones de uso. La versión básica se rellena a mano.

## 8. Mínimo de pruebas por endpoint

Cada endpoint tiene, como mínimo, estas pruebas (cada una prepara sus propios datos y usa una BD de test):

- Sin sesión → `401`.
- Un rol sin permiso → `403`, y se verifica que **no cambió nada** en los datos.
- Caso correcto, comprobando código, contenido devuelto y estado resultante.
- Datos inválidos → `422` (y `409`/`404` donde aplique) sin dejar el sistema inconsistente.
- Para recursos de equipo: un entrenador de **otro** equipo recibe `403`.
