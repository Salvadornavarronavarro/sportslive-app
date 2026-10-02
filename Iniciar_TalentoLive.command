#!/bin/bash
# ==========================================================
# SportsLive (anteriormente TalentoLive) - Lanzador Principal
# Doble clic para abrir SportsLive en el navegador web
# ==========================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"
exec ./Iniciar_SportsLive.command
