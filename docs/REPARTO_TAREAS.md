# Reparto de tareas — CD. Calasanz (G2105)

Borrador v0.1 · 20/10/2026 · Los roles se sortearon al azar.

## 1. Roles

| Persona | Rol | Responsabilidad principal |
|---|---|---|
| **Mateo** | Backend y modelo de datos | Esquema de BD, API REST, validación y reglas de negocio |
| **Enriquez** | Seguridad, usuarios y roles | Autenticación, sesiones, permisos, solicitudes de acceso, hardening |
| **Bosque** | Frontend | Interfaz, responsive, accesibilidad, consumo de la API |
| **Guillermo** | Infraestructura, pruebas y documentación | Docker, pytest, CI, README, endpoints sencillos, vídeo |

Revisión cruzada de PRs (todo PR lo revisa alguien de **otro** rol):
Mateo ↔ Enriquez (API y seguridad) y Bosque ↔ Guillermo (interfaz y pruebas/infra).
Cada uno debe poder explicar el sistema completo en el examen oral individual.

## 2. Equilibrio de carga

Estimación en puntos (1 punto ≈ media jornada de trabajo; es aproximado y depende de la experiencia de cada uno).

| Persona | Puntos | % del total |
|---|---|---|
| Mateo | 48 | 24,7 % |
| Enriquez | 49 | 25,3 % |
| Bosque | 53 | 27,3 % |
| Guillermo | 44 | 22,7 % |

- Está equilibrado dentro de un margen razonable. **Bosque** carga algo más (el frontend es lo más largo de pulir) y **Guillermo** algo menos.
- Para compensar ya se han movido tareas: Guillermo asume los endpoints sencillos (noticias, lesiones, rivales) y la página de contacto; Enriquez construye las páginas de login, registro y solicitud (HTML/JS), que van pegadas a la autenticación.
- **Cuellos de botella por fase:** al principio todo depende de Mateo (esquema y API) y Guillermo (que arranque el proyecto); al final se concentra en Bosque (paneles por rol y accesibilidad). Si Bosque se retrasa, Guillermo es el relevo natural para B7 y B9.
- Revisad el reparto al terminar la Fase 1 con lo que realmente haya costado cada cosa.

## 3. Fases (orientativas, ajustad al plazo real cuando se publique)

| Fase | Fechas | Objetivo |
|---|---|---|
| 0 | 20–23 oct | Sesión conjunta: decisiones abiertas, modelo de datos, contrato de API (`API_CONTRATO.md`), flujo de Git |
| 1 | 26 oct–1 nov | Base: el proyecto arranca con un comando, auth, cliente API, plantilla común, tests base |
| 2 | 2–15 nov | Funcionalidad principal: jugadores, equipos, partidos, estadísticas, noticias |
| 3 | 16–29 nov | Paneles por rol, accesibilidad, solicitudes de acceso, tests completos |
| 4 | 30 nov en adelante | Auditoría cruzada, vídeo, README final, congelar versión |

Prioridades: **P0** bloquea a otros o es imprescindible; **P1** requisito obligatorio del enunciado; **P2** deseable o complemento.

## 4. Tareas por persona

### Mateo — Backend y modelo de datos (48)

- [ ] **M1** (P0, F0–1, 5) Arreglar esquema y arranque de BD: orden de scripts de inicialización (`datos.sql` se ejecuta antes que `tablas.sql`), typo `mins__jugados`, nombre de BD coherente, PKs autoincrementales, FKs de `partido`. *Con Guillermo (G2).*
- [ ] **M2** (P0, F1, 4) Cambios de modelo para las entidades nuevas (ver `API_CONTRATO.md` §6): noticia, lesión, apunte, solicitud, y vínculo usuario↔jugador/entrenador. *Con Enriquez para `usuarios` y `solicitud_acceso`.*
- [ ] **M3** (P0, F1, 4) Estructura de la app Flask: blueprints, capa de acceso a datos, gestor global de errores que devuelva el formato JSON del contrato.
- [ ] **M4** (P0, F2, 6) CRUD de jugadores y estadísticas agregadas por jugador.
- [ ] **M5** (P0, F2, 3) Equipos, plantilla, temporadas y categorías.
- [ ] **M6** (P0–P1, F2, 8) Partidos (crear, editar y borrar: entrenador de su equipo, coordinador y desarrollador) y acta (`PUT /api/partidos/{id}/acta`, atómica, con reglas de negocio).
- [ ] **M7** (P1, F2–3, 7) Clasificación, goleadores, estadísticas del equipo y `GET /api/inicio`.
- [ ] **M8** (P1, F3, 3) Apuntes del entrenador (con comprobación de propiedad; usar los decoradores de Enriquez).
- [ ] **M9** (P0, F1–2, 3) Validaciones y reglas de negocio centralizadas; que los errores de BD (CHECK, trigger de porteros) lleguen como 422, no como 500.
- [ ] **M10** (P1, F2–3, 5) Tests de reglas de negocio de partidos, actas y estadísticas, incluidos casos límite.

### Enriquez — Seguridad, usuarios y roles (49)

- [ ] **E1** (P0, F1, 4) Registro de usuarios con hash de contraseña (argon2id o bcrypt) y validación.
- [ ] **E2** (P0, F1, 6) Login/logout/`yo` con sesión segura (cookie `HttpOnly`, `SameSite`, secreto desde entorno) y protección CSRF.
- [ ] **E3** (P0, F1, 6) Decoradores: `login_required`, `rol_requerido(...)` y comprobación de propiedad (entrenador del equipo, también para partidos; jugador propio). **Bloquea a Mateo y Guillermo: priorizar.**
- [ ] **E4** (P1, F3, 6) Solicitudes de acceso: alta, listado, aprobación atómica (cambia rol y vincula usuario).
- [ ] **E5** (P1, F3, 4) Gestión de usuarios: listar, cambiar rol, desactivar, con la jerarquía de quién asigna qué.
- [ ] **E6** (P1, F3, 4) Limitación de intentos (login y registro), cabeceras de seguridad, `.env.example`, ningún secreto en el repo.
- [ ] **E7** (P0–P1, F1–3, 8) Tests de autenticación y autorización: 401 sin sesión y al menos un caso 403 por cada tipo de permiso de la matriz.
- [ ] **E8** (P2, F3–4, 4) Revisión de seguridad del código del equipo (XSS, inyección SQL, acceso a recursos ajenos) y checklist para la auditoría a otro equipo.
- [ ] **E9** (P1, F1, 2) Usuarios de prueba, uno por rol, para seed y tests. *Con Guillermo.*
- [ ] **E10** (P1, F1–2, 5) Páginas de login, registro y solicitud de acceso (HTML/JS accesible). *Con Bosque (estilo y cliente API).*

### Bosque — Frontend (53)

- [ ] **B1** (P0, F1, 5) Cliente API central (`api.js`) con URL relativa `/api` (hoy `main.js` apunta a `localhost:8080`), manejo de errores por código HTTP, indicador de carga y función de escapado (sustituir `innerHTML` con datos por `textContent`).
- [ ] **B2** (P0, F1, 5) Plantilla común (cabecera, navegación, pie, enlace «saltar al contenido»), tema claro/oscuro y guía de estilo; quitar estilos en línea.
- [ ] **B3** (P0, F1, 2) Estado de sesión, redirección según rol y logout.
- [ ] **B4** (P1, F2, 4) Página de inicio (próximos partidos, resultados de la semana, noticias).
- [ ] **B5** (P1, F2, 6) Equipos, plantilla y perfil de jugador.
- [ ] **B6** (P1, F2–3, 8) Página de equipo: clasificación, resultados, calendario, goleadores, tarjetas y lesionados.
- [ ] **B7** (P1, F2–3, 3) Página de noticias y eventos.
- [ ] **B8** (P1–P2, F3, 12) Paneles por rol: coordinador (alta de jugadores, noticias, solicitudes), entrenador (calendario y partidos de su equipo, actas, apuntes, lesiones) y perfil del jugador.
- [ ] **B9** (P1, F1–4, 8) Responsive real, accesibilidad (etiquetas con `for`, foco visible, teclado, `aria-live`, contraste, `alt`), diálogos de confirmación en acciones destructivas, revisión con teclado y herramientas automáticas.

### Guillermo — Infraestructura, pruebas y documentación (44)

- [ ] **G1** (P0, F1, 5) `Dockerfile` (falta; el compose lo referencia con `build: .`), compose funcional, healthcheck y variables de entorno. Objetivo: un único comando para arrancar.
- [ ] **G2** (P0, F1, 3) Inicialización de BD ordenada y BD de test aislada. *Con Mateo (M1).*
- [ ] **G3** (P0, F1, 6) Configuración de pytest: fixtures (app, cliente, BD limpia por test, helpers para iniciar sesión por rol) y comando único documentado.
- [ ] **G4** (P1, F2, 3) CI con GitHub Actions: tests en cada PR.
- [ ] **G5** (P0–P1, F1 y F4, 4) README (instalación, ejecución, tests, credenciales de prueba), convenciones de ramas y plantilla de PR.
- [ ] **G6** (P1, F2, 4) Noticias: endpoints CRUD y sus tests.
- [ ] **G7** (P1, F2, 3) Lesiones: endpoints CRUD y sus tests.
- [ ] **G8** (P1, F2, 2) Equipos rivales: endpoints CRUD y sus tests.
- [ ] **G9** (P1, F2–3, 8) Tests de CRUD, validación y flujo principal de principio a fin.
- [ ] **G10** (P2, F3–4, 6) Página de contacto (estática), guion y grabación del vídeo, pruebas de aceptación (UAT).

## 5. Dependencias críticas

1. **E3** (decoradores de permisos) antes de que Mateo, Guillermo y Bosque puedan probar rutas protegidas. Hasta entonces, usad un usuario falso en desarrollo.
2. **M1 + G1 + G2** (el proyecto arranca) antes de cualquier otra cosa.
3. **Contrato de API acordado** en la Fase 0: Bosque puede trabajar con datos simulados contra él mientras Mateo implementa.
4. **G3** (fixtures de pytest) antes de que cada uno escriba sus tests.

## 6. Reglas de trabajo

- Ramas: `feature/<persona>-<id>` (por ejemplo `feature/bosque-B1`). Nadie hace push directo a `main`.
- Un PR por tarea, con revisión de otro rol y tests en verde antes de fusionar.
- Si cambia el contrato de API, se actualiza `API_CONTRATO.md` **en el mismo PR**.
- Reunión corta (15 min) dos veces por semana: qué hay hecho, qué bloquea, qué cambia.
- Antes de usar un framework JS (React) o CSS adicional, consensuarlo con el profesor (lo exige el enunciado).
