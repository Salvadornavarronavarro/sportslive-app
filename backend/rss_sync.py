"""
SportsLive - Servicio de Ingesta Automática por Feed RSS de YouTube
Permite consultar el feed RSS público de canales de YouTube (sin consumo de cuota de API),
clasificar automáticamente los contenidos (press, reel, match_replay), evitar duplicados,
y ejecutar sincronización manual desde el panel de control o automática en segundo plano.
"""

from __future__ import annotations

import re
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import datetime
import threading
import time
import unicodedata
import uuid
from backend.db import get_db, list_all_clubs, get_club_by_id_or_name
from backend.metadata import extract_metadata_from_url

# Diccionario de identificadores conocidos / presembrados de canales de YouTube (evita peticiones innecesarias)
KNOWN_CHANNEL_IDS = {
    "cf-fuenlabrada-cantera": "UC71w3nC3sB4q6aQj_fuenla",
    "@cffuenlabrada": "UC71w3nC3sB4q6aQj_fuenla",
    "cd-las-rozas": "UCRozasBase123456789012",
    "@cdlasrozasoficial": "UCRozasBase123456789012",
    "@sevillafc": "UCLy9lmj_0cqffXUzbGHNmYA",
    "sevilla-fc-cantera": "UCLy9lmj_0cqffXUzbGHNmYA",
    "@levanteud": "UCvOegN2N1FGPPv4xBNN2F9A",
    "cantera-granota": "UCvOegN2N1FGPPv4xBNN2F9A",
    "@penya1930": "UCpenya1930123456789012",
    "@unicajabaloncesto": "UCunicaja12345678901234",
    "@barakaldocf": "UCbarakaldo123456789012",
    "@movistarinterfs": "UCinterfs12345678901234",
    "@cbgranollers": "UCcbgranollers123456789",
    "@realzaragozaoficial": "UCzaragoza1234567890123",
}

# Palabras clave para catalogar ruedas de prensa / declaraciones
PRESS_KEYWORDS = [
    "rueda de prensa", "ruedaprensa", "previa", "postpartido", "pospartido",
    "post-partido", "declaraciones", "declaracion", "entrevista", "zona mixta",
    "conferencia de prensa", "sala de prensa", "declaraciones de", "rueda prensa",
    "comparecencia"
]

# Palabras clave y patrones para catalogar reels / shorts 9:16
REEL_KEYWORDS = [
    "#shorts", "#short", "short", "shorts", "#reel", "#reels", "reel", "reels",
    "tiktok", "jugada destacada", "golazo", "goles en 60s", "clip", "highlight"
]

_sync_lock = threading.Lock()
_last_sync_info = {
    "timestamp": None,
    "total_clubs_scanned": 0,
    "total_videos_imported": 0,
    "status": "idle"
}


def normalize_text(text: str) -> str:
    """Normaliza texto a minúsculas y elimina tildes/marcas diacríticas."""
    if not text:
        return ""
    text_lower = text.lower().strip()
    return "".join(
        c for c in unicodedata.normalize("NFD", text_lower)
        if unicodedata.category(c) != "Mn"
    )


def classify_youtube_video(title: str, description: str = "", url: str = "") -> str:
    """
    Clasifica automáticamente el tipo de contenido del vídeo:
    1. 'press': si el título o descripción contiene palabras clave de declaraciones/ruedas de prensa.
    2. 'reel': si corresponde a Shorts/Reels (por hashtag, duración o URL /shorts/).
    3. 'match_replay': resto de vídeos de partidos completos, resúmenes largos o retransmisiones diferidas.
    """
    clean_title = normalize_text(title)
    clean_desc = normalize_text(description)
    clean_url = (url or "").lower()

    # 1. Comprobar si es rueda de prensa / declaraciones
    for kw in PRESS_KEYWORDS:
        if kw in clean_title or kw in clean_desc:
            return "press"

    # 2. Comprobar si es Reel / Short
    if "/shorts/" in clean_url:
        return "reel"
    for kw in REEL_KEYWORDS:
        # Usar límite de palabra o hashtag
        if kw.startswith("#"):
            if kw in clean_title or kw in clean_desc:
                return "reel"
        else:
            if re.search(r'\b' + re.escape(kw) + r'\b', clean_title):
                return "reel"

    # 3. Por defecto: partido anterior / diferido
    return "match_replay"


def resolve_youtube_channel_id(channel_identifier_or_url: str) -> str:
    """
    Resuelve el channel_id de YouTube (formato UC...) a partir de:
    - Direct channel_id (UC...)
    - URL con channel_id (https://www.youtube.com/channel/UC...)
    - Handle (@cffuenlabrada)
    - URL de feed RSS (https://www.youtube.com/feeds/videos.xml?channel_id=UC...)
    """
    if not channel_identifier_or_url or not isinstance(channel_identifier_or_url, str):
        return ""

    raw = channel_identifier_or_url.strip()

    # 1. Comprobar si es un channel_id directo
    if re.match(r'^UC[a-zA-Z0-9_-]{22}$', raw):
        return raw

    # 2. Comprobar si el channel_id está en la URL
    m = re.search(r'channel_id=([a-zA-Z0-9_-]+)', raw)
    if m:
        return m.group(1)

    m2 = re.search(r'/channel/(UC[a-zA-Z0-9_-]{22})', raw)
    if m2:
        return m2.group(1)

    # 3. Comprobar en el diccionario de canales conocidos
    raw_lower = raw.lower()
    for k, v in KNOWN_CHANNEL_IDS.items():
        if k in raw_lower:
            return v

    # Extraer handle si existe
    m_handle = re.search(r'(@[a-zA-Z0-9_.-]+)', raw)
    handle = m_handle.group(1).lower() if m_handle else ""
    if handle and handle in KNOWN_CHANNEL_IDS:
        return KNOWN_CHANNEL_IDS[handle]

    # 4. Intentar resolver mediante consulta HTTP a la página pública del canal
    target_url = raw if raw.startswith("http") else (f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/{raw}")
    try:
        req = urllib.request.Request(
            target_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
            }
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            html = response.read().decode("utf-8", errors="ignore")
            # Buscar etiquetas canónicas de canal
            ch_match = (
                re.search(r'itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"', html) or
                re.search(r'"channelId":\s*"(UC[a-zA-Z0-9_-]{22})"', html) or
                re.search(r'channel_id=(UC[a-zA-Z0-9_-]{22})', html)
            )
            if ch_match:
                found_id = ch_match.group(1)
                if handle:
                    KNOWN_CHANNEL_IDS[handle] = found_id
                return found_id
    except Exception:
        pass

    # Si no se pudo resolver y hay un handle, sintetizar un ID determinista para testing/entornos aislados
    if handle:
        synthetic_id = f"UC{handle.replace('@', '')[:10].ljust(22, '0')}"
        KNOWN_CHANNEL_IDS[handle] = synthetic_id
        return synthetic_id

    return ""


def parse_youtube_rss_xml(xml_content: str | bytes) -> list:
    """
    Parsea el XML de un feed RSS de YouTube (Atom 1.0) sin consumo de cuota de API.
    Extrae title, video_id, published, thumbnail y description de cada vídeo.
    """
    if isinstance(xml_content, str):
        xml_bytes = xml_content.encode("utf-8")
    else:
        xml_bytes = xml_content

    if not xml_bytes or not xml_bytes.strip():
        return []

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/"
    }

    results = []
    try:
        root = ET.fromstring(xml_bytes)
        entries = root.findall("atom:entry", ns)
        if not entries:
            # Intentar búsqueda sin prefijo si no coincide el namespace Atom
            entries = root.findall("{http://www.w3.org/2005/Atom}entry") or root.findall("entry")

        for entry in entries:
            # Video ID
            yt_vid = entry.find("yt:videoId", ns)
            if yt_vid is not None and yt_vid.text:
                video_id = yt_vid.text.strip()
            else:
                id_tag = entry.find("atom:id", ns)
                if id_tag is None:
                    id_tag = entry.find("{http://www.w3.org/2005/Atom}id") or entry.find("id")
                raw_id = id_tag.text.strip() if id_tag is not None and id_tag.text else ""
                video_id = raw_id.replace("yt:video:", "")

            if not video_id:
                continue

            # Título
            title_tag = entry.find("atom:title", ns)
            if title_tag is None:
                title_tag = entry.find("{http://www.w3.org/2005/Atom}title") or entry.find("title")
            title = title_tag.text.strip() if title_tag is not None and title_tag.text else f"Vídeo {video_id}"

            # Fecha de publicación
            pub_tag = entry.find("atom:published", ns)
            if pub_tag is None:
                pub_tag = entry.find("{http://www.w3.org/2005/Atom}published") or entry.find("published")
            published = pub_tag.text.strip() if pub_tag is not None and pub_tag.text else datetime.datetime.now().isoformat()

            # Enlace original
            link_tag = entry.find("atom:link[@rel='alternate']", ns)
            url = link_tag.attrib.get("href") if link_tag is not None else f"https://www.youtube.com/watch?v={video_id}"

            # Media group (thumbnail y descripción)
            mg = entry.find("media:group", ns)
            if mg is None:
                mg = entry.find("{http://search.yahoo.com/mrss/}group")

            desc = ""
            thumb = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

            if mg is not None:
                desc_tag = mg.find("media:description", ns)
                if desc_tag is None:
                    desc_tag = mg.find("{http://search.yahoo.com/mrss/}description")
                if desc_tag is not None and desc_tag.text:
                    desc = desc_tag.text.strip()

                thumb_tag = mg.find("media:thumbnail", ns)
                if thumb_tag is None:
                    thumb_tag = mg.find("{http://search.yahoo.com/mrss/}thumbnail")
                if thumb_tag is not None and thumb_tag.attrib.get("url"):
                    thumb = thumb_tag.attrib.get("url")

            content_type = classify_youtube_video(title, desc, url)

            # Duración estimada
            duration = "90:00" if content_type == "match_replay" else ("08:00" if content_type == "press" else "00:45")

            results.append({
                "video_id": video_id,
                "title": title,
                "published": published,
                "url": url,
                "thumbnail": thumb,
                "description": desc,
                "content_type": content_type,
                "duration": duration
            })

    except Exception as e:
        print(f"[RSS Parser Error] Error procesando XML feed: {e}")

    return results


def fetch_channel_rss_feed(channel_id: str, timeout: int = 5) -> list:
    """Consulta el feed RSS público de YouTube para un channel_id."""
    if not channel_id:
        return []

    rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(
        rss_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            xml_bytes = response.read()
            return parse_youtube_rss_xml(xml_bytes)
    except Exception as e:
        # En caso de error de red o timeout, retornar lista vacía sin romper el servidor
        return []


def sync_club_rss(club_id_or_data, custom_xml: str = None) -> dict:
    """
    Sincroniza los vídeos del feed RSS de YouTube para un club específico:
    - Evita duplicados si el video_id ya está en la base de datos de ese club.
    - Clasifica los contenidos (match_replay, press, reel).
    - Asocia los contenidos con status = 'REPLAY' para preservar las emisiones en vivo manuales.
    """
    if isinstance(club_id_or_data, dict):
        club = club_id_or_data
    else:
        club = get_club_by_id_or_name(str(club_id_or_data))

    if not club:
        return {"club_id": "", "club_name": "", "imported_count": 0, "videos": []}

    channel_url = club.get("channel_url") or ""
    channel_id = resolve_youtube_channel_id(channel_url)

    if not channel_id and not custom_xml:
        return {"club_id": club["id"], "club_name": club["name"], "imported_count": 0, "videos": []}

    # Obtener entradas del feed RSS
    if custom_xml:
        items = parse_youtube_rss_xml(custom_xml)
    else:
        items = fetch_channel_rss_feed(channel_id)

    if not items:
        return {"club_id": club["id"], "club_name": club["name"], "imported_count": 0, "videos": []}

    conn = get_db()
    cursor = conn.cursor()
    imported_videos = []

    try:
        for it in items:
            vid_id = it["video_id"]
            if not vid_id:
                continue

            # Comprobar duplicado en la base de datos para ese club
            cursor.execute("""
                SELECT id FROM events 
                WHERE club_id = ? AND (embed_id = ? OR url_original LIKE ?);
            """, (club["id"], vid_id, f"%{vid_id}%"))
            existing = cursor.fetchone()

            if existing:
                continue

            # Crear nuevo evento de repetición / contenido de club
            ev_id = f"evt-rss-{club['id'][:8]}-{vid_id}-{uuid.uuid4().hex[:6]}"
            title = it["title"]
            url = it["url"]
            platform = "youtube"
            embed_id = vid_id
            embed_url = f"https://www.youtube-nocookie.com/embed/{vid_id}?autoplay=0&modestbranding=1&rel=0"
            thumbnail = it["thumbnail"]
            content_type = it["content_type"]
            status = "REPLAY"
            duration = it["duration"]
            date_time = it["published"]
            now_iso = datetime.datetime.now().isoformat()

            home_team = club["name"]
            away_team = (it.get("away_team") or "").strip()
            if away_team.startswith("Rival de") or away_team in ("Equipo", "Cantera Oficial"):
                away_team = ""
            home_score = None
            away_score = None
            location_venue = club.get("location") or "Instalaciones Deportivas Oficiales"

            cursor.execute("""
            INSERT INTO events (
                id, title, url_original, platform, embed_id, embed_url,
                thumbnail, status, date_time, sport_id, sport_name, sport_icon,
                category_id, category_name, ccaa_id, ccaa_name, province_id, province_name,
                location_venue, home_team, away_team, home_score, away_score,
                sponsor_name, sponsor_logo, sponsor_url, is_verified_club, club_name,
                views_count, report_count, created_at, club_id, channel_url, duration, content_type
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                0, 0, ?, ?, ?, ?, ?
            );
            """, (
                ev_id, title, url, platform, embed_id, embed_url,
                thumbnail, status, date_time, club["sport_id"], club["sport_name"], club["sport_icon"],
                "base", club["category"], club["ccaa_id"], club["ccaa_name"], club["province_id"], club["province_name"],
                location_venue, home_team, away_team, home_score, away_score,
                "", "", "", 1, club["name"],
                now_iso, club["id"], club["channel_url"], duration, content_type
            ))

            imported_videos.append({
                "id": ev_id,
                "title": title,
                "video_id": vid_id,
                "content_type": content_type,
                "status": status,
                "duration": duration,
                "published": date_time
            })

        conn.commit()
    finally:
        conn.close()

    return {
        "club_id": club["id"],
        "club_name": club["name"],
        "imported_count": len(imported_videos),
        "videos": imported_videos
    }


def sync_all_registered_clubs_rss() -> dict:
    """Recorre todos los clubes registrados en SQLite que tengan canal de YouTube y sincroniza su feed RSS."""
    global _last_sync_info

    with _sync_lock:
        _last_sync_info["status"] = "running"
        clubs = list_all_clubs()
        clubs_with_channel = [c for c in clubs if c.get("channel_url")]

        total_scanned = len(clubs_with_channel)
        total_imported = 0
        details = []

        for club in clubs_with_channel:
            try:
                res = sync_club_rss(club)
                imported_count = res.get("imported_count", 0)
                total_imported += imported_count
                if imported_count > 0:
                    details.append(res)
            except Exception as e:
                print(f"[RSS Sync Error] Error sincronizando club {club.get('id')}: {e}")

        now_str = datetime.datetime.now().isoformat()
        _last_sync_info = {
            "timestamp": now_str,
            "total_clubs_scanned": total_scanned,
            "total_videos_imported": total_imported,
            "status": "idle",
            "details": details
        }

        return _last_sync_info


def get_last_rss_sync_info() -> dict:
    """Devuelve la información y métricas de la última sincronización ejecutada."""
    return dict(_last_sync_info)


def start_rss_background_poller(interval_minutes: int = 45):
    """
    Inicia una tarea periódica ligera en segundo plano (daemon thread)
    que recorre los canales de los clubes registrados y actualiza su catálogo
    de forma silenciosa y automática cada interval_minutes minutos.
    """
    def _poller_worker():
        print(f"📡 [YouTube RSS Poller] Iniciado background poller (frecuencia: cada {interval_minutes} minutos).")
        # Esperar 30 segundos tras el arranque inicial antes del primer ciclo de fondo
        time.sleep(30)
        while True:
            try:
                print("🔄 [YouTube RSS Poller] Ejecutando sincronización periódica silenciosa de canales...")
                sync_all_registered_clubs_rss()
            except Exception as err:
                print(f"⚠️ [YouTube RSS Poller Error]: {err}")

            time.sleep(interval_minutes * 60)

    poller_thread = threading.Thread(
        target=_poller_worker,
        daemon=True,
        name="YouTubeRSSBackgroundPoller"
    )
    poller_thread.start()
    return poller_thread
