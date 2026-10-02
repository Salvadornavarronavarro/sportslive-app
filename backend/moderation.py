"""
Módulo de moderación y filtro antispam para SportsLive.
Detecta palabras ofensivas, descalificaciones y lenguaje inapropiado en retransmisiones deportivas.
"""
import re
import unicodedata

# Lista negra de términos ofensivos, insultos comunes y descalificaciones en ámbito deportivo
OFFENSIVE_TERMS = [
    # Insultos y descalificaciones directas
    "puto", "puta", "puton", "putona", "putero", "cabron", "cabrona", "cabrones",
    "hijo de puta", "hija de puta", "hijos de puta", "hdp", "subnormal", "subnormales",
    "gilipollas", "retrasado", "retrasada", "retrasados", "maricon", "maricona", "marica", "maricada",
    "mierda", "mierdas", "bastardo", "bastarda", "bastardos", "capullo", "capulla", "capullos",
    "zorra", "zorrilla", "imbecil", "imbeciles", "idiota", "idiotas", "malparido", "malparida",
    "malnacido", "malnacida", "inutil", "inutiles", "asqueroso", "asquerosa", "muerete", "asesino",
    "asesinos", "corrupto", "ladron", "ladrona", "ladrones", "estafador", "nazi", "nazis",
    "fascista", "facha", "payaso", "payasos", "negrata", "manco de mierda", "guarra", "perra"
]

# Patrones con comodines para intentos comunes de elusión (ej: p*ta, c*bron)
OFFENSIVE_PATTERNS = [
    r'\bp[\*u]t[ao]s?\b',
    r'\bc[\*a]br[o\*ó]n(?:es)?\b',
    r'\bm[\*i]erd[a\*]s?\b',
    r'\bg[\*i]l[\*i]p[o\*]ll[a\*]s\b',
    r'\b[\*s]ubn[o\*]rm[a\*]l(?:es)?\b',
    r'\bh[\.\-\*]?d[\.\-\*]?p\b',
    r'\bhij[o|a]s?\s+de\s+p[u\*]t[a\*]\b'
]

def contains_offensive_language(text: str) -> bool:
    """
    Comprueba si un texto contiene insultos o descalificaciones prohibidas por las normas deportivas.
    Devuelve True si se detecta alguna palabra prohibida, False si el comentario es limpio.
    """
    if not text or not isinstance(text, str):
        return False

    raw = text.strip().lower()
    if not raw:
        return False

    # 1. Normalizar eliminando tildes y diacríticos
    norm = unicodedata.normalize('NFD', raw)
    norm = "".join(c for c in norm if unicodedata.category(c) != 'Mn')

    # 2. Comprobar patrones con comodines
    for pat in OFFENSIVE_PATTERNS:
        if re.search(pat, norm, flags=re.IGNORECASE):
            return True

    # 3. Comprobar términos compuestos (con espacios)
    for term in OFFENSIVE_TERMS:
        term_norm = unicodedata.normalize('NFD', term.lower())
        term_norm = "".join(c for c in term_norm if unicodedata.category(c) != 'Mn')
        if " " in term_norm:
            if term_norm in norm:
                return True
        else:
            # Palabra completa con límites estrictos para evitar falsos positivos
            pattern = rf'(?:^|[^a-z0-9áéíóúüñ]){re.escape(term_norm)}(?:[^a-z0-9áéíóúüñ]|$)'
            if re.search(pattern, norm, flags=re.IGNORECASE):
                return True

    return False
