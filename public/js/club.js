/**
 * SportsLive - Controlador de la Página de Club / Canal Favorito (club.html)
 * Jerarquía de contenidos (Nivel 1, Nivel 2, Nivel 3) y Doble Sistema de Chat
 */

const clubState = {
  currentClub: null,
  activeVideo: null,
  isLiveActive: false,
  allClubsList: [],
  communityMessages: [],
  matchMessages: [],
  communityPollTimer: null,
  matchPollTimer: null,
  currentUser: null
};

// Palabras ofensivas comunes para moderación instantánea en cliente
const CLIENT_BANNED_WORDS = [
  "puto", "puta", "cabron", "cabrona", "hdp", "gilipollas", "subnormal", "maricon",
  "mierda", "imbecil", "idiota", "asqueroso", "muerete", "ladron", "payaso"
];

function checkOffensiveLanguageClient(text) {
  if (!text) return false;
  const clean = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return CLIENT_BANNED_WORDS.some(w => {
    const reg = new RegExp(`\\b${w}`, 'i');
    return reg.test(clean);
  });
}

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
  if (!url || typeof url !== 'string') return '#';
  const clean = url.trim();
  if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(clean)) return clean;
  return '#';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) {
    alert(msg);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Inicialización de la página de club
document.addEventListener('DOMContentLoaded', async () => {
  initClubCapsuleDropdowns();
  await loadCurrentUser();
  await loadAllClubsCatalog();

  const urlParams = new URLSearchParams(window.location.search);
  const defaultClubId = (clubState.allClubsList && clubState.allClubsList[0]) 
    ? (clubState.allClubsList[0].id || clubState.allClubsList[0].name) 
    : 'cf-intercity';
  const clubParam = urlParams.get('club') || defaultClubId;

  await loadClubProfile(clubParam);
});

function initClubCapsuleDropdowns() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.capsule-dropdown-wrap .capsule-btn');
    if (btn) {
      e.stopPropagation();
      const wrap = btn.closest('.capsule-dropdown-wrap');
      if (wrap) {
        const isOpen = wrap.classList.contains('open');
        document.querySelectorAll('.capsule-dropdown-wrap').forEach(w => w.classList.remove('open'));
        if (!isOpen) {
          wrap.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
        return;
      }
    }
    if (!e.target.closest('.capsule-dropdown-wrap')) {
      document.querySelectorAll('.capsule-dropdown-wrap').forEach(w => {
        w.classList.remove('open');
        const b = w.querySelector('.capsule-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.capsule-dropdown-wrap').forEach(w => {
        w.classList.remove('open');
        const b = w.querySelector('.capsule-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        clubState.currentUser = data.user;
        renderUserHeader(data.user);
      } else {
        renderUserHeader(null);
      }
    }
  } catch (err) {
    console.warn('Error fetching user auth:', err);
    renderUserHeader(null);
  }
}

function renderUserHeader(user) {
  const zone = document.getElementById('user-header-zone');
  if (!zone) return;
  if (user) {
    if (user.role === 'admin') {
      zone.innerHTML = `
        <div class="capsule-dropdown-wrap" id="wrap-admin-user">
          <button type="button" class="capsule-btn account-capsule-btn role-admin" id="btn-header-admin-user" aria-haspopup="true" aria-expanded="false" title="👑 Administrador General de SportsLive">
            <span class="account-icon">👑</span>
            <span id="account-btn-label">Admin</span>
            <span class="capsule-btn-arrow">⌄</span>
          </button>
          <div class="floating-dropdown-menu user-dropdown-menu" id="menu-admin-user" role="menu">
            <button type="button" class="dropdown-item btn-admin-panel" id="btn-header-admin-panel" onclick="window.location.href='/?open_admin=1'" title="⚙️ Abrir Panel de Gestión y Moderación">
              <span class="item-icon">⚙️</span>
              <span class="capsule-btn-text">Abrir Panel Admin</span>
            </button>
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-item btn-logout" onclick="handleLogout()" title="Cerrar sesión">
              <span class="item-icon">🚪</span>
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      `;
    } else if (user.role === 'club') {
      const clubName = escapeHtml(user.club_name || 'Mi Club');
      const clubPageUrl = user.club_id 
        ? `club.html?id=${encodeURIComponent(user.club_id)}` 
        : (user.club_name ? `club.html?club=${encodeURIComponent(user.club_name)}` : 'club.html');
      zone.innerHTML = `
        <div class="capsule-dropdown-wrap" id="wrap-club-user">
          <button type="button" class="capsule-btn account-capsule-btn role-club" id="btn-header-club-user" aria-haspopup="true" aria-expanded="false" title="🛡️ Club Deportivo: ${clubName}">
            <span class="account-icon">🛡️</span>
            <span id="account-btn-label">Mi Club</span>
            <span class="capsule-btn-arrow">⌄</span>
          </button>
          <div class="floating-dropdown-menu user-dropdown-menu" id="menu-club-user" role="menu">
            <a href="${clubPageUrl}" class="dropdown-item" title="Mi Canal Oficial">
              <span class="item-icon">📺</span>
              <span>Mi Canal / Perfil</span>
            </a>
            <a href="/?open_club=1" class="dropdown-item" title="Panel de gestión de emisiones">
              <span class="item-icon">🛡️</span>
              <span>Panel de Gestión Club</span>
            </a>
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-item btn-logout" onclick="handleLogout()" title="Cerrar sesión">
              <span class="item-icon">🚪</span>
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      `;
    } else {
      const name = escapeHtml(user.full_name || user.username || 'Aficionado');
      zone.innerHTML = `
        <div class="capsule-dropdown-wrap" id="wrap-viewer-user">
          <button type="button" class="capsule-btn account-capsule-btn" id="btn-header-viewer-user" aria-haspopup="true" aria-expanded="false" title="👤 Aficionado: ${name}">
            <span class="account-icon">👤</span>
            <span id="account-btn-label">${name}</span>
            <span class="capsule-btn-arrow">⌄</span>
          </button>
          <div class="floating-dropdown-menu user-dropdown-menu" id="menu-viewer-user" role="menu">
            <a href="/#favorites-modal" class="dropdown-item" title="Mis Clubes Favoritos">
              <span class="item-icon">⭐</span>
              <span>Mis Favoritos</span>
            </a>
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-item btn-logout" onclick="handleLogout()" title="Cerrar sesión">
              <span class="item-icon">🚪</span>
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      `;
    }
  } else {
    zone.innerHTML = `
      <button type="button" class="capsule-btn account-capsule-btn" onclick="window.location.href='index.html'" title="Acceso de usuarios">
        <span class="account-icon">👤</span>
        <span id="account-btn-label">MI CUENTA / ENTRAR</span>
      </button>
    `;
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    clubState.currentUser = null;
    window.location.reload();
  } catch (e) {
    window.location.reload();
  }
}

// Carga del catálogo completo de clubes para el selector
async function loadAllClubsCatalog() {
  try {
    const res = await fetch('/api/clubs');
    if (res.ok) {
      clubState.allClubsList = await res.json();
      renderClubSelector();
    }
  } catch (e) {
    console.warn('Error cargando clubes:', e);
  }
}

function renderClubSelector() {
  const select = document.getElementById('club-quick-selector');
  if (!select || !clubState.allClubsList) return;
  select.innerHTML = clubState.allClubsList.map(c => `
    <option value="${escapeHtml(c.id || c.name)}" ${clubState.currentClub && (clubState.currentClub.id === c.id || clubState.currentClub.name === c.name) ? 'selected' : ''}>
      ${escapeHtml(c.name)} (${escapeHtml(c.location)})
    </option>
  `).join('');
}

function onClubSelectorChange(e) {
  const targetId = e.target.value;
  if (targetId) {
    window.location.href = `/club.html?club=${encodeURIComponent(targetId)}`;
  }
}

// Cargar perfil del club
async function loadClubProfile(clubIdOrName) {
  try {
    const res = await fetch(`/api/clubs/${encodeURIComponent(clubIdOrName)}`);
    if (!res.ok) {
      showToast('Club no encontrado en el catálogo de SportsLive', 'error');
      return;
    }
    const club = await res.json();
    clubState.currentClub = club;

    renderClubHeader(club);
    renderDossierCard(club);
    renderNivel1Player(club);
    renderNivel2Replays(club);
    renderNivel3PressAndReels(club);

    // Iniciar chat de comunidad permanente
    startCommunityChat(club.id || club.name);

    // Actualizar selector
    renderClubSelector();
  } catch (err) {
    console.error('Error al cargar perfil de club:', err);
    showToast('Error de conexión cargando los datos del club', 'error');
  }
}

// Renderizado de la Cabecera Oficial del Club
function renderClubHeader(club) {
  const shieldContainer = document.getElementById('club-shield-container');
  if (shieldContainer) {
    if (club.shield_url) {
      shieldContainer.innerHTML = `
        <img class="club-shield-img" src="${sanitizeUrl(club.shield_url)}" alt="${escapeHtml(club.name)}" onerror="this.outerHTML='<div class=\\'club-shield-fallback\\'>${escapeHtml(club.shield_icon || '🛡️')}</div>';">
        ${club.is_verified ? '<span class="club-verified-seal" title="Club Verificado Oficial">✓</span>' : ''}
      `;
    } else {
      shieldContainer.innerHTML = `
        <div class="club-shield-fallback">${escapeHtml(club.shield_icon || '🛡️')}</div>
        ${club.is_verified ? '<span class="club-verified-seal" title="Club Verificado Oficial">✓</span>' : ''}
      `;
    }
  }

  const nameEl = document.getElementById('club-main-name');
  if (nameEl) nameEl.textContent = club.name;

  const locEl = document.getElementById('club-meta-location');
  if (locEl) locEl.textContent = `📍 ${club.location || club.province_name || 'España'}`;

  const catEl = document.getElementById('club-meta-category');
  if (catEl) catEl.textContent = `${club.sport_icon || '🏅'} ${club.sport_name || 'Deporte Base'} • ${club.category || 'Categoría Oficial'}`;

  const descEl = document.getElementById('club-description-text');
  if (descEl) descEl.textContent = club.description || `Canal oficial de ${club.name} en la plataforma SportsLive.`;

  // Botón de Canal de YouTube
  const ytBtn = document.getElementById('btn-club-youtube');
  if (ytBtn) {
    if (club.channel_url && club.channel_url.trim().length > 0) {
      ytBtn.href = sanitizeUrl(club.channel_url);
      ytBtn.style.display = 'inline-flex';
      ytBtn.target = '_blank';
    } else {
      ytBtn.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(club.name)}`;
      ytBtn.style.display = 'inline-flex';
      ytBtn.target = '_blank';
    }
  }

  // Cabecera del chat oficial del club con escudo
  const chatHeaderTitle = document.getElementById('club-community-chat-header-title');
  if (chatHeaderTitle) {
    const shield = club.shield_icon || '🛡️';
    chatHeaderTitle.innerHTML = `<span>💬</span> Muro de la Afición - ${escapeHtml(club.name)} <span class="club-chat-crest" style="margin-left: 6px;">${escapeHtml(shield)}</span>`;
  }

  // Estado del botón de seguimiento
  updateFollowButtonState();
}

// Botón de seguir club (sincronizado con localStorage y cuenta)
function isClubFollowed(clubName) {
  if (!clubName) return false;
  try {
    const list = JSON.parse(localStorage.getItem('sportslive_favorite_clubs') || localStorage.getItem('talentolive_favorite_clubs') || '[]');
    return list.includes(clubName);
  } catch (e) {
    return false;
  }
}

function updateFollowButtonState() {
  const btn = document.getElementById('btn-club-follow');
  if (!btn || !clubState.currentClub) return;
  const isFollowing = isClubFollowed(clubState.currentClub.name);
  if (isFollowing) {
    btn.classList.add('following');
    btn.innerHTML = `<span>⭐</span> <span>Siguiendo</span>`;
  } else {
    btn.classList.remove('following');
    btn.innerHTML = `<span>⭐</span> <span>Seguir Club</span>`;
  }
}

async function toggleFollowCurrentClub() {
  if (!clubState.currentClub) return;
  if (!clubState.currentUser) {
    showToast('Identifícate para seguir a este club y guardar tus preferencias.', 'info');
    setTimeout(() => {
      window.location.href = 'index.html?auth=login';
    }, 1000);
    return;
  }

  const clubName = clubState.currentClub.name;
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem('sportslive_favorite_clubs') || localStorage.getItem('talentolive_favorite_clubs') || '[]');
  } catch (e) {
    list = [];
  }

  const idx = list.indexOf(clubName);
  let isNowFollowing = false;
  if (idx >= 0) {
    list.splice(idx, 1);
    isNowFollowing = false;
    showToast(`Dejaste de seguir a ${clubName}`, 'info');
  } else {
    list.push(clubName);
    isNowFollowing = true;
    showToast(`¡Ahora sigues a ${clubName}! Recibirás avisos de sus directos`, 'success');
  }

  localStorage.setItem('sportslive_favorite_clubs', JSON.stringify(list));
  localStorage.setItem('talentolive_favorite_clubs', JSON.stringify(list));
  updateFollowButtonState();

  // Sincronizar en backend si el usuario está autenticado
  try {
    await fetch('/api/user/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite_clubs: list })
    });
  } catch (err) {
    console.warn('Error sincronizando favoritos:', err);
  }
}

// Ficha Oficial del Club
function renderDossierCard(club) {
  const container = document.getElementById('club-dossier-items');
  if (!container) return;
  container.innerHTML = `
    <div class="club-dossier-item">
      <span class="dossier-label">Club Oficial:</span>
      <span class="dossier-value">${escapeHtml(club.name)}</span>
    </div>
    <div class="club-dossier-item">
      <span class="dossier-label">Sede / Sede Social:</span>
      <span class="dossier-value">${escapeHtml(club.location || club.province_name)}</span>
    </div>
    <div class="club-dossier-item">
      <span class="dossier-label">Categoría:</span>
      <span class="dossier-value">${escapeHtml(club.category || 'Federada Base')}</span>
    </div>
    <div class="club-dossier-item">
      <span class="dossier-label">Estado de Emisión:</span>
      <span class="dossier-value" style="color: #34d399;">✓ Emisión Oficial Verificada</span>
    </div>
    <div class="club-dossier-item">
      <span class="dossier-label">Vídeos en Catálogo:</span>
      <span class="dossier-value">${club.total_videos || 0} publicaciones</span>
    </div>
  `;
}

// ==========================================================
// NIVEL 1: Directo Activo o Última Emisión
// ==========================================================
function renderNivel1Player(club) {
  const targetEvent = club.live_event || club.last_event;
  if (!targetEvent) {
    const box = document.getElementById('club-nivel-1-embed-box');
    if (box) {
      box.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; text-align:center; padding:2rem;">
          <span style="font-size:3rem; margin-bottom:1rem;">📺</span>
          <h3>No hay emisiones disponibles en este momento</h3>
          <p>El club publicará su próximo encuentro en su canal oficial.</p>
        </div>
      `;
    }
    return;
  }

  playVideoInMainPlayer(targetEvent);
}

function playVideoInMainPlayer(evt) {
  clubState.activeVideo = evt;
  const isLive = evt.status === 'LIVE';
  clubState.isLiveActive = isLive;

  // Actualizar Badge del Nivel 1
  const badgeEl = document.getElementById('nivel-1-status-badge');
  if (badgeEl) {
    if (isLive) {
      badgeEl.className = 'level-badge-pill badge-live';
      badgeEl.innerHTML = `<span class="live-dot-pulse-mini" style="display:inline-block; margin-right:4px;"></span> DIRECTO ACTIVO`;
    } else {
      badgeEl.className = 'level-badge-pill badge-replay';
      badgeEl.innerHTML = `📼 ÚLTIMA EMISIÓN / DIFERIDO COMPLETO`;
    }
  }

  // Reproductor embebido (siempre con autoplay=0 para evitar reproducción automática indeseada)
  const embedBox = document.getElementById('club-nivel-1-embed-box');
  if (embedBox) {
    let embedUrl = evt.embed_url || '';
    if (embedUrl.includes('autoplay=1')) embedUrl = embedUrl.replace('autoplay=1', 'autoplay=0');
    embedBox.innerHTML = `
      <iframe src="${sanitizeUrl(embedUrl)}" title="${escapeHtml(evt.title)}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    `;
  }

  // Detalles del partido cargado
  const titleEl = document.getElementById('nivel-1-match-title');
  if (titleEl) titleEl.textContent = evt.title;

  const teamsRow = document.getElementById('nivel-1-teams-row');
  if (teamsRow) {
    if (evt.status === 'LIVE' && evt.home_score !== null && evt.away_score !== null) {
      teamsRow.innerHTML = `
        <span>${escapeHtml(evt.home_team || 'Equipo Local')}</span>
        <span class="club-featured-score-pill">${escapeHtml(evt.home_score)} - ${escapeHtml(evt.away_score)}</span>
        <span>${escapeHtml(evt.away_team || 'Equipo Visitante')}</span>
      `;
      teamsRow.style.display = 'flex';
    } else if (evt.away_team && !evt.away_team.startsWith('Rival de') && evt.away_team !== 'Equipo' && evt.away_team !== 'Cantera Oficial' && evt.content_type !== 'press' && evt.content_type !== 'reel') {
      teamsRow.innerHTML = `
        <span>${escapeHtml(evt.home_team || 'Equipo Local')}</span>
        <span class="club-featured-score-pill" style="font-size:0.9rem;">VS</span>
        <span>${escapeHtml(evt.away_team || 'Equipo Visitante')}</span>
      `;
      teamsRow.style.display = 'flex';
    } else {
      teamsRow.innerHTML = '';
      teamsRow.style.display = 'none';
    }
  }

  const metaEl = document.getElementById('nivel-1-match-meta');
  if (metaEl) {
    const dateFormatted = evt.date_time ? new Date(evt.date_time).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    metaEl.innerHTML = `
      <span>📅 ${dateFormatted}</span>
      <span>•</span>
      <span>📍 ${escapeHtml(evt.location_venue || evt.province_name || '')}</span>
      ${evt.duration ? `<span>•</span> <span>⏱️ ${escapeHtml(evt.duration)}</span>` : ''}
    `;
  }

  // Control del Chat de Partido (Directo)
  setupMatchLiveChat(evt);

  // Scroll suave al reproductor si se seleccionó desde una tarjeta inferior
  const playerCard = document.getElementById('club-nivel-1-card');
  if (playerCard && window.scrollY > 300) {
    playerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ==========================================================
// CHAT DE PARTIDO (DIRECTO) - Asociado a event_id
// ==========================================================
function setupMatchLiveChat(evt) {
  const isLive = evt.status === 'LIVE';
  const chatContainer = document.getElementById('match-live-chat-panel');
  if (!chatContainer) return;

  if (clubState.matchPollTimer) {
    clearInterval(clubState.matchPollTimer);
    clubState.matchPollTimer = null;
  }

  if (isLive) {
    chatContainer.innerHTML = `
      <div class="match-live-chat-header">
        <h4><span class="live-dot-pulse-mini" style="display:inline-block;"></span> Chat del Partido en Directo</h4>
        <span style="font-size:0.75rem; color:#34d399;">🔴 Reacción en tiempo real</span>
      </div>
      <div class="match-chat-feed" id="match-chat-feed" aria-live="polite">
        <p style="color:#64748b; font-size:0.8rem; text-align:center;">Cargando comentarios del directo...</p>
      </div>
      <form class="chat-form-row" onsubmit="handleSendMatchMessage(event)" style="margin-top:0.75rem;">
        <input type="text" class="chat-input-text" id="match-chat-input" placeholder="Comenta la jugada o anima al equipo..." maxlength="300" required>
        <button type="submit" class="btn-chat-send">Enviar</button>
      </form>
    `;
    fetchMatchChatMessages(evt.id);
    clubState.matchPollTimer = setInterval(() => fetchMatchChatMessages(evt.id), 3500);
  } else {
    chatContainer.innerHTML = `
      <div class="match-chat-notice-inactive">
        <strong>🔒 El chat de partido solo está activo durante retransmisiones en directo</strong>
        <span>Este contenido es un partido en diferido o rueda de prensa. Para comentar en cualquier momento y dejar ánimos al equipo, usa el <strong>Chat de Comunidad</strong> permanente en el panel lateral derecho.</span>
      </div>
    `;
  }
}

async function fetchMatchChatMessages(eventId) {
  try {
    const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/chat`);
    if (res.ok) {
      const msgs = await res.json();
      clubState.matchMessages = msgs;
      renderMatchChatMessages(msgs);
    }
  } catch (err) {
    console.warn('Error fetching match chat:', err);
  }
}

function renderMatchChatMessages(messages) {
  const feed = document.getElementById('match-chat-feed');
  if (!feed) return;
  if (!messages || messages.length === 0) {
    feed.innerHTML = `<p style="color:#64748b; font-size:0.8rem; text-align:center; margin:auto;">Sé el primero en comentar este directo. ¡Juego limpio!</p>`;
    return;
  }

  feed.innerHTML = messages.map(m => {
    const roleIcon = m.user_role === 'admin' ? '👑' : (m.user_role === 'club' ? '🛡️' : '👤');
    const timeFormatted = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="club-chat-bubble ${m.user_role === 'club' ? 'role-club' : (m.user_role === 'admin' ? 'role-admin' : '')}">
        <div class="chat-msg-meta">
          <span class="chat-user-badge ${m.user_role === 'club' ? 'badge-club' : (m.user_role === 'admin' ? 'badge-admin' : '')}">
            <span>${roleIcon}</span> <span>${escapeHtml(m.user_name)}</span>
          </span>
          <span class="chat-timestamp">${timeFormatted}</span>
        </div>
        <div class="chat-msg-content">${escapeHtml(m.message)}</div>
      </div>
    `;
  }).join('');

  feed.scrollTop = feed.scrollHeight;
}

async function handleSendMatchMessage(e) {
  e.preventDefault();
  if (!clubState.activeVideo) return;
  const input = document.getElementById('match-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (checkOffensiveLanguageClient(text)) {
    showToast('Tu comentario contiene palabras no permitidas por las normas de respeto deportivo.', 'error');
    return;
  }

  const user = clubState.currentUser;
  const payload = {
    message: text,
    user_name: user ? (user.full_name || user.username) : 'Aficionado'
  };

  try {
    const res = await fetch(`/api/events/${encodeURIComponent(clubState.activeVideo.id)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Error al enviar mensaje', 'error');
    } else {
      input.value = '';
      fetchMatchChatMessages(clubState.activeVideo.id);
    }
  } catch (err) {
    showToast('Error de conexión al enviar mensaje', 'error');
  }
}

// ==========================================================
// NIVEL 2: Fila horizontal de Partidos Anteriores (Diferidos)
// ==========================================================
function renderNivel2Replays(club) {
  const container = document.getElementById('club-replays-scroll-row');
  if (!container) return;

  const replays = club.match_replays || [];
  if (replays.length === 0) {
    container.innerHTML = `<p style="color:#94a3b8; font-size:0.85rem; padding:1rem;">No hay partidos anteriores grabados para este club.</p>`;
    return;
  }

  container.innerHTML = replays.map(r => {
    const hasScore = (r.status === 'LIVE' && r.home_score !== null && r.away_score !== null);
    const scoreOverlayHtml = hasScore ? `<span class="replay-score-overlay">${escapeHtml(r.home_score)} - ${escapeHtml(r.away_score)}</span>` : '';
    const dateFormatted = r.date_time ? new Date(r.date_time).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
    const thumbUrl = r.thumbnail || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60';

    return `
      <div class="club-replay-card" onclick="loadReplayVideo('${escapeHtml(r.id)}')" title="Reproducir este partido completo">
        <div class="replay-thumb-wrap">
          <img class="replay-thumb-img" src="${sanitizeUrl(thumbUrl)}" alt="${escapeHtml(r.title)}" loading="lazy">
          <span class="replay-badge-tag">📼 COMPLETO</span>
          ${scoreOverlayHtml}
        </div>
        <div class="replay-card-body">
          <h4 class="replay-card-title">${escapeHtml(r.title)}</h4>
          <div class="replay-card-footer">
            <span>📅 ${dateFormatted}</span>
            <span style="color:#38bdf8; font-weight:700;">▶ Ver Partido</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function loadReplayVideo(eventId) {
  if (!clubState.currentClub) return;
  const allVideos = [
    ...(clubState.currentClub.match_replays || []),
    ...(clubState.currentClub.press_videos || []),
    ...(clubState.currentClub.live_event ? [clubState.currentClub.live_event] : [])
  ];
  const found = allVideos.find(v => v.id === eventId);
  if (found) {
    playVideoInMainPlayer(found);
  }
}

// ==========================================================
// NIVEL 3: Ruedas de Prensa (16:9) y Reels (9:16)
// ==========================================================
function renderNivel3PressAndReels(club) {
  // 1. Ruedas de Prensa (formato horizontal 16:9)
  const pressRow = document.getElementById('club-press-scroll-row');
  if (pressRow) {
    const press = club.press_videos || [];
    if (press.length === 0) {
      pressRow.innerHTML = `<p style="color:#94a3b8; font-size:0.85rem; padding:0.5rem;">No hay declaraciones o ruedas de prensa publicadas.</p>`;
    } else {
      pressRow.innerHTML = press.map(p => {
        const thumbUrl = p.thumbnail || 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&auto=format&fit=crop&q=60';
        const dateFormatted = p.date_time ? new Date(p.date_time).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
        return `
          <div class="press-card" onclick="loadReplayVideo('${escapeHtml(p.id)}')" title="Ver rueda de prensa">
            <div class="press-thumb-box">
              <img src="${sanitizeUrl(thumbUrl)}" alt="${escapeHtml(p.title)}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
              ${p.duration ? `<span class="press-duration-pill">⏱️ ${escapeHtml(p.duration)}</span>` : ''}
            </div>
            <div class="press-card-body">
              <h5 class="press-card-title">${escapeHtml(p.title)}</h5>
              <div style="font-size:0.75rem; color:#94a3b8; display:flex; justify-content:space-between;">
                <span>🎙️ Declaraciones</span>
                <span>${dateFormatted}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Reels & Shorts (formato vertical 9:16)
  const reelsRow = document.getElementById('club-reels-scroll-row');
  if (reelsRow) {
    const reels = club.reels || [];
    if (reels.length === 0) {
      reelsRow.innerHTML = `<p style="color:#94a3b8; font-size:0.85rem; padding:0.5rem;">No hay reels o shorts publicados aún.</p>`;
    } else {
      reelsRow.innerHTML = reels.map(reel => {
        const thumbUrl = reel.thumbnail || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=500&auto=format&fit=crop&q=80';
        return `
          <div class="club-reel-card" onclick="openReelModal('${escapeHtml(reel.id)}')" title="Ver Reel vertical 9:16">
            <img class="reel-img-bg" src="${sanitizeUrl(thumbUrl)}" alt="${escapeHtml(reel.title)}" loading="lazy">
            <div class="reel-gradient-overlay">
              <div class="reel-topline">
                <span class="reel-badge-tag">⚡ REEL</span>
                ${reel.duration ? `<span style="font-size:0.68rem; color:#fff; background:rgba(0,0,0,0.6); padding:0.1rem 0.35rem; border-radius:4px;">${escapeHtml(reel.duration)}</span>` : ''}
              </div>
              <div class="reel-center-play">▶</div>
              <div class="reel-bottom-info">
                <p class="reel-title-text">${escapeHtml(reel.title)}</p>
                <span class="reel-meta-tag">Ver Clip 9:16 ↗</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Modal de reproducción vertical de Reel (9:16)
function openReelModal(reelId) {
  if (!clubState.currentClub) return;
  const reel = (clubState.currentClub.reels || []).find(r => r.id === reelId);
  if (!reel) return;

  const modal = document.getElementById('reel-modal-overlay');
  const iframeBox = document.getElementById('reel-modal-iframe-box');
  if (modal && iframeBox) {
    let embedUrl = reel.embed_url || '';
    if (embedUrl.includes('autoplay=1')) embedUrl = embedUrl.replace('autoplay=1', 'autoplay=0');
    iframeBox.innerHTML = `
      <iframe src="${sanitizeUrl(embedUrl)}" title="${escapeHtml(reel.title)}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeReelModal() {
  const modal = document.getElementById('reel-modal-overlay');
  const iframeBox = document.getElementById('reel-modal-iframe-box');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
  if (iframeBox) iframeBox.innerHTML = '';
}

// ==========================================================
// CHAT DE COMUNIDAD DEL CLUB (club_id) - Panel Lateral Permanente
// ==========================================================
function startCommunityChat(clubId) {
  if (clubState.communityPollTimer) {
    clearInterval(clubState.communityPollTimer);
    clubState.communityPollTimer = null;
  }
  fetchClubCommunityMessages(clubId);
  clubState.communityPollTimer = setInterval(() => fetchClubCommunityMessages(clubId), 3500);
}

async function fetchClubCommunityMessages(clubId) {
  try {
    const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/chat`);
    if (res.ok) {
      const msgs = await res.json();
      clubState.communityMessages = msgs;
      renderClubCommunityMessages(msgs);
    }
  } catch (err) {
    console.warn('Error fetching community chat:', err);
  }
}

function renderClubCommunityMessages(messages) {
  const box = document.getElementById('club-chat-messages-box');
  if (!box) return;
  if (!messages || messages.length === 0) {
    box.innerHTML = `<p style="color:#64748b; font-size:0.8rem; text-align:center; margin:auto;">Espacio abierto. ¡Sé el primero en dejar ánimos al club!</p>`;
    return;
  }

  box.innerHTML = messages.map(m => {
    const roleIcon = m.user_role === 'admin' ? '👑' : (m.user_role === 'club' ? '🛡️' : '👤');
    const timeFormatted = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="club-chat-bubble ${m.user_role === 'club' ? 'role-club' : (m.user_role === 'admin' ? 'role-admin' : '')}">
        <div class="chat-msg-meta">
          <span class="chat-user-badge ${m.user_role === 'club' ? 'badge-club' : (m.user_role === 'admin' ? 'badge-admin' : '')}">
            <span>${roleIcon}</span> <span>${escapeHtml(m.user_name)}</span>
          </span>
          <span class="chat-timestamp">${timeFormatted}</span>
        </div>
        <div class="chat-msg-content">${escapeHtml(m.message)}</div>
      </div>
    `;
  }).join('');

  box.scrollTop = box.scrollHeight;
}

function appendQuickCheer(cheerText) {
  const input = document.getElementById('community-chat-input');
  if (!input) return;
  input.value = input.value ? `${input.value} ${cheerText}` : cheerText;
  input.focus();
}

async function handleSendCommunityMessage(e) {
  e.preventDefault();
  if (!clubState.currentClub) return;
  const input = document.getElementById('community-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (!clubState.currentUser) {
    showToast('Inicia sesión para escribir en el Muro de la Afición.', 'info');
    return;
  }

  // Moderación estricta en cliente
  if (checkOffensiveLanguageClient(text)) {
    showToast('Tu mensaje infringe las normas de respeto deportivo de SportsLive.', 'error');
    return;
  }

  const user = clubState.currentUser;
  const payload = {
    message: text,
    user_name: user ? (user.full_name || user.username) : 'Aficionado'
  };

  const clubId = clubState.currentClub.id || clubState.currentClub.name;

  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('talentolive_token') || localStorage.getItem('sportslive_token');
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }

  try {
    const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/chat`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'No se pudo enviar el mensaje.', 'error');
    } else {
      input.value = '';
      fetchClubCommunityMessages(clubId);
    }
  } catch (err) {
    showToast('Error de red al conectar con el servidor', 'error');
  }
}

// Modal de patrocinadores y tarifas (mismo que en la portada)
function openSponsorModal(event) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const modal = document.getElementById('sponsor-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeSponsorModal() {
  const modal = document.getElementById('sponsor-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}
