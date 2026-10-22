from flask import Flask, jsonify, request, render_template
import psycopg2
import os

app = Flask(__name__, static_folder='frontend', template_folder='frontend')

from auth import bp as auth_bp
app.register_blueprint(auth_bp)

# Configuración de la base de datos (puedes usar variables de entorno para Docker)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "calasanz_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "postgres")

def get_db_connection():
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )
    return conn

# Ruta de ejemplo para obtener los jugadores en formato JSON (para tu main.js)
@app.route('/api/jugadores', methods=['GET'])
def get_jugadores():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, nombre, dorsal, posicion FROM jugador;")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    
    jugadores = []
    for row in rows:
        jugadores.append({
            "id": row[0],
            "nombre": row[1],
            "dorsal": row[2],
            "posicion": row[3]
        })
    return jsonify(jugadores)

# Ruta para servir la página principal
@app.route('/')
def index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
