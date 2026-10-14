"""
LiveSports - Servicio de Búsqueda Global de Emisiones Deportivas en YouTube.
Proporciona búsqueda en tiempo real de retransmisiones y partidos mediante
YouTube Data API v3 (con videoCategoryId=17 para deportes) o mediante el extractor/scraper
público de YouTube como fallback resiliente sin consumo forzoso de cuota.
Los resultados retornados son efímeros y marcados como 'is_external: True'.
"""

from __future__ import annotations

import os
import re
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import List, Dict, Any

SPORT_KEYWORDS = {
    "futbol", "fútbol", "basket", "baloncesto", "balonmano", "deporte", "deportes",
    "sports", "partido", "directo", "cantera", "cadete", "juvenil", "infantil",
    "alevin", "aleví", "alevin", "federacion", "federación", "liga", "club",
    "cf", "cd", "cb", "fc", "rfef", "fbm", "fbcv", "boxeo", "contacto", "mma",
    "voleibol", "sala", "live", "en vivo"
}


def _enhance_sports_query(query: str) -> str:
    """Mejora la consulta añadiendo contexto deportivo si la búsqueda no lo incluye explícitamente."""
    q_clean = query.strip()
    if not q_clean:
        return ""
    words = set(re.findall(r"\w+", q_clean.lower()))
    if any(k in words for k in SPORT_KEYWORDS):
        return q_clean
    return f"{q_clean} deporte partido"


def _search_youtube_api(query: str, api_key: str, max_results: int = 16) -> List[Dict[str, Any]]:
    """Consulta la API oficial de YouTube v3 filtrando por la categoría Deportes (17)."""
    params = {
        "part": "snippet",
        "type": "video",
        "videoCategoryId": "17",  # Deportes en YouTube Data API
        "maxResults": str(max(1, min(max_results, 30))),
        "q": query,
        "key": api_key
    }
    url = f"https://www.googleapis.com/youtube/v3/search?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LiveSports/1.0",
            "Accept": "application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        if resp.status != 200:
            return []
        data = json.loads(resp.read().decode("utf-8"))

    results = []
    items = data.get("items", [])
    for it in items:
        id_info = it.get("id", {})
        vid = id_info.get("videoId")
        if not vid:
            continue
        snippet = it.get("snippet", {})
        title = snippet.get("title", "Emisión Deportiva")
        channel = snippet.get("channelTitle", "Canal de YouTube")
        thumbs = snippet.get("thumbnails", {})
        thumb = (
            thumbs.get("high", {}).get("url") or
            thumbs.get("medium", {}).get("url") or
            thumbs.get("default", {}).get("url") or
            f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"
        )
        is_live = (snippet.get("liveBroadcastContent") == "live")

        results.append({
            "id": vid,
            "youtubeId": vid,
            "title": title,
            "channelTitle": channel,
            "thumbnail": thumb,
            "videoUrl": f"https://www.youtube.com/watch?v={vid}",
            "embed_url": f"https://www.youtube-nocookie.com/embed/{vid}?autoplay=0&modestbranding=1&rel=0",
            "is_live": is_live,
            "is_external": True
        })
    return results


def _search_youtube_scraper(query: str, max_results: int = 16) -> List[Dict[str, Any]]:
    """Extractor/scraper público de YouTube que procesa ytInitialData sin requerir cuota de API."""
    enhanced_q = _enhance_sports_query(query)
    # sp=EgIQAQ%253D%253D aplica filtro de sólo vídeos en YouTube search
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(enhanced_q)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
    )

    with urllib.request.urlopen(req, timeout=6.0) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    m = re.search(r"var ytInitialData = ({.*?});</script>", html) or re.search(r"ytInitialData\s*=\s*({.*?});", html)
    if not m:
        return []

    data = json.loads(m.group(1))
    results = []
    seen = set()

    def walk(obj: Any):
        if len(results) >= max_results:
            return
        if isinstance(obj, dict):
            if "videoRenderer" in obj:
                vr = obj["videoRenderer"]
                vid = vr.get("videoId")
                if vid and vid not in seen:
                    seen.add(vid)
                    title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", []))
                    if not title and "accessibility" in vr.get("title", {}):
                        title = vr["title"]["accessibility"].get("accessibilityData", {}).get("label", "")

                    owner = vr.get("ownerText", {}) or vr.get("shortBylineText", {})
                    channel = "".join(r.get("text", "") for r in owner.get("runs", []))

                    thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
                    thumb = thumbs[-1].get("url") if thumbs else f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"

                    badges = vr.get("badges", [])
                    is_live = False
                    try:
                        badges_str = json.dumps(badges).upper()
                        if "LIVE" in badges_str or "DIRECTO" in badges_str:
                            is_live = True
                    except Exception:
                        pass

                    results.append({
                        "id": vid,
                        "youtubeId": vid,
                        "title": title or f"Partido YouTube ({vid})",
                        "channelTitle": channel or "Canal Deportivo",
                        "thumbnail": thumb,
                        "videoUrl": f"https://www.youtube.com/watch?v={vid}",
                        "embed_url": f"https://www.youtube-nocookie.com/embed/{vid}?autoplay=0&modestbranding=1&rel=0",
                        "is_live": is_live,
                        "is_external": True
                    })
            for val in obj.values():
                if len(results) >= max_results:
                    return
                walk(val)
        elif isinstance(obj, list):
            for it in obj:
                if len(results) >= max_results:
                    return
                walk(it)

    walk(data)
    return results


def search_youtube_sports(query: str, max_results: int = 16) -> List[Dict[str, Any]]:
    """
    Punto de entrada principal para la búsqueda global de emisiones deportivas en YouTube.
    1. Si se define YOUTUBE_API_KEY en variables de entorno, intenta consultar YouTube Data API v3 (categoría 17).
    2. Si no hay API key o si la consulta falla (cuota agotada, etc.), usa el scraper público.
    3. Resultados puramente efímeros (NO guardados en base de datos SQLite).
    """
    clean_q = (query or "").strip()
    if not clean_q or len(clean_q) < 2:
        return []

    # 1. Intentar con YouTube Data API si existe clave
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if api_key:
        try:
            enhanced_q = _enhance_sports_query(clean_q)
            api_results = _search_youtube_api(enhanced_q, api_key, max_results=max_results)
            if api_results:
                return api_results
        except Exception as e:
            # Fallback silencioso al scraper
            pass

    # 2. Scraper público como fallback robusto
    try:
        return _search_youtube_scraper(clean_q, max_results=max_results)
    except Exception as e:
        return []
