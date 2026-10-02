/**
 * Catálogo estático de Comunidades Autónomas, Provincias y Deportes
 * para filtrado instantáneo sin latencia en el navegador.
 */

const GEO_CATALOG = [
  {
    id: "andalucia",
    name: "Andalucía",
    provinces: [
      { id: "almeria", name: "Almería" },
      { id: "cadiz", name: "Cádiz" },
      { id: "cordoba", name: "Córdoba" },
      { id: "granada", name: "Granada" },
      { id: "huelva", name: "Huelva" },
      { id: "jaen", name: "Jaén" },
      { id: "malaga", name: "Málaga" },
      { id: "sevilla", name: "Sevilla" }
    ]
  },
  {
    id: "aragon",
    name: "Aragón",
    provinces: [
      { id: "huesca", name: "Huesca" },
      { id: "teruel", name: "Teruel" },
      { id: "zaragoza", name: "Zaragoza" }
    ]
  },
  {
    id: "asturias",
    name: "Principado de Asturias",
    provinces: [{ id: "asturias", name: "Asturias" }]
  },
  {
    id: "baleares",
    name: "Islas Baleares",
    provinces: [{ id: "baleares", name: "Baleares" }]
  },
  {
    id: "canarias",
    name: "Canarias",
    provinces: [
      { id: "las-palmas", name: "Las Palmas" },
      { id: "santa-cruz-de-tenerife", name: "Santa Cruz de Tenerife" }
    ]
  },
  {
    id: "cantabria",
    name: "Cantabria",
    provinces: [{ id: "cantabria", name: "Cantabria" }]
  },
  {
    id: "castilla-la-mancha",
    name: "Castilla-La Mancha",
    provinces: [
      { id: "albacete", name: "Albacete" },
      { id: "ciudad-real", name: "Ciudad Real" },
      { id: "cuenca", name: "Cuenca" },
      { id: "guadalajara", name: "Guadalajara" },
      { id: "toledo", name: "Toledo" }
    ]
  },
  {
    id: "castilla-y-leon",
    name: "Castilla y León",
    provinces: [
      { id: "avila", name: "Ávila" },
      { id: "burgos", name: "Burgos" },
      { id: "leon", name: "León" },
      { id: "palencia", name: "Palencia" },
      { id: "salamanca", name: "Salamanca" },
      { id: "segovia", name: "Segovia" },
      { id: "soria", name: "Soria" },
      { id: "valladolid", name: "Valladolid" },
      { id: "zamora", name: "Zamora" }
    ]
  },
  {
    id: "cataluna",
    name: "Cataluña",
    provinces: [
      { id: "barcelona", name: "Barcelona" },
      { id: "girona", name: "Girona" },
      { id: "lleida", name: "Lleida" },
      { id: "tarragona", name: "Tarragona" }
    ]
  },
  {
    id: "comunidad-valenciana",
    name: "Comunidad Valenciana",
    provinces: [
      { id: "alicante", name: "Alicante" },
      { id: "castellon", name: "Castellón" },
      { id: "valencia", name: "Valencia" }
    ]
  },
  {
    id: "extremadura",
    name: "Extremadura",
    provinces: [
      { id: "badajoz", name: "Badajoz" },
      { id: "caceres", name: "Cáceres" }
    ]
  },
  {
    id: "galicia",
    name: "Galicia",
    provinces: [
      { id: "a-coruna", name: "A Coruña" },
      { id: "lugo", name: "Lugo" },
      { id: "ourense", name: "Ourense" },
      { id: "pontevedra", name: "Pontevedra" }
    ]
  },
  {
    id: "madrid",
    name: "Comunidad de Madrid",
    provinces: [{ id: "madrid", name: "Madrid" }]
  },
  {
    id: "murcia",
    name: "Región de Murcia",
    provinces: [{ id: "murcia", name: "Murcia" }]
  },
  {
    id: "navarra",
    name: "Comunidad Foral de Navarra",
    provinces: [{ id: "navarra", name: "Navarra" }]
  },
  {
    id: "pais-vasco",
    name: "País Vasco",
    provinces: [
      { id: "alava", name: "Álava" },
      { id: "bizkaia", name: "Bizkaia" },
      { id: "gipuzkoa", name: "Gipuzkoa" }
    ]
  },
  {
    id: "la-rioja",
    name: "La Rioja",
    provinces: [{ id: "la-rioja", name: "La Rioja" }]
  },
  {
    id: "ceuta",
    name: "Ceuta",
    provinces: [{ id: "ceuta", name: "Ceuta" }]
  },
  {
    id: "melilla",
    name: "Melilla",
    provinces: [{ id: "melilla", name: "Melilla" }]
  }
];

const SPORTS_CATALOG = [
  {
    id: "futbol",
    name: "Fútbol",
    icon: "⚽",
    categories: [
      { id: "prebenjamin", name: "Prebenjamín (Sub-8)" },
      { id: "benjamin", name: "Benjamín (Sub-10)" },
      { id: "alevin", name: "Alevín (Sub-12)" },
      { id: "infantil", name: "Infantil (Sub-14)" },
      { id: "cadete", name: "Cadete (Sub-16)" },
      { id: "juvenil", name: "Juvenil / Div. Honor (Sub-19)" },
      { id: "regional", name: "Regional Preferente / 1ª Regional" },
      { id: "tercera_rfef", name: "Tercera RFEF" },
      { id: "femenino_base", name: "Fútbol Femenino" }
    ]
  },
  {
    id: "baloncesto",
    name: "Baloncesto",
    icon: "🏀",
    categories: [
      { id: "minibasket", name: "Mini-Basket" },
      { id: "infantil", name: "Infantil" },
      { id: "cadete", name: "Cadete" },
      { id: "junior", name: "Junior Autonómico" },
      { id: "senior_nacional", name: "1ª Nacional / Senior" },
      { id: "femenino_base", name: "Baloncesto Femenino" }
    ]
  },
  {
    id: "futsal",
    name: "Fútbol Sala",
    icon: "🥅",
    categories: [
      { id: "benjamin", name: "Benjamín" },
      { id: "alevin", name: "Alevín" },
      { id: "infantil", name: "Infantil" },
      { id: "cadete", name: "Cadete" },
      { id: "juvenil_dh", name: "División Honor Juvenil" },
      { id: "tercera_futsal", name: "Tercera División FS" }
    ]
  },
  {
    id: "balonmano",
    name: "Balonmano",
    icon: "🤾",
    categories: [
      { id: "alevin", name: "Alevín" },
      { id: "infantil", name: "Infantil" },
      { id: "cadete", name: "Cadete" },
      { id: "juvenil", name: "Juvenil" },
      { id: "primera_territorial", name: "1ª Territorial / Nacional" }
    ]
  },
  {
    id: "voleibol",
    name: "Voleibol",
    icon: "🏐",
    categories: [
      { id: "infantil", name: "Infantil" },
      { id: "cadete", name: "Cadete" },
      { id: "juvenil", name: "Juvenil" },
      { id: "primera_autonomica", name: "1ª Autonómica" }
    ]
  },
  {
    id: "rugby",
    name: "Rugby",
    icon: "🏉",
    categories: [
      { id: "sub14", name: "M14 (Sub-14)" },
      { id: "sub16", name: "M16 (Sub-16)" },
      { id: "sub18", name: "M18 (Sub-18)" },
      { id: "senior_regional", name: "Senior Regional" }
    ]
  },
  {
    id: "padel_tenis",
    name: "Tenis y Pádel",
    icon: "🎾",
    categories: [
      { id: "torneo_alevin", name: "Circuito Alevín" },
      { id: "torneo_infantil", name: "Circuito Infantil" },
      { id: "torneo_cadete", name: "Circuito Cadete" },
      { id: "liga_interclubes", name: "Liga Interclubes Amateur" }
    ]
  },
  {
    id: "hockey",
    name: "Hockey",
    icon: "🏑",
    categories: [
      { id: "alevin", name: "Alevín" },
      { id: "infantil", name: "Infantil" },
      { id: "juvenil", name: "Juvenil / 1ª Nacional" }
    ]
  },
  {
    id: "contacto",
    name: "Boxeo y deportes de contacto",
    icon: "🥊",
    categories: [
      { id: "boxeo", name: "Boxeo" },
      { id: "mma", name: "MMA" },
      { id: "kickboxing", name: "Kickboxing" },
      { id: "muay_thai", name: "Muay Thai" },
      { id: "otras", name: "Otras disciplinas" }
    ]
  }
];

/**
 * Imagen deportiva genérica por defecto (fútbol base)
 * utilizada cuando no existe miniatura cargada en el partido.
 */
const DEFAULT_GENERIC_SPORT_THUMBNAIL = "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60";

/**
 * Devuelve la imagen de fondo deportiva genérica (fútbol base)
 * para tarjetas de partidos que no disponen de miniatura propia.
 */
function getGenericSportThumbnail(sportId) {
  return DEFAULT_GENERIC_SPORT_THUMBNAIL;
}

/**
 * Genera una imagen deportiva vectorial en formato Data URI (SVG local)
 * adaptada al deporte, colores temáticos e icono correspondiente.
 * Se utiliza como fallback inmediato y garantizado si la miniatura externa falla o da error 404.
 */
function getSportSvgDataUri(sportId, sportIcon, sportName) {
  const cleanId = (sportId || 'futbol').toLowerCase();
  const themes = {
    futbol: { g1: '#065f46', g2: '#022c22', accent: '#10b981', name: 'FÚTBOL' },
    baloncesto: { g1: '#c2410c', g2: '#431407', accent: '#f97316', name: 'BALONCESTO' },
    futsal: { g1: '#1d4ed8', g2: '#0f172a', accent: '#06b6d4', name: 'FÚTBOL SALA' },
    balonmano: { g1: '#9f1239', g2: '#4c0519', accent: '#f43f5e', name: 'BALONMANO' },
    voleibol: { g1: '#7e22ce', g2: '#2e1065', accent: '#a855f7', name: 'VOLEIBOL' },
    rugby: { g1: '#047857', g2: '#064e3b', accent: '#34d399', name: 'RUGBY' },
    padel_tenis: { g1: '#0284c7', g2: '#082f49', accent: '#38bdf8', name: 'TENIS / PÁDEL' },
    hockey: { g1: '#b45309', g2: '#451a03', accent: '#fbbf24', name: 'HOCKEY' },
    contacto: { g1: '#831843', g2: '#500724', accent: '#f43f5e', name: 'BOXEO / CONTACTO' }
  };
  const t = themes[cleanId] || { g1: '#1e293b', g2: '#0f172a', accent: '#38bdf8', name: (sportName || 'DEPORTE BASE').toUpperCase() };
  const icon = sportIcon || '🏅';
  const label = (sportName || t.name).toUpperCase();
  const safeIcon = String(icon).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeLabel = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225" width="400" height="225">
  <defs>
    <linearGradient id="grad_${cleanId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.g1}"/>
      <stop offset="100%" stop-color="${t.g2}"/>
    </linearGradient>
    <pattern id="grid_${cleanId}" width="25" height="25" patternUnits="userSpaceOnUse">
      <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="400" height="225" fill="url(#grad_${cleanId})"/>
  <rect width="400" height="225" fill="url(#grid_${cleanId})"/>
  <circle cx="200" cy="100" r="52" fill="rgba(0,0,0,0.35)" stroke="${t.accent}" stroke-width="2.5" stroke-dasharray="6 4"/>
  <text x="200" y="112" font-size="42" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${safeIcon}</text>
  <rect x="130" y="165" width="140" height="24" rx="12" fill="rgba(0,0,0,0.45)" stroke="${t.accent}" stroke-width="1"/>
  <text x="200" y="181" font-size="11" font-weight="bold" fill="#f8fafc" text-anchor="middle" letter-spacing="1.5" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${safeLabel}</text>
  <rect x="0" y="221" width="400" height="4" fill="${t.accent}"/>
</svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

if (typeof window !== 'undefined') {
  window.getSportSvgDataUri = getSportSvgDataUri;
}

