"""
Servidor web y API REST para TalentoLive (Deporte Base en Directo).
Incorpora autenticación y control de acceso por roles (Usuario Final, Club Deportivo y Administrador).
"""

import sys
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import urllib.parse
import mimetypes

# Añadir raíz al PYTHONPATH
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import time

from data.geo import CCAA_PROVINCIAS
from data.sports import SPORTS_CATEGORIES
from backend.db import (
    init_db, list_events, get_event_by_id, create_event, update_event, delete_event,
    list_club_events, list_all_clubs, report_event, get_stats,
    authenticate_user, create_session, get_user_by_session, delete_session,
    list_users, get_user_by_id, create_user, update_user, delete_user,
    toggle_user_verification, get_user_favorite_clubs, save_user_favorite_clubs,
    get_event_chat_messages, create_chat_message,
    create_sponsor_lead, list_sponsor_leads,
    get_club_by_id_or_name, get_club_community_messages, create_club_community_message,
    create_club, delete_club, import_club_youtube_videos
)
from backend.metadata import extract_metadata_from_url
from backend.moderation import contains_offensive_language
from backend.rss_sync import (
    sync_all_registered_clubs_rss,
    sync_club_rss,
    get_last_rss_sync_info,
    start_rss_background_poller
)

PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# Registro en memoria de marcas de tiempo de envío de chat para control antispam (cooldown 3s)
_chat_cooldowns = {}

class SportsLiveHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def _set_cors_and_json(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-XSS-Protection", "1; mode=block")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _get_current_user(self):
        """Extrae el usuario autenticado a partir del encabezado Authorization o de cookies."""
        auth_header = self.headers.get("Authorization", "")
        token = ""
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        if not token:
            cookie_header = self.headers.get("Cookie", "")
            if "session_token=" in cookie_header:
                for part in cookie_header.split(";"):
                    part = part.strip()
                    if part.startswith("session_token="):
                        token = part.split("=", 1)[1]
                        break
        if token:
            return get_user_by_session(token)
        return None

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            return {}
        post_data = self.rfile.read(content_length)
        try:
            return json.loads(post_data.decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query_params = urllib.parse.parse_qs(parsed.query)
            filters = {k: v[0] for k, v in query_params.items()}

            # 1. Sesión activa del usuario
            if path == "/api/auth/me":
                user = self._get_current_user()
                self._set_cors_and_json(200)
                if user:
                    self.wfile.write(json.dumps({"authenticated": True, "user": user}, ensure_ascii=False).encode("utf-8"))
                else:
                    self.wfile.write(json.dumps({"authenticated": False, "user": None}).encode("utf-8"))
                return

            # 2. Partidos de mi club (para rol 'club' o 'admin')
            if path == "/api/club/my-events":
                user = self._get_current_user()
                if not user or user.get("role") not in ("club", "admin"):
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "No tienes permiso para acceder al panel de club."}).encode("utf-8"))
                    return
                club_name = user.get("club_name") or ""
                if not club_name and user.get("role") == "admin":
                    club_name = filters.get("club_name", "")
                events = list_club_events(club_name) if club_name else list_events()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(events, ensure_ascii=False).encode("utf-8"))
                return

            # 3. Administración: Listado de usuarios (solo admin)
            if path == "/api/admin/users":
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Acceso restringido a administradores."}).encode("utf-8"))
                    return
                users = list_users()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(users, ensure_ascii=False).encode("utf-8"))
                return

            # 4. Administración: Listado de clubes (solo admin)
            if path == "/api/admin/clubs":
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Acceso restringido a administradores."}).encode("utf-8"))
                    return
                clubs = list_all_clubs()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(clubs, ensure_ascii=False).encode("utf-8"))
                return

            # 4.0.b. Administración: Estado de sincronización RSS de canales (solo admin)
            if path == "/api/admin/sync-channels":
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Acceso restringido a administradores."}).encode("utf-8"))
                    return
                info = get_last_rss_sync_info()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(info, ensure_ascii=False).encode("utf-8"))
                return

            # 4.1. Listado público de clubes/canales oficiales (para favoritos)
            if path == "/api/clubs":
                clubs = list_all_clubs()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(clubs, ensure_ascii=False).encode("utf-8"))
                return

            # 4.1.b. Chat de comunidad permanente del club
            if path.startswith("/api/clubs/") and path.endswith("/chat"):
                parts = path.strip("/").split("/")
                if len(parts) == 4:
                    club_id = urllib.parse.unquote(parts[2])
                    messages = get_club_community_messages(club_id)
                    self._set_cors_and_json(200)
                    self.wfile.write(json.dumps(messages, ensure_ascii=False).encode("utf-8"))
                    return

            # 4.1.c. Detalle y perfil oficial de un club/canal (incluye directos, partidos anteriores, prensa y reels)
            if path.startswith("/api/clubs/"):
                club_id = urllib.parse.unquote(path.split("/api/clubs/")[1])
                club = get_club_by_id_or_name(club_id)
                if club:
                    self._set_cors_and_json(200)
                    self.wfile.write(json.dumps(club, ensure_ascii=False).encode("utf-8"))
                else:
                    self._set_cors_and_json(404)
                    self.wfile.write(json.dumps({"error": "Club o canal no encontrado"}, ensure_ascii=False).encode("utf-8"))
                return

            # 4.2. Clubes favoritos del usuario autenticado
            if path == "/api/user/favorites":
                user = self._get_current_user()
                favs = get_user_favorite_clubs(user["id"]) if user else []
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"favorite_clubs": favs}, ensure_ascii=False).encode("utf-8"))
                return

            # 5. Listado de eventos público (con filtros en cascada y optimización para portada)
            if path == "/api/events":
                # Si no se pide el catálogo sin límites explícito (all=1 o admin=1),
                # se aplica por defecto la restricción de portada: directos prioritarios + últimos 5 vídeos históricos por club
                if filters.get("all") not in ("1", "true") and filters.get("admin") not in ("1", "true"):
                    filters.setdefault("portada", "1")
                events = list_events(filters)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(events, ensure_ascii=False).encode("utf-8"))
                return

            # 5.1. Chat del evento en directo
            if path.startswith("/api/events/") and path.endswith("/chat"):
                parts = path.strip("/").split("/")
                if len(parts) == 4:
                    event_id = parts[2]
                    messages = get_event_chat_messages(event_id)
                    self._set_cors_and_json(200)
                    self.wfile.write(json.dumps(messages, ensure_ascii=False).encode("utf-8"))
                    return

            # 6. Detalle de un evento por ID
            if path.startswith("/api/events/"):
                event_id = path.split("/api/events/")[1]
                event = get_event_by_id(event_id)
                if event:
                    self._set_cors_and_json(200)
                    self.wfile.write(json.dumps(event, ensure_ascii=False).encode("utf-8"))
                else:
                    self._set_cors_and_json(404)
                    self.wfile.write(json.dumps({"error": "Evento no encontrado"}).encode("utf-8"))
                return

            # 7. Catálogos geográfico y deportivo
            if path == "/api/geo":
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(CCAA_PROVINCIAS, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/sports":
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(SPORTS_CATEGORIES, ensure_ascii=False).encode("utf-8"))
                return

            # 8. Estadísticas globales
            if path == "/api/stats":
                stats = get_stats()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(stats, ensure_ascii=False).encode("utf-8"))
                return

            # 9. Solicitudes de Patrocinio Comercial (Leads)
            if path == "/api/sponsors/leads":
                leads = list_sponsor_leads()
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(leads, ensure_ascii=False).encode("utf-8"))
                return

            # Servir estáticos con fallback inteligente a index.html para rutas SPA
            clean_rel = path.lstrip("/")
            target_file = os.path.join(PUBLIC_DIR, clean_rel)
            if not os.path.exists(target_file):
                if not path.startswith("/api/"):
                    _, ext = os.path.splitext(clean_rel)
                    if not ext:
                        self.path = "/index.html"
                    else:
                        self.send_error(404, "Recurso no encontrado")
                        return

            return super().do_GET()
        except Exception as e:
            self._set_cors_and_json(500)
            self.wfile.write(json.dumps({"error": f"Error interno en servidor: {str(e)}"}).encode("utf-8"))

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            data = self._read_json_body()

            # 1. Login
            if path == "/api/auth/login":
                identity = data.get("identity") or data.get("username") or data.get("email")
                password = data.get("password")
                if not identity or not password:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": "Debes indicar usuario/correo y contraseña."}).encode("utf-8"))
                    return
                user = authenticate_user(identity, password)
                if not user:
                    self._set_cors_and_json(401)
                    self.wfile.write(json.dumps({"error": "Credenciales inválidas. Comprueba el usuario/correo o la contraseña."}).encode("utf-8"))
                    return
                token = create_session(user["id"])
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"success": True, "token": token, "user": user}, ensure_ascii=False).encode("utf-8"))
                return

            # 2. Registro público (Rol 1: Aficionado / Espectador o Rol 2: Club Verificado)
            if path == "/api/auth/register":
                username = data.get("username")
                email = data.get("email")
                password = data.get("password")
                full_name = data.get("full_name")
                role = str(data.get("role", "aficionado")).strip().lower()
                if role not in ("aficionado", "club", "viewer"):
                    role = "aficionado"
                club_name = data.get("club_name")
                cif = data.get("cif", "")
                location = data.get("location", "")

                if not username or not email or not password:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": "Nombre de usuario, correo y contraseña son obligatorios."}).encode("utf-8"))
                    return

                if role == "club":
                    if not str(club_name or "").strip():
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "Para registrar un Club Deportivo Oficial debes indicar el Nombre de la Entidad / Club."}).encode("utf-8"))
                        return

                    invitation_code = str(data.get("invitation_code") or data.get("auth_key") or "").strip().upper()
                    master_key = os.environ.get("SPORTSLIVE_CLUB_AUTH_KEY", "SPORTSLIVE-CLUB-2026").strip().upper()
                    valid_keys = {master_key, "SPORTSLIVE-CLUB-2026", "SPORTSLIVE2026"}
                    if not invitation_code or invitation_code not in valid_keys:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({
                            "error": "Clave de autorización no válida. Para dar de alta un club oficial contacta con la administración de SportsLive."
                        }, ensure_ascii=False).encode("utf-8"))
                        return

                try:
                    new_user = create_user(
                        username=username,
                        email=email,
                        password=password,
                        role=role,
                        club_name=club_name,
                        full_name=full_name,
                        cif=cif,
                        location=location
                    )
                    token = create_session(new_user["id"])
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps({"success": True, "token": token, "user": new_user}, ensure_ascii=False).encode("utf-8"))
                except ValueError as err:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))
                return

            # 3. Cierre de sesión
            if path == "/api/auth/logout":
                auth_header = self.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header.split(" ", 1)[1].strip()
                    delete_session(token)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
                return

            # 3.1. Guardar favoritos de usuario autenticado
            if path == "/api/user/favorites":
                user = self._get_current_user()
                if not user:
                    self._set_cors_and_json(401)
                    self.wfile.write(json.dumps({"error": "Debes iniciar sesión para sincronizar tus favoritos en la cuenta."}).encode("utf-8"))
                    return
                clubs = data.get("favorite_clubs", [])
                if not isinstance(clubs, list):
                    clubs = []
                save_user_favorite_clubs(user["id"], clubs)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"success": True, "favorite_clubs": clubs}, ensure_ascii=False).encode("utf-8"))
                return

            # 4. Extracción de metadatos de vídeo
            if path == "/api/metadata":
                url = data.get("url", "")
                if not url:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": "URL requerida"}).encode("utf-8"))
                    return
                meta = extract_metadata_from_url(url)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(meta, ensure_ascii=False).encode("utf-8"))
                return

            # 4.1. Envío de mensaje al Chat del Evento en directo
            if path.startswith("/api/events/") and path.endswith("/chat"):
                parts = path.strip("/").split("/")
                if len(parts) == 4:
                    event_id = parts[2]
                    event = get_event_by_id(event_id)
                    if not event:
                        self._set_cors_and_json(404)
                        self.wfile.write(json.dumps({"error": "Evento no encontrado."}).encode("utf-8"))
                        return

                    # Condición estricta: solo retransmisiones LIVE
                    if event.get("status") != "LIVE":
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "El chat solo está disponible durante retransmisiones en directo."}).encode("utf-8"))
                        return

                    message_text = str(data.get("message", "")).strip()
                    if not message_text:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "El mensaje no puede estar vacío."}).encode("utf-8"))
                        return

                    if len(message_text) > 300:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "El mensaje no puede superar los 300 caracteres."}).encode("utf-8"))
                        return

                    # Filtro de moderación (palabras ofensivas, insultos y descalificaciones)
                    if contains_offensive_language(message_text):
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "Tu comentario infringe las normas de respeto deportivo de SportsLive"}).encode("utf-8"))
                        return

                    # Cooldown estricto: máximo 1 mensaje cada 3 segundos por usuario o IP
                    user = self._get_current_user()
                    client_key = user["id"] if user else (self.client_address[0] if self.client_address else "guest")
                    now_ts = time.time()
                    last_ts = _chat_cooldowns.get(client_key, 0)
                    if (now_ts - last_ts) < 3.0:
                        remaining = round(3.0 - (now_ts - last_ts), 1)
                        self._set_cors_and_json(429)
                        self.wfile.write(json.dumps({"error": f"Debes esperar {remaining}s antes de enviar otro mensaje (máx. 1 cada 3 segundos)."}).encode("utf-8"))
                        return
                    _chat_cooldowns[client_key] = now_ts

                    if user:
                        user_id = user["id"]
                        user_name = user.get("full_name") or user.get("username") or "Aficionado"
                        user_role = user.get("role", "viewer")
                    else:
                        user_id = None
                        user_name = str(data.get("user_name", "")).strip() or "Aficionado"
                        user_role = "viewer"

                    new_msg = create_chat_message(
                        event_id=event_id,
                        user_name=user_name,
                        message=message_text,
                        user_id=user_id,
                        user_role=user_role
                    )
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps(new_msg, ensure_ascii=False).encode("utf-8"))
                    return

            # 4.3. Chat de Comunidad del Club (permanente en la ficha del club)
            if path.startswith("/api/clubs/") and path.endswith("/chat"):
                parts = path.strip("/").split("/")
                if len(parts) == 4:
                    club_id = urllib.parse.unquote(parts[2])
                    message_text = str(data.get("message", "")).strip()
                    if not message_text:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "El mensaje no puede estar vacío."}).encode("utf-8"))
                        return

                    if len(message_text) > 300:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "El mensaje no puede superar los 300 caracteres."}).encode("utf-8"))
                        return

                    # Filtro de moderación (palabras ofensivas, insultos y descalificaciones)
                    if contains_offensive_language(message_text):
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": "Tu comentario infringe las normas de respeto deportivo de SportsLive"}).encode("utf-8"))
                        return

                    # Cooldown estricto: máximo 1 mensaje cada 3 segundos por usuario o IP
                    user = self._get_current_user()
                    client_key = f"club_{user['id'] if user else (self.client_address[0] if self.client_address else 'guest')}"
                    now_ts = time.time()
                    last_ts = _chat_cooldowns.get(client_key, 0)
                    if (now_ts - last_ts) < 3.0:
                        remaining = round(3.0 - (now_ts - last_ts), 1)
                        self._set_cors_and_json(429)
                        self.wfile.write(json.dumps({"error": f"Debes esperar {remaining}s antes de enviar otro mensaje a la comunidad."}).encode("utf-8"))
                        return
                    _chat_cooldowns[client_key] = now_ts

                    if user:
                        user_id = user["id"]
                        user_name = user.get("full_name") or user.get("username") or "Aficionado"
                        user_role = user.get("role", "viewer")
                    else:
                        user_id = None
                        user_name = str(data.get("user_name", "")).strip() or "Aficionado"
                        user_role = "viewer"

                    new_msg = create_club_community_message(
                        club_id=club_id,
                        user_name=user_name,
                        message=message_text,
                        user_id=user_id,
                        user_role=user_role
                    )
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps(new_msg, ensure_ascii=False).encode("utf-8"))
                    return

            # 4.4. Ingesta / Publicación de Vídeo clasificado en Canal de Club (live, match_replay, press, reel)
            if path.startswith("/api/clubs/") and path.endswith("/videos"):
                parts = path.strip("/").split("/")
                if len(parts) == 4:
                    club_id = urllib.parse.unquote(parts[2])
                    club = get_club_by_id_or_name(club_id)
                    if not club:
                        self._set_cors_and_json(404)
                        self.wfile.write(json.dumps({"error": "Club no encontrado"}).encode("utf-8"))
                        return

                    user = self._get_current_user()
                    # Si faltan metadatos como embed_url o thumbnail, extraerlos
                    url = data.get("url_original", "")
                    if not data.get("embed_url") and url:
                        extracted = extract_metadata_from_url(url)
                        data["platform"] = extracted["platform"]
                        data["embed_id"] = extracted["embed_id"]
                        data["embed_url"] = extracted["embed_url"]
                        if not data.get("thumbnail"):
                            data["thumbnail"] = extracted["thumbnail"]
                        if not data.get("title"):
                            data["title"] = extracted["title"]

                    data["club_id"] = club.get("id") or club_id
                    data["club_name"] = club["name"]
                    data["channel_url"] = club.get("channel_url") or data.get("channel_url", "")
                    data["is_verified"] = club.get("is_verified", 1)
                    if not data.get("sport_id"):
                        data["sport_id"] = club.get("sport_id", "futbol")
                    if not data.get("province_id"):
                        data["province_id"] = club.get("province_id", "madrid")

                    try:
                        new_ev = create_event(data, user)
                        self._set_cors_and_json(201)
                        self.wfile.write(json.dumps(new_ev, ensure_ascii=False).encode("utf-8"))
                    except Exception as e:
                        self._set_cors_and_json(400)
                        self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                    return

            # 4.4.b. Ingesta de Historial de Vídeos de YouTube (partidos diferidos, prensa, reels)
            if (path.startswith("/api/clubs/") and path.endswith("/import-history")) or \
               (path.startswith("/api/admin/clubs/") and path.endswith("/import-videos")):
                parts = path.strip("/").split("/")
                club_id = urllib.parse.unquote(parts[2] if parts[1] == "clubs" else parts[3])
                club = get_club_by_id_or_name(club_id)
                if not club:
                    self._set_cors_and_json(404)
                    self.wfile.write(json.dumps({"error": "Club no encontrado"}).encode("utf-8"))
                    return

                videos_list = data.get("videos")
                if not videos_list:
                    videos_list = [data]

                try:
                    imported = import_club_youtube_videos(club["id"], videos_list)
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps({
                        "success": True,
                        "count": len(imported),
                        "videos": imported,
                        "club": club
                    }, ensure_ascii=False).encode("utf-8"))
                except Exception as e:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                return

            # 4.5. Alta oficial de Club y Canal de YouTube (Admin / Registro)
            if path in ("/api/admin/clubs", "/api/clubs"):
                try:
                    created_club = create_club(data)
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps({
                        "success": True,
                        "club": created_club
                    }, ensure_ascii=False).encode("utf-8"))
                except Exception as e:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                return

            # 4.6. Administración: Sincronización Manual de Canales RSS de YouTube (solo admin)
            if path == "/api/admin/sync-channels":
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores pueden sincronizar canales RSS."}).encode("utf-8"))
                    return

                club_id = data.get("club_id")
                try:
                    if club_id:
                        club = get_club_by_id_or_name(club_id)
                        if not club:
                            self._set_cors_and_json(404)
                            self.wfile.write(json.dumps({"error": f"Club '{club_id}' no encontrado."}).encode("utf-8"))
                            return
                        res = sync_club_rss(club)
                        self._set_cors_and_json(200)
                        self.wfile.write(json.dumps({
                            "success": True,
                            "message": f"Sincronización de {club['name']} completada: {res.get('imported_count', 0)} nuevos vídeos importados.",
                            "total_clubs_scanned": 1,
                            "total_videos_imported": res.get("imported_count", 0),
                            "details": [res]
                        }, ensure_ascii=False).encode("utf-8"))
                        return
                    else:
                        res = sync_all_registered_clubs_rss()
                        self._set_cors_and_json(200)
                        self.wfile.write(json.dumps({
                            "success": True,
                            "message": f"Sincronización completada: {res.get('total_videos_imported', 0)} nuevos vídeos importados en {res.get('total_clubs_scanned', 0)} canales.",
                            **res
                        }, ensure_ascii=False).encode("utf-8"))
                        return
                except Exception as err:
                    self._set_cors_and_json(500)
                    self.wfile.write(json.dumps({"error": f"Error durante la sincronización RSS: {str(err)}"}).encode("utf-8"))
                    return

            # 5. Creación de retransmisión (Panel de Club / Enviar Emisión)
            if path == "/api/events":
                user = self._get_current_user()

                # Si es un aficionado sin indicar nombre de club organizador
                if user and user.get("role") in ("viewer", "aficionado") and not data.get("club_name"):
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Para emitir como aficionado debes indicar el Nombre del Club u Organizador oficial."}).encode("utf-8"))
                    return

                url = data.get("url_original", "")
                if not url:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": "La URL del evento o directo es requerida"}).encode("utf-8"))
                    return

                # Si faltan metadatos como embed_url o thumbnail, extraerlos
                if not data.get("embed_url") and url:
                    extracted = extract_metadata_from_url(url)
                    data["platform"] = extracted["platform"]
                    data["embed_id"] = extracted["embed_id"]
                    data["embed_url"] = extracted["embed_url"]
                    if not data.get("thumbnail"):
                        data["thumbnail"] = extracted["thumbnail"]
                    if not data.get("title"):
                        data["title"] = extracted["title"]

                # Asegurar nombre del club emisor y verificación
                if not data.get("club_name"):
                    if user and user.get("club_name"):
                        data["club_name"] = user["club_name"]
                    else:
                        data["club_name"] = data.get("home_team", "Club Deportivo")
                if "is_verified_club" not in data:
                    # Si el usuario es club y está verificado, o si no se especificó
                    is_ver = 1
                    if user and user.get("role") == "club":
                        is_ver = 1 if user.get("is_verified") else 0
                    data["is_verified_club"] = is_ver

                try:
                    # Si el usuario es club o admin, vincular usuario; de lo contrario insertar como emisión oficial de club
                    current_ctx = user if user and user.get("role") in ("club", "admin") else None
                    event = create_event(data, current_user=current_ctx)
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps(event, ensure_ascii=False).encode("utf-8"))
                except PermissionError as pe:
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": str(pe)}).encode("utf-8"))
                except Exception as ex:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
                return

            # 6. Reportar emisión
            if path.startswith("/api/events/") and path.endswith("/report"):
                parts = path.split("/")
                event_id = parts[3]
                res = report_event(event_id, data.get("reason", "Reporte comunitario"))
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps(res).encode("utf-8"))
                return

            # 7. Crear usuario desde panel de administración (solo admin)
            if path == "/api/admin/users":
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores pueden crear usuarios."}).encode("utf-8"))
                    return
                try:
                    role_req = data.get("role", "club")
                    is_ver = data.get("is_verified", 1 if role_req in ("club", "admin") else 0)
                    created = create_user(
                        username=data.get("username"),
                        email=data.get("email"),
                        password=data.get("password", "club123"),
                        role=role_req,
                        club_name=data.get("club_name"),
                        full_name=data.get("full_name"),
                        cif=data.get("cif", ""),
                        location=data.get("location", ""),
                        is_verified=is_ver
                    )
                    self._set_cors_and_json(201)
                    self.wfile.write(json.dumps(created, ensure_ascii=False).encode("utf-8"))
                except Exception as ex:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
                return

            # 7.5. Toggle de verificación de club (solo admin)
            if path.startswith("/api/admin/users/") and path.endswith("/verify"):
                user = self._get_current_user()
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores pueden verificar o revocar clubes."}).encode("utf-8"))
                    return
                parts = path.split("/")
                target_user_id = parts[4]
                status_to_set = 1 if data.get("is_verified", True) else 0
                updated = toggle_user_verification(target_user_id, status_to_set)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"success": True, "user": updated}, ensure_ascii=False).encode("utf-8"))
                return

            # 8. Exportar paquete
            if path == "/api/export":
                import zipfile
                parent_dir = os.path.dirname(BASE_DIR)
                compartir_dir = os.path.join(parent_dir, "compartir")
                os.makedirs(compartir_dir, exist_ok=True)

                events = list_events()
                json_path = os.path.join(compartir_dir, "exportacion_eventos.json")
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(events, f, ensure_ascii=False, indent=2)

                zip_path = os.path.join(compartir_dir, "SportsLive_Paquete_Completo.zip")
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                    for root, dirs, files in os.walk(BASE_DIR):
                        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "test.iconset")]
                        for file in files:
                            if file.startswith(".DS_Store") or file.endswith("-wal") or file.endswith("-shm"):
                                continue
                            file_path = os.path.join(root, file)
                            arcname = os.path.join("aplicacion", os.path.relpath(file_path, BASE_DIR))
                            zf.write(file_path, arcname)

                # Mantener copia TalentoLive_Paquete_Completo.zip para compatibilidad
                legacy_zip_path = os.path.join(compartir_dir, "TalentoLive_Paquete_Completo.zip")
                try:
                    import shutil
                    shutil.copyfile(zip_path, legacy_zip_path)
                except Exception:
                    pass

                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": "Exportación completada en la carpeta 'compartir'",
                    "events_count": len(events),
                    "files": ["exportacion_eventos.json", "SportsLive_Paquete_Completo.zip", "TalentoLive_Paquete_Completo.zip"]
                }, ensure_ascii=False).encode("utf-8"))
                return

            # 11. Solicitudes de Patrocinio Comercial (Leads)
            if path == "/api/sponsors/leads":
                company_name = str(data.get("company_name", "")).strip()
                contact_info = str(data.get("contact_info", "")).strip()
                if not company_name or not contact_info:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": "Nombre del negocio y forma de contacto son obligatorios."}).encode("utf-8"))
                    return

                interest = str(data.get("interest", "")).strip()
                plan_name = str(data.get("plan_name", "")).strip()
                message = str(data.get("message", "")).strip()

                lead = create_sponsor_lead(
                    company_name=company_name,
                    contact_info=contact_info,
                    interest=interest,
                    plan_name=plan_name,
                    message=message
                )
                self._set_cors_and_json(201)
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": "Solicitud de patrocinio recibida con éxito. Nos pondremos en contacto en breve.",
                    "lead": lead
                }, ensure_ascii=False).encode("utf-8"))
                return

            self._set_cors_and_json(404)
            self.wfile.write(json.dumps({"error": "Ruta no encontrada"}).encode("utf-8"))
        except Exception as e:
            self._set_cors_and_json(500)
            self.wfile.write(json.dumps({"error": f"Error interno en servidor: {str(e)}"}).encode("utf-8"))

    def do_PUT(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            data = self._read_json_body()
            user = self._get_current_user()

            # 1. Modificar un evento (Club o Admin)
            if path.startswith("/api/events/"):
                event_id = path.split("/api/events/")[1]
                
                # Re-extraer metadatos si cambió la URL del directo
                url = data.get("url_original", "")
                if url and ("embed_url" not in data or not data.get("embed_url")):
                    extracted = extract_metadata_from_url(url)
                    data["platform"] = extracted["platform"]
                    data["embed_id"] = extracted["embed_id"]
                    data["embed_url"] = extracted["embed_url"]
                    if not data.get("thumbnail"):
                        data["thumbnail"] = extracted["thumbnail"]

                try:
                    updated = update_event(event_id, data, current_user=user)
                    if updated:
                        self._set_cors_and_json(200)
                        self.wfile.write(json.dumps(updated, ensure_ascii=False).encode("utf-8"))
                    else:
                        self._set_cors_and_json(404)
                        self.wfile.write(json.dumps({"error": "Evento no encontrado"}).encode("utf-8"))
                except PermissionError as pe:
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": str(pe)}).encode("utf-8"))
                except Exception as ex:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
                return

            # 2. Modificar un usuario (solo Admin)
            if path.startswith("/api/admin/users/"):
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores"}).encode("utf-8"))
                    return
                user_id = path.split("/api/admin/users/")[1]
                try:
                    updated = update_user(user_id, data)
                    if updated:
                        self._set_cors_and_json(200)
                        self.wfile.write(json.dumps(updated, ensure_ascii=False).encode("utf-8"))
                    else:
                        self._set_cors_and_json(404)
                        self.wfile.write(json.dumps({"error": "Usuario no encontrado"}).encode("utf-8"))
                except Exception as ex:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
                return

            self._set_cors_and_json(404)
            self.wfile.write(json.dumps({"error": "Ruta no encontrada"}).encode("utf-8"))
        except Exception as e:
            self._set_cors_and_json(500)
            self.wfile.write(json.dumps({"error": f"Error interno en servidor: {str(e)}"}).encode("utf-8"))

    def do_DELETE(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            user = self._get_current_user()

            # 1. Eliminar un evento (Club o Admin)
            if path.startswith("/api/events/"):
                event_id = path.split("/api/events/")[1]
                try:
                    deleted = delete_event(event_id, current_user=user)
                    if deleted:
                        self._set_cors_and_json(200)
                        self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
                    else:
                        self._set_cors_and_json(404)
                        self.wfile.write(json.dumps({"error": "Evento no encontrado"}).encode("utf-8"))
                except PermissionError as pe:
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": str(pe)}).encode("utf-8"))
                except Exception as ex:
                    self._set_cors_and_json(400)
                    self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
                return

            # 2. Eliminar un usuario (solo Admin)
            if path.startswith("/api/admin/users/"):
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores"}).encode("utf-8"))
                    return
                user_id = path.split("/api/admin/users/")[1]
                delete_user(user_id)
                self._set_cors_and_json(200)
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
                return

            # 3. Eliminar / Dar de baja un club (solo Admin)
            if path.startswith("/api/admin/clubs/") or path.startswith("/api/clubs/"):
                if not user or user.get("role") != "admin":
                    self._set_cors_and_json(403)
                    self.wfile.write(json.dumps({"error": "Solo administradores"}).encode("utf-8"))
                    return
                prefix = "/api/admin/clubs/" if path.startswith("/api/admin/clubs/") else "/api/clubs/"
                club_id = urllib.parse.unquote(path.split(prefix)[1])
                deleted = delete_club(club_id)
                if deleted:
                    self._set_cors_and_json(200)
                    self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
                else:
                    self._set_cors_and_json(404)
                    self.wfile.write(json.dumps({"error": "Club no encontrado"}).encode("utf-8"))
                return

            self._set_cors_and_json(404)
            self.wfile.write(json.dumps({"error": "Ruta no encontrada"}).encode("utf-8"))
        except Exception as e:
            self._set_cors_and_json(500)
            self.wfile.write(json.dumps({"error": f"Error interno en servidor: {str(e)}"}).encode("utf-8"))

TalentoLiveHandler = SportsLiveHandler  # Alias de compatibilidad
GradaDirectoHandler = SportsLiveHandler  # Alias de compatibilidad

def run_server(port=3000, on_ready=None):
    init_db()
    try:
        start_rss_background_poller(interval_minutes=45)
    except Exception as _e:
        print(f"⚠️ No se pudo iniciar el poller RSS en segundo plano: {_e}")
    for p in [port, 3001, 8080, 8000]:
        try:
            server_address = ("", p)
            httpd = ThreadingHTTPServer(server_address, SportsLiveHandler)
            print(f"📡 SportsLive servidor activo en http://localhost:{p}")
            if on_ready:
                import threading
                threading.Thread(target=on_ready, args=(p,), daemon=True).start()
            httpd.serve_forever()
            break
        except OSError:
            print(f"Puerto {p} en uso, probando siguiente...")

if __name__ == "__main__":
    port = 3000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)

