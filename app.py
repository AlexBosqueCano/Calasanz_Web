from datetime import timedelta
import os

from flask import Flask, jsonify

from auth import bp as auth_bp
from comun import get_db_connection, registrar_manejadores_errores

app = Flask(__name__, static_folder="frontend", template_folder="frontend")

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("Falta la variable de entorno SECRET_KEY")

app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)

registrar_manejadores_errores(app)
app.register_blueprint(auth_bp)

# Registro condicional de blueprints de dominio a medida que se incorporan
for modulo in ("equipos", "jugadores", "partidos", "apuntes", "cronicas"):
    try:
        mod = __import__(modulo)
        if hasattr(mod, "bp"):
            app.register_blueprint(mod.bp)
    except ImportError:
        pass


@app.route("/api/salud", methods=["GET"])
def salud():
    return jsonify({"estado": "ok"}), 200


@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
