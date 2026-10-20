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
| Ver equipos, plantillas, partidos, clasificación, estadísticas, noticias, lesiones | sí | sí | sí | sí | sí |
| Ver datos físicos de un jugador (estatura, peso) | no | solo el suyo | los de su equipo | sí | sí |
| Solicitar acceso como jugador o entrenador | sí | no | no | no | no |
| Gestionar solicitudes | no | no | no | JUGADOR y ENTRENADOR | todas |
| Crear, editar y dar de baja jugadores | no | no | no | sí | sí |
| Crear, editar y borrar partidos | no | no | no | sí | sí |
| Rellenar o modificar el acta de un partido | no | no | solo su equipo | no | sí |
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
{ "id": 1, "nombre": "Juvenil A", "categoria": { "id": 1, "nombre": "Juvenil" },
  "es_propio": true, "entrenador": { "id": 7, "username": "mgarcia" } }
```

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
  "estado": "programado", "evento": null }
```
`estado` es `programado` hasta que se envía el acta y `finalizado` después.

**Acta** (cuerpo de `PUT /api/partidos/{id}/acta`)
```json
{ "resultado_local": 2, "resultado_visitante": 0,
  "estadisticas": [
    { "jugador_id": 1, "estado": "titular", "mins_jugados": 90, "goles": 2,
      "goles_recibidos": 0, "asistencias": 0, "amarillas": 0, "roja": false },
    { "jugador_id": 2, "estado": "titular", "mins_jugados": 90, "goles": 0,
      "goles_recibidos": 0, "asistencias": 0, "amarillas": 0, "roja": false }
  ] }
```

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
  "equipo_id": 1, "fecha_inicio": "2026-10-30", "fecha_estimada_vuelta": "2026-11-20", "activa": true }
```

**Apunte del entrenador**
```json
{ "id": 9, "equipo_id": 1, "rival_id": 11, "partido_id": null,
  "texto": "Presiona alto; el lateral derecho se queda atrás.", "autor_id": 7,
  "creado_en": "2026-11-09T18:30:00+01:00" }
```

**Solicitud de acceso**
```json
{ "id": 5, "usuario_id": 12, "rol_solicitado": "JUGADOR", "jugador_id": 3, "equipo_id": null,
  "mensaje": "Soy Carlos García, del Juvenil A.", "estado": "pendiente",
  "comentario_resolucion": null, "creada_en": "2026-10-28T09:00:00+01:00", "resuelta_en": null }
```

## 4. Endpoints

### Sistema y autenticación

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/salud` | público | 200 `{ "estado": "ok" }` (para Docker y CI) |
| POST | `/api/auth/registro` | público | 201 usuario (rol `ESTANDAR`) · 409 usuario/email ya existe · 422 · 429 |
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
| GET | `/api/equipos?categoria=&propios=true` | autenticado | 200 array |
| GET | `/api/equipos/{id}` | autenticado | 200 · 404 |
| GET | `/api/equipos/{id}/plantilla` | autenticado | 200 array de jugadores activos |
| GET | `/api/equipos/{id}/clasificacion?temporada=` | autenticado | 200 array `{ posicion, equipo, pj, g, e, p, gf, gc, dg, puntos }` (3-1-0) |
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
| GET | `/api/partidos?temporada=&equipo=&desde=&hasta=&estado=` | autenticado | 200 paginado |
| GET | `/api/partidos/{id}` | autenticado | 200 (incluye acta si existe) · 404 |
| POST | `/api/partidos` `{ temporada_id, jornada, fecha, local_id, visitante_id, evento? }` | COORD, DEV | 201 · 403 · 422 |
| PATCH | `/api/partidos/{id}` | COORD, DEV | 200 · 403 · 404 · 409 (ya tiene acta y se cambia algo que la invalida) · 422 |
| DELETE | `/api/partidos/{id}` | COORD, DEV | 204 (borra también su acta; la interfaz pide confirmación) · 403 · 404 |
| PUT | `/api/partidos/{id}/acta` | ENTRENADOR del equipo, DEV | 200 (reemplaza el acta completa en una transacción) · 403 · 404 · 409 (partido en el futuro) · 422 |

### Apuntes, lesiones y noticias

| Método | Ruta | Quién | Respuestas |
|---|---|---|---|
| GET | `/api/equipos/{id}/apuntes` | ENTRENADOR del equipo, DEV | 200 array · 403 |
| POST | `/api/apuntes` `{ equipo_id, rival_id?, partido_id?, texto }` | ENTRENADOR del equipo, DEV | 201 · 403 · 422 |
| PATCH / DELETE | `/api/apuntes/{id}` | su autor, DEV | 200/204 · 403 · 404 |
| GET | `/api/lesiones?equipo=&activa=true` | autenticado | 200 array |
| POST | `/api/lesiones` | ENTRENADOR del equipo, COORD, DEV | 201 · 403 · 409 (el jugador ya tiene una lesión activa) · 422 |
| PATCH | `/api/lesiones/{id}` | ENTRENADOR del equipo, COORD, DEV | 200 · 403 · 404 · 422 |
| DELETE | `/api/lesiones/{id}` | COORD, DEV | 204 · 403 · 404 |
| GET | `/api/noticias?tipo=&estado_evento=&page=` | autenticado | 200 paginado (más recientes primero) |
| GET | `/api/noticias/{id}` | autenticado | 200 · 404 |
| POST / PATCH / DELETE | `/api/noticias[/{id}]` | COORD, DEV | 201/200/204 · 403 · 404 · 422 |

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
- `local_id` ≠ `visitante_id`; al menos uno es equipo propio; ambos de la misma categoría.
- `jornada` ≥ 1; `fecha` obligatoria y válida; la temporada debe existir.

**Acta**
- Solo se puede enviar si la fecha del partido ya ha llegado (`409` si es futura).
- `resultado_*` entre 0 y 99.
- Cada jugador del acta pertenece al equipo propio del partido, está activo y no se repite.
- La suma de goles de los jugadores ≤ goles del equipo propio en el resultado.
- `goles_recibidos` > 0 solo para porteros (hoy lo hace un trigger de BD; la API debe devolver `422`, no `500`).
- `mins_jugados` 0–120; `amarillas` 0–2; `estado` ∈ {`titular`, `suplente`}; el resto, enteros ≥ 0.
- El acta se reemplaza de forma atómica: si falla la validación, **el acta anterior queda intacta**.

**Solicitudes de acceso**
- Una sola solicitud pendiente por usuario (`409`).
- `JUGADOR`: exige `jugador_id` de un jugador activo sin usuario vinculado.
- `ENTRENADOR`: exige `equipo_id` de un equipo propio sin entrenador asignado.
- Aprobar es una única transacción: cambia el rol, crea el vínculo y cierra la solicitud. Rechazar exige `comentario`.
- Una solicitud ya resuelta no se puede volver a resolver (`409`).

**Lesiones**
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
6. Tablas nuevas: `noticia`, `lesion`, `apunte_entrenador`, `solicitud_acceso`.
7. Ordenar los scripts de `PostGres/web` (`01_tablas.sql`, `02_datos.sql`), corregir `mins__jugados` y eliminar o corregir `create_base.sql` (crea `cd_calasanz`, pero la app usa `calasanz_db`).

## 7. Decisiones abiertas (cerrar en la Fase 0)

- **D1. Equipos.** Hoy hay dos tablas (`equipo` rivales y `equipo_calasanz`), y `partido.local/visitante` no puede apuntar a ambas. *Recomendación:* una sola tabla `equipo` con `es_propio`. Así los partidos entre rivales también se guardan y la clasificación puede ser de toda la liga y no solo de nuestro equipo.
- **D2. Sesión o JWT.** *Recomendación:* sesión con cookie (más sencillo y seguro para esta app, y encaja con el CSRF descrito).
- **D3. Quién crea partidos y calendario.** El enunciado de requisitos no lo dice. *Recomendación:* coordinador; el entrenador solo rellena el acta.
- **D4. Visibilidad.** Se asume que todo requiere sesión (el requisito dice que antes de la página principal hay login). ¿Se quiere algo público (por ejemplo, la página de contacto)?
- **D5. Datos de lesiones.** Son datos de salud de menores: se propone mostrar solo estado y fecha estimada, sin diagnóstico.
- **D6. Frameworks.** El frontend actual es JavaScript puro. Cualquier librería (React, framework CSS) hay que consensuarla con el profesor.

## 8. Mínimo de pruebas por endpoint

Cada endpoint tiene, como mínimo, estas pruebas (cada una prepara sus propios datos y usa una BD de test):

- Sin sesión → `401`.
- Un rol sin permiso → `403`, y se verifica que **no cambió nada** en los datos.
- Caso correcto, comprobando código, contenido devuelto y estado resultante.
- Datos inválidos → `422` (y `409`/`404` donde aplique) sin dejar el sistema inconsistente.
- Para recursos de equipo: un entrenador de **otro** equipo recibe `403`.
