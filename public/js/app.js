/**
 * SportsLive - Aplicación Web Principal
 * Gestión de retransmisiones de deporte base en directo, filtros en cascada,
 * ingesta inteligente de URLs con metadatos y reproductores embebidos.
 */

// Estado global de la aplicación
const state = {
  currentTab: 'LIVE', // 'LIVE', 'UPCOMING', 'REPLAY'
  directosFilter: 'all', // 'all', 'today', 'weekend'
  selectedCcaa: 'all',
  selectedProvince: 'all',
  selectedSport: 'all',
  selectedCategory: 'all',
  selectedDiscipline: 'all',
  searchQuery: '',
  allEvents: [],
  events: [],
  isFetchingEvents: false,
  hasFetchedEvents: false,
  featuredEventId: null,
  favorites: [],
  favoriteClubs: [],
  favoritesOnlyMode: false,
  favoritesChangedWhileModalOpen: false,
  allClubs: [],
  favModalSportFilter: 'all',
  favModalSearch: '',
  favModalTab: 'my_clubs', // 'my_clubs' o 'search'
  activeClubMode: null, // ID o Nombre del club en modo monográfico exclusivo
  activeClubFilter: null, // Filtro activo por club o monográfico
  activeModalEvent: null,
  currentUser: JSON.parse(localStorage.getItem('sportslive_current_user') || 'null'),
  token: localStorage.getItem('sportslive_auth_token') || localStorage.getItem('talentolive_auth_token') || localStorage.getItem('grada_auth_token') || '',
  adminMatches: [],
  adminUsers: [],
  sidebarTab: 'featured', // 'featured' o 'chat'
  chatMessages: [],
  chatEventId: null,
  lastChatSendTime: 0,
  chatPollTimer: null
};

/* ==========================================================
   GESTIÓN DE FAVORITOS AISLADOS POR USUARIO O INVITADO
   ========================================================== */

function getSportsLiveUser() {
  if (typeof state !== 'undefined' && state && state.currentUser) {
    return state.currentUser;
  }
  try {
    const raw = localStorage.getItem('sportslive_current_user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.id || u.username)) {
        if (typeof state !== 'undefined' && state) state.currentUser = u;
        return u;
      }
    }
  } catch (_) {}
  return null;
}

function isSportsLiveAuthenticated() {
  const u = getSportsLiveUser();
  return !!(u && (u.id || u.username) && u.role && u.role !== 'guest');
}
window.getSportsLiveUser = getSportsLiveUser;
window.isSportsLiveAuthenticated = isSportsLiveAuthenticated;

function getFavoritesStorageKey(type = 'clubs') {
  const user = getSportsLiveUser();
  if (user && user.id && user.role !== 'guest') {
    return (type === 'clubs') ? ('favorite_clubs_' + user.id) : ('favorites_' + user.id);
  }
  return (type === 'clubs') ? 'favorite_clubs_guest' : 'favorites_guest';
}

function loadUserFavorites() {
  const user = getSportsLiveUser();
  const authenticated = isSportsLiveAuthenticated();

  // Si no hay sesión activa (usuario invitado / no autenticado):
  // El contador debe estar a 0 y no tener clubes ni partidos favoritos guardados
  if (!authenticated || !user || !user.id) {
    state.favorites = [];
    state.favoriteClubs = [];
    state.favoritesOnlyMode = false;
    try {
      localStorage.removeItem('sportslive_favorite_clubs');
      localStorage.removeItem('talentolive_favorite_clubs');
      localStorage.removeItem('sportslive_favorites');
      localStorage.removeItem('talentolive_favorites');
      localStorage.removeItem('favorite_clubs_guest');
      localStorage.removeItem('favorites_guest');
    } catch (_) {}

    const favBadge = document.getElementById('badge-fav-count');
    if (favBadge) {
      favBadge.textContent = '0';
      favBadge.style.display = 'none';
    }
    const favBtn = document.getElementById('btn-header-favorites') || document.getElementById('btn-favorites');
    if (favBtn) {
      favBtn.classList.remove('has-favorites');
    }
    return;
  }

  // 1. Partidos / Eventos favoritos vinculados al ID de usuario activo
  const matchesKey = 'favorites_' + user.id;
  try {
    const rawMatches = localStorage.getItem(matchesKey);
    state.favorites = rawMatches ? JSON.parse(rawMatches) : [];
    if (!Array.isArray(state.favorites)) state.favorites = [];
  } catch (e) {
    state.favorites = [];
  }

  // 2. Clubes favoritos vinculados al ID de usuario activo
  const clubsKey = 'favorite_clubs_' + user.id;
  const clubsLegacyKey = 'favorites_' + user.id;
  try {
    const rawClubs = localStorage.getItem(clubsKey) || localStorage.getItem(clubsLegacyKey);
    if (rawClubs) {
      state.favoriteClubs = JSON.parse(rawClubs);
    } else if (Array.isArray(user.favorite_clubs)) {
      state.favoriteClubs = user.favorite_clubs;
    } else {
      state.favoriteClubs = [];
    }
    if (!Array.isArray(state.favoriteClubs)) state.favoriteClubs = [];
  } catch (e) {
    state.favoriteClubs = [];
  }

  // Si el usuario ya tiene favoritos configurados, la cartelera principal debe mostrar por defecto sus vídeos y partidos favoritos
  const hasFavClubs = state.favoriteClubs && state.favoriteClubs.length > 0;
  const hasFavMatches = state.favorites && state.favorites.length > 0;
  const hasFavorites = hasFavClubs || hasFavMatches;
  if (hasFavorites) {
    state.favoritesOnlyMode = true;
  } else {
    state.favoritesOnlyMode = false;
  }

  // Actualizar inmediatamente estado visual de favoritos en cabecera
  const favBadge = document.getElementById('badge-fav-count');
  if (favBadge) {
    favBadge.style.display = 'none';
  }
  const favBtn = document.getElementById('btn-header-favorites') || document.getElementById('btn-favorites');
  if (favBtn) {
    favBtn.classList.toggle('has-favorites', hasFavorites);
  }
}

function saveUserFavorites(type = 'both') {
  const user = getSportsLiveUser();
  if (!isSportsLiveAuthenticated() || !user || !user.id) return; // En modo invitado no se persisten favoritos

  if (type === 'matches' || type === 'both') {
    const matchesKey = 'favorites_' + user.id;
    const matchesData = JSON.stringify(state.favorites || []);
    localStorage.setItem(matchesKey, matchesData);

    // Persistir eventos favoritos en backend si el usuario tiene sesión activa
    if (state.token) {
      try {
        fetch('/api/user/favorites', {
          method: 'POST',
          headers: getAuthHeaders(true),
          body: JSON.stringify({ favorite_events: state.favorites || [] })
        }).catch(() => {});
      } catch (_) {}
    }
  }

  if (type === 'clubs' || type === 'both') {
    const clubsKey = 'favorite_clubs_' + user.id;
    const clubsLegacyKey = 'favorites_' + user.id;
    const clubsData = JSON.stringify(state.favoriteClubs || []);

    localStorage.setItem(clubsKey, clubsData);
    localStorage.setItem(clubsLegacyKey, clubsData);

    // Persistir en backend SQLite / Turso libSQL si el usuario tiene sesión activa
    if (state.token) {
      try {
        fetch('/api/user/favorites', {
          method: 'POST',
          headers: getAuthHeaders(true),
          body: JSON.stringify({ favorite_clubs: state.favoriteClubs || [] })
        }).catch(() => {});
      } catch (_) {}
    }
  }
}


// Cargar favoritos iniciales según la sesión activa o invitado
loadUserFavorites();

// Conjunto de partidos ya notificados para evitar spam
const notifiedMatches = new Set(JSON.parse(sessionStorage.getItem('sportslive_notified_matches') || sessionStorage.getItem('talentolive_notified_matches') || sessionStorage.getItem('grada_notified_matches') || '[]'));

/* ==========================================================
   GESTIÓN DE MODO INVITADO, BARRERAS DE CONVERSIÓN Y DESCUBRIMIENTO
   ========================================================== */

function openGuestLeadModal(triggerReason = 'favorites', contextData = '') {
  const modal = document.getElementById('guest-lead-modal');
  if (!modal) {
    if (typeof openAuthModal === 'function') {
      openAuthModal('login');
    }
    return;
  }

  const iconEl = document.getElementById('guest-lead-icon');
  const badgeEl = document.getElementById('guest-lead-badge-pill');
  const titleEl = document.getElementById('guest-lead-modal-title');
  const subEl = document.getElementById('guest-lead-subtitle');

  if (triggerReason === 'chat') {
    if (iconEl) iconEl.textContent = '💬';
    if (badgeEl) badgeEl.textContent = 'MURO DE LA AFICIÓN Y CHAT';
    if (titleEl) titleEl.textContent = 'Inicia sesión para escribir en el Muro de la Afición y comentar en directo';
    if (subEl) subEl.textContent = 'Crea tu cuenta gratuita para apoyar a tus equipos, interactuar con otros aficionados y comentar cada jugada.';
  } else if (triggerReason === 'follow_club') {
    const club = contextData ? String(contextData).trim() : 'tus clubes';
    if (iconEl) iconEl.textContent = '⭐';
    if (badgeEl) badgeEl.textContent = `SEGUIR A ${club.toUpperCase()}`;
    if (titleEl) titleEl.textContent = `Identifícate para seguir a ${club} y guardar tus preferencias`;
    if (subEl) subEl.textContent = `Inicia sesión o crea tu cuenta gratuita para seguir a ${club}, guardar sus partidos en tus favoritos y recibir alertas de sus retransmisiones.`;
  } else if (triggerReason === 'notifications') {
    if (iconEl) iconEl.textContent = '🔔';
    if (badgeEl) badgeEl.textContent = 'ALERTAS Y RECORDATORIOS';
    if (titleEl) titleEl.textContent = 'Identifícate para guardar alertas y partidos favoritos';
    if (subEl) subEl.textContent = 'Inicia sesión o crea tu cuenta gratuita para activar avisos automáticos 10 minutos antes de cada partido.';
  } else {
    // favorites (por defecto)
    if (iconEl) iconEl.textContent = '⭐';
    if (badgeEl) badgeEl.textContent = 'MIS FAVORITOS';
    if (titleEl) titleEl.textContent = 'Identifícate para guardar tus favoritos y personalizar tu cartelera';
    if (subEl) subEl.textContent = 'Inicia sesión o crea tu cuenta gratuita para guardar tus partidos y clubes preferidos, sincronizar tus preferencias y no perderte ninguna retransmisión.';
  }


  modal.classList.add('active');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeGuestLeadModal() {
  const modal = document.getElementById('guest-lead-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function updateGuestFloatingBar() {
  const bar = document.getElementById('guest-floating-bar');
  if (!bar) return;

  let isDismissed = false;
  try {
    isDismissed = sessionStorage.getItem('sportslive_guest_bar_dismissed') === '1';
  } catch (_) {}

  if (!isSportsLiveAuthenticated() && !isDismissed) {
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

function dismissGuestFloatingBar() {
  try {
    sessionStorage.setItem('sportslive_guest_bar_dismissed', '1');
  } catch (_) {}
  const bar = document.getElementById('guest-floating-bar');
  if (bar) {
    bar.style.opacity = '0';
    bar.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => { bar.style.display = 'none'; }, 300);
  }
}

function scrollToGrid() {
  const gridSection = document.getElementById('live-grid-section');
  if (gridSection && typeof gridSection.scrollIntoView === 'function') {
    gridSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderDiscoveryBanner() {
  const discoveryBanner = document.getElementById('guest-discovery-banner');
  const cardsGrid = document.getElementById('discovery-cards-grid');
  if (!discoveryBanner) return;

  // Solo mostrar en modo invitado y cuando no se esté en monográfico de club
  if (!isSportsLiveAuthenticated() && !state.activeClubMode) {
    discoveryBanner.style.display = 'flex';
    if (cardsGrid) {
      const cleanEvents = (state.allEvents || []).filter(e => {
        if (typeof isTestResidualEvent === 'function' && isTestResidualEvent(e)) return false;
        if (typeof isEventOfApprovedClub === 'function' && !isEventOfApprovedClub(e)) return false;
        return true;
      });

      // Priorizar directos primero, luego eventos con más visualizaciones o relevancia
      const sorted = [...cleanEvents].sort((a, b) => {
        if (a.status === 'LIVE' && b.status !== 'LIVE') return -1;
        if (b.status === 'LIVE' && a.status !== 'LIVE') return 1;
        return (b.views_count || 0) - (a.views_count || 0);
      });

      const top3 = sorted.slice(0, 3);
      if (top3.length === 0) {
        cardsGrid.innerHTML = '<p style="color: #94a3b8; font-size: 0.8rem; padding: 0.5rem 0;">Descubriendo directos y retransmisiones...</p>';
      } else {
        cardsGrid.innerHTML = top3.map(evt => {
          const safeId = typeof escapeHtml === 'function' ? escapeHtml(evt.id) : evt.id;
          const title = typeof escapeHtml === 'function' ? escapeHtml(evt.title || `${evt.home_team} vs ${evt.away_team}`) : (evt.title || '');
          const sportIcon = typeof escapeHtml === 'function' ? escapeHtml(evt.sport_icon || '🏅') : '🏅';
          const sportName = typeof escapeHtml === 'function' ? escapeHtml(evt.sport_name || 'Deporte') : (evt.sport_name || 'Deporte');
          const isLive = evt.status === 'LIVE';
          const badgeHtml = isLive
            ? '<span class="discovery-card-badge badge-live">🔴 EN VIVO</span>'
            : `<span class="discovery-card-badge">${sportIcon} ${typeof escapeHtml === 'function' ? escapeHtml(evt.category_name || 'Diferido') : 'Diferido'}</span>`;
          const thumb = evt.thumbnail || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60';

          return `
            <div class="discovery-card" onclick="loadFeaturedVideo('${safeId}')" title="${title}">
              <div class="discovery-card-thumb-wrap">
                <img src="${typeof escapeHtml === 'function' ? escapeHtml(thumb) : thumb}" alt="${title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60'">
                ${badgeHtml}
              </div>
              <div class="discovery-card-info">
                <span class="discovery-card-title">${title}</span>
                <span class="discovery-card-meta">${sportIcon} ${sportName}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } else {
    discoveryBanner.style.display = 'none';
  }
}

/* ==========================================================
   0. SEGURIDAD Y SANITIZACIÓN (PREVENCIÓN DE XSS)
   ========================================================== */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url) return '#';
  const clean = String(url).trim();
  if (/^(https?:\/\/|\/)/i.test(clean)) {
    return escapeHtml(clean);
  }
  return '#';
}

/**
 * Garantiza que la URL incrustada (YouTube, Twitch, etc.) nunca reproduzca automáticamente
 * y cargue siempre en pausa esperando el clic manual de usuario (autoplay=0 / autoplay=false).
 */
function disableAutoplayInUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();

  // Reemplazar autoplay=1 o autoplay=true por autoplay=0
  url = url.replace(/([?&])autoplay=(?:1|true)(&|$)/gi, '$1autoplay=0$2');

  const lower = url.toLowerCase();
  if (lower.includes('twitch.tv')) {
    url = url.replace(/([?&])autoplay=0(&|$)/gi, '$1autoplay=false$2');
    if (!/([?&])autoplay=false(&|$)/i.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}autoplay=false`;
    }
  } else if (lower.includes('youtube') || lower.includes('youtu.be')) {
    if (!/([?&])autoplay=0(&|$)/i.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}autoplay=0`;
    }
  }

  return url;
}

function getAuthHeaders(includeContentType = true) {
  const headers = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  return headers;
}

// Inicialización al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  initCapsuleDropdowns();
  initFavoritesHeaderListeners();
  initGeoSelector();
  initSportsSelector();
  initTabs();
  initSearch();
  initModals();
  initIngestionForm();
  initNotificationScheduler();
  initAuthSession();

  // Filtro territorial inicial por defecto: «Toda España»
  state.selectedCcaa = 'all';
  state.selectedProvince = 'all';
  updateFilterButtonsVisual();
  updateGeoButtonLabel();

  // Cargar clubes aprobados primero, luego actualizar selector de deportes, estadísticas y eventos
  fetchClubs().then(() => {
    updateSportsSelectorVisibility();
    fetchStats();
    fetchEvents();
  });

  // Soporte directo para enlace monográfico por URL: ?club=cf-intercity o ?club=CF%20Intercity
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const clubParam = urlParams.get('club');
    if (clubParam) {
      setTimeout(() => {
        enterClubMode(clubParam);
      }, 200);
    }
  } catch (_) {}
});

function initFavoritesHeaderListeners() {
  const selectors = ['#btn-header-favorites', '#btn-favorites', '.btn-favorites-capsule', '.nav-favorites-btn'];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.onclick = handleFavoritesClick;
    });
  });

  // Delegación de clic a nivel de documento como salvaguarda permanente tras re-renderizados
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-header-favorites, #btn-favorites, .btn-favorites-capsule, .nav-favorites-btn');
    if (btn) {
      handleFavoritesClick(e);
    }
  });

  // Reset visual del contador en modo invitado si no está autenticado
  if (!isSportsLiveAuthenticated()) {
    const badge = document.getElementById('badge-fav-count');
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
    document.querySelectorAll('#btn-header-favorites, #btn-favorites, .btn-favorites-capsule, .nav-favorites-btn').forEach(b => {
      b.classList.remove('has-favorites');
    });
  }
}

// Compatibilidad transparente para selector #btn-favorites
if (typeof document !== 'undefined') {
  const origGetElementById = document.getElementById.bind(document);
  document.getElementById = function(id) {
    if (id === 'btn-favorites') {
      return origGetElementById('btn-favorites') || origGetElementById('btn-header-favorites');
    }
    return origGetElementById(id);
  };
}

/* ==========================================================
   1. SELECTORES EN CASCADA (GEOGRAFÍA Y DEPORTES)
   ========================================================== */

function initGeoSelector() {
  const ccaaSelect = document.getElementById('filter-ccaa');
  const provSelect = document.getElementById('filter-province');
  
  if (!ccaaSelect || !provSelect) return;

  // Llenar CCAA
  GEO_CATALOG.forEach(ccaa => {
    const opt = document.createElement('option');
    opt.value = ccaa.id;
    opt.textContent = ccaa.name;
    ccaaSelect.appendChild(opt);
  });

  // Al cambiar CCAA, filtrar provincias disponibles
  ccaaSelect.addEventListener('change', (e) => {
    state.selectedCcaa = e.target.value;
    updateProvinceDropdown(state.selectedCcaa);
    state.selectedProvince = 'all';
    applyFilters();
  });

  provSelect.addEventListener('change', (e) => {
    state.selectedProvince = e.target.value;
    localStorage.setItem('talentolive_user_province', state.selectedProvince);
    updateGeoButtonLabel();
    applyFilters();
  });

  updateProvinceDropdown('all');
}

function updateProvinceDropdown(ccaaId, targetSelectId = 'filter-province') {
  const provSelect = document.getElementById(targetSelectId);
  if (!provSelect) return;

  provSelect.innerHTML = '<option value="all">Todas las Provincias</option>';

  GEO_CATALOG.forEach(ccaa => {
    if (ccaaId === 'all' || ccaa.id === ccaaId) {
      ccaa.provinces.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (state.selectedProvince === p.id && targetSelectId === 'filter-province') {
          opt.selected = true;
        }
        provSelect.appendChild(opt);
      });
    }
  });
}

function initSportsSelector() {
  const sportSelect = document.getElementById('filter-sport');
  const catSelect = document.getElementById('filter-category');
  const chipsContainer = document.getElementById('sports-chips');

  if (!sportSelect || !catSelect) return;

  // Poblar select de deportes y chips visuales
  SPORTS_CATALOG.forEach(sport => {
    const opt = document.createElement('option');
    opt.value = sport.id;
    opt.textContent = `${sport.icon} ${sport.name}`;
    sportSelect.appendChild(opt);

    // Chip botón rápido
    if (chipsContainer) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sport-chip';
      chip.dataset.sportId = sport.id;
      chip.innerHTML = `<span>${sport.icon}</span> <span>${sport.name}</span>`;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
        if (state.selectedSport === sport.id) {
          state.selectedSport = 'all';
          sportSelect.value = 'all';
        } else {
          chip.classList.add('active');
          state.selectedSport = sport.id;
          sportSelect.value = sport.id;
        }
        updateCategoryDropdown(state.selectedSport);
        applyFilters();
      });
      chipsContainer.appendChild(chip);
    }
  });

  sportSelect.addEventListener('change', (e) => {
    state.selectedSport = e.target.value;
    document.querySelectorAll('.sport-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.sportId === state.selectedSport);
    });
    updateCategoryDropdown(state.selectedSport);
    applyFilters();
  });

  catSelect.addEventListener('change', (e) => {
    state.selectedCategory = e.target.value;
    applyFilters();
  });

  updateCategoryDropdown('all');
}

function updateCategoryDropdown(sportId, targetSelectId = 'filter-category') {
  const catSelect = document.getElementById(targetSelectId);
  if (!catSelect) return;

  catSelect.innerHTML = '<option value="all">Todas las Categorías</option>';

  const sport = SPORTS_CATALOG.find(s => s.id === sportId);
  if (sport) {
    sport.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      catSelect.appendChild(opt);
    });
  } else {
    // Si no hay deporte específico, mostrar categorías comunes
    const commonCats = ["Prebenjamín", "Benjamín", "Alevín", "Infantil", "Cadete", "Juvenil", "Senior"];
    commonCats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.toLowerCase();
      opt.textContent = c;
      catSelect.appendChild(opt);
    });
  }
}

/* ==========================================================
   1.5. NAVEGACIÓN CÁPSULA Y MENÚS DESPLEGABLES FLOTANTES
   ========================================================== */

function toggleMobileNav(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const nav = document.getElementById('capsule-nav-group');
  const btn = document.getElementById('btn-mobile-nav-toggle');
  const icon = document.getElementById('hamburger-icon');
  const header = document.querySelector('.app-header, .navbar-header');
  if (!nav) return;
  const isOpen = nav.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileNav();
  } else {
    nav.classList.add('mobile-open');
    if (header) header.classList.add('menu-open');
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
    }
    if (icon) icon.textContent = '✕';
  }
}
window.toggleMobileNav = toggleMobileNav;

function closeMobileNav() {
  const nav = document.getElementById('capsule-nav-group');
  const btn = document.getElementById('btn-mobile-nav-toggle');
  const icon = document.getElementById('hamburger-icon');
  const header = document.querySelector('.app-header, .navbar-header');
  if (nav) nav.classList.remove('mobile-open');
  if (header) header.classList.remove('menu-open');
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
  if (icon) icon.textContent = '☰';
}
window.closeMobileNav = closeMobileNav;

function initCapsuleDropdowns() {
  // Manejo delegado de clics para desplegables estáticos y dinámicos (cabecera, usuario, etc.)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.capsule-dropdown-wrap .capsule-btn');
    if (btn) {
      e.stopPropagation();
      const wrap = btn.closest('.capsule-dropdown-wrap');
      if (wrap) {
        const isOpen = wrap.classList.contains('open');
        closeAllCapsuleDropdowns();
        if (!isOpen) {
          wrap.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
        return;
      }
    }

    // Cerrar al hacer clic fuera de cualquier desplegable
    if (!e.target.closest('.capsule-dropdown-wrap')) {
      closeAllCapsuleDropdowns();
    }
    // Cerrar navegación móvil si se hace clic fuera del header y fuera del menú móvil
    if (!e.target.closest('.app-header') && !e.target.closest('.capsule-nav-group')) {
      closeMobileNav();
    }
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCapsuleDropdowns();
      closeMobileNav();
    }
  });

  // En pantallas de tablet o escritorio (>= 768px), cerrar menú colapsable móvil
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      closeMobileNav();
    }
  });

  // Renderizar listado de Comunidades Autónomas en el desplegable
  renderGeoDropdownList();
}

function closeAllCapsuleDropdowns() {
  document.querySelectorAll('.capsule-dropdown-wrap').forEach(wrap => {
    wrap.classList.remove('open');
    const btn = wrap.querySelector('.capsule-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.dropdown-item-submenu-wrap').forEach(wrap => {
    wrap.classList.remove('expanded');
  });
}

function updateSportsSelectorVisibility() {
  const menuSports = document.getElementById('menu-sports');
  if (!menuSports) return;

  const activeClubs = (state.allClubs || []).filter(c => (c.is_active === undefined || c.is_active) && (c.approved_by_admin === undefined || c.approved_by_admin));
  const activeEvents = (state.allEvents || []).filter(e => !isTestResidualEvent(e) && isEventOfApprovedClub(e));

  const availableSports = new Set();
  activeClubs.forEach(c => {
    if (c.sport_id) availableSports.add(c.sport_id.toLowerCase().trim());
  });
  activeEvents.forEach(e => {
    if (e.sport_id) availableSports.add(e.sport_id.toLowerCase().trim());
  });

  // Futbol
  const futbolBtn = menuSports.querySelector('button[data-sport="futbol"]');
  if (futbolBtn) {
    futbolBtn.style.display = (availableSports.has('futbol') || availableSports.has('futsal')) ? '' : 'none';
  }

  // Boxeo y deportes de contacto
  const contactoWrap = document.getElementById('wrap-sport-contacto');
  if (contactoWrap) {
    const hasContacto = availableSports.has('contacto') || availableSports.has('boxeo_contacto') || availableSports.has('boxeo') || availableSports.has('mma') || availableSports.has('kickboxing') || availableSports.has('muay_thai');
    contactoWrap.style.display = hasContacto ? '' : 'none';
  }

  // Baloncesto
  const basketBtn = menuSports.querySelector('button[data-sport="baloncesto"]');
  if (basketBtn) {
    basketBtn.style.display = availableSports.has('baloncesto') ? '' : 'none';
  }

  // Voleibol
  const voleyBtn = menuSports.querySelector('button[data-sport="voleibol"]');
  if (voleyBtn) {
    voleyBtn.style.display = availableSports.has('voleibol') ? '' : 'none';
  }

  // Balonmano
  const balonmanoBtn = menuSports.querySelector('button[data-sport="balonmano"]');
  if (balonmanoBtn) {
    balonmanoBtn.style.display = availableSports.has('balonmano') ? '' : 'none';
  }

  // Otros
  const otrosBtn = menuSports.querySelector('button[data-sport="otros"]');
  if (otrosBtn) {
    otrosBtn.style.display = availableSports.has('otros') ? '' : 'none';
  }

  renderGeoDropdownList();
}
window.updateSportsSelectorVisibility = updateSportsSelectorVisibility;

function renderGeoDropdownList() {
  const container = document.getElementById('geo-menu-list');
  if (!container || typeof GEO_CATALOG === 'undefined') return;

  const activeClubs = (state.allClubs || []).filter(c => (c.is_active === undefined || c.is_active) && (c.approved_by_admin === undefined || c.approved_by_admin));
  const activeEvents = (state.allEvents || []).filter(e => !isTestResidualEvent(e) && isEventOfApprovedClub(e));

  const availableCcaas = new Set();
  activeClubs.forEach(c => {
    if (c.ccaa_id) availableCcaas.add(c.ccaa_id.toLowerCase().trim());
  });
  activeEvents.forEach(e => {
    if (e.ccaa_id) availableCcaas.add(e.ccaa_id.toLowerCase().trim());
  });

  container.innerHTML = '';
  GEO_CATALOG.forEach(ccaa => {
    if (availableCcaas.size > 0 && !availableCcaas.has(ccaa.id.toLowerCase())) {
      return;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `dropdown-item ${state.selectedCcaa === ccaa.id ? 'active' : ''}`;
    item.dataset.ccaa = ccaa.id;
    item.innerHTML = `<span class="item-icon">📍</span> <span>${escapeHtml(ccaa.name)}</span>`;
    item.onclick = () => selectGeoCcaa(ccaa.id);
    container.appendChild(item);
  });
}

/* ==========================================================
   1.4. LÓGICA DE FILTRADO EN TIEMPO REAL (DEPORTES, DIRECTOS, CCAA)
   ========================================================== */

function getSportDisplayName(sportId) {
  if (!sportId || sportId === 'all') return 'DEPORTES';
  const sportNames = {
    futbol: 'Fútbol',
    baloncesto: 'Baloncesto',
    voleibol: 'Voleibol',
    balonmano: 'Balonmano',
    otros: 'Otros',
    futsal: 'Fútbol Sala',
    rugby: 'Rugby',
    padel_tenis: 'Pádel / Tenis',
    hockey: 'Hockey',
    contacto: 'Boxeo y deportes de contacto',
    boxeo_contacto: 'Boxeo y deportes de contacto'
  };
  if (sportNames[sportId.toLowerCase()]) return sportNames[sportId.toLowerCase()];
  if (typeof SPORTS_CATALOG !== 'undefined') {
    const found = SPORTS_CATALOG.find(s => s.id === sportId);
    if (found) return found.name;
  }
  return sportId.charAt(0).toUpperCase() + sportId.slice(1);
}

function getCcaaShortName(ccaaId) {
  if (!ccaaId || ccaaId === 'all') return '🇪🇸 Toda España';
  const shortNames = {
    'madrid': 'Madrid',
    'andalucia': 'Andalucía',
    'cataluna': 'Cataluña',
    'comunidad-valenciana': 'C. Valenciana',
    'galicia': 'Galicia',
    'pais-vasco': 'País Vasco',
    'castilla-y-leon': 'Castilla y León',
    'castilla-la-mancha': 'Castilla-La Mancha',
    'canarias': 'Canarias',
    'baleares': 'Baleares',
    'aragon': 'Aragón',
    'extremadura': 'Extremadura',
    'asturias': 'Asturias',
    'navarra': 'Navarra',
    'cantabria': 'Cantabria',
    'murcia': 'Murcia',
    'la-rioja': 'La Rioja',
    'ceuta': 'Ceuta',
    'melilla': 'Melilla'
  };
  if (shortNames[ccaaId]) return shortNames[ccaaId];
  if (typeof GEO_CATALOG !== 'undefined') {
    const found = GEO_CATALOG.find(c => c.id === ccaaId);
    if (found) {
      return found.name.replace('Comunidad de ', '').replace('Principado de ', '').replace('Región de ', '');
    }
  }
  return ccaaId.charAt(0).toUpperCase() + ccaaId.slice(1);
}

function isSportMatch(evt, targetSport, targetDiscipline = 'all') {
  if (!targetSport || targetSport === 'all') return true;
  const s = (evt.sport_id || '').toLowerCase().trim();
  const target = targetSport.toLowerCase().trim();
  const disc = (targetDiscipline || 'all').toLowerCase().trim();

  // Caso: Boxeo y deportes de contacto
  if (target === 'contacto' || target === 'boxeo_contacto' || target.includes('contacto') || target.includes('boxeo')) {
    const isCombat = s === 'contacto' || s === 'boxeo_contacto' || s.includes('boxeo') || s.includes('contacto') || s.includes('mma') || s.includes('kickboxing') || s.includes('muay');
    if (!isCombat) return false;

    if (disc && disc !== 'all') {
      const evtMod = ((evt.discipline || '') + ' ' + (evt.modality || '') + ' ' + (evt.category_id || '') + ' ' + (evt.category_name || '') + ' ' + (evt.title || '')).toLowerCase();
      if (disc === 'boxeo') return evtMod.includes('boxeo') || evtMod.includes('boxing');
      if (disc === 'mma') return evtMod.includes('mma') || evtMod.includes('artes marciales mixtas');
      if (disc === 'kickboxing') return evtMod.includes('kickboxing') || evtMod.includes('kick boxing') || evtMod.includes('kick');
      if (disc === 'muay_thai' || disc === 'muay thai') return evtMod.includes('muay');
      return evtMod.includes(disc);
    }
    return true;
  }

  // Si alguien filtra directamente pasando la subdisciplina como targetSport
  if (target === 'boxeo' || target === 'mma' || target === 'kickboxing' || target === 'muay_thai') {
    const evtMod = ((evt.discipline || '') + ' ' + (evt.modality || '') + ' ' + (evt.category_id || '') + ' ' + (evt.category_name || '') + ' ' + (evt.title || '')).toLowerCase();
    if (target === 'boxeo') return evtMod.includes('boxeo') || evtMod.includes('boxing');
    if (target === 'mma') return evtMod.includes('mma') || evtMod.includes('artes marciales mixtas');
    if (target === 'kickboxing') return evtMod.includes('kickboxing') || evtMod.includes('kick');
    if (target === 'muay_thai') return evtMod.includes('muay');
    return evtMod.includes(target);
  }

  if (target === 'futbol') {
    return s === 'futbol' || s === 'futsal' || s.includes('futbol') || s.includes('fútbol');
  }
  if (target === 'baloncesto') {
    return s === 'baloncesto' || s.includes('basket');
  }
  if (target === 'voleibol') {
    return s === 'voleibol' || s.includes('volei') || s.includes('volley');
  }
  if (target === 'balonmano') {
    return s === 'balonmano' || s.includes('handball');
  }
  if (target === 'otros') {
    const primarySports = ['futbol', 'futsal', 'baloncesto', 'voleibol', 'balonmano', 'contacto', 'boxeo_contacto'];
    return !primarySports.includes(s) && !s.includes('boxeo') && !s.includes('contacto') && !s.includes('mma');
  }
  return s === target;
}

function sanitizeEventSportAndClubData(evt) {
  if (!evt) return evt;

  // Detección de Real Federación Española de Boxeo RFEBox o eventos BOXAM
  const isRfebox = (evt.club_id === 'real-federacion-espanola-de-boxeo-rfebox') ||
    (evt.club_name && (evt.club_name.toLowerCase().includes('boxeo') || evt.club_name.toLowerCase().includes('rfebox'))) ||
    (evt.title && evt.title.toUpperCase().includes('BOXAM')) ||
    (evt.channel_url && evt.channel_url.toLowerCase().includes('@rfebox'));

  if (isRfebox) {
    evt.sport_id = 'contacto';
    evt.sport_name = 'Boxeo';
    evt.sport_icon = '🥊';
    evt.category_name = 'Nacional';
    evt.location_venue = 'España';
    evt.province_name = 'España';
    evt.ccaa_name = 'Toda España';
  } else if (evt.club_id === 'climent-club' || (evt.club_name && evt.club_name.toLowerCase().includes('climent'))) {
    evt.sport_id = 'contacto';
    evt.sport_name = 'MMA y Boxeo';
    evt.sport_icon = '🥊';
  }
  return evt;
}
window.sanitizeEventSportAndClubData = sanitizeEventSportAndClubData;

function normalizeGeoText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CCAA_TERRITORY_TERMS = {
  'comunidad-valenciana': {
    aliases: ['comunidad valenciana', 'comunitat valenciana', 'c valenciana', 'c. valenciana', 'valenciana', 'valencia'],
    provinces: ['valencia', 'alicante', 'castellon', 'castello', 'alacant']
  },
  'madrid': {
    aliases: ['madrid', 'comunidad de madrid', 'c madrid', 'c. madrid'],
    provinces: ['madrid']
  },
  'cataluna': {
    aliases: ['cataluna', 'catalunya', 'catalonia'],
    provinces: ['barcelona', 'girona', 'lleida', 'tarragona', 'gerona', 'lerida']
  },
  'andalucia': {
    aliases: ['andalucia', 'andalusia'],
    provinces: ['almeria', 'cadiz', 'cordoba', 'granada', 'huelva', 'jaen', 'malaga', 'sevilla']
  },
  'aragon': {
    aliases: ['aragon'],
    provinces: ['huesca', 'teruel', 'zaragoza']
  },
  'asturias': {
    aliases: ['asturias', 'principado de asturias'],
    provinces: ['asturias', 'oviedo', 'gijon']
  },
  'baleares': {
    aliases: ['baleares', 'islas baleares', 'illes balears'],
    provinces: ['baleares', 'mallorca', 'menorca', 'ibiza', 'formentera']
  },
  'canarias': {
    aliases: ['canarias', 'islas canarias'],
    provinces: ['las palmas', 'santa cruz de tenerife', 'tenerife']
  },
  'cantabria': {
    aliases: ['cantabria'],
    provinces: ['cantabria', 'santander']
  },
  'castilla-la-mancha': {
    aliases: ['castilla la mancha', 'c la mancha', 'c. la mancha'],
    provinces: ['albacete', 'ciudad real', 'cuenca', 'guadalajara', 'toledo']
  },
  'castilla-y-leon': {
    aliases: ['castilla y leon', 'c y leon', 'c. y leon'],
    provinces: ['avila', 'burgos', 'leon', 'palencia', 'salamanca', 'segovia', 'soria', 'valladolid', 'zamora']
  },
  'extremadura': {
    aliases: ['extremadura'],
    provinces: ['badajoz', 'caceres']
  },
  'galicia': {
    aliases: ['galicia'],
    provinces: ['a coruna', 'la coruna', 'coruna', 'lugo', 'ourense', 'orense', 'pontevedra']
  },
  'murcia': {
    aliases: ['murcia', 'region de murcia'],
    provinces: ['murcia']
  },
  'navarra': {
    aliases: ['navarra', 'comunidad foral de navarra'],
    provinces: ['navarra', 'pamplona']
  },
  'pais-vasco': {
    aliases: ['pais vasco', 'euskadi'],
    provinces: ['alava', 'bizkaia', 'vizcaya', 'gipuzkoa', 'guipuzcoa', 'araba']
  },
  'la-rioja': {
    aliases: ['la rioja', 'rioja'],
    provinces: ['la rioja', 'logrono']
  },
  'ceuta': {
    aliases: ['ceuta'],
    provinces: ['ceuta']
  },
  'melilla': {
    aliases: ['melilla'],
    provinces: ['melilla']
  }
};

function resolveCcaaKey(input) {
  if (!input || input === 'all') return 'all';
  const norm = normalizeGeoText(input);
  if (!norm || norm === 'all' || norm === 'toda espana' || norm === 'espana') return 'all';

  // 1. Direct key match (e.g. 'comunidad valenciana' -> 'comunidad-valenciana')
  for (const key of Object.keys(CCAA_TERRITORY_TERMS)) {
    if (normalizeGeoText(key) === norm) return key;
  }

  // 2. Check aliases
  for (const [key, data] of Object.entries(CCAA_TERRITORY_TERMS)) {
    if (data.aliases.some(a => normalizeGeoText(a) === norm || norm.includes(normalizeGeoText(a)))) {
      return key;
    }
  }

  // 3. Check provinces (if a province name was passed as CCAA filter)
  for (const [key, data] of Object.entries(CCAA_TERRITORY_TERMS)) {
    if (data.provinces.some(p => normalizeGeoText(p) === norm)) {
      return key;
    }
  }

  // 4. Fallback check against GEO_CATALOG
  if (typeof GEO_CATALOG !== 'undefined') {
    const found = GEO_CATALOG.find(c => {
      const cNorm = normalizeGeoText(c.id);
      const cNameNorm = normalizeGeoText(c.name);
      return cNorm === norm || cNameNorm === norm || norm.includes(cNorm) || norm.includes(cNameNorm);
    });
    if (found) return found.id;
  }

  return input;
}

function isEventInCcaa(evt, targetCcaaId) {
  if (!targetCcaaId || targetCcaaId === 'all') return true;
  if (!evt) return false;

  const targetKey = resolveCcaaKey(targetCcaaId);
  if (targetKey === 'all') return true;

  const territoryData = CCAA_TERRITORY_TERMS[targetKey];
  const allAliases = territoryData ? territoryData.aliases : [];
  const allProvinces = territoryData ? territoryData.provinces : [];

  // Extract all event geo descriptors
  const evtCcaaId = normalizeGeoText(evt.ccaa_id);
  const evtCcaaName = normalizeGeoText(evt.ccaa_name);
  const evtRegion = normalizeGeoText(evt.region);
  const evtProvinceId = normalizeGeoText(evt.province_id);
  const evtProvinceName = normalizeGeoText(evt.province_name);
  const evtLocation = normalizeGeoText(evt.location_venue);

  // 1. Direct match with targetKey
  const normTargetKey = normalizeGeoText(targetKey);
  if (evtCcaaId === normTargetKey) return true;

  // 2. Match with aliases
  for (const alias of allAliases) {
    const normAlias = normalizeGeoText(alias);
    if (!normAlias) continue;
    if (evtCcaaId === normAlias || evtRegion === normAlias || evtCcaaName === normAlias) return true;
    if (evtRegion.includes(normAlias) || evtCcaaName.includes(normAlias)) return true;
  }

  // 3. Match with provinces
  for (const prov of allProvinces) {
    const normProv = normalizeGeoText(prov);
    if (!normProv) continue;
    if (evtProvinceId === normProv || evtProvinceName === normProv) return true;
    if (evtLocation.includes(normProv)) return true;
    if (evtRegion.includes(normProv)) return true;
  }

  // 4. Fallback check with GEO_CATALOG
  if (typeof GEO_CATALOG !== 'undefined') {
    const ccaaObj = GEO_CATALOG.find(c => c.id === targetKey);
    if (ccaaObj && ccaaObj.provinces) {
      if (ccaaObj.provinces.some(p => {
        const pIdNorm = normalizeGeoText(p.id);
        const pNameNorm = normalizeGeoText(p.name);
        return evtProvinceId === pIdNorm || evtProvinceName === pNameNorm;
      })) {
        return true;
      }
    }
  }

  return false;
}

function isEventToday(evt) {
  if (evt.status === 'LIVE') return true;
  if (!evt.date_time) return false;
  const d = new Date(evt.date_time);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function isEventWeekend(evt) {
  if (evt.date_time) {
    const d = new Date(evt.date_time);
    if (!isNaN(d.getTime())) {
      const day = d.getDay(); // 0 = Domingo, 6 = Sábado
      if (day === 0 || day === 6) return true;
    }
  }
  if (evt.status === 'LIVE') {
    const nowDay = new Date().getDay();
    if (nowDay === 0 || nowDay === 6) return true;
  }
  return false;
}

function isSearchMatch(evt, query) {
  if (!query || !query.trim()) return true;
  const q = query.toLowerCase().trim();
  const fields = [
    evt.title,
    evt.home_team,
    evt.away_team,
    evt.club_name,
    evt.location_venue,
    evt.province_name,
    evt.ccaa_name,
    evt.sport_name,
    evt.category_name
  ];
  return fields.some(f => f && String(f).toLowerCase().includes(q));
}

/* ==========================================================
   1.5. SISTEMA DE CANALES Y EQUIPOS FAVORITOS
   ========================================================== */

function isEventOfClub(evt, clubIdentifier) {
  if (!evt || !clubIdentifier) return false;
  const target = (typeof clubIdentifier === 'object') ? (clubIdentifier.name || clubIdentifier.id || '') : String(clubIdentifier);
  const t = target.toLowerCase().trim();
  if (!t) return false;

  const clubId = (evt.club_id || '').toLowerCase().trim();
  const clubName = (evt.club_name || '').toLowerCase().trim();
  const homeTeam = (evt.home_team || '').toLowerCase().trim();
  const awayTeam = (evt.away_team || '').toLowerCase().trim();

  // Coincidencias directas y subtérminos
  if (clubId && (clubId === t || clubId.includes(t) || t.includes(clubId))) return true;
  if (clubName && (clubName === t || clubName.includes(t) || t.includes(clubName))) return true;
  if (homeTeam && (homeTeam === t || homeTeam.includes(t) || t.includes(homeTeam))) return true;
  if (awayTeam && (awayTeam === t || awayTeam.includes(t) || t.includes(awayTeam))) return true;

  // Comparación por slug normalizado (ej. "cf-intercity" coincide con "CF INTERCITY")
  const tSlug = t.replace(/[^a-z0-9]/g, '');
  if (tSlug && tSlug.length >= 3) {
    const idSlug = clubId.replace(/[^a-z0-9]/g, '');
    const nameSlug = clubName.replace(/[^a-z0-9]/g, '');
    const homeSlug = homeTeam.replace(/[^a-z0-9]/g, '');
    const awaySlug = awayTeam.replace(/[^a-z0-9]/g, '');

    if (idSlug && (idSlug.includes(tSlug) || tSlug.includes(idSlug))) return true;
    if (nameSlug && (nameSlug.includes(tSlug) || tSlug.includes(nameSlug))) return true;
    if (homeSlug && (homeSlug.includes(tSlug) || tSlug.includes(homeSlug))) return true;
    if (awaySlug && (awaySlug.includes(tSlug) || tSlug.includes(awaySlug))) return true;
  }

  return false;
}

function isEventOfFavoriteClub(evt, favoriteClubs) {
  if (!favoriteClubs || favoriteClubs.length === 0 || !evt) return false;
  return favoriteClubs.some(fav => isEventOfClub(evt, fav));
}

function isFavoriteEventRecentOrLive(evt) {
  if (evt.status === 'LIVE' || evt.status === 'UPCOMING') return true;
  if (!evt.date_time) return true;
  const evtDate = new Date(evt.date_time);
  if (isNaN(evtDate.getTime())) return true;
  const now = new Date();
  const diffDays = Math.abs(now.getTime() - evtDate.getTime()) / (1000 * 60 * 60 * 24);
  // Partidos y contenidos emitidos en la última semana (o margen de 30 días para catálogo histórico)
  return diffDays <= 30;
}

async function fetchClubs() {
  try {
    const res = await fetch('/api/clubs');
    if (res.ok) {
      const clubs = await res.json();
      state.allClubs = Array.isArray(clubs) 
        ? clubs.filter(c => (c.is_active === undefined || c.is_active) && (c.approved_by_admin === undefined || c.approved_by_admin)) 
        : [];
      return state.allClubs;
    }
  } catch (err) {
    console.warn('Error fetching clubs from API:', err);
  }
  return state.allClubs || [];
}

function isEventOfApprovedClub(e) {
  if (!e) return false;
  if (!state.allClubs || state.allClubs.length === 0) return true;
  const clubId = (e.club_id || '').toLowerCase().trim();
  const clubName = (e.club_name || '').toLowerCase().trim();
  const homeTeam = (e.home_team || '').toLowerCase().trim();
  return state.allClubs.some(c => {
    if (c.is_active === 0 || c.approved_by_admin === 0) return false;
    const cid = (c.id || '').toLowerCase().trim();
    const cname = (c.name || '').toLowerCase().trim();
    return (cid && (cid === clubId || cid === clubName)) ||
           (cname && (cname === clubName || cname === homeTeam || clubName.includes(cname) || cname.includes(clubName)));
  });
}

function limitEventsForPortada(eventsList, maxHistoryPerClub = 5) {
  if (!eventsList || eventsList.length === 0) return [];

  // 1. Filtrar únicamente por clubes registrados y aprobados
  const valid = eventsList.filter(e => {
    if (typeof isTestResidualEvent === 'function' && isTestResidualEvent(e)) return false;
    if (typeof isEventOfApprovedClub === 'function' && !isEventOfApprovedClub(e)) return false;
    return true;
  });

  // 2. Prioridad Directos: Si el club tiene una emisión en directo activa (LIVE), siempre se conserva con prioridad
  const liveEvents = valid.filter(e => e.status === 'LIVE');
  const historyEvents = valid.filter(e => e.status !== 'LIVE');

  // 3. Límite de histórico: únicamente los últimos 5 vídeos más recientes por club
  const clubCount = new Map();
  const limitedHistory = [];

  // Ordenar históricos por fecha descendente
  const sortedHistory = [...historyEvents].sort((a, b) => new Date(b.date_time || 0) - new Date(a.date_time || 0));

  sortedHistory.forEach(e => {
    let clubKey = (e.club_id || e.club_name || e.home_team || '').toLowerCase().trim();
    if (state.allClubs && state.allClubs.length > 0) {
      const matchedClub = state.allClubs.find(c => {
        const cid = (c.id || '').toLowerCase().trim();
        const cname = (c.name || '').toLowerCase().trim();
        return (cid && (cid === clubKey || cid === (e.club_id || '').toLowerCase().trim())) ||
               (cname && (cname === clubKey || (e.club_name && e.club_name.toLowerCase().includes(cname)) || (e.home_team && e.home_team.toLowerCase().includes(cname))));
      });
      if (matchedClub) {
        clubKey = (matchedClub.id || matchedClub.name).toLowerCase().trim();
      }
    }
    const count = clubCount.get(clubKey) || 0;
    if (count < maxHistoryPerClub) {
      clubCount.set(clubKey, count + 1);
      limitedHistory.push(e);
    }
  });

  return [...liveEvents, ...limitedHistory];
}
window.limitEventsForPortada = limitEventsForPortada;

let lastFavHeaderClickTime = 0;
function handleFavoritesClick(event) {
  const now = Date.now();
  if (now - lastFavHeaderClickTime < 200) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    return;
  }
  lastFavHeaderClickTime = now;

  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  if (typeof closeMobileNav === 'function') {
    closeMobileNav();
  }

  const authenticated = isSportsLiveAuthenticated();

  // Si el usuario es Administrador o cualquier Usuario registrado (currentUser && currentUser.role !== 'guest'):
  // Al pulsar MIS FAVORITOS, NUNCA debe saltar el modal de registro/inscripción.
  // Debe abrir directamente el panel de gestión de sus favoritos (openFavoritesModal()).
  if (authenticated) {
    openFavoritesModal();
  } else {
    // Si el usuario es Invitado / No autenticado (!currentUser || currentUser.role === 'guest'):
    // Al pulsar MIS FAVORITOS, SIEMPRE debe abrir el modal de captación o registro (openGuestLeadModal() o openAuthModal('register')).
    if (typeof openGuestLeadModal === 'function') {
      openGuestLeadModal('favorites');
    } else if (typeof openAuthModal === 'function') {
      openAuthModal('register');
    }
  }
}
window.handleFavoritesClick = handleFavoritesClick;
window.handleFavoritesHeaderClick = handleFavoritesClick;

async function openFavoritesModal() {
  if (typeof closeMobileNav === 'function') closeMobileNav();
  const authenticated = isSportsLiveAuthenticated();

  // Si el usuario no está autenticado o es invitado, abrir modal de captación o registro
  if (!authenticated) {
    if (typeof openGuestLeadModal === 'function') {
      openGuestLeadModal('favorites');
    } else if (typeof openAuthModal === 'function') {
      openAuthModal('register');
    }
    return;
  }

  // Si el usuario está autenticado, NUNCA debe saltar el modal de registro ni de captación
  const modal = document.getElementById('favorites-modal');
  if (!modal) {
    console.warn('favorites-modal no encontrado en el DOM');
    return;
  }

  state.favoritesChangedWhileModalOpen = false;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  if (!state.allClubs || state.allClubs.length === 0) {
    await fetchClubs();
  }

  const searchInput = document.getElementById('fav-club-search-input');
  if (searchInput) searchInput.value = state.favModalSearch || '';

  // Determinar pestaña activa: si el usuario ya sigue clubes, mostrar "Mis Clubes Favoritos"; si no, "Buscar Favoritos"
  if (state.favoriteClubs && state.favoriteClubs.length > 0) {
    switchFavModalTab('my_clubs');
  } else {
    switchFavModalTab('search');
  }

  renderFavClubsList();
  renderMyClubsList();
  updateFavModalCounter();
}

function closeFavoritesModal() {
  const modal = document.getElementById('favorites-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  state.favoritesChangedWhileModalOpen = false;

  const authenticated = isSportsLiveAuthenticated();
  if (authenticated) {
    const hasFavClubs = state.favoriteClubs && state.favoriteClubs.length > 0;
    const hasFavMatches = state.favorites && state.favorites.length > 0;
    const hasFavorites = hasFavClubs || hasFavMatches;
    if (hasFavorites) {
      state.favoritesOnlyMode = true;
    } else {
      state.favoritesOnlyMode = false;
    }
  }

  // Cierre reactivo inmediato: actualizar componentes y re-filtrar/renderizar la portada sin recargar la página
  updateFilterButtonsVisual();
  updateActiveFilterIndicator();
  applyFilters();
}

function handleApplyFavoritesAndClose() {
  state.favoritesChangedWhileModalOpen = false;
  state.favoritesOnlyMode = true;
  closeFavoritesModal();
}

async function backToFavoritesModal() {
  await openFavoritesModal();
  switchFavModalTab('my_clubs');
}
window.backToFavoritesModal = backToFavoritesModal;

function switchFavModalTab(tab) {
  state.favModalTab = tab || 'my_clubs';

  const btnMy = document.getElementById('fav-nav-tab-my-clubs');
  const btnSearch = document.getElementById('fav-nav-tab-search');
  const viewMy = document.getElementById('fav-tab-content-my-clubs');
  const viewSearch = document.getElementById('fav-tab-content-search');

  if (state.favModalTab === 'search') {
    if (btnMy) {
      btnMy.classList.remove('active');
      btnMy.setAttribute('aria-selected', 'false');
    }
    if (btnSearch) {
      btnSearch.classList.add('active');
      btnSearch.setAttribute('aria-selected', 'true');
    }
    if (viewMy) viewMy.style.display = 'none';
    if (viewSearch) viewSearch.style.display = 'block';

    renderFavClubsList();
  } else {
    // 'my_clubs'
    if (btnMy) {
      btnMy.classList.add('active');
      btnMy.setAttribute('aria-selected', 'true');
    }
    if (btnSearch) {
      btnSearch.classList.remove('active');
      btnSearch.setAttribute('aria-selected', 'false');
    }
    if (viewMy) viewMy.style.display = 'block';
    if (viewSearch) viewSearch.style.display = 'none';

    renderMyClubsList();
  }

  updateFavModalCounter();
}

function updateFavModalCounter() {
  const counter = document.getElementById('fav-modal-counter');
  const badgeMyClubs = document.getElementById('fav-my-clubs-badge');
  const count = (state.favoriteClubs || []).length;

  if (counter) {
    counter.textContent = `${count} ${count === 1 ? 'club seguido' : 'clubes seguidos'}`;
  }
  if (badgeMyClubs) {
    badgeMyClubs.textContent = count;
  }
}

function renderMyClubsList() {
  const container = document.getElementById('fav-clubs-list-my');
  if (!container) return;

  const followedNames = state.favoriteClubs || [];
  if (followedNames.length === 0) {
    container.innerHTML = `
      <div class="fav-empty-state">
        <span class="fav-empty-icon">⭐</span>
        <h4>Aún no tienes clubes favoritos guardados</h4>
        <p>Encuentra tus equipos en el buscador y síguelos para acceder a sus partidos en directo y contenidos exclusivos.</p>
        <button type="button" class="btn-explore-clubs" onclick="switchFavModalTab('search')">
          <span>🔍</span> <span>Explorar y Buscar Clubes</span>
        </button>
      </div>
    `;
    return;
  }

  const allClubs = state.allClubs || [];
  const followedClubs = followedNames.map(name => {
    const found = allClubs.find(c => 
      c.name.toLowerCase() === name.toLowerCase() || 
      (c.id && c.id.toLowerCase() === name.toLowerCase())
    );
    if (found) return found;

    // Fallback con eventos si no está en allClubs
    const matchingEvents = (state.allEvents || []).filter(e => isEventOfClub(e, name));
    const firstEv = matchingEvents[0];
    return {
      id: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, ''),
      name: name,
      sport_name: firstEv ? (firstEv.sport_name || 'Fútbol') : 'Fútbol',
      sport_icon: firstEv ? (firstEv.sport_icon || '⚽') : '⚽',
      category: firstEv ? (firstEv.category_name || 'Categoría Oficial') : 'Categoría Oficial',
      location: firstEv ? (firstEv.location_venue || firstEv.province_name || 'España') : 'España',
      events_count: matchingEvents.length || 1,
      is_verified: firstEv ? (firstEv.is_verified_club || 1) : 1
    };
  });

  container.innerHTML = '';
  followedClubs.forEach(club => {
    const card = document.createElement('div');
    card.className = 'fav-my-club-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('title', `Ver ficha monográfica exclusiva de ${escapeHtml(club.name)}`);

    const clubParam = club.id || club.name;
    const safeClubParam = escapeHtml(club.name).replace(/'/g, "\\'");

    card.onclick = () => {
      enterClubMode(clubParam);
    };
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enterClubMode(clubParam);
      }
    };

    const sportIcon = club.sport_icon || getSportIcon(club.sport_id) || '🏅';
    const loc = club.location || club.province_name || 'España';
    const verifiedBadge = club.is_verified ? '<span class="badge-official-club">🛡️ Oficial</span>' : '';
    const videoCountText = `${club.events_count || 1} ${(club.events_count === 1) ? 'vídeo disponible' : 'vídeos disponibles'}`;

    card.innerHTML = `
      <div class="fav-club-left">
        <div class="fav-club-avatar" aria-hidden="true">${escapeHtml(sportIcon)}</div>
        <div class="fav-club-details">
          <h4 class="fav-club-name">${escapeHtml(club.name)}</h4>
          <div class="fav-club-meta">
            <span>${escapeHtml(club.sport_name || 'Fútbol')}</span>
            ${club.category ? `<span>•</span> <span>${escapeHtml(club.category)}</span>` : ''}
            <span>•</span>
            <span>📍 ${escapeHtml(loc)}</span>
            ${verifiedBadge}
            <span>•</span>
            <span style="color: #38bdf8; font-weight: 600;">📺 ${videoCountText}</span>
          </div>
        </div>
      </div>
      <div class="fav-club-actions" style="display:flex; gap:0.5rem; align-items:center;">
        <span class="btn-view-club-action">
          <span>Ver Equipo</span> <span>➔</span>
        </span>
        <button 
          type="button" 
          class="btn-follow-club following" 
          onclick="event.stopPropagation(); toggleFavoriteClub('${safeClubParam}', event)"
          aria-pressed="true"
          title="Dejar de seguir a este club">
          <span>✓</span>
          <span>Siguiendo</span>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderFavClubsList() {
  const container = document.getElementById('fav-clubs-list');
  if (!container) return;

  const clubs = state.allClubs || [];
  const search = (state.favModalSearch || '').toLowerCase();
  const sport = state.favModalSportFilter || 'all';

  const filtered = clubs.filter(c => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search) ||
      (c.location && c.location.toLowerCase().includes(search)) ||
      (c.sport_name && c.sport_name.toLowerCase().includes(search));

    let matchSport = true;
    if (sport !== 'all') {
      if (sport === 'futbol') {
        matchSport = (c.sport_id === 'futbol' || c.sport_id === 'futsal');
      } else {
        matchSport = (c.sport_id === sport);
      }
    }

    return matchSearch && matchSport;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8;">
        <p style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</p>
        <p style="font-weight: 600; color: #f1f5f9;">No se encontraron clubes o canales con esa búsqueda.</p>
        <p style="font-size: 0.85rem;">Prueba con otro término o selecciona "Todos los Deportes".</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(club => {
    const isFollowing = (state.favoriteClubs || []).some(f => f.toLowerCase() === club.name.toLowerCase());
    const card = document.createElement('div');
    card.className = `fav-club-card ${isFollowing ? 'is-followed' : ''}`;
    card.onclick = (e) => e.stopPropagation();

    const sportIcon = club.sport_icon || getSportIcon(club.sport_id) || '🏅';
    const loc = club.location || club.province_name || 'España';
    const verifiedBadge = club.is_verified ? '<span class="badge-official-club">🛡️ Oficial</span>' : '';
    const safeClubParam = escapeHtml(club.name).replace(/'/g, "\\'");
    const clubIdOrName = club.id || club.name;

    card.innerHTML = `
      <div class="fav-club-left">
        <div class="fav-club-avatar" aria-hidden="true">${escapeHtml(sportIcon)}</div>
        <div class="fav-club-details">
          <h4 class="fav-club-name">${escapeHtml(club.name)}</h4>
          <div class="fav-club-meta">
            <span>${escapeHtml(club.sport_name || 'Fútbol')}</span>
            <span>•</span>
            <span>📍 ${escapeHtml(loc)}</span>
            ${verifiedBadge}
            <span>•</span>
            <span>${club.events_count || 1} ${(club.events_count === 1) ? 'emisión' : 'emisiones'}</span>
          </div>
        </div>
      </div>
      <div class="fav-club-actions" style="display:flex; gap:0.5rem; align-items:center;">
        <button type="button" 
           class="btn-visit-club" 
           onclick="enterClubMode('${encodeURIComponent(clubIdOrName)}')" 
           title="Ver Ficha Exclusiva del Club"
           style="padding:0.42rem 0.75rem; font-size:0.8rem; font-weight:600; border-radius:8px; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.35); color:#38bdf8; text-decoration:none; display:inline-flex; align-items:center; gap:5px; transition:all 0.2s ease; cursor:pointer;">
          <span>📺</span> <span>Ficha Club</span>
        </button>
        <button 
          type="button" 
          class="btn-follow-club ${isFollowing ? 'following' : ''}" 
          onclick="event.stopPropagation(); toggleFavoriteClub('${safeClubParam}', event)"
          aria-pressed="${isFollowing}">
          <span>${isFollowing ? '✓' : '⭐'}</span>
          <span>${isFollowing ? 'Siguiendo' : 'Seguir'}</span>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

async function toggleFavoriteClub(clubName, event) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  if (!clubName) return;

  // Bloqueo de captación: Si es un usuario invitado no autenticado, no guardar datos y abrir modal
  if (!isSportsLiveAuthenticated()) {
    openGuestLeadModal('follow_club', clubName);
    return;
  }

  const cleanName = String(clubName).trim();
  const index = state.favoriteClubs.indexOf(cleanName);

  if (index >= 0) {
    state.favoriteClubs.splice(index, 1);
    if (typeof showToast === 'function') {
      showToast(`Has dejado de seguir a ${cleanName}`);
    }
  } else {
    state.favoriteClubs.push(cleanName);
    if (typeof showToast === 'function') {
      showToast(`⭐ Ahora sigues a ${cleanName}`);
    }
  }

  // Registrar que se realizaron modificaciones mientras el modal estaba abierto
  state.favoritesChangedWhileModalOpen = true;

  // Persistir en almacén dependiente del usuario activo y backend
  saveUserFavorites('clubs');

  const hasFavClubs = state.favoriteClubs && state.favoriteClubs.length > 0;
  const hasFavMatches = state.favorites && state.favorites.length > 0;
  if (hasFavClubs || hasFavMatches) {
    state.favoritesOnlyMode = true;
  } else {
    state.favoritesOnlyMode = false;
  }

  // Actualizar listados de datos y estado de la interfaz
  updateFilterButtonsVisual();
  renderMyClubsList();
  renderFavClubsList();
  updateFavModalCounter();
  updateClubModeFollowButton();
  updateActiveFilterIndicator();

  // Reactividad inmediata en la vista principal
  applyFilters();
}

function filterClubsInModal(query) {
  state.favModalSearch = (query || '').trim();
  renderFavClubsList();
}

function filterFavClubsBySport(sportId) {
  state.favModalSportFilter = sportId || 'all';
  document.querySelectorAll('#fav-sport-pills .fav-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.sport === state.favModalSportFilter);
  });
  renderFavClubsList();
}

/* ==========================================================
   NAVEGACIÓN Y VISTA EXCLUSIVA POR CLUB (MODO CLUB)
   ========================================================== */

async function enterClubMode(clubIdentifier) {
  if (!clubIdentifier) return;
  const targetIdOrName = decodeURIComponent(String(clubIdentifier).trim());

  // Cerrar modal de favoritos si estaba abierto
  closeFavoritesModal();

  state.activeClubMode = targetIdOrName;
  state.activeClubFilter = targetIdOrName;

  // Asegurar que state.allClubs esté cargado
  if (!state.allClubs || state.allClubs.length === 0) {
    await fetchClubs();
  }

  // Buscar objeto club
  let clubObj = (state.allClubs || []).find(c =>
    (c.id && c.id.toLowerCase() === targetIdOrName.toLowerCase()) ||
    (c.name && c.name.toLowerCase() === targetIdOrName.toLowerCase())
  );

  // Fallback buscando en eventos
  const cleanEvents = (state.allEvents || []).filter(e => !isTestResidualEvent(e));
  const clubEvents = cleanEvents.filter(e => isEventOfClub(e, targetIdOrName));
  const firstEv = clubEvents[0];

  if (!clubObj && firstEv) {
    clubObj = {
      id: firstEv.club_id || targetIdOrName.toLowerCase().replace(/\s+/g, '-'),
      name: firstEv.club_name || firstEv.home_team || targetIdOrName,
      sport_id: firstEv.sport_id || 'futbol',
      sport_name: firstEv.sport_name || 'Fútbol',
      sport_icon: firstEv.sport_icon || '⚽',
      category: firstEv.category_name || 'Categoría Oficial',
      location: firstEv.location_venue || firstEv.province_name || 'España',
      is_verified: firstEv.is_verified_club || 1,
      events_count: clubEvents.length
    };
  }

  const isRfeboxClub = (clubObj && clubObj.id === 'real-federacion-espanola-de-boxeo-rfebox') ||
    (targetIdOrName && (String(targetIdOrName) === 'real-federacion-espanola-de-boxeo-rfebox' || String(targetIdOrName).toLowerCase().includes('boxeo') || String(targetIdOrName).toLowerCase().includes('rfebox')));

  const clubName = clubObj ? clubObj.name : (isRfeboxClub ? 'Real Federación Española de Boxeo RFEBox' : targetIdOrName);
  const clubShield = isRfeboxClub ? '🥊' : ((clubObj && clubObj.shield_icon) ? clubObj.shield_icon : ((clubObj && clubObj.sport_icon) ? clubObj.sport_icon : '🛡️'));
  const clubSport = isRfeboxClub ? 'Boxeo' : ((clubObj && clubObj.sport_name) ? clubObj.sport_name : 'Fútbol');
  const clubCategory = isRfeboxClub ? 'Nacional' : ((clubObj && clubObj.category) ? clubObj.category : 'Categoría Oficial');
  const clubLoc = isRfeboxClub ? 'España' : ((clubObj && clubObj.location) ? clubObj.location : 'España');
  const totalCount = clubEvents.length || (clubObj ? clubObj.events_count : 1) || 1;

  // Actualizar cabecera propia del club
  const banner = document.getElementById('club-mode-banner');
  if (banner) {
    const elName = document.getElementById('club-mode-name');
    const elShield = document.getElementById('club-mode-shield');
    const elSport = document.getElementById('club-mode-sport');
    const elCat = document.getElementById('club-mode-category');
    const elLoc = document.getElementById('club-mode-location');
    const elCount = document.getElementById('club-mode-count');
    const elVerified = document.getElementById('club-mode-verified');

    if (elName) elName.textContent = clubName;
    if (elShield) elShield.textContent = clubShield;
    const sportIcon = isRfeboxClub ? '🥊' : ((clubObj && clubObj.sport_icon) ? clubObj.sport_icon : '⚽');
    if (elSport) elSport.textContent = `${sportIcon} ${clubSport}`;
    if (elCat) elCat.textContent = clubCategory;
    if (elLoc) elLoc.textContent = `📍 ${clubLoc}`;
    if (elCount) elCount.textContent = `📺 ${totalCount} ${(totalCount === 1) ? 'vídeo' : 'vídeos'}`;
    if (elVerified) {
      elVerified.style.display = (clubObj && clubObj.is_verified) ? 'inline-block' : (isRfeboxClub ? 'inline-block' : 'none');
    }

    updateClubModeFollowButton(clubName);
    banner.style.display = 'block';
  }

  // Ocultar banner general de favoritos mientras se está en Modo Club
  const favHighlightBanner = document.getElementById('favorites-highlight-banner');
  if (favHighlightBanner) favHighlightBanner.style.display = 'none';

  // Configurar chat de comunidad para este club
  state.activeClubChatId = clubObj ? (clubObj.id || clubObj.name) : clubName;
  state.activeClubChatName = clubName;

  // Actualizar URL con parámetro ?club=... sin recargar la página
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location.href);
    url.searchParams.set('club', clubObj ? (clubObj.id || clubObj.name) : targetIdOrName);
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ''));
  }

  // Aplicar filtros exclusivos del club
  applyFilters();

  // Desplazar vista al inicio suavemente
  const mainCol = document.querySelector('.main-primary-col');
  if (mainCol && typeof mainCol.scrollIntoView === 'function') {
    mainCol.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function exitClubMode() {
  exitToGlobalCatalog();
}

function exitToGlobalCatalog() {
  state.activeClubMode = null;
  state.activeClubFilter = null;
  state.favoritesOnlyMode = false;
  state.selectedSport = 'all';
  state.selectedDiscipline = 'all';
  state.selectedCcaa = 'all';
  state.selectedProvince = 'all';
  state.directosFilter = 'all';
  state.searchQuery = '';
  state.featuredEventId = null;

  const banner = document.getElementById('club-mode-banner');
  if (banner) banner.style.display = 'none';

  // Limpiar parámetro ?club= de la URL
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location.href);
    if (url.searchParams.has('club')) {
      url.searchParams.delete('club');
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ''));
    }
  }

  updateFilterButtonsVisual();
  updateActiveFilterIndicator();
  applyFilters();
}

function updateActiveFilterIndicator() {
  const indicator = document.getElementById('active-filter-indicator');
  const targetEl = document.getElementById('filter-indicator-target');
  if (!indicator) return;

  const targetClub = state.activeClubMode || state.activeClubFilter;
  if (targetClub) {
    const rawClubName = (typeof targetClub === 'object') ? targetClub.name : targetClub;
    const clubObj = (state.allClubs || []).find(c =>
      (c.id && c.id.toLowerCase() === String(targetClub).toLowerCase()) ||
      (c.name && c.name.toLowerCase() === String(targetClub).toLowerCase())
    );
    const displayName = clubObj ? clubObj.name : rawClubName;
    if (targetEl) targetEl.textContent = displayName;
    indicator.style.display = 'flex';
  } else if (state.favoritesOnlyMode && ((state.favoriteClubs || []).length > 0 || (state.favorites || []).length > 0)) {
    if (targetEl) targetEl.textContent = (state.favoriteClubs && state.favoriteClubs.length > 0) ? 'Mis Clubes Favoritos' : 'Mis Favoritos';
    indicator.style.display = 'flex';
  } else {
    indicator.style.display = 'none';
  }
}

function openClubModeCommunityChat() {
  switchSidebarTab('chat');
  const chatCard = document.getElementById('live-chat-card');
  if (chatCard && window.innerWidth <= 1024 && typeof chatCard.scrollIntoView === 'function') {
    chatCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const input = document.getElementById('chat-message-input');
  if (input) input.focus();
}

function updateClubModeFollowButton(clubName) {
  const btnFollow = document.getElementById('btn-club-mode-follow');
  const labelFollow = document.getElementById('label-club-mode-follow');
  const iconFollow = document.getElementById('icon-club-mode-follow');
  if (!btnFollow) return;

  const targetName = clubName || (state.activeClubMode ? (typeof state.activeClubMode === 'object' ? state.activeClubMode.name : state.activeClubMode) : '');
  const isFollowing = (state.favoriteClubs || []).some(f => f.toLowerCase() === targetName.toLowerCase());

  btnFollow.classList.toggle('following', isFollowing);
  if (labelFollow) labelFollow.textContent = isFollowing ? 'Siguiendo' : 'Seguir';
  if (iconFollow) iconFollow.textContent = isFollowing ? '✓' : '⭐';
}

function handleClubModeToggleFollow() {
  if (!state.activeClubMode) return;
  const clubName = (typeof state.activeClubMode === 'object') ? state.activeClubMode.name : state.activeClubMode;
  toggleFavoriteClub(clubName);
  updateClubModeFollowButton(clubName);
}

function toggleFavoritesOnlyMode() {
  state.favoritesOnlyMode = !state.favoritesOnlyMode;
  applyFilters();
}

async function syncUserFavorites() {
  if (!state.token || !state.currentUser) return;
  try {
    const res = await fetch('/api/user/favorites', {
      headers: getAuthHeaders(false)
    });
    if (res.ok) {
      const data = await res.json();
      let changed = false;
      if (Array.isArray(data.favorite_clubs)) {
        if (data.favorite_clubs.length > 0) {
          state.favoriteClubs = data.favorite_clubs;
          saveUserFavorites('clubs');
        } else if (state.favoriteClubs.length > 0) {
          saveUserFavorites('clubs');
        } else {
          state.favoriteClubs = [];
          saveUserFavorites('clubs');
        }
        changed = true;
      }
      if (Array.isArray(data.favorite_events)) {
        if (data.favorite_events.length > 0) {
          state.favorites = data.favorite_events;
          saveUserFavorites('matches');
        } else if (state.favorites.length > 0) {
          saveUserFavorites('matches');
        } else {
          state.favorites = [];
          saveUserFavorites('matches');
        }
        changed = true;
      }
      const hasFavClubs = state.favoriteClubs && state.favoriteClubs.length > 0;
      const hasFavMatches = state.favorites && state.favorites.length > 0;
      if (hasFavClubs || hasFavMatches) {
        state.favoritesOnlyMode = true;
      }
      if (changed) {
        updateFilterButtonsVisual();
        updateActiveFilterIndicator();
        applyFilters();
      }
    }
  } catch (err) {
    console.warn('Error syncing user favorites:', err);
  }
}


function updateFilterButtonsVisual() {
  // 1. Botón DEPORTES
  const sportsBtn = document.getElementById('btn-capsule-sports');
  const sportsBtnText = document.querySelector('#btn-capsule-sports .capsule-btn-text');
  const sportsArrow = document.querySelector('#btn-capsule-sports .capsule-btn-arrow');
  if (sportsArrow) sportsArrow.textContent = '⌄';

  if (sportsBtnText) {
    if (state.selectedSport === 'all') {
      sportsBtnText.textContent = 'DEPORTES';
      if (sportsBtn) sportsBtn.classList.remove('active');
    } else if (state.selectedSport === 'contacto') {
      const disc = (state.selectedDiscipline || 'all').toLowerCase();
      if (disc && disc !== 'all') {
        const discLabels = { boxeo: 'Boxeo', mma: 'MMA', kickboxing: 'Kickboxing', muay_thai: 'Muay Thai', otras: 'Otras disciplinas' };
        sportsBtnText.textContent = `🥊 ${discLabels[disc] || disc.toUpperCase()}`;
      } else {
        sportsBtnText.textContent = '🥊 Boxeo y contacto';
      }
      if (sportsBtn) sportsBtn.classList.add('active');
    } else {
      sportsBtnText.textContent = getSportDisplayName(state.selectedSport);
      if (sportsBtn) sportsBtn.classList.add('active');
    }
  }

  document.querySelectorAll('#menu-sports .dropdown-item').forEach(item => {
    const isSportActive = item.dataset.sport === state.selectedSport;
    if (item.classList.contains('sub-item')) {
      const isDiscActive = isSportActive && (item.dataset.discipline === (state.selectedDiscipline || 'all'));
      item.classList.toggle('active', isDiscActive);
    } else {
      item.classList.toggle('active', isSportActive);
    }
  });

  // 2. Botón DIRECTOS
  const directosBtn = document.getElementById('btn-capsule-directos');
  const directosBtnText = document.querySelector('#btn-capsule-directos .capsule-btn-text');
  const directosArrow = document.querySelector('#btn-capsule-directos .capsule-btn-arrow');
  if (directosArrow) directosArrow.textContent = '⌄';

  if (directosBtnText) {
    if (state.directosFilter === 'all') {
      directosBtnText.textContent = 'DIRECTOS';
      if (directosBtn) directosBtn.classList.remove('active');
    } else if (state.directosFilter === 'today') {
      directosBtnText.textContent = 'Hoy';
      if (directosBtn) directosBtn.classList.add('active');
    } else if (state.directosFilter === 'weekend') {
      directosBtnText.textContent = 'Fin de semana';
      if (directosBtn) directosBtn.classList.add('active');
    }
  }

  document.querySelectorAll('#menu-directos .dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.filter === state.directosFilter);
  });

  // 3. Botón PROVINCIAS/AUTONOMÍAS
  const geoBtn = document.getElementById('btn-capsule-geo');
  const geoLabel = document.getElementById('label-capsule-geo');
  const geoArrow = document.querySelector('#btn-capsule-geo .capsule-btn-arrow');
  if (geoArrow) geoArrow.textContent = '⌄';

  if (geoLabel) {
    if (state.selectedCcaa === 'all') {
      geoLabel.textContent = '🇪🇸 Toda España';
      if (geoBtn) geoBtn.classList.remove('active');
    } else {
      geoLabel.textContent = getCcaaShortName(state.selectedCcaa);
      if (geoBtn) geoBtn.classList.add('active');
    }
  }

  document.querySelectorAll('#menu-geo .dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.ccaa === state.selectedCcaa);
  });

  // 4. Botón MIS FAVORITOS (Header)
  const favBtn = document.getElementById('btn-header-favorites');
  const favBadge = document.getElementById('badge-fav-count');
  const isGuest = !isSportsLiveAuthenticated();
  const hasFavs = !isGuest && (((state.favoriteClubs || []).length + (state.favorites || []).length) > 0);

  if (favBadge) {
    favBadge.style.display = 'none';
  }

  if (favBtn) {
    favBtn.classList.toggle('has-favorites', hasFavs);
  }
}

function isTestResidualEvent(e) {
  if (!e) return false;
  const t = (e.title || '').toLowerCase();
  const h = (e.home_team || '').toLowerCase();
  const a = (e.away_team || '').toLowerCase();
  return t.includes('caso borde') || t.includes('test local') || h.includes('test local') || a.includes('test visitante');
}

function updateFeaturedPlayer(filtered) {
  const wrapper = document.getElementById('main-player') || document.getElementById('featured-video-wrapper');
  if (!wrapper) return;

  const validFiltered = (filtered || []).filter(e => !isTestResidualEvent(e));

  if (validFiltered && validFiltered.length > 0) {
    // Si el usuario tiene favoritos activos, priorizar el primer partido LIVE o de sus favoritos en el reproductor principal
    const isGuest = !state.currentUser;
    const hasFavClubs = !isGuest && state.favoriteClubs && state.favoriteClubs.length > 0;
    const hasFavMatches = !isGuest && state.favorites && state.favorites.length > 0;
    const hasFavorites = hasFavClubs || hasFavMatches;

    const isFav = (e) => {
      if (!hasFavorites) return false;
      return (hasFavClubs && isEventOfFavoriteClub(e, state.favoriteClubs)) ||
             (hasFavMatches && state.favorites.includes(e.id));
    };

    if (hasFavorites) {
      // 1. LIVE de favoritos en máxima prioridad
      const favLive = validFiltered.find(e => isFav(e) && e.status === 'LIVE');
      if (favLive) {
        if (state.featuredEventId !== favLive.id) {
          loadFeaturedPlayer(favLive);
        }
        return;
      }
      // 2. Cualquier contenido de sus favoritos si el reproductor actual no es ya un favorito
      const favAny = validFiltered.find(e => isFav(e));
      const currentIsFav = validFiltered.some(e => e.id === state.featuredEventId && isFav(e));
      if (favAny && !currentIsFav) {
        if (state.featuredEventId !== favAny.id) {
          loadFeaturedPlayer(favAny);
        }
        return;
      }
    }

    // Si el evento actual sigue en la lista filtrada, conservarlo
    const currentStillMatches = validFiltered.find(e => e.id === state.featuredEventId);
    if (!currentStillMatches) {
      // Priorizar el primer LIVE de los filtrados, o el primer partido disponible
      const liveEvt = validFiltered.find(e => e.status === 'LIVE');
      loadFeaturedPlayer(liveEvt || validFiltered[0]);
    }
  } else {
    // Si filtered está vacío:
    const isGeoFiltered = state.selectedCcaa && state.selectedCcaa !== 'all';
    if (isGeoFiltered) {
      state.featuredEventId = null;
      wrapper.innerHTML = `
        <div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0f172a; color:#94a3b8; text-align:center; padding:2rem; z-index:1;">
          <span style="font-size: 2.8rem; margin-bottom: 0.75rem;">📍</span>
          <p style="font-size: 1.15rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.5rem;">No hay emisiones disponibles en esta comunidad</p>
          <p style="font-size: 0.88rem; color: #94a3b8; max-width: 420px; line-height:1.4;">Selecciona otra comunidad autónoma en el menú superior o restablece los filtros para ver todos los partidos.</p>
        </div>
      `;
      const info = document.getElementById('featured-player-info') || document.querySelector('.match-info');
      if (info) {
        info.innerHTML = '';
      }
      return;
    }

    // Si filtered está vacío sin filtro territorial: NO romper ni vaciar el reproductor
    if (!state.featuredEventId && state.allEvents && state.allEvents.length > 0) {
      const validAll = state.allEvents.filter(e => !isTestResidualEvent(e));
      const defaultEvt = validAll.find(e => e.status === 'LIVE') || validAll[0] || state.allEvents[0];
      if (defaultEvt) {
        loadFeaturedPlayer(defaultEvt);
        return;
      }
    }

    // Si no hay partidos disponibles en ningún filtro:
    state.featuredEventId = null;
    wrapper.innerHTML = `
      <div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0f172a; color:#94a3b8; text-align:center; padding:2rem; z-index:1;">
        <span style="font-size: 2.8rem; margin-bottom: 0.75rem;">📺</span>
        <p style="font-size: 1.15rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.5rem;">No hay emisiones disponibles</p>
        <p style="font-size: 0.88rem; color: #94a3b8; max-width: 420px; line-height:1.4;">Pronto se publicarán nuevos directos y contenidos oficiales de deporte base.</p>
      </div>
    `;
    const info = document.getElementById('featured-player-info') || document.querySelector('.match-info');
    if (info) {
      info.innerHTML = '';
      info.style.display = 'none';
    }
  }
}

function updateFeaturedSidebar(filtered) {
  const container = document.getElementById('featured-cards-list');
  if (!container) return;

  const validFiltered = (filtered || []).filter(e => !isTestResidualEvent(e));

  if (validFiltered && validFiltered.length > 0) {
    const isGuest = !state.currentUser;
    const hasFavClubs = !isGuest && state.favoriteClubs && state.favoriteClubs.length > 0;
    const hasFavMatches = !isGuest && state.favorites && state.favorites.length > 0;
    const hasFavorites = hasFavClubs || hasFavMatches;

    const isFav = (e) => (
      hasFavorites && (
        (hasFavClubs && isEventOfFavoriteClub(e, state.favoriteClubs)) ||
        (hasFavMatches && state.favorites.includes(e.id))
      )
    );

    const upcomingFiltered = validFiltered.filter(e => e.status === 'UPCOMING');
    let itemsToShow = upcomingFiltered.length > 0 ? upcomingFiltered : validFiltered.filter(e => e.id !== state.featuredEventId);

    if (hasFavorites) {
      itemsToShow.sort((a, b) => {
        const aF = isFav(a) ? 1 : 0;
        const bF = isFav(b) ? 1 : 0;
        return bF - aF;
      });
    }

    renderFeaturedSidebar(itemsToShow.slice(0, 6));
  } else {
    // Si no hay partidos con los filtros seleccionados, limpiar y mostrar aviso sin fallback cruzado a otras regiones
    renderFeaturedSidebar([]);
  }
}

function applyFilters() {
  if (!state.allEvents || state.allEvents.length === 0) {
    if (!state.hasFetchedEvents && !state.isFetchingEvents) {
      fetchEvents();
      return;
    }
    state.events = [];
    const countEl = document.getElementById('matches-header-count');
    if (countEl) countEl.textContent = '0 retransmisiones';
    updateFilterButtonsVisual();
    updateFeaturedPlayer([]);
    updateFeaturedSidebar([]);
    renderEvents([]);
    updateActiveFilterIndicator();
    return;
  }

  const isGuest = !state.currentUser;
  const hasFavoriteClubs = !isGuest && state.favoriteClubs && state.favoriteClubs.length > 0;
  const hasFavoriteMatches = !isGuest && state.favorites && state.favorites.length > 0;
  const hasFavorites = hasFavoriteClubs || hasFavoriteMatches;
  const isFavoritesView = hasFavorites && state.favoritesOnlyMode;

  // Actualizar banner superior y títulos según estado de favoritos
  const favBanner = document.getElementById('favorites-highlight-banner');
  const favClubsListEl = document.getElementById('fav-banner-clubs-list');
  const btnToggleMode = document.getElementById('btn-toggle-fav-mode');
  const sectionTitle = document.getElementById('section-title');

  if (favBanner) {
    if (hasFavorites && !state.activeClubMode) {
      favBanner.style.display = 'flex';
      if (favClubsListEl) {
        if (hasFavoriteClubs && hasFavoriteMatches) {
          favClubsListEl.textContent = `Mostrando partidos y emisiones de tus clubes seguidos (${state.favoriteClubs.join(', ')}) y partidos favoritos.`;
        } else if (hasFavoriteClubs) {
          favClubsListEl.textContent = `Mostrando partidos y emisiones de tus clubes seguidos (${state.favoriteClubs.join(', ')}).`;
        } else {
          favClubsListEl.textContent = 'Mostrando tus partidos y emisiones marcadas como favoritas.';
        }
      }
      if (btnToggleMode) {
        if (state.favoritesOnlyMode) {
          btnToggleMode.innerHTML = '<span>🌐</span> <span>Ver Todo el Catálogo</span>';
          btnToggleMode.classList.remove('active-toggle');
        } else {
          btnToggleMode.innerHTML = '<span>⭐</span> <span>Ver Solo Favoritos</span>';
          btnToggleMode.classList.add('active-toggle');
        }
      }
    } else {
      favBanner.style.display = 'none';
    }
  }

  // Renderizar sección de descubrimiento para usuarios invitados
  renderDiscoveryBanner();

  if (sectionTitle) {
    if (isFavoritesView) {
      sectionTitle.innerHTML = '⭐ En Directo y Emisiones de tus Favoritos';
    } else {
      sectionTitle.textContent = 'Partidos en Directo';
    }
  }

  // Base de eventos según vista de favoritos, excluyendo cualquier residuo de prueba y requiriendo club aprobado
  const cleanEvents = (state.allEvents || []).filter(e => !isTestResidualEvent(e) && isEventOfApprovedClub(e));

  // Helper para verificar si un evento es favorito (por club o por evento)
  const isFavoriteEvent = (e) => {
    if (!hasFavorites) return false;
    const matchClub = hasFavoriteClubs && isEventOfFavoriteClub(e, state.favoriteClubs);
    const matchEvt = hasFavoriteMatches && state.favorites.includes(e.id);
    return matchClub || matchEvt;
  };

  // MODO CLUB / MONOGRÁFICO DE EQUIPO ACTIVO
  const targetClubMode = state.activeClubMode || state.activeClubFilter;
  if (targetClubMode) {
    if (favBanner) favBanner.style.display = 'none';

    const clubEvents = cleanEvents.filter(e => isEventOfClub(e, targetClubMode));
    state.events = clubEvents;

    const clubName = (typeof targetClubMode === 'object') ? targetClubMode.name : targetClubMode;
    const titleClub = (state.allClubs || []).find(c =>
      (c.id && c.id.toLowerCase() === String(targetClubMode).toLowerCase()) ||
      (c.name && c.name.toLowerCase() === String(targetClubMode).toLowerCase())
    );
    const displayName = titleClub ? titleClub.name : (clubEvents[0] ? (clubEvents[0].club_name || clubEvents[0].home_team || clubName) : clubName);

    if (sectionTitle) {
      sectionTitle.textContent = `📺 Histórico y Emisiones de ${displayName}`;
    }

    const countEl = document.getElementById('matches-header-count');
    if (countEl) {
      if (clubEvents.length === 0) {
        countEl.textContent = `0 emisiones de ${displayName}`;
      } else if (clubEvents.length === 1) {
        countEl.textContent = `1 emisión de ${displayName}`;
      } else {
        countEl.textContent = `${clubEvents.length} emisiones de ${displayName}`;
      }
    }

    // Seleccionar vídeo para el reproductor principal: LIVE si existe, o el más reciente del club
    const liveEvt = clubEvents.find(e => e.status === 'LIVE');
    const targetEvt = liveEvt || clubEvents[0];
    if (targetEvt) {
      loadFeaturedPlayer(targetEvt);
    } else {
      updateFeaturedPlayer(clubEvents);
    }

    // Actualizar barra lateral DESTACADOS y Muro de comunidad
    updateFeaturedSidebar(clubEvents);

    // Renderizar la rejilla con el catálogo del club
    renderEvents(clubEvents);
    updateActiveFilterIndicator();
    return;
  }

  // ALIMENTACIÓN DE CONTENIDOS EN PORTADA: Restringir a emisiones en directo + últimos 5 vídeos históricos por club
  const portadaEvents = limitEventsForPortada(cleanEvents, 5);
  let baseEvents = portadaEvents;
  if (isFavoritesView) {
    const favMatches = cleanEvents.filter(isFavoriteEvent);
    if (favMatches.length > 0) {
      baseEvents = limitEventsForPortada(favMatches, 5);
    } else {
      // Si aún no hay partidos de esos favoritos, mostrar los generales con título estándar
      baseEvents = portadaEvents;
      if (sectionTitle) {
        sectionTitle.textContent = 'Partidos en Directo';
      }
    }
  }

  // Filtrado combinable en tiempo real (0 ms de latencia)
  const filtered = baseEvents.filter(evt => {
    // 1. Deporte y Disciplina
    const matchSport = isSportMatch(evt, state.selectedSport, state.selectedDiscipline);

    // 2. Territorial (Comunidad Autónoma)
    const matchGeo = isEventInCcaa(evt, state.selectedCcaa);

    // 3. Temporal (Todos, Hoy, Fin de semana)
    let matchTime = true;
    if (state.directosFilter === 'today') {
      matchTime = isEventToday(evt);
    } else if (state.directosFilter === 'weekend') {
      matchTime = isEventWeekend(evt);
    }

    // 4. Búsqueda por texto (buscador secundario si aplica)
    const matchSearch = isSearchMatch(evt, state.searchQuery);

    return matchSport && matchGeo && matchTime && matchSearch;
  });

  // Priorizar eventos de favoritos en la cartelera principal (adaptando la pantalla a sus preferencias)
  if (hasFavorites) {
    filtered.sort((a, b) => {
      const aFav = isFavoriteEvent(a) ? 1 : 0;
      const bFav = isFavoriteEvent(b) ? 1 : 0;
      const aLive = a.status === 'LIVE' ? 1 : 0;
      const bLive = b.status === 'LIVE' ? 1 : 0;

      // 1. LIVE de favoritos en primera posición
      if (aLive && bLive) {
        if (aFav !== bFav) return bFav - aFav;
      }
      // 2. Eventos LIVE generales
      if (aLive !== bLive) return bLive - aLive;

      // 3. Favoritos no-LIVE por encima de no-favoritos
      if (aFav !== bFav) return bFav - aFav;

      // 4. Por fecha descendente
      return new Date(b.date_time || 0) - new Date(a.date_time || 0);
    });
  }

  state.events = filtered;

  // Actualizar indicadores visuales de los botones cápsula (ej. "Fútbol ⌄", "Madrid ⌄", "Hoy ⌄")
  updateFilterButtonsVisual();

  // Actualizar contador del encabezado
  const countEl = document.getElementById('matches-header-count');
  if (countEl) {
    if (filtered.length === 0) {
      countEl.textContent = '0 retransmisiones';
    } else if (filtered.length === 1) {
      countEl.textContent = '1 retransmisión disponible';
    } else {
      countEl.textContent = `${filtered.length} retransmisiones disponibles`;
    }
  }

  // Actualizar reproductor grande (priorizando favoritos en directo)
  updateFeaturedPlayer(filtered);

  // Actualizar barra lateral DESTACADOS (sin descuadrarla si no hay partidos)
  updateFeaturedSidebar(filtered);

  // Renderizar rejilla principal de partidos (o estado limpio si filtered.length === 0)
  renderEvents(filtered);
  updateActiveFilterIndicator();
}

function selectSportFilter(sportId, discipline = 'all', event = null) {
  if (event) {
    event.stopPropagation();
  }
  state.selectedSport = sportId || 'all';
  state.selectedDiscipline = discipline || 'all';
  state.selectedCategory = (discipline && discipline !== 'all') ? discipline : 'all';
  closeAllCapsuleDropdowns();
  if (typeof closeMobileNav === 'function') closeMobileNav();
  updateFilterButtonsVisual();
  applyFilters();
}

function openSportSubmenu(sportId) {
  const wrap = document.getElementById(`wrap-sport-${sportId}`);
  if (wrap) {
    wrap.classList.add('expanded');
  }
}

function toggleSportSubmenu(sportId, e) {
  if (e) e.stopPropagation();
  const wrap = document.getElementById(`wrap-sport-${sportId}`);
  if (wrap) {
    wrap.classList.toggle('expanded');
  }
}

function selectDirectosFilter(filterType) {
  state.directosFilter = filterType || 'all';
  closeAllCapsuleDropdowns();
  if (typeof closeMobileNav === 'function') closeMobileNav();
  applyFilters();
}

function selectGeoCcaa(ccaaId) {
  state.selectedCcaa = ccaaId || 'all';
  state.selectedProvince = 'all';
  closeAllCapsuleDropdowns();
  if (typeof closeMobileNav === 'function') closeMobileNav();
  updateFilterButtonsVisual();
  if (typeof filterMatches === 'function') {
    filterMatches();
  } else {
    applyFilters();
  }
}

function filterMatches() {
  applyFilters();
}

function renderGrid(events) {
  renderEvents(events || state.events);
}

function resetAllFilters() {
  state.selectedSport = 'all';
  state.selectedDiscipline = 'all';
  state.selectedCcaa = 'all';
  state.selectedProvince = 'all';
  state.directosFilter = 'all';
  state.selectedCategory = 'all';
  state.searchQuery = '';

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  updateFilterButtonsVisual();
  applyFilters();
  if (typeof showToast === 'function') {
    showToast('Filtros restablecidos');
  }
}

window.selectSportFilter = selectSportFilter;
window.selectDirectosFilter = selectDirectosFilter;
window.selectGeoCcaa = selectGeoCcaa;
window.filterMatches = filterMatches;
window.renderGrid = renderGrid;
window.isEventInCcaa = isEventInCcaa;
window.normalizeGeoText = normalizeGeoText;
window.resolveCcaaKey = resolveCcaaKey;
window.resetAllFilters = resetAllFilters;
window.applyFilters = applyFilters;
window.openFavoritesModal = openFavoritesModal;
window.closeFavoritesModal = closeFavoritesModal;
window.toggleFavoriteClub = toggleFavoriteClub;
window.handleApplyFavoritesAndClose = handleApplyFavoritesAndClose;
window.filterClubsInModal = filterClubsInModal;
window.filterFavClubsBySport = filterFavClubsBySport;
window.toggleFavoritesOnlyMode = toggleFavoritesOnlyMode;
window.switchFavModalTab = switchFavModalTab;
window.renderMyClubsList = renderMyClubsList;
window.renderFavClubsList = renderFavClubsList;
window.enterClubMode = enterClubMode;
window.exitClubMode = exitClubMode;
window.backToFavoritesModal = backToFavoritesModal;
window.openClubModeCommunityChat = openClubModeCommunityChat;
window.handleClubModeToggleFollow = handleClubModeToggleFollow;
window.isEventOfClub = isEventOfClub;
window.handleFavoritesClick = handleFavoritesClick;
window.handleFavoritesHeaderClick = handleFavoritesClick;
window.openGuestLeadModal = openGuestLeadModal;
window.requestClubKeyInfo = requestClubKeyInfo;
window.state = state;

/* ==========================================================
   1.6. REPRODUCTOR GRANDE EN VIVO Y BARRA LATERAL DESTACADOS
   ========================================================== */

function loadFeaturedPlayer(evt) {
  if (!evt) return;
  evt = sanitizeEventSportAndClubData(evt);
  state.featuredEventId = evt.id;

  const isLive = evt.status === 'LIVE';

  // Si el vídeo en reproducción es diferido, rueda de prensa o resumen (REPLAY / catálogo):
  // No mostrar el error "Chat no disponible" como pestaña principal.
  // Mantener activa por defecto la pestaña ★ DESTACADOS con los vídeos y contenidos relacionados.
  if (!isLive) {
    state.sidebarTab = 'featured';
    const btnFeatured = document.getElementById('tab-btn-featured');
    const btnChat = document.getElementById('tab-btn-chat');
    const viewFeatured = document.getElementById('sidebar-view-featured');
    const viewChat = document.getElementById('sidebar-view-chat');
    if (btnFeatured) btnFeatured.classList.add('active');
    if (btnChat) btnChat.classList.remove('active');
    if (viewFeatured) {
      viewFeatured.classList.add('active');
      viewFeatured.style.display = 'block';
    }
    if (viewChat) {
      viewChat.classList.remove('active');
      viewChat.style.display = 'none';
    }
    stopChatPolling();
  }

  // Sincronizar visibilidad y conmutación de chat (Directo vs Muro de la Afición del Club)
  if (typeof updateChatVisibility === 'function') {
    updateChatVisibility();
  }
  if (state.sidebarTab === 'chat' && typeof loadActiveChatContent === 'function') {
    loadActiveChatContent();
  }

  const wrapper = document.getElementById('main-player') || document.getElementById('featured-video-wrapper');
  const info = document.getElementById('featured-player-info') || document.querySelector('.match-info');

  if (wrapper) {
    const cleanEmbedUrl = disableAutoplayInUrl(evt.embed_url);
    const safeEmbedUrl = sanitizeUrl(cleanEmbedUrl);
    wrapper.innerHTML = `
      <iframe 
        id="main-player-iframe"
        src="${safeEmbedUrl}" 
        title="${escapeHtml(evt.title)}"
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; display: block; z-index: 1;"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
        allowfullscreen>
      </iframe>
    `;
  }

  if (info) {
    if (!info.classList.contains('match-info')) {
      info.classList.add('match-info');
    }
    info.style.position = 'relative';
    info.style.marginTop = '12px';
    info.style.clear = 'both';
    info.style.zIndex = '2';
    info.style.display = 'block';
    const isLive = evt.status === 'LIVE';
    const tagHtml = isLive
      ? `<span class="featured-live-tag"><span class="live-dot"></span> EN VIVO</span>`
      : `<span class="featured-live-tag" style="background:#3b82f6;"><span class="live-dot" style="background:#bfdbfe;"></span> ${escapeHtml(evt.status || 'DIRECTO')}</span>`;

    let teamsRowHtml = '';
    if (isLive && evt.home_score !== null && evt.away_score !== null) {
      teamsRowHtml = `
        <div class="featured-teams-row">
          <span>${escapeHtml(evt.home_team)}</span>
          <span class="featured-score-pill">${escapeHtml(evt.home_score)} - ${escapeHtml(evt.away_score)}</span>
          <span>${escapeHtml(evt.away_team)}</span>
        </div>
      `;
    } else if (evt.away_team && !evt.away_team.startsWith('Rival de') && evt.away_team !== 'Equipo' && evt.away_team !== 'Cantera Oficial' && evt.content_type !== 'press' && evt.content_type !== 'reel') {
      teamsRowHtml = `
        <div class="featured-teams-row">
          <span>${escapeHtml(evt.home_team)}</span>
          <span class="featured-score-pill">VS</span>
          <span>${escapeHtml(evt.away_team)}</span>
        </div>
      `;
    }

    const hasSponsor = evt.sponsor_name && String(evt.sponsor_name).trim().length > 0;
    const sponsorHtml = hasSponsor
      ? `<div class="featured-sponsor-tag" title="Patrocinador oficial del club">
           <span>🤝 Patrocinador:</span> <strong>${escapeHtml(evt.sponsor_name)}</strong>
         </div>`
      : `<div class="featured-sponsor-promo-bar" onclick="openSponsorModal(event)" onkeydown="if(event.key==='Enter'||event.key===' '){openSponsorModal(event);}" role="button" tabindex="0" title="📢 ¿Quieres poner tu empresa aquí? Haz clic y solicita tu publicidad" style="cursor: pointer;">
           <div class="promo-bar-left">
             <span class="promo-bar-icon">📢</span>
             <span class="promo-bar-text">¿Quieres poner tu empresa aquí? <strong class="promo-bar-link">Haz clic y solicita tu publicidad</strong></span>
           </div>
         </div>`;

    info.innerHTML = `
      <div class="featured-player-topline">
        ${tagHtml}
        <div class="featured-meta-badges">
          <span>${escapeHtml(evt.sport_icon || '🏅')} ${escapeHtml(evt.sport_name)}</span>
          <span>•</span>
          <span>${escapeHtml(evt.category_name || '')}</span>
          <span>•</span>
          <span>📍 ${escapeHtml(evt.location_venue || evt.province_name)}</span>
        </div>
      </div>

      <h2 class="featured-title-main">${escapeHtml(evt.title)}</h2>

      ${teamsRowHtml}

      <div class="featured-bottomline">
        <div class="featured-bottomline-sponsor-zone">${sponsorHtml}</div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" class="btn-watch" onclick="openPlayerModal('${escapeHtml(evt.id)}')" style="padding: 0.35rem 0.85rem; font-size: 0.82rem;">
            🔍 Pantalla Completa / Ficha
          </button>
          ${(evt.club_id || evt.club_name) ? `
          <a href="club.html?club=${encodeURIComponent(evt.club_id || evt.club_name)}" class="btn-watch" style="padding: 0.35rem 0.85rem; font-size: 0.82rem; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #93c5fd;" title="Acceder a la ficha monográfica y videoteca completa del club">
            🏛️ Ficha del Club / Videoteca Completa ↗
          </a>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Marcar visualmente la tarjeta activa
  document.querySelectorAll('.match-card, .compact-featured-card').forEach(c => {
    c.classList.toggle('active-playing', c.dataset.eventId === evt.id);
  });
}
window.loadFeaturedPlayer = loadFeaturedPlayer;

function loadFeaturedPlayerById(eventId) {
  const evt = state.events.find(e => e.id === eventId);
  if (evt) {
    loadFeaturedPlayer(evt);
    const playerSection = document.getElementById('featured-player-section');
    if (playerSection) {
      playerSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else {
    openPlayerModal(eventId);
  }
}
window.loadFeaturedPlayerById = loadFeaturedPlayerById;

function handleCompactThumbError(imgEl, sportId, sportIcon, sportName) {
  if (!imgEl) return;
  // Prevenir bucles infinitos en caso de cualquier error
  imgEl.onerror = () => {
    imgEl.style.display = 'none';
  };

  // 1. Obtener imagen deportiva local en formato Data URI vectorial (SVG) adaptado al deporte
  const localSvgThumb = (typeof getSportSvgDataUri === 'function')
    ? getSportSvgDataUri(sportId, sportIcon, sportName)
    : '';

  if (localSvgThumb && imgEl.src !== localSvgThumb) {
    imgEl.src = localSvgThumb;
  } else {
    // 2. Si no hay SVG o ya falló, ocultar completamente el <img> para dejar visible el degradado con icono
    imgEl.style.display = 'none';
  }
}
window.handleCompactThumbError = handleCompactThumbError;

function renderFeaturedSidebar(events) {
  const container = document.getElementById('featured-cards-list');
  if (!container) return;

  container.innerHTML = '';
  if (!events || events.length === 0) {
    const isCcaaFiltered = state.selectedCcaa && state.selectedCcaa !== 'all';
    const msg = isCcaaFiltered
      ? 'No hay emisiones disponibles en esta comunidad'
      : 'No hay retransmisiones destacadas disponibles.';
    container.innerHTML = `<div class="sidebar-empty-notice" style="text-align:center; padding:2rem 1rem; color:#94a3b8; font-size:0.88rem; line-height:1.4;">
      <span style="font-size:1.8rem; display:block; margin-bottom:0.5rem;">📍</span>
      <p style="font-weight:600; color:#e2e8f0; margin-bottom:0.25rem;">${msg}</p>
    </div>`;
    return;
  }

  const displayEvents = (events || []).slice(0, 6);
  displayEvents.forEach(evt => {
    evt = sanitizeEventSportAndClubData(evt);
    const card = document.createElement('div');
    card.className = `compact-featured-card ${state.featuredEventId === evt.id ? 'active' : ''}`;
    card.dataset.eventId = evt.id;
    card.onclick = () => loadFeaturedPlayer(evt);

    const sportId = (evt.sport_id || 'futbol').toLowerCase();
    const sportIcon = evt.sport_icon || '🏅';
    const sportName = evt.sport_name || 'Deporte';

    // Determinar miniatura: si tiene URL se usa; si no o si da error, se usa el SVG vectorial local
    const localSvgThumb = (typeof getSportSvgDataUri === 'function')
      ? getSportSvgDataUri(sportId, sportIcon, sportName)
      : '';
    const hasCustomThumb = evt.thumbnail && typeof evt.thumbnail === 'string' && evt.thumbnail.trim().length > 0;
    const initialThumb = hasCustomThumb
      ? sanitizeUrl(evt.thumbnail)
      : (localSvgThumb || (typeof DEFAULT_GENERIC_SPORT_THUMBNAIL !== 'undefined' ? DEFAULT_GENERIC_SPORT_THUMBNAIL : ''));

    card.innerHTML = `
      <div class="compact-card-thumb">
        <div class="compact-thumb-fallback sport-bg-${escapeHtml(sportId)}" aria-hidden="true">
          <div class="compact-thumb-fallback-center">
            <span class="compact-thumb-fallback-icon">${escapeHtml(sportIcon)}</span>
            <span class="compact-thumb-fallback-label">${escapeHtml(sportName)}</span>
          </div>
        </div>
        <img class="compact-thumb-img"
             src="${initialThumb}"
             alt="${escapeHtml(evt.title)}"
             loading="lazy"
             onerror="handleCompactThumbError(this, '${escapeHtml(sportId)}', '${escapeHtml(sportIcon)}', '${escapeHtml(sportName)}');">
      </div>
      <div class="compact-card-body">
        <div class="compact-card-tag-row">
          <span class="compact-card-badge">${escapeHtml(sportIcon)} ${escapeHtml(sportName)}</span>
          ${isEventOfFavoriteClub(evt, state.favoriteClubs) ? '<span class="card-fav-team-badge" style="font-size:0.62rem; padding:0.08rem 0.35rem; margin-left:0.25rem;">⭐ FAVORITO</span>' : ''}
          ${evt.category_name ? `<span class="compact-card-category">• ${escapeHtml(evt.category_name)}</span>` : ''}
        </div>
        <h4 class="compact-card-title">${escapeHtml(evt.title)}</h4>
      </div>
    `;
    container.appendChild(card);
  });
}
window.renderFeaturedSidebar = renderFeaturedSidebar;

/* ==========================================================
   1.7. SISTEMA DE CHAT EN VIVO Y MODERACIÓN DEPORTIVA
   ========================================================== */

// Lista negra client-side de términos ofensivos y patrones con comodines
const CLIENT_OFFENSIVE_TERMS = [
  "puto", "puta", "puton", "putona", "putero", "cabron", "cabrona", "cabrones",
  "hijo de puta", "hija de puta", "hijos de puta", "hdp", "subnormal", "subnormales",
  "gilipollas", "retrasado", "retrasada", "retrasados", "maricon", "maricona", "marica", "maricada",
  "mierda", "mierdas", "bastardo", "bastarda", "bastardos", "capullo", "capulla", "capullos",
  "zorra", "zorrilla", "imbecil", "imbeciles", "idiota", "idiotas", "malparido", "malparida",
  "malnacido", "malnacida", "inutil", "inutiles", "asqueroso", "asquerosa", "muerete", "asesino",
  "asesinos", "corrupto", "ladron", "ladrona", "ladrones", "estafador", "nazi", "nazis",
  "fascista", "facha", "payaso", "payasos", "negrata", "manco de mierda", "guarra", "perra"
];

const CLIENT_OFFENSIVE_PATTERNS = [
  /\bp[\*u]t[ao]s?\b/i,
  /\bc[\*a]br[o\*ó]n(?:es)?\b/i,
  /\bm[\*i]erd[a\*]s?\b/i,
  /\bg[\*i]l[\*i]p[o\*]ll[a\*]s\b/i,
  /\b[\*s]ubn[o\*]rm[a\*]l(?:es)?\b/i,
  /\bh[\.\-\*]?d[\.\-\*]?p\b/i,
  /\bhij[o|a]s?\s+de\s+p[u\*]t[a\*]\b/i
];

function checkOffensiveLanguageClient(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  // Normalizar diacríticos (á -> a, etc.)
  const norm = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  for (const pat of CLIENT_OFFENSIVE_PATTERNS) {
    if (pat.test(norm)) return true;
  }

  for (const term of CLIENT_OFFENSIVE_TERMS) {
    const termNorm = term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (termNorm.includes(' ')) {
      if (norm.includes(termNorm)) return true;
    } else {
      const reg = new RegExp(`(?:^|[^a-z0-9áéíóúüñ])${termNorm}(?:[^a-z0-9áéíóúüñ]|$)`, 'i');
      if (reg.test(norm)) return true;
    }
  }

  return false;
}

function getCurrentFeaturedEvent() {
  return (state.allEvents && state.allEvents.find(e => e.id === state.featuredEventId))
    || (state.events && state.events.find(e => e.id === state.featuredEventId))
    || (state.events && state.events[0])
    || (state.allEvents && state.allEvents[0]);
}

function getEventClub(evt) {
  if (!evt) return null;
  const clubName = (evt.club_name || evt.home_team || '').trim().toLowerCase();
  const clubId = (evt.club_id || '').trim().toLowerCase();
  if (state.allClubs && state.allClubs.length > 0) {
    const found = state.allClubs.find(c =>
      (clubId && c.id && c.id.toLowerCase() === clubId) ||
      (clubName && c.name && c.name.toLowerCase() === clubName) ||
      (clubName && c.id && c.id.toLowerCase() === clubName)
    );
    if (found) return found;
  }
  return {
    id: evt.club_id || (evt.club_name || evt.home_team || 'club').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, ''),
    name: evt.club_name || evt.home_team || 'Club Deportivo',
    shield_icon: evt.sport_icon || '🛡️'
  };
}

function switchSidebarTab(tabName) {
  state.sidebarTab = tabName;
  const btnFeatured = document.getElementById('tab-btn-featured');
  const btnChat = document.getElementById('tab-btn-chat');
  const viewFeatured = document.getElementById('sidebar-view-featured');
  const viewChat = document.getElementById('sidebar-view-chat');

  if (tabName === 'chat') {
    if (btnFeatured) btnFeatured.classList.remove('active');
    if (btnChat) btnChat.classList.add('active');
    if (viewFeatured) {
      viewFeatured.classList.remove('active');
      viewFeatured.style.display = 'none';
    }
    if (viewChat) {
      viewChat.classList.add('active');
      viewChat.style.display = 'block';
    }

    updateChatVisibility();
    loadActiveChatContent();
    startChatPolling();
  } else {
    if (btnFeatured) btnFeatured.classList.add('active');
    if (btnChat) btnChat.classList.remove('active');
    if (viewFeatured) {
      viewFeatured.classList.add('active');
      viewFeatured.style.display = 'block';
    }
    if (viewChat) {
      viewChat.classList.remove('active');
      viewChat.style.display = 'none';
    }
    stopChatPolling();
  }
}

function updateChatVisibility() {
  const currentEvt = getCurrentFeaturedEvent();
  const pulseEl = document.getElementById('chat-pulse-indicator');
  const tagEl = document.getElementById('chat-match-tag');
  const badgeEl = document.getElementById('chat-header-badge');
  const dotEl = document.getElementById('chat-tab-live-dot');
  const tabTextEl = document.getElementById('chat-tab-text');
  const noticeEl = document.getElementById('chat-offline-notice');
  const activeBodyEl = document.getElementById('chat-active-body');
  const inputEl = document.getElementById('chat-message-input');
  const sendBtn = document.getElementById('btn-chat-send');
  const hintEl = document.getElementById('chat-rules-hint');

  const isLive = Boolean(currentEvt && currentEvt.status === 'LIVE');

  if (isLive) {
    state.chatMode = 'live';
    state.activeClubChatId = null;

    if (dotEl) dotEl.style.display = 'inline-block';
    if (tabTextEl) tabTextEl.textContent = 'CHAT EN VIVO';
    if (pulseEl) pulseEl.style.display = 'inline-block';
    if (badgeEl) badgeEl.textContent = '🔴 Chat del Directo';
    if (tagEl) {
      tagEl.textContent = 'EN VIVO';
      tagEl.style.display = 'inline-block';
      tagEl.style.background = '#ef4444';
      tagEl.style.color = '#ffffff';
    }
    if (noticeEl) noticeEl.style.display = 'none';
    if (activeBodyEl) activeBodyEl.style.display = 'flex';
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.placeholder = 'Escribe un comentario respetuoso...';
    }
    if (sendBtn) sendBtn.disabled = false;
    if (hintEl) hintEl.textContent = '⚽ Deportes sin insultos';
  } else {
    state.chatMode = 'club';
    const club = getEventClub(currentEvt);
    const clubId = club ? (club.id || club.name) : (currentEvt ? (currentEvt.club_name || currentEvt.home_team) : 'club');
    const clubName = club ? club.name : (currentEvt ? (currentEvt.club_name || currentEvt.home_team || 'Club') : 'Club');
    const clubIcon = (club && club.shield_icon) ? club.shield_icon : '🛡️';

    state.activeClubChatId = clubId;
    state.activeClubChatName = clubName;

    if (dotEl) dotEl.style.display = 'none';
    if (tabTextEl) tabTextEl.textContent = 'Comunidad / Club';
    if (pulseEl) pulseEl.style.display = 'none';
    if (badgeEl) badgeEl.textContent = `💬 Muro de la Afición - ${clubName} ${clubIcon}`;
    if (tagEl) {
      tagEl.textContent = 'COMUNIDAD';
      tagEl.style.display = 'inline-block';
      tagEl.style.background = '#3b82f6';
      tagEl.style.color = '#ffffff';
    }
    if (noticeEl) noticeEl.style.display = 'none';
    if (activeBodyEl) activeBodyEl.style.display = 'flex';
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.placeholder = `Escribe un mensaje de apoyo a ${clubName}...`;
    }
    if (sendBtn) sendBtn.disabled = false;
    if (hintEl) hintEl.textContent = `🛡️ Muro permanente de ${clubName} • 24/7`;
  }

  // Sustituir campo de texto por aviso inactivo en modo invitado (solo lectura)
  const inputForm = document.getElementById('chat-input-form');
  const guestPrompt = document.getElementById('chat-guest-prompt');
  const guestPromptText = document.getElementById('chat-guest-prompt-text');

  if (!isSportsLiveAuthenticated()) {
    if (inputForm) inputForm.style.display = 'none';
    if (guestPrompt) {
      guestPrompt.style.display = 'flex';
      if (guestPromptText) {
        guestPromptText.textContent = isLive
          ? 'Inicia sesión para comentar en directo'
          : 'Inicia sesión para escribir en el Muro de la Afición';
      }
    }
  } else {
    if (inputForm) inputForm.style.display = 'flex';
    if (guestPrompt) guestPrompt.style.display = 'none';
  }
}

async function loadActiveChatContent() {
  const currentEvt = getCurrentFeaturedEvent();
  if (state.chatMode === 'live' && currentEvt && currentEvt.status === 'LIVE') {
    await fetchChatMessages(currentEvt.id);
  } else if (state.chatMode === 'club') {
    const clubId = state.activeClubChatId || (currentEvt ? (currentEvt.club_name || currentEvt.home_team) : null);
    if (clubId) {
      await fetchClubCommunityMessages(clubId);
    }
  }
}

async function fetchChatMessages(eventId) {
  if (!eventId) return;
  try {
    const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/chat`);
    if (res.ok) {
      const msgs = await res.json();
      state.chatMessages = Array.isArray(msgs) ? msgs : [];
      state.chatEventId = eventId;
      renderChatMessages(state.chatMessages, false);
    }
  } catch (err) {
    console.warn('Error al obtener mensajes de chat:', err);
  }
}

async function fetchClubCommunityMessages(clubId) {
  if (!clubId) return;
  try {
    const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/chat`);
    if (res.ok) {
      const msgs = await res.json();
      state.chatMessages = Array.isArray(msgs) ? msgs : [];
      renderChatMessages(state.chatMessages, true);
    }
  } catch (err) {
    console.warn('Error al obtener mensajes del muro del club:', err);
  }
}

function renderChatMessages(messages, isClubWall = false) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  if (!messages || messages.length === 0) {
    const emptyNotice = isClubWall
      ? '💬 Muro de la Afición abierto.<br>¡Sé el primero en dejar ánimos al club!'
      : '💬 ¡Sé el primero en animar a los equipos en este directo!';
    container.innerHTML = `
      <div style="text-align: center; color: #94a3b8; font-size: 0.8rem; padding: 2rem 1rem;">
        ${emptyNotice}
      </div>
    `;
    return;
  }

  const html = messages.map(msg => {
    const role = (msg.user_role || 'viewer').toLowerCase();
    let roleClass = '';
    let roleBadge = '';

    if (role === 'admin') {
      roleClass = 'role-admin';
      roleBadge = '<span class="chat-author-badge badge-role-admin">👑 Admin</span>';
    } else if (role === 'club') {
      roleClass = 'role-club';
      roleBadge = '<span class="chat-author-badge badge-role-club">🛡️ Club</span>';
    }

    let timeStr = '';
    if (msg.created_at) {
      try {
        const d = new Date(msg.created_at);
        if (!isNaN(d.getTime())) {
          timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
          timeStr = String(msg.created_at).slice(11, 16);
        }
      } catch (_) {
        timeStr = '';
      }
    }

    const authorName = escapeHtml(msg.user_name || 'Aficionado');
    const msgContent = escapeHtml(msg.message || '');

    return `
      <div class="chat-message-item ${roleClass}">
        <div class="chat-msg-header">
          <div class="chat-msg-author">
            <span>${authorName}</span>
            ${roleBadge}
          </div>
          <span class="chat-msg-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="chat-msg-text">${msgContent}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function stopChatPolling() {
  if (state.chatPollTimer) {
    clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  }
}

function startChatPolling() {
  stopChatPolling();
  state.chatPollTimer = setInterval(() => {
    if (state.sidebarTab !== 'chat') {
      stopChatPolling();
      return;
    }
    const currentEvt = getCurrentFeaturedEvent();
    const isLive = Boolean(currentEvt && currentEvt.status === 'LIVE');
    if (isLive && state.chatMode === 'live') {
      fetchChatMessages(currentEvt.id);
    } else if (!isLive && state.chatMode === 'club') {
      const clubId = state.activeClubChatId || (currentEvt ? (currentEvt.club_name || currentEvt.home_team) : null);
      if (clubId) fetchClubCommunityMessages(clubId);
    } else {
      updateChatVisibility();
      loadActiveChatContent();
    }
  }, 3500);
}

async function handleSendChatMessage(e) {
  if (e && e.preventDefault) e.preventDefault();

  // Bloqueo de captación: Si el usuario es un invitado no registrado, no permitir enviar mensajes
  if (!state.currentUser) {
    openGuestLeadModal('chat');
    return;
  }

  const currentEvt = getCurrentFeaturedEvent();

  const inputEl = document.getElementById('chat-message-input');
  const text = (inputEl ? inputEl.value : '').trim();
  if (!text) return;

  // 1. Control antispam / Cooldown de 3 segundos por usuario
  const now = Date.now();
  const elapsed = (now - (state.lastChatSendTime || 0)) / 1000;
  if (elapsed < 3.0) {
    const remaining = (3.0 - elapsed).toFixed(1);
    const cdNotice = document.getElementById('chat-cooldown-notice');
    if (cdNotice) {
      cdNotice.textContent = `Espera ${remaining}s...`;
      setTimeout(() => { if (cdNotice.textContent.includes('Espera')) cdNotice.textContent = ''; }, 2000);
    }
    if (typeof showToast === 'function') {
      showToast(`Debes esperar ${remaining}s antes de enviar otro mensaje`, 'warning');
    }
    return;
  }

  // 2. Filtro estricto de moderación en cliente
  if (checkOffensiveLanguageClient(text)) {
    const errorNotice = 'Tu comentario infringe las normas de respeto deportivo de SportsLive';
    if (typeof showToast === 'function') {
      showToast(errorNotice, 'error');
    } else {
      alert(errorNotice);
    }
    return;
  }

  // 3. Obtener nombre y rol de autor identificado
  let authorName = 'Aficionado';
  if (state.currentUser) {
    authorName = state.currentUser.full_name || state.currentUser.username || 'Aficionado';
  }

  const sendBtn = document.getElementById('btn-chat-send');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
      headers['Authorization'] = 'Bearer ' + state.token;
    }

    let url = '';
    const isLive = Boolean(currentEvt && currentEvt.status === 'LIVE');
    if (isLive && state.chatMode === 'live') {
      url = `/api/events/${encodeURIComponent(currentEvt.id)}/chat`;
    } else {
      const clubId = state.activeClubChatId || (currentEvt ? (currentEvt.club_name || currentEvt.home_team) : 'club');
      url = `/api/clubs/${encodeURIComponent(clubId)}/chat`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        message: text,
        user_name: authorName
      })
    });

    if (res.status === 201) {
      state.lastChatSendTime = Date.now();
      if (inputEl) inputEl.value = '';
      const created = await res.json();
      state.chatMessages.push(created);
      renderChatMessages(state.chatMessages, state.chatMode === 'club');

      const cdNotice = document.getElementById('chat-cooldown-notice');
      if (cdNotice) {
        cdNotice.textContent = '⏳ Cooldown 3s';
        setTimeout(() => {
          if (cdNotice && cdNotice.textContent === '⏳ Cooldown 3s') cdNotice.textContent = '';
        }, 3000);
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || 'No se pudo publicar el comentario';
      if (typeof showToast === 'function') {
        showToast(msg, 'error');
      } else {
        alert(msg);
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast('Error de conexión al enviar comentario', 'error');
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

window.checkOffensiveLanguageClient = checkOffensiveLanguageClient;
window.switchSidebarTab = switchSidebarTab;
window.updateChatVisibility = updateChatVisibility;
window.loadActiveChatContent = loadActiveChatContent;
window.fetchChatMessages = fetchChatMessages;
window.fetchClubCommunityMessages = fetchClubCommunityMessages;
window.renderChatMessages = renderChatMessages;
window.handleSendChatMessage = handleSendChatMessage;

/* ==========================================================
   2. PESTAÑAS Y BÚSQUEDA SECUNDARIA
   ========================================================== */

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      applyFilters();
    });
  });

  // Botón reset filtros
  const btnReset = document.getElementById('btn-reset-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      state.selectedCcaa = 'all';
      state.selectedProvince = 'all';
      state.selectedSport = 'all';
      state.selectedCategory = 'all';
      state.searchQuery = '';
      
      document.getElementById('filter-ccaa').value = 'all';
      document.getElementById('filter-province').value = 'all';
      document.getElementById('filter-sport').value = 'all';
      document.getElementById('filter-category').value = 'all';
      document.getElementById('search-input').value = '';
      document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
      
      localStorage.removeItem('talentolive_user_province');
      localStorage.removeItem('grada_user_province');
      updateGeoButtonLabel();
      applyFilters();
      showToast('Filtros restablecidos');
    });
  }
}

function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  let debounceTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      applyFilters();
    }, 300);
  });
}

/* ==========================================================
   3. LLAMADAS API Y RENDERIZADO DE PARTIDOS
   ========================================================== */

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const stats = await res.json();
      const liveBadge = document.getElementById('live-count-badge');
      const upcomingBadge = document.getElementById('upcoming-count-badge');
      const replayBadge = document.getElementById('replay-count-badge');
      const liveDotCounter = document.getElementById('live-dot-counter');

      if (liveBadge) liveBadge.textContent = stats.live_count;
      if (upcomingBadge) upcomingBadge.textContent = stats.upcoming_count;
      if (replayBadge) replayBadge.textContent = stats.replay_count;
      if (liveDotCounter) liveDotCounter.textContent = `${stats.live_count} partidos en directo`;
    }
  } catch (err) {
    console.warn('Error cargando estadísticas:', err);
  }
}

async function fetchEvents(force = false) {
  if (state.isFetchingEvents && !force) return;
  state.isFetchingEvents = true;

  const grid = document.getElementById('matches-grid');
  const countEl = document.getElementById('matches-header-count');

  if (grid && (!state.allEvents || state.allEvents.length === 0)) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
        <div class="pulsing-dot" style="margin: 0 auto 1rem; width: 16px; height: 16px;"></div>
        <p style="color: var(--text-muted);">Cargando retransmisiones...</p>
      </div>
    `;
    if (countEl) countEl.textContent = 'Cargando eventos...';
  }

  try {
    if (!state.allClubs || state.allClubs.length === 0) {
      try {
        await fetchClubs();
      } catch (_) {}
    }

    const res = await fetch('/api/events?portada=1');
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const events = await res.json();
    state.allEvents = limitEventsForPortada(
      Array.isArray(events) ? events.map(sanitizeEventSportAndClubData) : [],
      5
    );
    state.hasFetchedEvents = true;
  } catch (err) {
    console.error('Error al cargar partidos desde el servidor:', err);
    state.hasFetchedEvents = true;
    if (grid && (!state.allEvents || state.allEvents.length === 0)) {
      if (countEl) countEl.textContent = '0 retransmisiones';
      if (window.location.protocol === 'file:') {
        grid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>Aplicación abierta directamente como archivo local</h3>
            <p>Para cargar los partidos y la base de datos, ejecuta <strong>Iniciar_SportsLive.command</strong> o <strong>SportsLive.app</strong> y accede desde <strong>http://localhost:3000</strong>.</p>
          </div>
        `;
      } else {
        grid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>No se pudieron cargar los partidos</h3>
            <p>Por favor comprueba que el servidor de SportsLive esté en ejecución en <strong>http://localhost:3000</strong>.</p>
            <button class="btn-upload" style="margin: 1rem auto 0;" onclick="fetchEvents(true)">🔄 Reintentar conexión</button>
          </div>
        `;
      }
    }
  } finally {
    state.isFetchingEvents = false;
    updateSportsSelectorVisibility();
    applyFilters();
  }
}
window.fetchEvents = fetchEvents;

function renderEvents(events) {
  const grid = document.getElementById('matches-grid');
  if (!grid) return;

  if (!events || events.length === 0) {
    const isCcaaFiltered = state.selectedCcaa && state.selectedCcaa !== 'all';
    const emptyTitle = isCcaaFiltered 
      ? 'No hay emisiones disponibles en esta comunidad' 
      : 'No hay retransmisiones oficiales disponibles con estos filtros';
    const emptyDesc = isCcaaFiltered
      ? 'Actualmente no hay partidos en directo ni programados para este territorio. Selecciona otra comunidad autónoma o consulta todo el catálogo nacional.'
      : 'Prueba a cambiar de deporte, seleccionar otra comunidad autónoma o restablecer los filtros para descubrir más partidos en directo.';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3.5rem 1.5rem; text-align: center;">
        <div class="empty-icon" style="font-size: 3rem; margin-bottom: 1rem;">📍</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.6rem;">${emptyTitle}</h3>
        <p style="color: #94a3b8; font-size: 0.92rem; max-width: 480px; margin: 0 auto 1.5rem; line-height: 1.5;">${emptyDesc}</p>
        <button type="button" class="capsule-btn" style="margin: 0 auto;" onclick="resetAllFilters()">
          <span>🔄</span> <span>Ver todos los partidos</span>
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  events.forEach((evt, idx) => {
    const card = createMatchCard(evt, idx);
    grid.appendChild(card);
  });
}

function getSportIcon(sportId) {
  const icons = {
    futbol: '⚽',
    baloncesto: '🏀',
    futsal: '🥅',
    balonmano: '🤾',
    voleibol: '🏐',
    rugby: '🏉',
    padel_tenis: '🎾',
    hockey: '🏑',
    contacto: '🥊',
    boxeo_contacto: '🥊',
    boxeo: '🥊',
    mma: '🥊',
    kickboxing: '🥊',
    muay_thai: '🥊'
  };
  return icons[(sportId || '').toLowerCase()] || '🏅';
}

const DEFAULT_FUTBOL_THUMB = 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60';

function getSportDefaultThumbnail(evt) {
  const sportId = (evt.sport_id || 'futbol').toLowerCase();
  const sportIcon = escapeHtml(evt.sport_icon || getSportIcon(sportId));
  const genericThumbUrl = (typeof DEFAULT_GENERIC_SPORT_THUMBNAIL !== 'undefined')
    ? DEFAULT_GENERIC_SPORT_THUMBNAIL
    : DEFAULT_FUTBOL_THUMB;

  return `
    <div class="thumb-default-sport thumb-sport-${sportId}">
      <img src="${genericThumbUrl}" alt="Fútbol - SportsLive" class="card-thumb-generic-bg" loading="lazy">
      <div class="thumb-sport-watermark" aria-hidden="true">${sportIcon}</div>
      <div class="thumb-sport-pattern" aria-hidden="true"></div>
    </div>
  `;
}

function createMatchCard(evt, index = 0) {
  evt = sanitizeEventSportAndClubData(evt);
  const card = document.createElement('article');
  card.className = 'match-card';
  card.dataset.id = evt.id;

  const isLive = evt.status === 'LIVE';
  const isUpcoming = evt.status === 'UPCOMING';
  const isReplay = evt.status === 'REPLAY';
  const isFav = state.favorites.includes(evt.id);
  const isFavClub = isEventOfFavoriteClub(evt, state.favoriteClubs);

  // Formato de fecha / hora
  const dateObj = new Date(evt.date_time);
  const timeFormatted = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const dayFormatted = dateObj.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

  // Badge de estado
  let statusBadgeHtml = '';
  if (isLive) {
    statusBadgeHtml = `<span class="card-badge-status status-live"><span class="pulsing-dot" style="width:7px;height:7px;"></span> LIVE</span>`;
  } else if (isUpcoming) {
    statusBadgeHtml = `<span class="card-badge-status status-upcoming">⏳ ${escapeHtml(dayFormatted)} ${escapeHtml(timeFormatted)}</span>`;
  } else if (evt.content_type === 'press') {
    statusBadgeHtml = `<span class="card-badge-status" style="background:rgba(56,189,248,0.2); color:#38bdf8; border:1px solid rgba(56,189,248,0.4);">🎙️ PRENSA</span>`;
  } else if (evt.content_type === 'reel') {
    statusBadgeHtml = `<span class="card-badge-status" style="background:rgba(244,63,94,0.2); color:#f43f5e; border:1px solid rgba(244,63,94,0.4);">⚡ REEL</span>`;
  } else {
    statusBadgeHtml = `<span class="card-badge-status status-replay">📼 DIFERIDO</span>`;
  }

  // Banner de monetización del club protegido contra XSS
  let sponsorHtml = '';
  if (evt.sponsor_name) {
    sponsorHtml = `
      <a href="${sanitizeUrl(evt.sponsor_url)}" target="_blank" rel="noopener noreferrer" class="club-sponsor-strip" title="Patrocinador oficial de ${escapeHtml(evt.club_name || 'este club')}">
        <div class="sponsor-title">
          <span>${escapeHtml(evt.sponsor_logo || '🤝')}</span>
          <span>${escapeHtml(evt.sponsor_name)}</span>
        </div>
        <span class="sponsor-tag-pill">Patrocinador</span>
      </a>
    `;
  }

  const safeId = escapeHtml(evt.id);
  card.dataset.eventId = safeId;
  const venueText = escapeHtml(evt.location_venue || (evt.province_name + ', ' + evt.ccaa_name));
  const hasCustomThumb = evt.thumbnail && typeof evt.thumbnail === 'string' && evt.thumbnail.trim().length > 0;
  const defaultThumb = getSportDefaultThumbnail(evt);

  // Miniatura con imagen o fondo temático por categoría deportiva en lugar de recuadro negro
  let thumbHtml = '';
  if (hasCustomThumb) {
    const thumbUrl = sanitizeUrl(evt.thumbnail);
    thumbHtml = `
      <img class="card-thumb-img" src="${thumbUrl}" alt="${escapeHtml(evt.title)}" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
      <div class="thumb-fallback-wrapper" style="display:none; width:100%; height:100%;">
        ${defaultThumb}
      </div>
    `;
  } else {
    thumbHtml = `
      <div class="thumb-fallback-wrapper" style="display:flex; width:100%; height:100%;">
        ${defaultThumb}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="card-thumb-wrapper" onclick="loadFeaturedPlayerById('${safeId}')">
      ${thumbHtml}
      <div class="card-badges-top">
        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
          ${statusBadgeHtml}
          ${isFavClub ? '<span class="card-fav-team-badge">⭐ FAVORITO</span>' : ''}
        </div>
        <span class="card-badge-platform">${escapeHtml(evt.platform || 'Directo')}</span>
      </div>
      <div class="play-overlay-icon" aria-label="Reproducir">▶</div>
    </div>
    
    <div class="card-body">
      <h3 class="card-match-title" onclick="loadFeaturedPlayerById('${safeId}')" title="${escapeHtml(evt.title)}">
        ${escapeHtml(evt.title)}
      </h3>

      <div class="card-meta-line">
        <div class="card-tags">
          ${(() => {
            const isCombat = (evt.sport_id || '').toLowerCase() === 'contacto' || (evt.sport_name || '').toLowerCase().includes('contacto') || (evt.sport_name || '').toLowerCase().includes('boxeo');
            let badgeIcon = evt.sport_icon || '🏅';
            let badgeLabel = evt.sport_name || 'Deporte';
            let catSubtitle = evt.category_name || '';

            if (isCombat) {
              badgeIcon = '🥊';
              const mod = evt.discipline || evt.modality || evt.category_name || '';
              if (mod && mod.toLowerCase() !== 'todas' && mod.toLowerCase() !== 'all' && mod.toLowerCase() !== 'contacto') {
                badgeLabel = mod;
                catSubtitle = '';
              } else {
                badgeLabel = 'Boxeo y deportes de contacto';
                catSubtitle = '';
              }
            }

            return `
              <span class="sport-tag">${escapeHtml(badgeIcon)} ${escapeHtml(badgeLabel)}</span>
              ${catSubtitle ? `<span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(catSubtitle)}</span>` : ''}
            `;
          })()}
          ${isFavClub ? '<span class="card-fav-team-badge" style="font-size:0.65rem; padding:0.1rem 0.4rem;" title="Equipo o canal en tus favoritos">⭐ Siguiendo</span>' : ''}
        </div>
        ${(evt.club_id || evt.club_name) ? `
          <a href="club.html?club=${encodeURIComponent(evt.club_id || evt.club_name)}" class="club-badge-link" onclick="event.stopPropagation();" title="Ir a la página oficial de ${escapeHtml(evt.club_name || evt.home_team)}" style="text-decoration:none; font-size:0.75rem; color:#38bdf8; display:inline-flex; align-items:center; gap:4px; background:rgba(56,189,248,0.12); padding:2px 7px; border-radius:4px; border:1px solid rgba(56,189,248,0.3); font-weight:600;">
            <span>🛡️</span> <span>Canal Club</span>
          </a>
        ` : (evt.is_verified_club ? '<span class="verified-badge" title="Retransmisión oficial del club">🛡️ Club Verificado</span>' : '')}
      </div>

      ${(isLive && evt.home_score !== null && evt.away_score !== null) ? `
      <div class="card-teams-scoreboard" onclick="loadFeaturedPlayerById('${safeId}')" style="cursor:pointer;">
        <div style="display:flex; justify-content:space-between;">
          <div style="flex:1;">
            <div class="team-row">
              <span class="team-info">🛡️ ${escapeHtml(evt.home_team)}</span>
              <span class="team-score">${escapeHtml(evt.home_score)}</span>
            </div>
            <div class="team-row">
              <span class="team-info">🛡️ ${escapeHtml(evt.away_team)}</span>
              <span class="team-score">${escapeHtml(evt.away_score)}</span>
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      ${isLive ? `
      <div class="card-venue">
        <span>📍</span>
        <span class="truncate">${venueText}</span>
      </div>
      ` : ''}

      ${sponsorHtml}

      <div class="card-actions">
        <button class="btn-watch ${isUpcoming ? 'upcoming' : (isReplay ? 'replay' : '')}" onclick="loadFeaturedPlayerById('${safeId}')">
          ${isLive ? '🔴 Ver en Directo' : (isUpcoming ? '⏳ Cargar Partido' : ((evt.content_type === 'press' || evt.content_type === 'reel') ? '▶ Ver Vídeo' : '📼 Ver Repetición'))}
        </button>
        <button class="btn-bell ${isFav ? 'active' : ''}" onclick="toggleFavorite('${safeId}', event)" title="Avisarme 10 min antes del partido">
          ${isFav ? '🔔' : '🔕'}
        </button>
        ${(state.currentUser && (
          state.currentUser.role === 'admin' ||
          (state.currentUser.role === 'club' && state.currentUser.club_name && (
            (evt.club_name && evt.club_name.toLowerCase() === state.currentUser.club_name.toLowerCase()) ||
            (evt.home_team && evt.home_team.toLowerCase() === state.currentUser.club_name.toLowerCase())
          ))
        )) ? `
          <button class="action-btn-sm edit" onclick="event.stopPropagation(); openEditMatchModal('${safeId}')" title="Modificar retransmisión">
            ✏️
          </button>
        ` : ''}
      </div>
    </div>
  `;

  return card;
}

/* ==========================================================
   4. REPRODUCTOR EMBEBIDO Y FICHA DE PARTIDO (MODAL)
   ========================================================== */

async function openPlayerModal(eventId) {
  const modal = document.getElementById('player-modal');
  if (!modal) return;

  try {
    const res = await fetch(`/api/events/${eventId}`);
    if (!res.ok) throw new Error('No se encontró el evento');
    const evt = await res.json();
    state.activeModalEvent = evt;

    document.getElementById('player-modal-title').textContent = evt.title;
    
    // Iframe embebido adaptativo sanitizado sin autoplay
    const iframeContainer = document.getElementById('video-player-container');
    const cleanEmbedUrl = disableAutoplayInUrl(evt.embed_url);
    const safeEmbedUrl = sanitizeUrl(cleanEmbedUrl);
    iframeContainer.innerHTML = `
      <iframe 
        src="${safeEmbedUrl}" 
        title="${escapeHtml(evt.title)}"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
        allowfullscreen>
      </iframe>
    `;

    // Equipos y marcador
    const scoreDisplay = (evt.home_score !== null && evt.away_score !== null)
      ? `<span style="color:#fbbf24; background:rgba(0,0,0,0.4); padding:0.2rem 0.6rem; border-radius:6px;">${escapeHtml(evt.home_score)} - ${escapeHtml(evt.away_score)}</span>`
      : '<span style="color:var(--text-dim);">VS</span>';

    document.getElementById('player-teams').innerHTML = `
      <div style="font-size: 1.15rem; font-weight: 700; display:flex; align-items:center; gap: 0.75rem;">
        <span>${escapeHtml(evt.home_team)}</span>
        ${scoreDisplay}
        <span>${escapeHtml(evt.away_team)}</span>
      </div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.35rem; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
        <span>${escapeHtml(evt.sport_icon)} ${escapeHtml(evt.sport_name)}</span> • <span>${escapeHtml(evt.category_name)}</span> • <span>📍 ${escapeHtml(evt.location_venue || evt.province_name)}</span>
        ${(evt.club_id || evt.club_name) ? `• <a href="club.html?club=${encodeURIComponent(evt.club_id || evt.club_name)}" style="color:#60a5fa; text-decoration:none; font-weight:600;" title="Ver archivo histórico completo de este club">🏛️ Videoteca Completa del Club ↗</a>` : ''}
      </div>
    `;

    // Espacio de patrocinador del club sanitizado o reclamo comercial para anunciantes
    const sponsorContainer = document.getElementById('player-sponsor-container');
    if (sponsorContainer) {
      if (evt.sponsor_name && String(evt.sponsor_name).trim().length > 0) {
        const ctaBtn = evt.sponsor_url
          ? `<a href="${sanitizeUrl(evt.sponsor_url)}" target="_blank" rel="noopener noreferrer" class="btn-sponsor-cta">Visitar Web</a>`
          : '';
        sponsorContainer.innerHTML = `
          <div class="player-sponsor-showcase">
            <div class="sponsor-highlight-info">
              <div class="sponsor-highlight-icon">${escapeHtml(evt.sponsor_logo || '🤝')}</div>
              <div>
                <div style="font-size:0.75rem; color:#fde68a; font-weight:700; text-transform:uppercase;">Espacio de Patrocinio del Club</div>
                <div style="font-size:1rem; font-weight:800; color:white;">${escapeHtml(evt.sponsor_name)}</div>
                <div style="font-size:0.8rem; color:#fef08a;">Apoyando el deporte base local</div>
              </div>
            </div>
            ${ctaBtn}
          </div>
        `;
        sponsorContainer.style.display = 'block';
      } else {
        sponsorContainer.innerHTML = `
          <div class="featured-sponsor-promo-bar" onclick="openSponsorModal(event)" onkeydown="if(event.key==='Enter'||event.key===' '){openSponsorModal(event);}" role="button" tabindex="0" title="📢 ¿Quieres poner tu empresa aquí? Haz clic y solicita tu publicidad" style="cursor: pointer; margin: 0.5rem 0;">
            <div class="promo-bar-left">
              <span class="promo-bar-icon">📢</span>
              <span class="promo-bar-text">¿Quieres poner tu empresa aquí? <strong class="promo-bar-link">Haz clic y solicita tu publicidad</strong></span>
            </div>
          </div>
        `;
        sponsorContainer.style.display = 'block';
      }
    }

    // Botón de favoritos del modal
    const isFav = state.favorites.includes(evt.id);
    const favBtn = document.getElementById('btn-modal-fav');
    if (favBtn) {
      favBtn.innerHTML = isFav ? '🔔 Equipo en favoritos' : '🔕 Seguir equipo (Aviso 10 min antes)';
      favBtn.onclick = (e) => toggleFavorite(evt.id, e, true);
    }

    // Botón de reporte
    const reportBtn = document.getElementById('btn-modal-report');
    if (reportBtn) {
      reportBtn.onclick = () => reportEventPrompt(evt.id);
    }

    // Botón de edición en modal si tiene permisos
    let editModalBtn = document.getElementById('btn-modal-edit-match');
    const canEditEvt = state.currentUser && (
      state.currentUser.role === 'admin' ||
      (state.currentUser.role === 'club' && state.currentUser.club_name && (
        (evt.club_name && evt.club_name.toLowerCase() === state.currentUser.club_name.toLowerCase()) ||
        (evt.home_team && evt.home_team.toLowerCase() === state.currentUser.club_name.toLowerCase())
      ))
    );

    const toolbar = document.querySelector('.player-actions-toolbar');
    if (toolbar) {
      // Botón a la Ficha del Club / Videoteca Completa
      let clubProfileBtn = document.getElementById('btn-modal-club-profile');
      if (!clubProfileBtn) {
        clubProfileBtn = document.createElement('a');
        clubProfileBtn.id = 'btn-modal-club-profile';
        clubProfileBtn.className = 'toolbar-btn';
        clubProfileBtn.style.textDecoration = 'none';
        clubProfileBtn.style.color = '#93c5fd';
        clubProfileBtn.style.borderColor = 'rgba(59, 130, 246, 0.5)';
        clubProfileBtn.style.background = 'rgba(59, 130, 246, 0.15)';
        clubProfileBtn.title = 'Acceder a la ficha monográfica y videoteca completa del club';
        toolbar.appendChild(clubProfileBtn);
      }
      const clubIdOrName = evt.club_id || evt.club_name;
      if (clubIdOrName) {
        clubProfileBtn.href = `club.html?club=${encodeURIComponent(clubIdOrName)}`;
        clubProfileBtn.innerHTML = `🏛️ Ficha del Club / Videoteca Completa ↗`;
        clubProfileBtn.style.display = 'inline-flex';
      } else {
        clubProfileBtn.style.display = 'none';
      }

      if (!editModalBtn) {
        editModalBtn = document.createElement('button');
        editModalBtn.id = 'btn-modal-edit-match';
        editModalBtn.className = 'toolbar-btn';
        editModalBtn.style.borderColor = 'rgba(59, 130, 246, 0.5)';
        editModalBtn.style.color = '#93c5fd';
        toolbar.insertBefore(editModalBtn, toolbar.firstChild);
      }
      if (canEditEvt) {
        editModalBtn.style.display = 'inline-flex';
        editModalBtn.innerHTML = '✏️ Modificar Retransmisión';
        editModalBtn.onclick = () => {
          closePlayerModal();
          openEditMatchModal(evt.id);
        };
      } else {
        editModalBtn.style.display = 'none';
      }
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast('Error abriendo el reproductor: ' + err.message, 'error');
  }
}

function closePlayerModal() {
  const modal = document.getElementById('player-modal');
  if (!modal) return;
  modal.classList.remove('active');
  document.body.style.overflow = '';
  // Limpiar iframe para detener la reproducción de audio en segundo plano
  const iframeContainer = document.getElementById('video-player-container');
  if (iframeContainer) iframeContainer.innerHTML = '';
}

/* ==========================================================
   5. INGESTA RÁPIDA CON AUTO-EXTRACCIÓN DE METADATOS
   ========================================================== */

function initIngestionForm() {
  const urlInput = document.getElementById('ingest-url');
  const previewBox = document.getElementById('url-preview-card');
  const previewThumb = document.getElementById('preview-thumb');
  const previewTitle = document.getElementById('preview-title');
  const previewChannel = document.getElementById('preview-channel');

  // Rellenar selectores del formulario de creación
  const formCcaa = document.getElementById('ingest-ccaa');
  const formSport = document.getElementById('ingest-sport');

  if (formCcaa) {
    formCcaa.innerHTML = '';
    GEO_CATALOG.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      formCcaa.appendChild(opt);
    });
    formCcaa.addEventListener('change', (e) => {
      updateProvinceDropdown(e.target.value, 'ingest-province');
    });
    updateProvinceDropdown('madrid', 'ingest-province');
    formCcaa.value = 'madrid';
  }

  if (formSport) {
    formSport.innerHTML = '';
    SPORTS_CATALOG.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.icon} ${s.name}`;
      formSport.appendChild(opt);
    });
    formSport.addEventListener('change', (e) => {
      const sp = e.target.value;
      updateCategoryDropdown(sp, 'ingest-category');
      const formDisciplineWrap = document.getElementById('ingest-discipline-wrap');
      const formCategoryWrap = document.getElementById('ingest-category-wrap');
      if (formDisciplineWrap) {
        formDisciplineWrap.style.display = (sp === 'contacto') ? 'block' : 'none';
      }
      if (formCategoryWrap) {
        formCategoryWrap.style.display = (sp === 'contacto') ? 'none' : 'block';
      }
    });
    updateCategoryDropdown('futbol', 'ingest-category');
    const initDisciplineWrap = document.getElementById('ingest-discipline-wrap');
    if (initDisciplineWrap) initDisciplineWrap.style.display = 'none';
  }

  // Autodetección al pegar o escribir enlace de YouTube / Twitch
  let debounceUrl;
  urlInput.addEventListener('input', (e) => {
    clearTimeout(debounceUrl);
    const url = e.target.value.trim();
    if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('twitch.tv'))) {
      if (previewBox) previewBox.style.display = 'none';
      return;
    }

    debounceUrl = setTimeout(async () => {
      if (previewBox) {
        previewBox.style.display = 'flex';
        previewTitle.textContent = 'Analizando enlace con la API oficial...';
        previewChannel.textContent = 'Extrayendo miniatura y título...';
      }

      try {
        const res = await fetch('/api/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        if (res.ok) {
          const meta = await res.json();
          previewThumb.src = meta.thumbnail;
          previewTitle.textContent = meta.title;
          previewChannel.textContent = `${meta.platform.toUpperCase()} • ${meta.channel_name}`;
          
          // Pre-llenar título del evento si está vacío
          const titleField = document.getElementById('ingest-title');
          if (titleField && !titleField.value) {
            titleField.value = meta.title;
          }

          // Guardar metadatos en dataset para el envío
          urlInput.dataset.embedUrl = meta.embed_url;
          urlInput.dataset.embedId = meta.embed_id;
          urlInput.dataset.platform = meta.platform;
          urlInput.dataset.thumbnail = meta.thumbnail;
        }
      } catch (err) {
        console.warn('Error extrayendo metadatos:', err);
      }
    }, 450);
  });

  // Envío del formulario oficial de club
  const form = document.getElementById('form-add-match');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const clubNameVal = (document.getElementById('ingest-club-name')?.value || '').trim();
      const homeTeamVal = (document.getElementById('ingest-home-team')?.value || '').trim();
      const awayTeamVal = (document.getElementById('ingest-away-team')?.value || '').trim();
      const clubFinalName = clubNameVal || (state.currentUser && state.currentUser.club_name) || homeTeamVal;

      if (!clubFinalName) {
        showToast('Debes indicar el Nombre del Club / Organizador Registrado.', 'error');
        document.getElementById('ingest-club-name')?.focus();
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Publicando Emisión Oficial...';

      const payload = {
        title: document.getElementById('ingest-title').value.trim() || `${homeTeamVal} vs ${awayTeamVal}`,
        url_original: urlInput.value.trim(),
        embed_url: urlInput.dataset.embedUrl || '',
        embed_id: urlInput.dataset.embedId || '',
        platform: urlInput.dataset.platform || 'youtube',
        thumbnail: urlInput.dataset.thumbnail || '',
        status: document.getElementById('ingest-status').value,
        date_time: document.getElementById('ingest-datetime').value || new Date().toISOString(),
        sport_id: document.getElementById('ingest-sport').value,
        category_id: (document.getElementById('ingest-sport').value === 'contacto' && document.getElementById('ingest-discipline'))
          ? (document.getElementById('ingest-discipline').value.toLowerCase().replace(/\s+/g, '_'))
          : document.getElementById('ingest-category').value,
        modality: (document.getElementById('ingest-sport').value === 'contacto' && document.getElementById('ingest-discipline'))
          ? document.getElementById('ingest-discipline').value
          : '',
        discipline: (document.getElementById('ingest-sport').value === 'contacto' && document.getElementById('ingest-discipline'))
          ? document.getElementById('ingest-discipline').value
          : '',
        province_id: document.getElementById('ingest-province').value,
        home_team: homeTeamVal,
        away_team: awayTeamVal,
        location_venue: (document.getElementById('ingest-venue')?.value || '').trim(),
        is_verified_club: true,
        club_name: clubFinalName,
        sponsor_name: (document.getElementById('ingest-sponsor-name')?.value || '').trim(),
        sponsor_url: (document.getElementById('ingest-sponsor-url')?.value || '').trim(),
        sponsor_logo: '⭐'
      };

      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: getAuthHeaders(true),
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Error al guardar el partido');
        }
        const newEvent = await res.json();
        
        closeIngestionModal();
        form.reset();
        if (previewBox) previewBox.style.display = 'none';
        showToast(`¡Emisión oficial de ${escapeHtml(clubFinalName)} publicada con éxito!`, 'success');

        // Refrescar lista de partidos y estadísticas
        fetchStats();
        await fetchEvents();

        // Incrustar inmediatamente en el reproductor principal grande oficial para que las visitas cuenten
        if (newEvent && typeof loadFeaturedPlayer === 'function') {
          loadFeaturedPlayer(newEvent);
        }
      } catch (err) {
        showToast('No se pudo publicar la emisión: ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Publicar Emisión Oficial en SportsLive';
      }
    });
  }
}

function openIngestionModal() {
  if (typeof closeMobileNav === 'function') closeMobileNav();
  const modal = document.getElementById('add-match-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Si el usuario es club, pre-rellenar el nombre del club y el equipo local
    const clubInput = document.getElementById('ingest-club-name');
    const homeTeamInput = document.getElementById('ingest-home-team');
    if (state.currentUser && state.currentUser.role === 'club' && state.currentUser.club_name) {
      if (clubInput && !clubInput.value) {
        clubInput.value = state.currentUser.club_name;
      }
      if (homeTeamInput && !homeTeamInput.value) {
        homeTeamInput.value = state.currentUser.club_name;
      }
    }

    // Poner fecha/hora actual por defecto en el input
    const dateInput = document.getElementById('ingest-datetime');
    if (dateInput && !dateInput.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dateInput.value = now.toISOString().slice(0, 16);
    }
  }
}

function closeIngestionModal() {
  const modal = document.getElementById('add-match-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/* ==========================================================
   6. GEOLOCALIZACIÓN Y SELECTOR DE PROVINCIA
   ========================================================== */

function detectUserLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Reverse-geocoding aproximado por coordenadas
        const lat = pos.coords.latitude;
        let detected = 'madrid';
        if (lat > 41.5) detected = 'barcelona';
        else if (lat < 38.0) detected = 'sevilla';
        else if (lat > 39.0 && lat < 40.0) detected = 'valencia';
        
        if (state.selectedProvince !== detected) {
          state.selectedProvince = detected;
          localStorage.setItem('talentolive_user_province', detected);
          updateGeoButtonLabel();
          syncCcaaFromProvince(detected);
          applyFilters();
          showToast(`Ubicación detectada: ${getProvinceName(detected)}`);
        }
      },
      (err) => {
        if (!state.selectedProvince) {
          state.selectedProvince = 'all';
          updateGeoButtonLabel();
        }
      },
      { timeout: 4000 }
    );
  }
}

function syncCcaaFromProvince(provId) {
  if (!provId || provId === 'all') return;
  for (const ccaa of GEO_CATALOG) {
    if (ccaa.provinces.some(p => p.id === provId)) {
      state.selectedCcaa = ccaa.id;
      const ccaaSelect = document.getElementById('filter-ccaa');
      if (ccaaSelect) ccaaSelect.value = ccaa.id;
      updateProvinceDropdown(ccaa.id);
      const provSelect = document.getElementById('filter-province');
      if (provSelect) provSelect.value = provId;
      break;
    }
  }
}

function getProvinceName(provId) {
  for (const c of GEO_CATALOG) {
    for (const p of c.provinces) {
      if (p.id === provId) return p.name;
    }
  }
  return 'Toda España';
}

function updateGeoButtonLabel() {
  const geoLabel = document.getElementById('current-geo-label');
  if (geoLabel) {
    if (state.selectedProvince === 'all') {
      geoLabel.textContent = 'Toda España';
    } else {
      geoLabel.textContent = getProvinceName(state.selectedProvince);
    }
  }
}

function openGeoModal() {
  const modal = document.getElementById('geo-modal');
  if (!modal) return;
  
  const listContainer = document.getElementById('geo-provinces-list');
  listContainer.innerHTML = `
    <button class="geo-picker-btn ${state.selectedProvince === 'all' ? 'active' : ''}" onclick="selectProvinceFromModal('all')">
      🇪🇸 Toda España (Ver todo el deporte base)
    </button>
  `;

  GEO_CATALOG.forEach(ccaa => {
    const section = document.createElement('div');
    section.style.margin = '0.85rem 0 0.4rem';
    section.innerHTML = `<h4 style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:0.4rem;">${escapeHtml(ccaa.name)}</h4>`;
    
    const provsGrid = document.createElement('div');
    provsGrid.style.display = 'grid';
    provsGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(140px, 1fr))';
    provsGrid.style.gap = '0.4rem';

    ccaa.provinces.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `geo-picker-btn ${state.selectedProvince === p.id ? 'active' : ''}`;
      btn.textContent = p.name;
      btn.onclick = () => selectProvinceFromModal(p.id);
      provsGrid.appendChild(btn);
    });

    section.appendChild(provsGrid);
    listContainer.appendChild(section);
  });

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function selectProvinceFromModal(provId) {
  state.selectedProvince = provId;
  localStorage.setItem('talentolive_user_province', provId);
  updateGeoButtonLabel();
  syncCcaaFromProvince(provId);
  
  const provSelect = document.getElementById('filter-province');
  if (provSelect) provSelect.value = provId;

  closeGeoModal();
  applyFilters();
  showToast(`Región fijada: ${getProvinceName(provId)}`);
}

function closeGeoModal() {
  const modal = document.getElementById('geo-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/* ==========================================================
   7. FAVORITOS Y ALERTAS PUSH (10 MINUTOS ANTES)
   ========================================================== */

function initNotificationScheduler() {
  // Comprobación periódica cada 30 segundos
  setInterval(checkUpcomingFavoriteMatches, 30000);
  // Y comprobación rápida inicial
  setTimeout(checkUpcomingFavoriteMatches, 2500);
}

function checkUpcomingFavoriteMatches() {
  if (!state.favorites || state.favorites.length === 0) return;
  if (!state.events || state.events.length === 0) return;

  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  state.favorites.forEach(favId => {
    const evt = state.events.find(e => e.id === favId);
    if (!evt) return;

    if (evt.status === 'UPCOMING' || evt.status === 'LIVE') {
      const matchTime = new Date(evt.date_time).getTime();
      const diffMs = matchTime - now;

      // Si falta entre 0 y 10 minutos (o si acaba de comenzar hace menos de 5 min)
      if (diffMs <= TEN_MINUTES_MS && diffMs > -5 * 60 * 1000) {
        if (!notifiedMatches.has(evt.id)) {
          notifiedMatches.add(evt.id);
          sessionStorage.setItem('talentolive_notified_matches', JSON.stringify(Array.from(notifiedMatches)));
          triggerMatchReminderNotification(evt, diffMs);
        }
      }
    }
  });
}

function triggerMatchReminderNotification(evt, diffMs) {
  const minutesLeft = Math.max(1, Math.round(diffMs / 60000));
  const title = diffMs > 0 
    ? `🚨 ¡Partido en 10 minutos!` 
    : `🔴 ¡El partido ha comenzado!`;
  const body = `${evt.home_team} vs ${evt.away_team} (${evt.sport_name} - ${evt.category_name})`;

  // 1. Notificación nativa Web Push del navegador
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, {
        body: body,
        icon: evt.thumbnail || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60',
        tag: `talentolive-${evt.id}`
      });
      notif.onclick = () => {
        window.focus();
        openPlayerModal(evt.id);
      };
    } catch (e) {
      console.warn('Error al disparar notificación del navegador:', e);
    }
  }

  // 2. Banner visual y sonoro in-app garantizado
  showInAppMatchAlert(evt, title, body);
}

function showInAppMatchAlert(evt, title, body) {
  let container = document.getElementById('match-alert-banner-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'match-alert-banner-container';
    container.className = 'match-alert-banner-container';
    document.body.appendChild(container);
  }

  const alertCard = document.createElement('div');
  alertCard.className = 'match-alert-card';
  const safeId = escapeHtml(evt.id);
  alertCard.innerHTML = `
    <div class="alert-icon-pulse">🔔</div>
    <div style="flex: 1;">
      <h4 style="font-size: 0.95rem; font-weight: 800; color: #fef08a; margin-bottom: 0.2rem;">${escapeHtml(title)}</h4>
      <p style="font-size: 0.84rem; color: #f1f5f9; margin-bottom: 0.5rem;">${escapeHtml(body)}</p>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button class="btn-watch-alert" onclick="openPlayerModal('${safeId}'); this.closest('.match-alert-card').remove();">
          ▶ Ver Emisión
        </button>
        <button class="btn-dismiss-alert" onclick="this.closest('.match-alert-card').remove()">
          Descartar
        </button>
      </div>
    </div>
  `;
  container.appendChild(alertCard);

  // Auto-descartar después de 25 segundos
  setTimeout(() => {
    if (alertCard && alertCard.parentNode) {
      alertCard.style.opacity = '0';
      alertCard.style.transform = 'translateY(-10px)';
      setTimeout(() => alertCard.remove(), 400);
    }
  }, 25000);
}

function toggleFavorite(eventId, event, fromModal = false) {
  if (event) event.stopPropagation();

  // Bloqueo de captación: Si es un visitante no autenticado, mostrar modal de registro/login
  if (!isSportsLiveAuthenticated()) {
    openGuestLeadModal('favorites');
    return;
  }


  const idx = state.favorites.indexOf(eventId);
  let isNowFav = false;

  if (idx > -1) {
    state.favorites.splice(idx, 1);
    showToast('Partido eliminado de tus favoritos');
  } else {
    state.favorites.push(eventId);
    isNowFav = true;
    showToast('🔔 Alerta programada: Te avisaremos 10 min antes del partido', 'success');
    
    // Solicitar permiso de notificación del navegador si aplica
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // Comprobar inmediatamente por si el partido ya está en la ventana de 10 min
    setTimeout(checkUpcomingFavoriteMatches, 300);
  }

  saveUserFavorites('matches');

  const hasFavClubs = state.favoriteClubs && state.favoriteClubs.length > 0;
  const hasFavMatches = state.favorites && state.favorites.length > 0;
  if (hasFavClubs || hasFavMatches) {
    state.favoritesOnlyMode = true;
  } else {
    state.favoritesOnlyMode = false;
  }

  // Actualizar icono en la tarjeta
  const card = document.querySelector(`.match-card[data-id="${eventId}"] .btn-bell`);
  if (card) {
    card.classList.toggle('active', isNowFav);
    card.innerHTML = isNowFav ? '🔔' : '🔕';
  }

  // Si se pulsó desde el modal de detalle
  if (fromModal) {
    const favBtn = document.getElementById('btn-modal-fav');
    if (favBtn) {
      favBtn.innerHTML = isNowFav ? '🔔 Equipo en favoritos' : '🔕 Seguir equipo (Aviso 10 min antes)';
    }
  }

  // Actualizar reactivamente la vista principal de inmediato sin recargar
  updateFilterButtonsVisual();
  updateActiveFilterIndicator();
  applyFilters();
}
window.toggleFavorite = toggleFavorite;

/* ==========================================================
   8. MODERACIÓN Y REPORTES COMUNITARIOS
   ========================================================== */

async function reportEventPrompt(eventId) {
  const reason = prompt('¿Cuál es el motivo del reporte? (Ej: Vídeo caído, spam, contenido inapropiado):', 'Emisión no disponible');
  if (!reason) return;

  try {
    const res = await fetch(`/api/events/${eventId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (res.ok) {
      showToast('Reporte enviado a moderación. Gracias por ayudar a la comunidad.', 'success');
      closePlayerModal();
      fetchStats();
      fetchEvents();
    }
  } catch (err) {
    showToast('No se pudo enviar el reporte', 'error');
  }
}

function shareCurrentEvent() {
  if (!state.activeModalEvent) return;
  const shareData = {
    title: state.activeModalEvent.title,
    text: `¡Sigue en directo: ${state.activeModalEvent.title} en SportsLive!`,
    url: window.location.href
  };

  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.href);
    showToast('Enlace copiado al portapapeles');
  }
}

/* ==========================================================
   9. TOASTS Y MODALES GENÉRICOS
   ========================================================== */

function initModals() {
  // Manejo de eventos en contenedores modales para máxima compatibilidad con el teclado táctil de iPadOS / iOS
  ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(evtType => {
    document.querySelectorAll('.modal-content').forEach(content => {
      content.addEventListener(evtType, (e) => {
        // Asegurar que NINGÚN listener aplique preventDefault() cuando el target sea un elemento INPUT, TEXTAREA o BUTTON
        // y permitir la propagación natural del evento al navegador nativo para despliegue inmediato del teclado táctil en iPadOS
        if (e.target && e.target.closest('input, textarea, select, button, a, label')) {
          return;
        }
        // Aislar clics en el fondo del modal para no cerrar el overlay
        if (evtType === 'click') {
          e.stopPropagation();
        }
      }, { passive: true });
    });
  });

  // Cerrar modales con clic fuera (overlay)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      // Si el clic/tap ocurrió dentro de un control interactivo (input, textarea, button), permitir propagación natural
      if (e.target && e.target.closest('input, textarea, select, button, a, label')) {
        return;
      }
      if (e.target === overlay) {
        if (overlay.id === 'favorites-modal') {
          closeFavoritesModal();
        } else {
          overlay.classList.remove('active');
          document.body.style.overflow = '';
          const iframe = document.getElementById('video-player-container');
          if (iframe) iframe.innerHTML = '';
        }
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const favModal = document.getElementById('favorites-modal');
      if (favModal && favModal.classList.contains('active')) {
        closeFavoritesModal();
      }
      document.querySelectorAll('.modal-overlay.active').forEach(m => {
        if (m.id !== 'favorites-modal') {
          m.classList.remove('active');
          const iframe = document.getElementById('video-player-container');
          if (iframe) iframe.innerHTML = '';
        }
      });
      document.body.style.overflow = '';
      if (typeof closeAllCapsuleDropdowns === 'function') closeAllCapsuleDropdowns();
      if (typeof closeMobileNav === 'function') closeMobileNav();
    }
  });
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️')}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => { if (toast && typeof toast.remove === 'function') toast.remove(); }, 300);
  }, 3500);
}

async function exportAppToShare() {
  showToast('📦 Empaquetando la aplicación en la carpeta compartir...', 'info');
  try {
    const res = await fetch('/api/export', { method: 'POST' });
    if (!res.ok) throw new Error('Error al generar la exportación');
    const data = await res.json();
    showToast('✨ Paquete listo en la carpeta "compartir" (ZIP y JSON)', 'success');
  } catch (err) {
    showToast('No se pudo exportar: ' + err.message, 'error');
  }
}

/* ==========================================================
   7. AUTENTICACIÓN, GESTIÓN DE ROLES Y SESIONES
   ========================================================== */

async function initAuthSession() {
  if (!state.token) {
    state.currentUser = null;
    loadUserFavorites();
    renderUserHeader();
    updateGuestFloatingBar();
    updateChatVisibility();
    renderDiscoveryBanner();
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders(false)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        state.currentUser = data.user;
        localStorage.setItem('sportslive_current_user', JSON.stringify(data.user));
        loadUserFavorites();
        await syncUserFavorites();
      } else {
        state.currentUser = null;
        state.token = '';
        localStorage.removeItem('talentolive_auth_token');
        localStorage.removeItem('grada_auth_token');
        localStorage.removeItem('sportslive_auth_token');
        localStorage.removeItem('sportslive_current_user');
        loadUserFavorites();
      }
    }
  } catch (err) {
    console.warn('Error verificando sesión:', err);
    loadUserFavorites();
  } finally {
    renderUserHeader();
    updateFilterButtonsVisual();
    updateActiveFilterIndicator();
    updateGuestFloatingBar();
    updateChatVisibility();
    renderDiscoveryBanner();
    const isPathAdmin = window.location.pathname === '/admin' || window.location.pathname.endsWith('/admin');
    const isHashAdmin = window.location.hash === '#admin' || window.location.hash === '#admin-login' || window.location.hash === '#admin-modal';
    const isQueryAdmin = new URLSearchParams(window.location.search).get('open_admin') === '1' || new URLSearchParams(window.location.search).get('admin') === '1' || new URLSearchParams(window.location.search).get('portal') === 'admin';

    if (state.currentUser && state.currentUser.role === 'admin') {
      if (isQueryAdmin || isHashAdmin || isPathAdmin) {
        openAdminModal();
        if (new URLSearchParams(window.location.search).get('open_admin') === '1') {
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }
    } else if (isPathAdmin || isHashAdmin || isQueryAdmin) {
      openAdminLoginModal();
    } else if (window.location.hash === '#login' || window.location.hash === '#auth' || window.location.hash === '#auth-modal' || new URLSearchParams(window.location.search).get('auth') === 'login') {
      openAuthModal('login');
    } else if (window.location.hash === '#register' || new URLSearchParams(window.location.search).get('auth') === 'register') {
      openAuthModal('register');
    }
  }
}

function renderUserHeader() {
  const container = document.getElementById('user-header-zone');
  const broadcastBtn = document.getElementById('btn-header-broadcast');
  if (!container) return;

  const authenticated = isSportsLiveAuthenticated();
  if (!authenticated) {
    if (broadcastBtn) broadcastBtn.style.display = 'none';
    container.innerHTML = `
      <button type="button" class="capsule-btn account-capsule-btn btn-header-auth-prominent" id="btn-header-login" onclick="openAuthModal()" title="Iniciar Sesión o Registrarse en SportsLive">
        <span class="account-icon">👤</span>
        <span id="account-btn-label" class="account-btn-label">Iniciar Sesión</span>
      </button>
    `;
    return;
  }

  const u = getSportsLiveUser() || state.currentUser;
  const role = u.role;

  if (role === 'admin') {
    if (broadcastBtn) broadcastBtn.style.display = 'inline-flex';
    container.innerHTML = `
      <div class="capsule-dropdown-wrap" id="wrap-admin-user">
        <button type="button" class="capsule-btn account-capsule-btn role-admin" id="btn-header-admin-user" aria-haspopup="true" aria-expanded="false" title="👑 Administrador General de SportsLive">
          <span class="account-icon">👑</span>
          <span id="account-btn-label" class="account-btn-label">Admin</span>
          <span class="capsule-btn-arrow">⌄</span>
        </button>
        <div class="floating-dropdown-menu user-dropdown-menu" id="menu-admin-user" role="menu">
          <button type="button" class="dropdown-item btn-admin-panel" id="btn-header-admin-panel" onclick="openAdminModal(); closeAllCapsuleDropdowns();" title="⚙️ Abrir Panel de Gestión y Moderación">
            <span class="item-icon">⚙️</span>
            <span>Abrir Panel Admin</span>
          </button>
          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item btn-logout" onclick="logout(); closeAllCapsuleDropdowns();" title="Cerrar sesión">
            <span class="item-icon">🚪</span>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>
    `;
  } else if (role === 'club') {
    if (broadcastBtn) broadcastBtn.style.display = 'inline-flex';
    const clubName = escapeHtml(u.club_name || 'Mi Club');
    const clubPageUrl = u.club_id 
      ? `club.html?id=${encodeURIComponent(u.club_id)}` 
      : (u.club_name ? `club.html?club=${encodeURIComponent(u.club_name)}` : 'club.html');
    container.innerHTML = `
      <div class="capsule-dropdown-wrap" id="wrap-club-user">
        <button type="button" class="capsule-btn account-capsule-btn role-club" id="btn-header-club-user" aria-haspopup="true" aria-expanded="false" title="🛡️ Club Deportivo: ${clubName}">
          <span class="account-icon">🛡️</span>
          <span id="account-btn-label" class="account-btn-label">Mi Club</span>
          <span class="capsule-btn-arrow">⌄</span>
        </button>
        <div class="floating-dropdown-menu user-dropdown-menu" id="menu-club-user" role="menu">
          <a href="${clubPageUrl}" class="dropdown-item" onclick="closeAllCapsuleDropdowns();" title="Ver canal y perfil del club">
            <span class="item-icon">📺</span>
            <span>Mi Canal / Perfil</span>
          </a>
          <button type="button" class="dropdown-item" onclick="openClubModal(); closeAllCapsuleDropdowns();" title="Gestionar emisiones">
            <span class="item-icon">🛡️</span>
            <span>Panel de Gestión Club</span>
          </button>
          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item btn-logout" onclick="logout(); closeAllCapsuleDropdowns();" title="Cerrar sesión">
            <span class="item-icon">🚪</span>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>
    `;
  } else {
    // Viewer / Aficionado
    if (broadcastBtn) broadcastBtn.style.display = 'none';
    const rawFullName = (u.full_name || u.username || 'Aficionado').trim();
    // Compact name for header: first name only (e.g. "Salva") to avoid pushing out other navbar elements on mobile
    const firstName = rawFullName.split(/\s+/)[0];
    const displayName = escapeHtml(firstName);
    const fullDisplayName = escapeHtml(rawFullName);
    container.innerHTML = `
      <div class="capsule-dropdown-wrap" id="wrap-viewer-user">
        <button type="button" class="capsule-btn account-capsule-btn" id="btn-header-viewer-user" aria-haspopup="true" aria-expanded="false" title="👤 Aficionado: ${fullDisplayName}">
          <span class="account-icon">👤</span>
          <span id="account-btn-label" class="account-btn-label">${displayName}</span>
          <span class="capsule-btn-arrow">⌄</span>
        </button>
        <div class="floating-dropdown-menu user-dropdown-menu" id="menu-viewer-user" role="menu">
          <button type="button" class="dropdown-item" onclick="openFavoritesModal(); closeAllCapsuleDropdowns();" title="Mis Clubes Favoritos">
            <span class="item-icon">⭐</span>
            <span>Mis Favoritos</span>
          </button>
          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item btn-logout" onclick="logout(); closeAllCapsuleDropdowns();" title="Cerrar sesión">
            <span class="item-icon">🚪</span>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>
    `;
  }
}

function openAuthModal(defaultTab = 'login') {
  if (typeof closeMobileNav === 'function') closeMobileNav();
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const errBox = document.getElementById('login-error');
    if (errBox) errBox.style.display = 'none';
    const regErr = document.getElementById('register-error');
    if (regErr) regErr.style.display = 'none';
    if (typeof switchAuthTab === 'function') {
      switchAuthTab(defaultTab === 'register' ? 'register' : 'login');
    }
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#admin-login' || window.location.hash === '#admin') {
    const u = (typeof getSportsLiveUser === 'function') ? getSportsLiveUser() : (state.currentUser);
    if (u && u.role === 'admin') {
      if (typeof openAdminModal === 'function') openAdminModal();
    } else {
      if (typeof openAdminLoginModal === 'function') openAdminLoginModal();
    }
  } else if (window.location.hash === '#login' || window.location.hash === '#auth' || window.location.hash === '#auth-modal') {
    openAuthModal('login');
  } else if (window.location.hash === '#register') {
    openAuthModal('register');
  }
});

function switchAuthTab(tab) {
  const btnLogin = document.getElementById('btn-tab-login');
  const btnReg = document.getElementById('btn-tab-register');
  const formLogin = document.getElementById('form-login');
  const formReg = document.getElementById('form-register');

  if (tab === 'login') {
    btnLogin.classList.add('active');
    btnReg.classList.remove('active');
    formLogin.style.display = 'block';
    formReg.style.display = 'none';
  } else {
    btnLogin.classList.remove('active');
    btnReg.classList.add('active');
    formLogin.style.display = 'none';
    formReg.style.display = 'block';
  }
}

function selectRegisterRole(role) {
  const roleInput = document.getElementById('reg-role-value');
  if (roleInput) roleInput.value = role;

  const btnAfic = document.getElementById('btn-role-aficionado');
  const btnClub = document.getElementById('btn-role-club');
  const clubFields = document.getElementById('reg-club-fields');
  const submitBtn = document.getElementById('btn-submit-register');
  const labelFullname = document.getElementById('label-reg-fullname');
  const inputFullname = document.getElementById('reg-fullname');
  const authKeyInput = document.getElementById('reg-club-auth-key');

  if (role === 'club') {
    if (btnAfic) btnAfic.classList.remove('active');
    if (btnClub) btnClub.classList.add('active');
    if (clubFields) clubFields.style.display = 'block';
    if (authKeyInput) authKeyInput.required = true;
    if (submitBtn) submitBtn.innerHTML = '🛡️ Registrar Club Verificado';
    if (labelFullname) labelFullname.textContent = 'Persona de Contacto / Delegado';
    if (inputFullname) inputFullname.placeholder = 'Ej: Manuel Ruiz (Delegado del Club)';
  } else {
    if (btnClub) btnClub.classList.remove('active');
    if (btnAfic) btnAfic.classList.add('active');
    if (clubFields) clubFields.style.display = 'none';
    if (authKeyInput) {
      authKeyInput.required = false;
      authKeyInput.value = '';
    }
    if (submitBtn) submitBtn.innerHTML = '👤 Crear Cuenta de Aficionado';
    if (labelFullname) labelFullname.textContent = 'Nombre y Apellidos';
    if (inputFullname) inputFullname.placeholder = 'Ej: Carlos Gómez';
  }
}

function requestClubKeyInfo(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const email = 'soporte@sportslive.es';
  const subject = encodeURIComponent('Solicitud de Clave de Emisión Oficial para Club Deportivo');
  const body = encodeURIComponent(
    'Hola Administración de SportsLive,\n\n' +
    'Deseamos solicitar la Clave de Autorización Oficial para dar de alta a nuestro Club Deportivo en SportsLive:\n\n' +
    '• Nombre Oficial del Club:\n' +
    '• Deporte y Categoría:\n' +
    '• CIF / NIF de la Entidad:\n' +
    '• Municipio y Provincia:\n' +
    '• Persona de Contacto / Cargo:\n' +
    '• Teléfono y Email de contacto:\n' +
    '• Enlace a Web o Canal Oficial de YouTube:\n\n' +
    'Muchas gracias.'
  );
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  if (typeof showToast === 'function') {
    showToast('📧 Redactando solicitud para soporte@sportslive.es...', 'info');
  }
}
window.requestClubKeyInfo = requestClubKeyInfo;

function openAdminLoginModal(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  closeAuthModal();
  if (typeof closeMobileNav === 'function') closeMobileNav();
  const modal = document.getElementById('admin-login-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const errBox = document.getElementById('admin-login-error');
    if (errBox) errBox.style.display = 'none';
    const identInput = document.getElementById('admin-login-identity');
    if (identInput) setTimeout(() => identInput.focus(), 100);
  }
}
window.openAdminLoginModal = openAdminLoginModal;

function closeAdminLoginModal() {
  const modal = document.getElementById('admin-login-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}
window.closeAdminLoginModal = closeAdminLoginModal;

async function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('admin-login-error');
  if (errBox) errBox.style.display = 'none';

  const identity = (document.getElementById('admin-login-identity')?.value || '').trim();
  const password = document.getElementById('admin-login-password')?.value || '';
  const adminKey = (document.getElementById('admin-login-key')?.value || '').trim();

  if (!identity || !password || !adminKey) {
    if (errBox) {
      errBox.textContent = 'Debes completar el usuario, la contraseña y la clave secreta maestra de administración.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password, admin_key: adminKey })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Credenciales o clave de administración no válidas');
    }

    if (!data.user || data.user.role !== 'admin') {
      throw new Error('Esta cuenta no dispone de permisos de Administrador.');
    }

    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem('talentolive_auth_token', data.token);
    localStorage.setItem('sportslive_auth_token', data.token);
    localStorage.setItem('sportslive_current_user', JSON.stringify(data.user));

    loadUserFavorites();
    await syncUserFavorites();

    renderUserHeader();
    updateFilterButtonsVisual();
    updateActiveFilterIndicator();
    closeAdminLoginModal();
    updateGuestFloatingBar();
    updateChatVisibility();
    applyFilters();

    showToast(`👑 ¡Autenticación de Administrador completada! Bienvenido, ${data.user.full_name || 'Admin'}`, 'success');
    if (typeof openAdminModal === 'function') {
      openAdminModal();
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    } else {
      showToast(err.message, 'error');
    }
  }
}
window.handleAdminLoginSubmit = handleAdminLoginSubmit;

async function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const identEl = document.getElementById('login-identity') || document.getElementById('loginUsername');
  const passEl = document.getElementById('login-password') || document.getElementById('loginPassword');
  const identity = (identEl ? identEl.value : '').trim();
  const password = passEl ? passEl.value : '';
  await doLogin(identity, password);
}

async function doLogin(identity, password) {
  const errBox = document.getElementById('login-error');
  if (errBox) errBox.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Credenciales no válidas');
    }

    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem('talentolive_auth_token', data.token);
    localStorage.setItem('sportslive_auth_token', data.token);
    localStorage.setItem('sportslive_current_user', JSON.stringify(data.user));

    // Cargar favoritos aislados de esta cuenta
    loadUserFavorites();
    await syncUserFavorites();

    renderUserHeader();
    updateFilterButtonsVisual();
    updateActiveFilterIndicator();
    closeAuthModal();
    updateGuestFloatingBar();
    updateChatVisibility();
    applyFilters();
    showToast(`¡Sesión iniciada con éxito! Conectado como ${data.user.full_name || data.user.username}`, 'success');
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    } else {
      showToast(err.message, 'error');
    }
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('register-error');
  if (errBox) errBox.style.display = 'none';

  const role = (document.getElementById('reg-role-value') ? document.getElementById('reg-role-value').value : 'aficionado');
  const payload = {
    role: role,
    full_name: document.getElementById('reg-fullname').value.trim(),
    username: document.getElementById('reg-username').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-password').value
  };

  if (role === 'club') {
    const clubName = document.getElementById('reg-club-name') ? document.getElementById('reg-club-name').value.trim() : '';
    const cif = document.getElementById('reg-club-cif') ? document.getElementById('reg-club-cif').value.trim() : '';
    const loc = document.getElementById('reg-club-location') ? document.getElementById('reg-club-location').value.trim() : '';
    const authKey = document.getElementById('reg-club-auth-key') ? document.getElementById('reg-club-auth-key').value.trim().toUpperCase() : '';

    if (!clubName) {
      if (errBox) {
        errBox.textContent = 'Debes indicar el Nombre Oficial del Club.';
        errBox.style.display = 'block';
      }
      return;
    }

    // Validación de clave de autorización obligatoria para dar de alta clubes verificados
    const validMasterKeys = ['SPORTSLIVE-CLUB-2026', 'SPORTSLIVE2026'];
    if (!authKey || !validMasterKeys.includes(authKey)) {
      if (errBox) {
        errBox.textContent = 'Clave de autorización no válida. Para dar de alta un club oficial contacta con la administración de SportsLive.';
        errBox.style.display = 'block';
      }
      return;
    }

    payload.club_name = clubName;
    payload.cif = cif;
    payload.location = loc;
    payload.invitation_code = authKey;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al registrar la cuenta');
    }

    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem('talentolive_auth_token', data.token);
    localStorage.setItem('sportslive_auth_token', data.token);
    localStorage.setItem('sportslive_current_user', JSON.stringify(data.user));

    loadUserFavorites();
    renderUserHeader();
    updateFilterButtonsVisual();
    updateActiveFilterIndicator();
    closeAuthModal();
    updateGuestFloatingBar();
    updateChatVisibility();
    applyFilters();

    if (role === 'club') {
      showToast(`¡Club ${data.user.club_name} registrado! Acceso concedido a tu Panel de Emisión.`, 'success');
    } else {
      showToast(`¡Bienvenido a SportsLive, ${data.user.full_name || data.user.username}! Cuenta de aficionado creada.`, 'success');
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    } else {
      showToast(err.message, 'error');
    }
  }
}

async function logout() {
  const currentTok = state.token;

  // 1. Limpiar credenciales y sesión inmediatamente de forma reactiva y síncrona
  state.token = '';
  state.currentUser = null;
  localStorage.removeItem('talentolive_auth_token');
  localStorage.removeItem('grada_auth_token');
  localStorage.removeItem('sportslive_auth_token');
  localStorage.removeItem('sportslive_current_user');

  // 2. Limpiar rigurosamente el estado reactivo en memoria de los favoritos del usuario saliente
  state.favorites = [];
  state.favoriteClubs = [];
  state.activeClubMode = null;
  state.activeClubFilter = null;
  state.favoritesOnlyMode = false;
  state.selectedSport = 'all';
  state.selectedDiscipline = 'all';
  state.selectedCcaa = 'all';
  state.selectedProvince = 'all';
  state.directosFilter = 'all';
  state.searchQuery = '';
  state.featuredEventId = null;

  // Notificar al backend en segundo plano
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentTok) headers['Authorization'] = `Bearer ${currentTok}`;
    fetch('/api/auth/logout', { method: 'POST', headers }).catch(() => {});
  } catch (err) {
    // Ignorar fallo de red en logout
  }

  // 3. Resetear favoritos y almacén de usuario
  loadUserFavorites();

  // 4. Asegurar contador badge inmediatamente a 0 (y oculto) en modo invitado
  const favBadge = document.getElementById('badge-fav-count');
  if (favBadge) {
    favBadge.textContent = '0';
    favBadge.style.display = 'none';
  }
  const favBtn = document.getElementById('btn-header-favorites') || document.getElementById('btn-favorites');
  if (favBtn) {
    favBtn.classList.remove('has-favorites');
    // Asegurar que el botón mantiene su eventListener intacto para responder inmediatamente
    favBtn.onclick = handleFavoritesClick;
  }

  const favBanner = document.getElementById('favorites-highlight-banner');
  if (favBanner) {
    favBanner.style.display = 'none';
  }

  const clubBanner = document.getElementById('club-mode-banner');
  if (clubBanner) {
    clubBanner.style.display = 'none';
  }

  renderUserHeader();
  updateFilterButtonsVisual();
  updateActiveFilterIndicator();
  updateGuestFloatingBar();
  updateChatVisibility();
  applyFilters();
  showToast('Sesión cerrada correctamente. Modo espectador activo.', 'info');
}

/* ==========================================================
   8. PANEL DE MI CLUB (PARA CLUBES DEPORTIVOS)
   ========================================================== */

async function openClubModal() {
  if (typeof closeMobileNav === 'function') closeMobileNav();
  if (!state.currentUser || (state.currentUser.role !== 'club' && state.currentUser.role !== 'admin')) {
    showToast('Acceso exclusivo para clubes deportivos o administradores.', 'error');
    return;
  }

  const modal = document.getElementById('club-modal');
  if (!modal) return;

  const clubName = state.currentUser.club_name || 'Mi Club';
  const subEl = document.getElementById('club-modal-subtitle');
  if (subEl) subEl.textContent = `Emisiones de: ${clubName}`;
  const viewPageBtn = document.getElementById('btn-view-my-club-page');
  if (viewPageBtn) {
    viewPageBtn.href = state.currentUser.club_name ? `club.html?club=${encodeURIComponent(state.currentUser.club_name)}` : 'club.html';
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  await loadClubMatches();
}

function closeClubModal() {
  const modal = document.getElementById('club-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function openClubIngestion() {
  closeClubModal();
  openIngestionModal();
}

async function loadClubMatches() {
  const container = document.getElementById('club-matches-container');
  const counterEl = document.getElementById('club-matches-counter');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center; padding: 2rem; color: var(--text-muted);">
      <div class="pulsing-dot" style="margin: 0 auto 0.5rem;"></div>
      Cargando directos de tu club...
    </div>
  `;

  try {
    const res = await fetch('/api/club/my-events', {
      headers: getAuthHeaders(false)
    });
    if (!res.ok) throw new Error('Error al cargar partidos del club');
    const matches = await res.json();

    if (counterEl) counterEl.textContent = `${matches.length} retransmisiones registradas`;

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2.5rem 1rem;">
          <div class="empty-icon">🛡️</div>
          <h3>Aún no has preparado ninguna retransmisión</h3>
          <p>Pulsa en "Emitir / Programar Partido" para añadir el enlace de tu próximo partido o directo.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    matches.forEach(m => {
      const card = createClubMatchRow(m);
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error al cargar</h3><p>${err.message}</p></div>`;
  }
}

function createClubMatchRow(m) {
  const row = document.createElement('div');
  row.className = 'club-match-card-row';

  const isLive = m.status === 'LIVE';
  const isUpcoming = m.status === 'UPCOMING';
  const isReplay = m.status === 'REPLAY';

  let statusBadge = '';
  if (isLive) statusBadge = `<span class="card-badge-status status-live">🔴 EN DIRECTO</span>`;
  else if (isUpcoming) statusBadge = `<span class="card-badge-status status-upcoming">⏳ PRÓXIMO</span>`;
  else statusBadge = `<span class="card-badge-status status-replay">📼 DIFERIDO</span>`;

  const safeId = escapeHtml(m.id);
  const hasCustomThumb = m.thumbnail && typeof m.thumbnail === 'string' && m.thumbnail.trim().length > 0;
  const sportId = (m.sport_id || 'futbol').toLowerCase();
  const sportIcon = escapeHtml(m.sport_icon || getSportIcon(sportId));

  const homeScoreVal = m.home_score !== null && m.home_score !== undefined ? m.home_score : '';
  const awayScoreVal = m.away_score !== null && m.away_score !== undefined ? m.away_score : '';

  row.innerHTML = `
    <div>
      ${hasCustomThumb ? `
        <img src="${sanitizeUrl(m.thumbnail)}" class="club-thumb-preview" alt="Miniatura" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
        <div class="club-thumb-preview thumb-default-sport thumb-sport-${sportId}" style="display:none; align-items:center; justify-content:center; font-size:2rem; padding:0;">
          <span>${sportIcon}</span>
        </div>
      ` : `
        <div class="club-thumb-preview thumb-default-sport thumb-sport-${sportId}" style="display:flex; align-items:center; justify-content:center; font-size:2rem; padding:0;">
          <span>${sportIcon}</span>
        </div>
      `}
      <div style="margin-top: 0.35rem;">${statusBadge}</div>
    </div>

    <div class="club-match-details">
      <h4>${escapeHtml(m.title)}</h4>
      <div class="club-match-meta">
        <span>🏆 ${escapeHtml(m.sport_name)} (${escapeHtml(m.category_name || '')})</span>
        <span>📍 ${escapeHtml(m.location_venue || m.province_name)}</span>
        <span>🕒 ${new Date(m.date_time).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>

      <!-- Marcador rápido en vivo -->
      <div class="club-quick-score-box">
        <span>Marcador:</span>
        <label style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(m.home_team)}</label>
        <input type="number" id="score-home-${safeId}" value="${homeScoreVal}" min="0">
        <span>-</span>
        <input type="number" id="score-away-${safeId}" value="${awayScoreVal}" min="0">
        <label style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(m.away_team)}</label>
        <button class="action-btn-sm" style="margin-left: 0.5rem;" onclick="quickUpdateScore('${safeId}', 'score-home-${safeId}', 'score-away-${safeId}')">
          💾 Guardar
        </button>
      </div>
    </div>

    <div class="club-match-actions">
      ${isUpcoming ? `
        <button class="action-btn-sm live-toggle" onclick="quickToggleStatus('${safeId}', 'LIVE')">
          🔴 Poner En Directo
        </button>
      ` : (isLive ? `
        <button class="action-btn-sm" style="color:#fde68a;" onclick="quickToggleStatus('${safeId}', 'REPLAY')">
          📼 Finalizar Partido
        </button>
      ` : `
        <button class="action-btn-sm live-toggle" onclick="quickToggleStatus('${safeId}', 'LIVE')">
          🔴 Reabrir Directo
        </button>
      `)}

      <button class="action-btn-sm edit" onclick="openEditMatchModal('${safeId}')">
        ✏️ Editar Enlace / Datos
      </button>

      <button class="action-btn-sm delete" onclick="clubDeleteMatch('${safeId}')">
        🗑️ Eliminar
      </button>
    </div>
  `;

  return row;
}

async function quickUpdateScore(eventId, homeInputId, awayInputId) {
  const homeVal = document.getElementById(homeInputId).value;
  const awayVal = document.getElementById(awayInputId).value;

  try {
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        home_score: homeVal !== '' ? parseInt(homeVal, 10) : null,
        away_score: awayVal !== '' ? parseInt(awayVal, 10) : null
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar marcador');
    }

    showToast('Marcador actualizado correctamente', 'success');
    fetchEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function quickToggleStatus(eventId, newStatus) {
  try {
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al cambiar estado');
    }

    const label = newStatus === 'LIVE' ? '¡Partido puesto EN DIRECTO!' : 'Partido finalizado (en diferido)';
    showToast(label, 'success');
    loadClubMatches();
    fetchStats();
    fetchEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function clubDeleteMatch(eventId) {
  if (!confirm('¿Estás seguro de que deseas eliminar esta retransmisión?')) return;

  try {
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(false)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar partido');
    }

    showToast('Retransmisión eliminada con éxito', 'success');
    loadClubMatches();
    fetchStats();
    fetchEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================
   9. PANEL DE CONTROL GLOBAL (ADMINISTRADOR - SALVADOR)
   ========================================================== */

async function openAdminModal() {
  if (typeof closeMobileNav === 'function') closeMobileNav();
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('Acceso exclusivo para el Administrador.', 'error');
    return;
  }

  const modal = document.getElementById('admin-modal');
  if (!modal) return;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  await loadAdminData();
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function switchAdminTab(tab) {
  const tabs = ['matches', 'clubs', 'users', 'stats'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btn-admin-tab-${t}`);
    const view = document.getElementById(`admin-tab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (view) view.style.display = t === tab ? 'block' : 'none';
  });
}

async function triggerAdminRssSync() {
  const btns = document.querySelectorAll('.btn-sync-rss-admin, #btn-admin-sync-rss');
  btns.forEach(b => {
    b.disabled = true;
    b.classList.add('syncing');
    b.innerHTML = '<span class="sync-icon">⏳</span> <span>Sincronizando Feeds RSS...</span>';
  });

  try {
    const res = await fetch('/api/admin/sync-channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof getAuthHeaders === 'function' ? getAuthHeaders(false) : {})
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al sincronizar canales RSS');
    }

    const imported = data.total_videos_imported || 0;
    const scanned = data.total_clubs_scanned || 0;

    if (imported > 0) {
      showToast(`✅ Sincronización RSS exitosa: ${imported} nuevo(s) vídeo(s) importado(s) de ${scanned} canal(es) de YouTube.`, 'success');
    } else {
      showToast(`✓ Todos los canales (${scanned}) están al día. No se detectaron vídeos nuevos en sus feeds RSS.`, 'info');
    }

    // Actualizar datos del panel de administración y portada
    await loadAdminData();
    if (typeof fetchEvents === 'function') fetchEvents();

  } catch (err) {
    console.error('Error triggerAdminRssSync:', err);
    showToast(`Error al sincronizar RSS: ${err.message}`, 'error');
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.classList.remove('syncing');
      b.innerHTML = '<span class="sync-icon">🔄</span> <span>Sincronizar Canales RSS Ahora</span>';
    });
  }
}

async function loadAdminData() {
  try {
    // 1. Cargar todos los eventos (catálogo completo sin recorte para administración)
    const resMatches = await fetch('/api/events?all=1');
    if (resMatches.ok) {
      state.adminMatches = await resMatches.json();
      renderAdminMatchesTable(state.adminMatches);
    }

    // 2. Cargar todos los clubes oficiales y canales
    try {
      const resClubs = await fetch('/api/clubs');
      if (resClubs.ok) {
        state.allClubs = await resClubs.json();
        renderAdminClubsTable(state.allClubs);
      }
    } catch (eClubs) {
      console.warn('Error cargando clubes oficiales:', eClubs);
    }

    // 3. Cargar todos los usuarios
    const resUsers = await fetch('/api/admin/users', {
      headers: getAuthHeaders(false)
    });
    if (resUsers.ok) {
      state.adminUsers = await resUsers.json();
      renderAdminUsersTable(state.adminUsers);
    }

    // 4. Cargar estadísticas
    const resStats = await fetch('/api/stats');
    if (resStats.ok) {
      const s = await resStats.json();
      const elEvents = document.getElementById('admin-stat-events');
      const elUsers = document.getElementById('admin-stat-users');
      const elClubs = document.getElementById('admin-stat-clubs');
      const elProvs = document.getElementById('admin-stat-provinces');

      if (elEvents) elEvents.textContent = (s.live_count + s.upcoming_count + s.replay_count);
      if (elUsers) elUsers.textContent = s.users_count || state.adminUsers.length;
      if (elClubs) elClubs.textContent = s.clubs_count || (state.allClubs ? state.allClubs.length : 0);
      if (elProvs) elProvs.textContent = s.provinces_active || 0;
    }
  } catch (err) {
    showToast('Error cargando datos de administración: ' + err.message, 'error');
  }
}

function renderAdminMatchesTable(matches) {
  const tbody = document.getElementById('admin-matches-tbody');
  if (!tbody) return;

  if (matches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">No hay partidos encontrados</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  matches.forEach(m => {
    const tr = document.createElement('tr');
    const safeId = escapeHtml(m.id);

    let statusHtml = '';
    if (m.status === 'LIVE') statusHtml = `<span style="color:#ef4444; font-weight:700;">🔴 LIVE</span>`;
    else if (m.status === 'UPCOMING') statusHtml = `<span style="color:#f59e0b;">⏳ Próx.</span>`;
    else statusHtml = `<span style="color:#64748b;">📼 Diferido</span>`;

    const scoreText = (m.home_score !== null && m.home_score !== undefined) ? `${m.home_score} - ${m.away_score}` : '-';

    tr.innerHTML = `
      <td>${statusHtml}</td>
      <td>
        <strong>${escapeHtml(m.title)}</strong><br>
        <small style="color:var(--text-dim);">${escapeHtml(m.home_team)} vs ${escapeHtml(m.away_team)}</small>
      </td>
      <td>
        <span style="color:#a7f3d0;">${escapeHtml(m.club_name || 'Sin club')}</span>
        ${m.is_verified_club ? ' <span title="Club verificado">🛡️</span>' : ''}
      </td>
      <td>
        <span>${escapeHtml(m.sport_name)}</span><br>
        <small style="color:var(--text-dim);">${escapeHtml(m.province_name)}</small>
      </td>
      <td><strong>${scoreText}</strong></td>
      <td>
        <div style="display: flex; gap: 0.35rem;">
          <button class="action-btn-sm edit" onclick="openEditMatchModal('${safeId}')" title="Editar este partido">
            ✏️ Editar
          </button>
          <button class="action-btn-sm delete" onclick="adminDeleteMatch('${safeId}')" title="Eliminar definitivamente">
            🗑️
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminMatches() {
  const q = (document.getElementById('admin-search-matches').value || '').toLowerCase().trim();
  if (!q) {
    renderAdminMatchesTable(state.adminMatches);
    return;
  }
  const filtered = state.adminMatches.filter(m => 
    (m.title && m.title.toLowerCase().includes(q)) ||
    (m.home_team && m.home_team.toLowerCase().includes(q)) ||
    (m.away_team && m.away_team.toLowerCase().includes(q)) ||
    (m.club_name && m.club_name.toLowerCase().includes(q))
  );
  renderAdminMatchesTable(filtered);
}

function renderAdminUsersTable(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    const safeId = escapeHtml(u.id);

    let roleBadge = '';
    if (u.role === 'admin') roleBadge = `<span class="user-badge-pill role-admin">👑 Admin</span>`;
    else if (u.role === 'club') roleBadge = `<span class="user-badge-pill role-club">🛡️ Club</span>`;
    else roleBadge = `<span class="user-badge-pill role-viewer">👤 Aficionado</span>`;

    const isSelf = state.currentUser && state.currentUser.id === u.id;
    const isClub = u.role === 'club';
    const isVerified = Boolean(u.is_verified);

    let verificationHtml = '<span style="color:var(--text-dim);">-</span>';
    if (isClub) {
      verificationHtml = isVerified
        ? `<span class="badge-tag-verified" style="display:inline-flex; align-items:center; gap:0.25rem;">✓ Verificado</span>`
        : `<span class="badge-tag-pending" style="display:inline-flex; align-items:center; gap:0.25rem;">⏳ Pendiente</span>`;
    }

    let actionsCell = '';
    if (isSelf) {
      actionsCell = '<small style="color:var(--text-dim);">Tu cuenta actual</small>';
    } else {
      let verifyBtn = '';
      if (isClub) {
        if (isVerified) {
          verifyBtn = `<button class="action-btn-sm" style="border-color:#f87171; color:#fca5a5; margin-right:0.35rem;" onclick="adminToggleVerification('${safeId}', false)" title="Revocar verificación oficial">Revocar</button>`;
        } else {
          verifyBtn = `<button class="action-btn-sm" style="border-color:#34d399; color:#6ee7b7; margin-right:0.35rem;" onclick="adminToggleVerification('${safeId}', true)" title="Aprobar y verificar club">✓ Aprobar</button>`;
        }
      }
      actionsCell = `
        <div style="display: flex; gap: 0.35rem; align-items: center;">
          ${verifyBtn}
          <button class="action-btn-sm delete" onclick="adminDeleteUser('${safeId}')" title="Dar de baja usuario">
            🗑️ Eliminar
          </button>
        </div>
      `;
    }

    const cifDisplay = u.cif ? `<br><small style="color:#94a3b8; font-size:0.75rem;">CIF: ${escapeHtml(u.cif)}</small>` : '';
    const locDisplay = u.location ? `<br><small style="color:#94a3b8; font-size:0.75rem;">📍 ${escapeHtml(u.location)}</small>` : '';

    tr.innerHTML = `
      <td>${roleBadge}</td>
      <td><strong>${escapeHtml(u.username)}</strong>${cifDisplay}</td>
      <td>${escapeHtml(u.email)}${locDisplay}</td>
      <td>${escapeHtml(u.club_name || '-')}</td>
      <td>${verificationHtml}</td>
      <td>${actionsCell}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function adminToggleVerification(userId, nextStatus) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/verify`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ is_verified: nextStatus })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar verificación');
    }
    showToast(nextStatus ? 'Club aprobado y verificado correctamente.' : 'Verificación de club revocada.', 'success');
    loadAdminData();
    fetchEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleNewUserForm() {
  const box = document.getElementById('new-user-form-container');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function toggleClubFieldInAdminUser(role) {
  const group = document.getElementById('adm-club-name-group');
  const extraGroup = document.getElementById('adm-club-extra-group');
  if (group) group.style.display = role === 'club' ? 'block' : 'none';
  if (extraGroup) extraGroup.style.display = role === 'club' ? 'flex' : 'none';
}

async function handleAdminCreateUser(e) {
  e.preventDefault();
  const role = document.getElementById('adm-role').value;
  const payload = {
    username: document.getElementById('adm-username').value.trim(),
    email: document.getElementById('adm-email').value.trim(),
    password: document.getElementById('adm-password').value,
    role: role,
    club_name: document.getElementById('adm-club-name') ? document.getElementById('adm-club-name').value.trim() : '',
    full_name: document.getElementById('adm-fullname') ? document.getElementById('adm-fullname').value.trim() : '',
    cif: document.getElementById('adm-cif') ? document.getElementById('adm-cif').value.trim() : '',
    location: document.getElementById('adm-location') ? document.getElementById('adm-location').value.trim() : '',
    is_verified: role === 'club' ? 1 : 0
  };

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al crear usuario');
    }

    showToast('Usuario / Club creado con éxito', 'success');
    document.getElementById('form-admin-create-user').reset();
    toggleNewUserForm();
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminDeleteUser(userId) {
  if (!confirm('¿Seguro que deseas eliminar a este usuario de la plataforma?')) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(false)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar usuario');
    }

    showToast('Usuario eliminado', 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminDeleteMatch(matchId) {
  if (!confirm('¿Seguro que deseas eliminar este partido de la plataforma?')) return;

  try {
    const res = await fetch(`/api/events/${matchId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(false)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar partido');
    }

    showToast('Partido eliminado del sistema', 'success');
    loadAdminData();
    fetchStats();
    fetchEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================
   9.1 GESTIÓN DE CLUBES Y CANALES OFICIALES (ADMIN)
   ========================================================== */

function toggleNewClubForm() {
  const box = document.getElementById('new-club-form-container');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function handleAdminSportChange(sportId) {
  const row = document.getElementById('adm-club-discipline-row');
  if (row) {
    row.style.display = (sportId === 'contacto' || sportId === 'boxeo_contacto') ? 'flex' : 'none';
  }
}
window.handleAdminSportChange = handleAdminSportChange;

async function handleAdminCreateClub(e) {
  e.preventDefault();
  const name = (document.getElementById('adm-club-official-name').value || '').trim();
  const sportId = document.getElementById('adm-club-sport').value;
  const category = (document.getElementById('adm-club-category').value || '').trim();
  const location = (document.getElementById('adm-club-location').value || '').trim();
  const youtubeUrl = (document.getElementById('adm-club-youtube-url').value || '').trim();
  const shieldIcon = (document.getElementById('adm-club-shield-icon').value || '').trim() || '🛡️';
  const description = (document.getElementById('adm-club-description').value || '').trim();

  if (!name || !youtubeUrl) {
    showToast('Por favor completa el nombre del club y su canal de YouTube', 'error');
    return;
  }

  const payload = {
    name: name,
    sport_id: sportId,
    category: category,
    location: location,
    channel_url: youtubeUrl,
    shield_icon: shieldIcon,
    description: description,
    is_verified: 1
  };

  if (sportId === 'contacto' || sportId === 'boxeo_contacto') {
    const disciplineEl = document.getElementById('adm-club-discipline');
    const discipline = disciplineEl ? disciplineEl.value : 'Boxeo';
    payload.modality = discipline;
    payload.discipline = discipline;
  }

  try {
    const res = await fetch('/api/admin/clubs', {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al registrar club');
    }

    const created = await res.json();
    showToast(`✓ Club "${created.name || name}" registrado como oficial con éxito`, 'success');
    document.getElementById('form-admin-create-club').reset();
    handleAdminSportChange('futbol');
    toggleNewClubForm();
    await fetchClubs();
    await loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAdminClubsTable(clubs) {
  const tbody = document.getElementById('admin-clubs-tbody');
  if (!tbody) return;

  if (!clubs || clubs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #94a3b8;">No hay clubes registrados actualmente</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  clubs.forEach(c => {
    const tr = document.createElement('tr');
    const safeId = escapeHtml(c.id || c.slug || '');
    const safeName = escapeHtml(c.name);
    const safeCategory = escapeHtml(c.category || 'Cantera Federada');
    const safeLocation = escapeHtml(c.location || c.province_name || '-');
    const safeSport = escapeHtml(c.sport_name || c.sport_id || 'Deporte Base');
    const channelUrl = c.channel_url || '';
    const totalVideos = c.total_videos !== undefined ? c.total_videos : (c.events_count || 0);

    const shieldDisplay = c.shield_icon ? escapeHtml(c.shield_icon) : '🛡️';
    const isLive = Boolean(c.has_active_live || c.live_event);
    const statusPill = isLive 
      ? `<span style="background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4); border-radius: 999px; padding: 2px 8px; font-size: 0.72rem; font-weight: 700;">🔴 LIVE</span>`
      : `<span style="background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); border-radius: 999px; padding: 2px 8px; font-size: 0.72rem; font-weight: 600;">⚪ OFFLINE</span>`;

    const channelLink = channelUrl 
      ? `<a href="${escapeHtml(channelUrl)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; font-size:0.82rem; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
           <span style="color:#ef4444;">▶</span> YouTube
         </a>`
      : `<span style="color:#64748b; font-size:0.8rem;">Sin canal</span>`;

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.25rem;">${shieldDisplay}</span>
          <div>
            <strong style="color: #f8fafc;">${safeName}</strong>
            <div style="margin-top: 2px;">${statusPill} <span style="color: #34d399; font-size: 0.72rem;">✓ Verificado</span></div>
          </div>
        </div>
      </td>
      <td>
        <span style="color: #e2e8f0; font-weight: 600;">${safeSport}</span><br>
        <small style="color: var(--text-dim);">${safeCategory}</small>
      </td>
      <td>
        <span style="color: #cbd5e1;">📍 ${safeLocation}</span>
      </td>
      <td>
        ${channelLink}
      </td>
      <td>
        <span style="background: rgba(56,189,248,0.12); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); border-radius: 6px; padding: 3px 8px; font-size: 0.78rem; font-weight: 600;">
          📼 ${totalVideos} vídeos
        </span>
      </td>
      <td>
        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
          <button class="action-btn-sm" style="border-color:#38bdf8; color:#38bdf8; background:rgba(56,189,248,0.1);" 
                  onclick="openAdminImportVideosModal('${safeId}', '${escapeHtml(c.name).replace(/'/g, "\\'")}')" 
                  title="Ingestar vídeos anteriores de YouTube para este club">
            📥 Ingestar Vídeos
          </button>
          <a href="club.html?club=${encodeURIComponent(c.id || c.name)}" class="action-btn-sm" style="border-color:#a855f7; color:#c084fc; text-decoration:none; display:inline-flex; align-items:center;" title="Ver página oficial del club">
            📺 Ver Canal
          </a>
          <button class="action-btn-sm" style="border-color:#ef4444; color:#f87171; background:rgba(239,68,68,0.1);" 
                  onclick="deleteAdminClub('${safeId}', '${escapeHtml(c.name).replace(/'/g, "\\'")}')" 
                  title="Dar de baja este club y sus emisiones">
            🗑️ Baja
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deleteAdminClub(clubId, clubName) {
  if (!confirm(`¿Estás seguro de que deseas dar de baja al club "${clubName}" y todos sus eventos asociados?`)) return;
  try {
    const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      showToast(`Club "${clubName}" eliminado.`);
      await fetchClubs();
      await fetchEvents();
      fetchAdminClubs();
    } else {
      const err = await res.json();
      showToast(err.error || 'Error al eliminar club', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}
window.deleteAdminClub = deleteAdminClub;

function openAdminImportVideosModal(clubId, clubName) {
  const modal = document.getElementById('admin-import-videos-modal');
  if (!modal) return;

  const idInput = document.getElementById('import-video-club-id');
  const nameInput = document.getElementById('import-video-club-name');
  const subtitle = document.getElementById('import-videos-club-subtitle');
  const dateInput = document.getElementById('import-video-date');

  if (idInput) idInput.value = clubId || '';
  if (nameInput) nameInput.value = clubName || '';
  if (subtitle) subtitle.textContent = `Asociar vídeos anteriores a: ${clubName || clubId}`;

  if (dateInput && !dateInput.value) {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dateInput.value = localIso;
  }

  const typeSelect = document.getElementById('import-video-content-type');
  if (typeSelect) {
    typeSelect.value = 'match_replay';
    onImportContentTypeChange('match_replay');
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAdminImportVideosModal() {
  const modal = document.getElementById('admin-import-videos-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
  const form = document.getElementById('form-admin-import-video');
  if (form) form.reset();
}

function onImportContentTypeChange(type) {
  const scoreRow = document.getElementById('import-match-scores-row');
  if (scoreRow) {
    scoreRow.style.display = (type === 'match_replay') ? 'flex' : 'none';
  }
}

async function handleAdminImportVideo(e) {
  e.preventDefault();
  const clubId = document.getElementById('import-video-club-id').value;
  const clubName = document.getElementById('import-video-club-name').value;
  const title = (document.getElementById('import-video-title').value || '').trim();
  const videoUrl = (document.getElementById('import-video-url').value || '').trim();
  const contentType = document.getElementById('import-video-content-type').value;
  const dateVal = document.getElementById('import-video-date').value;
  const rival = (document.getElementById('import-video-rival').value || '').trim();
  const duration = (document.getElementById('import-video-duration').value || '').trim() || '90:00';

  const homeScoreRaw = document.getElementById('import-video-home-score').value;
  const awayScoreRaw = document.getElementById('import-video-away-score').value;
  const homeScore = homeScoreRaw !== '' ? parseInt(homeScoreRaw, 10) : null;
  const awayScore = awayScoreRaw !== '' ? parseInt(awayScoreRaw, 10) : null;

  if (!title || !videoUrl) {
    showToast('Título y enlace de YouTube son obligatorios', 'error');
    return;
  }

  const payloadVideo = {
    title: title,
    stream_url: videoUrl,
    content_type: contentType,
    date_time: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
    home_team: clubName || 'Club Oficial',
    away_team: rival || 'Equipo Rival',
    home_score: homeScore,
    away_score: awayScore,
    duration: duration,
    status: 'REPLAY'
  };

  try {
    const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/import-history`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ videos: [payloadVideo] })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al importar vídeo histórico');
    }

    showToast('✓ Vídeo histórico de YouTube asociado con éxito al club', 'success');
    closeAdminImportVideosModal();
    await fetchClubs();
    await fetchEvents();
    await loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================
   10. MODAL DE EDICIÓN DE PARTIDO (PARA CLUB O ADMIN)
   ========================================================== */

async function openEditMatchModal(eventId) {
  if (!state.currentUser || (state.currentUser.role !== 'admin' && state.currentUser.role !== 'club')) {
    showToast('Solo clubes y administradores pueden editar retransmisiones.', 'error');
    return;
  }

  const modal = document.getElementById('edit-match-modal');
  if (!modal) return;

  try {
    const res = await fetch(`/api/events/${eventId}`);
    if (!res.ok) throw new Error('No se pudo consultar el evento');
    const evt = await res.json();

    document.getElementById('edit-id').value = evt.id;
    document.getElementById('edit-url').value = evt.url_original || '';
    document.getElementById('edit-title').value = evt.title || '';
    document.getElementById('edit-home-team').value = evt.home_team || '';
    document.getElementById('edit-home-score').value = evt.home_score !== null && evt.home_score !== undefined ? evt.home_score : '';
    document.getElementById('edit-away-team').value = evt.away_team || '';
    document.getElementById('edit-away-score').value = evt.away_score !== null && evt.away_score !== undefined ? evt.away_score : '';
    document.getElementById('edit-status').value = evt.status || 'LIVE';
    
    // Normalizar fecha/hora para datetime-local
    let dtVal = '';
    if (evt.date_time) {
      dtVal = evt.date_time.slice(0, 16);
    }
    document.getElementById('edit-datetime').value = dtVal;

    // Llenar selects de deporte y provincia si están vacíos
    const sportSelect = document.getElementById('edit-sport');
    const editDisciplineWrap = document.getElementById('edit-discipline-wrap');
    const editDisciplineSelect = document.getElementById('edit-discipline');

    if (sportSelect && sportSelect.options.length <= 1) {
      sportSelect.innerHTML = '';
      SPORTS_CATALOG.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.icon} ${s.name}`;
        sportSelect.appendChild(opt);
      });
    }
    if (sportSelect) {
      sportSelect.value = evt.sport_id;
      sportSelect.onchange = (e) => {
        if (editDisciplineWrap) {
          editDisciplineWrap.style.display = (e.target.value === 'contacto' || e.target.value === 'boxeo_contacto') ? 'block' : 'none';
        }
      };
    }
    if (editDisciplineWrap) {
      editDisciplineWrap.style.display = (evt.sport_id === 'contacto' || evt.sport_id === 'boxeo_contacto') ? 'block' : 'none';
    }
    if (editDisciplineSelect && (evt.modality || evt.discipline)) {
      editDisciplineSelect.value = evt.modality || evt.discipline;
    }

    const provSelect = document.getElementById('edit-province');
    if (provSelect && provSelect.options.length <= 1) {
      provSelect.innerHTML = '';
      GEO_CATALOG.forEach(c => {
        c.provinces.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${c.name})`;
          provSelect.appendChild(opt);
        });
      });
    }
    if (provSelect) provSelect.value = evt.province_id;

    document.getElementById('edit-venue').value = evt.location_venue || '';

    // Club
    const clubInput = document.getElementById('edit-club-name');
    if (clubInput) {
      clubInput.value = evt.club_name || '';
      if (state.currentUser.role === 'club') {
        clubInput.disabled = true; // El club no puede cambiar el nombre del club asignado
      } else {
        clubInput.disabled = false;
      }
    }

    document.getElementById('edit-sponsor-name').value = evt.sponsor_name || '';
    document.getElementById('edit-sponsor-url').value = evt.sponsor_url || '';

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast('Error al abrir editor: ' + err.message, 'error');
  }
}

function closeEditMatchModal() {
  const modal = document.getElementById('edit-match-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

async function handleEditMatchSubmit(e) {
  e.preventDefault();
  const eventId = document.getElementById('edit-id').value;
  const homeScoreRaw = document.getElementById('edit-home-score').value;
  const awayScoreRaw = document.getElementById('edit-away-score').value;
  const editSportId = document.getElementById('edit-sport').value;

  const payload = {
    url_original: document.getElementById('edit-url').value.trim(),
    title: document.getElementById('edit-title').value.trim(),
    home_team: document.getElementById('edit-home-team').value.trim(),
    away_team: document.getElementById('edit-away-team').value.trim(),
    home_score: homeScoreRaw !== '' ? parseInt(homeScoreRaw, 10) : null,
    away_score: awayScoreRaw !== '' ? parseInt(awayScoreRaw, 10) : null,
    status: document.getElementById('edit-status').value,
    date_time: document.getElementById('edit-datetime').value,
    sport_id: editSportId,
    province_id: document.getElementById('edit-province').value,
    location_venue: document.getElementById('edit-venue').value.trim(),
    club_name: document.getElementById('edit-club-name').value.trim(),
    sponsor_name: document.getElementById('edit-sponsor-name').value.trim(),
    sponsor_url: document.getElementById('edit-sponsor-url').value.trim()
  };

  if (editSportId === 'contacto' || editSportId === 'boxeo_contacto') {
    const editDisciplineEl = document.getElementById('edit-discipline');
    const discipline = editDisciplineEl ? editDisciplineEl.value : 'Boxeo';
    payload.modality = discipline;
    payload.discipline = discipline;
  }

  try {
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al guardar cambios');
    }

    showToast('Retransmisión actualizada con éxito', 'success');
    closeEditMatchModal();

    // Refrescar paneles y cartelera
    fetchEvents();
    fetchStats();
    if (state.currentUser.role === 'club') {
      loadClubMatches();
    }
    if (state.currentUser.role === 'admin') {
      loadAdminData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================
   11. SISTEMA DE PATROCINIO, PUBLICIDAD Y DOSSIER COMERCIAL
   ========================================================== */

function openSponsorModal(event) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  if (typeof closeMobileNav === 'function') closeMobileNav();
  const modal = document.getElementById('sponsor-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeSponsorModal(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  const modal = document.getElementById('sponsor-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function selectSponsorPlan(planName, event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  const selectEl = document.getElementById('sponsor-plan-select');
  if (selectEl && planName) {
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value.includes(planName) || planName.includes(selectEl.options[i].value)) {
        selectEl.selectedIndex = i;
        break;
      }
    }
  }

  // Desplazar suavemente hacia el formulario de contacto
  const formSection = document.querySelector('.sponsor-contact-section');
  if (formSection) {
    formSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const companyInput = document.getElementById('sponsor-company');
  if (companyInput) {
    companyInput.focus();
  }

  if (typeof showToast === 'function') {
    showToast(`Plan seleccionado: ${planName}`);
  }
}

async function handleSendSponsorLead(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  const companyEl = document.getElementById('sponsor-company');
  const contactEl = document.getElementById('sponsor-contact');
  const interestEl = document.getElementById('sponsor-interest');
  const planEl = document.getElementById('sponsor-plan-select');
  const messageEl = document.getElementById('sponsor-message');

  const company = (companyEl?.value || '').trim();
  const contact = (contactEl?.value || '').trim();
  const interest = (interestEl?.value || '').trim();
  const plan = (planEl?.value || 'Plan Comercial').trim();
  const message = (messageEl?.value || '').trim();

  if (!company || !contact) {
    if (typeof showToast === 'function') {
      showToast('Por favor, indica el nombre de tu empresa y teléfono o email de contacto.', 'error');
    }
    return;
  }

  const submitBtn = document.getElementById('btn-submit-sponsor');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
  }

  try {
    const res = await fetch('/api/sponsors/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: company,
        contact_info: contact,
        interest: interest,
        plan_name: plan,
        message: message
      })
    });

    if (res.ok) {
      if (typeof showToast === 'function') {
        showToast('¡Solicitud enviada con éxito! Nuestro equipo comercial te contactará en breve.', 'success');
      }
      const form = document.getElementById('sponsor-lead-form');
      if (form) form.reset();
      closeSponsorModal();
    } else {
      const data = await res.json().catch(() => ({}));
      const errMsg = data.error || 'No se pudo enviar la solicitud comercial.';
      if (typeof showToast === 'function') {
        showToast(errMsg, 'error');
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast('¡Solicitud registrada! Nos pondremos en contacto contigo lo antes posible.', 'success');
    }
    closeSponsorModal();
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>📨 Enviar Solicitud Comercial</span>';
    }
  }
}

window.openSponsorModal = openSponsorModal;
window.closeSponsorModal = closeSponsorModal;
window.selectSponsorPlan = selectSponsorPlan;
window.handleSendSponsorLead = handleSendSponsorLead;

window.switchAdminTab = switchAdminTab;
window.toggleNewClubForm = toggleNewClubForm;
window.handleAdminCreateClub = handleAdminCreateClub;
window.renderAdminClubsTable = renderAdminClubsTable;
window.openAdminImportVideosModal = openAdminImportVideosModal;
window.closeAdminImportVideosModal = closeAdminImportVideosModal;
window.onImportContentTypeChange = onImportContentTypeChange;
window.handleAdminImportVideo = handleAdminImportVideo;
window.triggerAdminRssSync = triggerAdminRssSync;

window.exitToGlobalCatalog = exitToGlobalCatalog;
window.clearClubFilter = exitToGlobalCatalog;
window.updateActiveFilterIndicator = updateActiveFilterIndicator;

window.getFavoritesStorageKey = getFavoritesStorageKey;
window.loadUserFavorites = loadUserFavorites;
window.saveUserFavorites = saveUserFavorites;
window.syncUserFavorites = syncUserFavorites;
window.logout = logout;
window.doLogin = doLogin;

window.openGuestLeadModal = openGuestLeadModal;
window.closeGuestLeadModal = closeGuestLeadModal;
window.updateGuestFloatingBar = updateGuestFloatingBar;
window.dismissGuestFloatingBar = dismissGuestFloatingBar;
window.scrollToGrid = scrollToGrid;
window.renderDiscoveryBanner = renderDiscoveryBanner;
window.openAuthModal = openAuthModal;


