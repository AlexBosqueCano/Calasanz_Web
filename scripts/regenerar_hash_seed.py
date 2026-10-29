"""Regenera los hashes argon2id de los usuarios de prueba en 02_datos.sql (E9).

Uso (desde la raíz del proyecto, con el entorno virtual activo):

    python scripts/regenerar_hash_seed.py                 # contraseña por defecto
    python scripts/regenerar_hash_seed.py OtraClave12345  # otra contraseña

Sustituye cada hash '$argon2id$...' del archivo por uno nuevo y válido
(con su propia sal) de la contraseña indicada. Se puede repetir las veces
que haga falta. Después hay que volver a cargar la base de datos.

SOLO PARA DESARROLLO: las cuentas de prueba tienen contraseña conocida y
no deben cargarse nunca en un entorno real.
"""
import re
import sys
from pathlib import Path

from argon2 import PasswordHasher

RUTA = Path(__file__).resolve().parents[1] / "PostGres" / "web" / "02_datos.sql"
PASSWORD_POR_DEFECTO = "calasanz1234"
PATRON = re.compile(r"'\$argon2id\$[^']*'")


def main():
    password = sys.argv[1] if len(sys.argv) > 1 else PASSWORD_POR_DEFECTO
    if not 10 <= len(password) <= 128:
        sys.exit("La contraseña debe tener entre 10 y 128 caracteres (regla del registro).")

    ph = PasswordHasher()
    # newline="" conserva los saltos de línea originales (el archivo usa CRLF).
    with open(RUTA, encoding="utf-8", newline="") as f:
        texto = f.read()

    nuevo, cuantos = PATRON.subn(lambda _m: f"'{ph.hash(password)}'", texto)
    if cuantos == 0:
        sys.exit(f"No se encontró ningún hash argon2id en {RUTA}")

    with open(RUTA, "w", encoding="utf-8", newline="") as f:
        f.write(nuevo)
    print(f"{cuantos} hashes regenerados en {RUTA.name} (contraseña: {password})")


if __name__ == "__main__":
    main()
