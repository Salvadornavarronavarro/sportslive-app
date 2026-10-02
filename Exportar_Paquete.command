#!/bin/bash
# ==========================================================
# SportsLive - Exportador de Aplicación y Datos para Compartir
# Doble clic para generar el paquete comprimido en la carpeta compartir
# ==========================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PARENT_DIR="$( dirname "$DIR" )"
COMPARTIR_DIR="$PARENT_DIR/compartir"

mkdir -p "$COMPARTIR_DIR"

echo "=========================================================="
echo "   📦 EXPORTANDO SPORTSLIVE PARA COMPARTIR"
echo "=========================================================="
echo ""
echo "Carpeta origen: $DIR"
echo "Carpeta destino: $COMPARTIR_DIR"
echo ""

# 1. Exportar datos JSON de partidos
echo "1️⃣ Exportando catálogo de partidos a JSON..."
python3 -c "
import sys, os, json
sys.path.insert(0, '$DIR')
from backend.db import list_events
events = list_events()
with open('$COMPARTIR_DIR/exportacion_eventos.json', 'w', encoding='utf-8') as f:
    json.dump(events, f, ensure_ascii=False, indent=2)
print(f'   ✅ {len(events)} eventos exportados en exportacion_eventos.json')
"

# 2. Crear archivo comprimido .ZIP de la aplicación completa
echo ""
echo "2️⃣ Empaquetando la aplicación en ZIP para compartir..."
cd "$PARENT_DIR"
ZIP_DEST="$COMPARTIR_DIR/SportsLive_Paquete_Completo.zip"
LEGACY_ZIP_DEST="$COMPARTIR_DIR/TalentoLive_Paquete_Completo.zip"
rm -f "$ZIP_DEST" "$LEGACY_ZIP_DEST"

zip -r "$ZIP_DEST" "aplicacion" -x "*.DS_Store" -x "*/__pycache__/*" > /dev/null
cp "$ZIP_DEST" "$LEGACY_ZIP_DEST"

echo "   ✅ Paquete generado con éxito:"
echo "   📁 $ZIP_DEST"
echo "   📁 $LEGACY_ZIP_DEST (copia de compatibilidad)"
echo ""
echo "=========================================================="
echo "✨ ¡LISTO! Ya puedes compartir los archivos que están en"
echo "   la carpeta 'compartir' con cualquier otra persona."
echo "=========================================================="
echo ""
read -p "Presiona Enter para cerrar esta ventana..."
