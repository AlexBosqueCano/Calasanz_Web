"""Endurecimiento de seguridad del CD. Calasanz (E6).

- Limitación de intentos (login y registro) -> 429 con Retry-After.
- Cabeceras de seguridad en todas las respuestas.

Límites del contrato (docs/API_CONTRATO.md):
    * 5 intentos de login FALLIDOS cada 15 minutos, por usuario + IP.
    * 5 registros cada hora, por IP.

Limitaciones conocidas (para explicarlas en el examen oral):
    * Los contadores viven en la memoria del proceso. Con un solo proceso de
      Flask (nuestro caso) funciona; con varios procesos cada uno tendría su
      propio contador y habría que moverlos a una base de datos o a Redis.
    * Se usa request.remote_addr. Detrás de un proxy inverso sería la IP del
      proxy; entonces habría que configurar ProxyFix (werkzeug) con cuidado.
"""
import math
import threading
import time
from collections import deque

from flask import current_app, request

from comun import error

# Si el diccionario crece más de esto, se purgan las claves caducadas
# (evita que alguien llene la memoria probando miles de nombres distintos).
MAX_CLAVES_ANTES_DE_PURGAR = 5000


class LimitadorIntentos:
    """Ventana deslizante: como mucho `maximo` intentos en `ventana` segundos."""

    def __init__(self, maximo, ventana, reloj=time.monotonic):
        self.maximo = maximo
        self.ventana = ventana
        self._reloj = reloj
        self._intentos = {}  # clave -> deque con el instante de cada intento
        self._cerrojo = threading.Lock()

    def _caducar(self, clave, ahora):
        """Quita los intentos fuera de la ventana. Devuelve la cola o None."""
        cola = self._intentos.get(clave)
        if cola is None:
            return None
        while cola and ahora - cola[0] >= self.ventana:
            cola.popleft()
        if not cola:
            del self._intentos[clave]
            return None
        return cola

    def segundos_de_espera(self, clave):
        """0 si se puede intentar; si no, segundos hasta poder volver a hacerlo."""
        with self._cerrojo:
            ahora = self._reloj()
            cola = self._caducar(clave, ahora)
            if cola is not None and len(cola) >= self.maximo:
                return max(1, math.ceil(self.ventana - (ahora - cola[0])))
            return 0

    def anotar(self, clave):
        """Registra un intento (fallido, o simplemente hecho) para esta clave."""
        with self._cerrojo:
            ahora = self._reloj()
            if len(self._intentos) > MAX_CLAVES_ANTES_DE_PURGAR:
                for otra in list(self._intentos):
                    self._caducar(otra, ahora)
            self._intentos.setdefault(clave, deque()).append(ahora)

    def reiniciar(self, clave):
        """Olvida los intentos de esta clave (p. ej. tras un login correcto)."""
        with self._cerrojo:
            self._intentos.pop(clave, None)

    def vaciar(self):
        with self._cerrojo:
            self._intentos.clear()


limite_login = LimitadorIntentos(maximo=5, ventana=15 * 60)
limite_registro = LimitadorIntentos(maximo=5, ventana=60 * 60)


def limites_activos():
    """En los tests están apagados, salvo que el test pida LIMITES_EN_TESTS.

    Así los tests que hacen muchos registros o logins seguidos no se bloquean
    entre sí, y los tests de este módulo pueden activarlos a propósito.
    """
    cfg = current_app.config
    return not cfg.get("TESTING") or cfg.get("LIMITES_EN_TESTS", False)


def clave_login(username):
    """Usuario + IP: bloquear solo por IP perjudicaría a todo un instituto
    detrás de la misma IP; bloquear solo por usuario dejaría que cualquiera
    bloquease la cuenta de otro desde cualquier sitio."""
    return f"{request.remote_addr}|{username.lower()}"


def clave_registro():
    return str(request.remote_addr)


def respuesta_429(segundos):
    cuerpo, status = error(
        "demasiados_intentos",
        "Demasiados intentos. Inténtalo de nuevo más tarde.",
        429,
    )
    cuerpo.headers["Retry-After"] = str(segundos)
    return cuerpo, status


# ----------------------------------------------------------------------------
# Cabeceras de seguridad
# ----------------------------------------------------------------------------
# El frontend actual no usa scripts ni estilos en línea ni recursos externos,
# por eso se puede ser estricto. Si alguien añade una fuente de Google, un CDN
# o un <script> en línea, hay que ampliar esta política (y justificarlo).
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def init_seguridad(app):
    """Añade las cabeceras de seguridad a todas las respuestas de la app."""

    @app.after_request
    def poner_cabeceras(respuesta):
        h = respuesta.headers
        h.setdefault("Content-Security-Policy", CSP)
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
        if request.path.startswith("/api/"):
            # Las respuestas de la API dependen de la sesión: que nadie las cachee.
            h.setdefault("Cache-Control", "no-store")
        if app.config.get("SESSION_COOKIE_SECURE"):
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return respuesta
