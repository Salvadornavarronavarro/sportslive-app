#!/usr/bin/env python3
"""
Punto de entrada para ejecutar SportsLive localmente.
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
    print(f"\n✨ Abriendo SportsLive en el navegador: {url}")
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
    port = 3000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    run_server(port, on_ready=open_browser)
