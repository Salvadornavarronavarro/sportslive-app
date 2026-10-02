"""
Catálogo geográfico de España: Comunidades Autónomas y Provincias.
"""

CCAA_PROVINCIAS = [
    {
        "id": "andalucia",
        "name": "Andalucía",
        "provinces": [
            {"id": "almeria", "name": "Almería"},
            {"id": "cadiz", "name": "Cádiz"},
            {"id": "cordoba", "name": "Córdoba"},
            {"id": "granada", "name": "Granada"},
            {"id": "huelva", "name": "Huelva"},
            {"id": "jaen", "name": "Jaén"},
            {"id": "malaga", "name": "Málaga"},
            {"id": "sevilla", "name": "Sevilla"}
        ]
    },
    {
        "id": "aragon",
        "name": "Aragón",
        "provinces": [
            {"id": "huesca", "name": "Huesca"},
            {"id": "teruel", "name": "Teruel"},
            {"id": "zaragoza", "name": "Zaragoza"}
        ]
    },
    {
        "id": "asturias",
        "name": "Principado de Asturias",
        "provinces": [
            {"id": "asturias", "name": "Asturias"}
        ]
    },
    {
        "id": "baleares",
        "name": "Islas Baleares",
        "provinces": [
            {"id": "baleares", "name": "Baleares"}
        ]
    },
    {
        "id": "canarias",
        "name": "Canarias",
        "provinces": [
            {"id": "las-palmas", "name": "Las Palmas"},
            {"id": "santa-cruz-de-tenerife", "name": "Santa Cruz de Tenerife"}
        ]
    },
    {
        "id": "cantabria",
        "name": "Cantabria",
        "provinces": [
            {"id": "cantabria", "name": "Cantabria"}
        ]
    },
    {
        "id": "castilla-la-mancha",
        "name": "Castilla-La Mancha",
        "provinces": [
            {"id": "albacete", "name": "Albacete"},
            {"id": "ciudad-real", "name": "Ciudad Real"},
            {"id": "cuenca", "name": "Cuenca"},
            {"id": "guadalajara", "name": "Guadalajara"},
            {"id": "toledo", "name": "Toledo"}
        ]
    },
    {
        "id": "castilla-y-leon",
        "name": "Castilla y León",
        "provinces": [
            {"id": "avila", "name": "Ávila"},
            {"id": "burgos", "name": "Burgos"},
            {"id": "leon", "name": "León"},
            {"id": "palencia", "name": "Palencia"},
            {"id": "salamanca", "name": "Salamanca"},
            {"id": "segovia", "name": "Segovia"},
            {"id": "soria", "name": "Soria"},
            {"id": "valladolid", "name": "Valladolid"},
            {"id": "zamora", "name": "Zamora"}
        ]
    },
    {
        "id": "cataluna",
        "name": "Cataluña",
        "provinces": [
            {"id": "barcelona", "name": "Barcelona"},
            {"id": "girona", "name": "Girona"},
            {"id": "lleida", "name": "Lleida"},
            {"id": "tarragona", "name": "Tarragona"}
        ]
    },
    {
        "id": "comunidad-valenciana",
        "name": "Comunidad Valenciana",
        "provinces": [
            {"id": "alicante", "name": "Alicante"},
            {"id": "castellon", "name": "Castellón"},
            {"id": "valencia", "name": "Valencia"}
        ]
    },
    {
        "id": "extremadura",
        "name": "Extremadura",
        "provinces": [
            {"id": "badajoz", "name": "Badajoz"},
            {"id": "caceres", "name": "Cáceres"}
        ]
    },
    {
        "id": "galicia",
        "name": "Galicia",
        "provinces": [
            {"id": "a-coruna", "name": "A Coruña"},
            {"id": "lugo", "name": "Lugo"},
            {"id": "ourense", "name": "Ourense"},
            {"id": "pontevedra", "name": "Pontevedra"}
        ]
    },
    {
        "id": "madrid",
        "name": "Comunidad de Madrid",
        "provinces": [
            {"id": "madrid", "name": "Madrid"}
        ]
    },
    {
        "id": "murcia",
        "name": "Región de Murcia",
        "provinces": [
            {"id": "murcia", "name": "Murcia"}
        ]
    },
    {
        "id": "navarra",
        "name": "Comunidad Foral de Navarra",
        "provinces": [
            {"id": "navarra", "name": "Navarra"}
        ]
    },
    {
        "id": "pais-vasco",
        "name": "País Vasco",
        "provinces": [
            {"id": "alava", "name": "Álava"},
            {"id": "bizkaia", "name": "Bizkaia"},
            {"id": "gipuzkoa", "name": "Gipuzkoa"}
        ]
    },
    {
        "id": "la-rioja",
        "name": "La Rioja",
        "provinces": [
            {"id": "la-rioja", "name": "La Rioja"}
        ]
    },
    {
        "id": "ceuta",
        "name": "Ceuta",
        "provinces": [
            {"id": "ceuta", "name": "Ceuta"}
        ]
    },
    {
        "id": "melilla",
        "name": "Melilla",
        "provinces": [
            {"id": "melilla", "name": "Melilla"}
        ]
    }
]

def get_province_info(prov_id: str):
    for ccaa in CCAA_PROVINCIAS:
        for prov in ccaa["provinces"]:
            if prov["id"] == prov_id:
                return {"ccaa_id": ccaa["id"], "ccaa_name": ccaa["name"], "province_id": prov["id"], "province_name": prov["name"]}
    return None
