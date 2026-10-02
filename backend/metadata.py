"""
Extractor automático de metadatos de plataformas de vídeo (YouTube, Twitch).
"""

import re
import json
import urllib.request
import urllib.error

def extract_metadata_from_url(url: str) -> dict:
    url = url.strip()
    result = {
        "url_original": url,
        "platform": "external",
        "embed_id": "",
        "embed_url": "",
        "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
        "title": "Retransmisión Deportiva",
        "channel_name": "Canal Emisor",
        "is_live_hint": False
    }

    if not url:
        return result

    if url.lower().startswith("javascript:") or url.lower().startswith("data:") or url.lower().startswith("vbscript:"):
        result["embed_url"] = ""
        result["title"] = "Protocolo no admitido"
        return result

    if not (url.startswith("http://") or url.startswith("https://")):
        url = "https://" + url
    result["url_original"] = url

    # 1. YouTube detection
    yt_regex = r'(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})'
    yt_match = re.search(yt_regex, url)

    if yt_match:
        video_id = yt_match.group(1)
        result["platform"] = "youtube"
        result["embed_id"] = video_id
        result["embed_url"] = f"https://www.youtube-nocookie.com/embed/{video_id}?autoplay=0&modestbranding=1&rel=0"
        result["thumbnail"] = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        
        # Intentar extraer metadatos ricos vía oEmbed
        try:
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            req = urllib.request.Request(
                oembed_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SportsLive/1.0"}
            )
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
                    result["title"] = data.get("title", result["title"])
                    result["channel_name"] = data.get("author_name", result["channel_name"])
                    if "thumbnail_url" in data:
                        # Reemplazar hqdefault por maxresdefault si es posible
                        result["thumbnail"] = data["thumbnail_url"]
        except Exception:
            # Fallback en caso de sin conexión o timeout
            if "/live/" in url:
                result["is_live_hint"] = True
                result["title"] = f"Emisión en Directo (YouTube #{video_id})"
            else:
                result["title"] = f"Partido retransmitido ({video_id})"
        return result

    # 2. Twitch detection
    twitch_clip_match = re.search(r'(?:clips\.twitch\.tv\/|twitch\.tv\/[^\/]+\/clip\/)([a-zA-Z0-9_-]+)', url)
    twitch_video_match = re.search(r'twitch\.tv\/videos\/(\d+)', url)
    twitch_channel_match = re.search(r'twitch\.tv\/([a-zA-Z0-9_]{3,25})(?:[\/?#]|$)', url)

    if twitch_clip_match:
        clip_id = twitch_clip_match.group(1)
        result["platform"] = "twitch"
        result["embed_id"] = clip_id
        result["embed_url"] = f"https://clips.twitch.tv/embed?clip={clip_id}&parent=localhost&parent=127.0.0.1&autoplay=false"
        result["thumbnail"] = "https://static-cdn.jtvnw.net/ttv-static/404_preview-640x360.jpg"
        result["title"] = f"Clip de Twitch: {clip_id}"
        result["channel_name"] = "Twitch Sports"
        return result
    elif twitch_video_match:
        video_id = twitch_video_match.group(1)
        result["platform"] = "twitch"
        result["embed_id"] = video_id
        result["embed_url"] = f"https://player.twitch.tv/?video={video_id}&parent=localhost&parent=127.0.0.1&autoplay=false"
        result["thumbnail"] = "https://static-cdn.jtvnw.net/ttv-static/404_preview-640x360.jpg"
        result["title"] = f"Vídeo Twitch #{video_id}"
        result["channel_name"] = "Twitch Sports"
        return result
    elif twitch_channel_match:
        channel_name = twitch_channel_match.group(1)
        if channel_name.lower() not in ["videos", "directory", "downloads", "clip", "clips"]:
            result["platform"] = "twitch"
            result["embed_id"] = channel_name
            result["embed_url"] = f"https://player.twitch.tv/?channel={channel_name}&parent=localhost&parent=127.0.0.1&autoplay=false"
            result["thumbnail"] = "https://static-cdn.jtvnw.net/ttv-static/404_preview-640x360.jpg"
            result["title"] = f"Directo en Twitch: @{channel_name}"
            result["channel_name"] = channel_name
            result["is_live_hint"] = True
            return result

    # 3. Genérico / Iframe externo
    result["embed_url"] = url
    result["title"] = "Retransmisión en directo"
    return result
