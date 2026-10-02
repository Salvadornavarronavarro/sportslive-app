#!/bin/bash
# ==========================================================
# SportsLive - Lanzador Ejecutable para macOS
# Doble clic en este archivo para iniciar la aplicación web
# ==========================================================

# Asegurar que el directorio de trabajo es la carpeta donde está este script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "   📡 INICIANDO SPORTSLIVE - DEPORTE BASE EN VIVO"
echo "=========================================================="
echo ""

PYTHON_BIN="$(which python3 2>/dev/null || echo "/usr/bin/python3")"

if ! "$PYTHON_BIN" --version &> /dev/null; then
    echo "❌ Error: Python 3 no se encuentra instalado en tu sistema."
    echo "Por favor instala Python 3 desde https://www.python.org/"
    read -p "Presiona Enter para salir..."
    exit 1
fi

echo "✅ Python 3 detectado: $("$PYTHON_BIN" --version)"
echo "🚀 Abriendo SportsLive en tu navegador web..."
echo ""
echo "👉 Si no se abre solo, accede manualmente a:"
echo "   http://localhost:3000"
echo ""
echo "⚠️  Mantén esta ventana abierta mientras uses la aplicación."
echo "=========================================================="
echo ""

# Liberar puerto 3000 si estaba ocupado por una instancia previa
OLD_PID=$(lsof -ti :3000 2>/dev/null)
if [ -n "$OLD_PID" ]; then
    kill -9 $OLD_PID 2>/dev/null || true
    sleep 0.4
fi

# Ejecutar el script principal (run.py se encarga de abrir el navegador en el puerto exacto)
"$PYTHON_BIN" run.py

echo ""
echo "Servidor detenido. Puedes cerrar esta ventana."
