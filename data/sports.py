"""
Catálogo de deportes y categorías federadas de deporte base y amateur.
"""

SPORTS_CATEGORIES = [
    {
        "id": "futbol",
        "name": "Fútbol",
        "icon": "⚽",
        "categories": [
            {"id": "prebenjamin", "name": "Prebenjamín (Sub-8)"},
            {"id": "benjamin", "name": "Benjamín (Sub-10)"},
            {"id": "alevin", "name": "Alevín (Sub-12)"},
            {"id": "infantil", "name": "Infantil (Sub-14)"},
            {"id": "cadete", "name": "Cadete (Sub-16)"},
            {"id": "juvenil", "name": "Juvenil / División de Honor (Sub-19)"},
            {"id": "regional", "name": "Regional Preferente / 1ª Regional"},
            {"id": "tercera_rfef", "name": "Tercera Federación (3ª RFEF)"},
            {"id": "femenino_base", "name": "Fútbol Femenino"}
        ]
    },
    {
        "id": "baloncesto",
        "name": "Baloncesto",
        "icon": "🏀",
        "categories": [
            {"id": "minibasket", "name": "Mini-Basket"},
            {"id": "infantil", "name": "Infantil"},
            {"id": "cadete", "name": "Cadete"},
            {"id": "junior", "name": "Junior Autonómico"},
            {"id": "senior_nacional", "name": "1ª División Nacional / Senior"},
            {"id": "femenino_base", "name": "Baloncesto Femenino"}
        ]
    },
    {
        "id": "futsal",
        "name": "Fútbol Sala",
        "icon": "🥅",
        "categories": [
            {"id": "benjamin", "name": "Benjamín"},
            {"id": "alevin", "name": "Alevín"},
            {"id": "infantil", "name": "Infantil"},
            {"id": "cadete", "name": "Cadete"},
            {"id": "juvenil_dh", "name": "División de Honor Juvenil"},
            {"id": "tercera_futsal", "name": "Tercera División FS"}
        ]
    },
    {
        "id": "balonmano",
        "name": "Balonmano",
        "icon": "🤾",
        "categories": [
            {"id": "alevin", "name": "Alevín"},
            {"id": "infantil", "name": "Infantil"},
            {"id": "cadete", "name": "Cadete"},
            {"id": "juvenil", "name": "Juvenil"},
            {"id": "primera_territorial", "name": "1ª Territorial / Nacional"}
        ]
    },
    {
        "id": "voleibol",
        "name": "Voleibol",
        "icon": "🏐",
        "categories": [
            {"id": "infantil", "name": "Infantil"},
            {"id": "cadete", "name": "Cadete"},
            {"id": "juvenil", "name": "Juvenil"},
            {"id": "primera_autonomica", "name": "1ª Autonómica"}
        ]
    },
    {
        "id": "rugby",
        "name": "Rugby",
        "icon": "🏉",
        "categories": [
            {"id": "sub14", "name": "M14 (Sub-14)"},
            {"id": "sub16", "name": "M16 (Sub-16)"},
            {"id": "sub18", "name": "M18 (Sub-18)"},
            {"id": "senior_regional", "name": "Senior Regional"}
        ]
    },
    {
        "id": "padel_tenis",
        "name": "Tenis y Pádel",
        "icon": "🎾",
        "categories": [
            {"id": "torneo_alevin", "name": "Circuito Alevín"},
            {"id": "torneo_infantil", "name": "Circuito Infantil"},
            {"id": "torneo_cadete", "name": "Circuito Cadete"},
            {"id": "liga_interclubes", "name": "Liga Interclubes Amateur"}
        ]
    },
    {
        "id": "hockey",
        "name": "Hockey (Patines y Hierba)",
        "icon": "🏑",
        "categories": [
            {"id": "alevin", "name": "Alevín"},
            {"id": "infantil", "name": "Infantil"},
            {"id": "juvenil", "name": "Juvenil / 1ª Catalana/Nacional"}
        ]
    },
    {
        "id": "contacto",
        "name": "Boxeo y deportes de contacto",
        "icon": "🥊",
        "categories": [
            {"id": "boxeo", "name": "Boxeo"},
            {"id": "mma", "name": "MMA"},
            {"id": "kickboxing", "name": "Kickboxing"},
            {"id": "muay_thai", "name": "Muay Thai"},
            {"id": "otras", "name": "Otras disciplinas"}
        ]
    }
]

def get_sport_info(sport_id: str, category_id: str = None):
    for sp in SPORTS_CATEGORIES:
        if sp["id"] == sport_id:
            cat_name = None
            if category_id:
                for cat in sp["categories"]:
                    if cat["id"] == category_id:
                        cat_name = cat["name"]
                        break
            return {
                "sport_id": sp["id"],
                "sport_name": sp["name"],
                "sport_icon": sp["icon"],
                "category_id": category_id,
                "category_name": cat_name
            }
    return None
