# Usuarios de prueba

Cuentas que carga `PostGres/web/02_datos.sql`, una por rol. **Solo para
desarrollo, tests y demostraciones.** Tienen la contraseña publicada aquí, así
que el seed no debe cargarse nunca en un entorno real.

Contraseña de todas: `calasanz1234`

| Usuario      | Rol            | Vinculado a                    | Para probar                                      |
|--------------|----------------|--------------------------------|--------------------------------------------------|
| `dev_admin`  | DESARROLLADOR  | —                              | Todo, incluidos los apuntes de los entrenadores  |
| `coord`      | COORDINADOR    | —                              | Gestión de usuarios, equipos, partidos y noticias |
| `mister_juv` | ENTRENADOR     | Equipo «Juvenil A»             | Acta, crónicas, lesiones y apuntes de su equipo  |
| `david9`     | JUGADOR        | Su ficha de jugador            | Ver solo sus propios datos físicos               |
| `aficionado` | ESTANDAR       | —                              | Solicitar acceso; ver solo lo público            |

Los vínculos reales los devuelve `GET /api/auth/yo` (`jugador_id`, `equipo_id`).

## Probar un login

```bash
curl -i -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"dev_admin","password":"calasanz1234"}'
```

## Si cambia el seed o la contraseña

Los hashes de `02_datos.sql` se generan con argon2id (el mismo algoritmo que el
registro). Para regenerarlos, con el entorno virtual activo y desde la raíz:

```bash
python scripts/regenerar_hash_seed.py                  # contraseña por defecto
python scripts/regenerar_hash_seed.py OtraClave12345   # otra contraseña
```

Después hay que recargar la base de datos (`01_tablas.sql` y `02_datos.sql`).

## En los tests

Los tests no dependen de estas cuentas: la fixture `api_como(rol)` de
`tests/conftest.py` crea un usuario temporal del rol pedido y lo borra al
terminar.
