#!/usr/bin/env python3
"""
Punto de entrada para ejecutar LiveSports localmente.
Lanza el servidor HTTP y abre la aplicación en tu navegador.
"""

import os
import sys
import webbrowser
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.server import run_server

def open_browser(port):
    time.sleep(0.5)
    url = f"http://localhost:{port}"
    print(f"\n✨ Abriendo LiveSports en el navegador: {url}")
    print("👉 Si tu navegador no se abre automáticamente, entra en esa dirección.\n")
    
    # 1. En macOS, '/usr/bin/open' es el método nativo más seguro y no requiere permisos AppleScript
    opened = False
    if sys.platform == "darwin":
        try:
            import subprocess
            subprocess.Popen(["/usr/bin/open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            opened = True
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        try:
            import subprocess
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            opened = True
        except Exception:
            pass
    elif sys.platform == "win32":
        try:
            os.startfile(url)
            opened = True
        except Exception:
            pass

    if not opened:
        try:
            webbrowser.open(url)
        except Exception:
            pass

if __name__ == "__main__":
    port = None
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    if port is None:
        try:
            port = int(os.environ.get("PORT", 5000))
        except (ValueError, TypeError):
            port = 5000

    # En entornos cloud como Render (donde se define PORT o RENDER), no abrir navegador
    on_ready_cb = None
    if "RENDER" not in os.environ and "PORT" not in os.environ:
        on_ready_cb = open_browser

    run_server(port=port, host="0.0.0.0", on_ready=on_ready_cb)
