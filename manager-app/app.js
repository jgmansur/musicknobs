const profile = {
  name: 'Jay Mansur',
  website: 'https://www.musicknobs.com',
  email: 'jgmansur2@gmail.com',
  whatsapp: '+528621417374',
  links: [
    ['YouTube Music Knobs', 'https://www.youtube.com/@musicknobs'],
    ['Instagram Music Knobs', 'https://www.instagram.com/musicknobs/'],
    ['TikTok Music Knobs', 'https://www.tiktok.com/@musicknobs'],
    ['Spotify Artista', 'https://open.spotify.com/artist/3bzFRaYQ7gRLdXnHh7rTts'],
    ['Patreon', 'https://www.patreon.com/c/JayMansur']
  ]
};

const socialLinksSample = profile.links.map(([name, url]) => ({ name, url }));

const cfg = window.MANAGER_APP_CONFIG || {};
const API_BASE = (cfg.apiBaseUrl || '').replace(/\/$/, '');
const API_TOKEN = cfg.apiToken || '';
const GOOGLE_CLIENT_ID = cfg.googleClientId || '';
const GOOGLE_SCOPES = 'openid email profile';
const AUTH_STORAGE_KEY = 'managerApp.googleAuth';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const ADMIN_EMAILS = ['jgmansur2@gmail.com'];
const DEV_AUTH_BYPASS_LOCAL = Boolean(cfg.devAuthBypassLocal);

let googleTokenClient = null;
let googleAccessToken = '';
let googleProfile = null;
let googleInitInterval = null;
let googleTokenExpiryAt = 0;
let googleTokenRefreshTimer = null;
let googleLastRequestInteractive = true;
let isAuthenticated = false;
let contactsCache = [];
let contactsSource = 'api';
let contactsSearchQuery = '';
let tasksCache = [];
let messagesCache = [];
let taskAssigneeUsers = [
  { email: 'jgmansur2@gmail.com', name: 'Jay Mansur' },
  { email: 'xeronimo3@gmail.com', name: 'Xeronimo' },
  { email: 'ricardo.calanda@gmail.com', name: 'Ricardo' }
];
let tasksNextCursor = '';
let tasksHasMore = false;
let tasksScope = 'all';
let catalogCache = [];
let catalogGenreFilter = 'Todas';
let catalogNowPlayingId = '';
let catalogNowCardOpen = false;
let playlistsCache = [];
let selectedPlaylistId = '';
let contactsVisibleCount = 12;
let messagesVisibleCount = 20;
let catalogVisibleCount = 20;
let catalogSearchQuery = '';
let catalogFilterView = 'genres';
let catalogDeepLinkSongId = '';
let catalogDeepLinkPlaylistId = '';
let catalogDeepLinkAutoplay = false;
let catalogDeepLinkHandled = false;
let catalogRandomMode = false;

const CONTACTS_PAGE_STEP = 12;
const MESSAGES_PAGE_STEP = 20;
const CATALOG_PAGE_STEP = 20;
const CATALOG_PROGRESS_REFRESH_MS = 350;
const CATALOG_AUTOPLAY_HINT = '[DALE CLICK A LA CANCIÓN SELECCIONADA]';
const PUBLIC_TABS = new Set(['catalog', 'links']);

const configuredTracks = Array.isArray(window.MANAGER_TRACKS) ? window.MANAGER_TRACKS : [];

const catalogPlayer = {
  howl: null,
  currentTrackIndex: -1,
  isLoading: false,
  isPlaying: false,
  progressTimer: null,
  volume: 0.8,
  isSeeking: false,
  activeSoundId: null,
  pendingPlay: false,
};

function isLocalDevHost() {
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPublicTab(tabName) {
  return PUBLIC_TABS.has(String(tabName || '').trim().toLowerCase());
}

function getActiveTabName() {
  const active = document.querySelector('.tab.active');
  return String(active?.dataset?.tab || 'overview');
}

function activateTab(tabName) {
  const target = String(tabName || '').trim();
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === target);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${target}`);
  });
}

function updateAuthGateForCurrentTab() {
  const locked = !isAuthenticated && !isPublicTab(getActiveTabName());
  setAuthGate(locked);
}

function shouldBypassAuthForLocalDev() {
  if (!isLocalDevHost()) return false;
  const params = new URLSearchParams(window.location.search || '');
  const byQuery = params.get('dev_auth_bypass') === '1';
  return DEV_AUTH_BYPASS_LOCAL || byQuery;
}

function enableLocalDevBypassMode() {
  const ownerEmail = ADMIN_EMAILS[0] || 'jgmansur2@gmail.com';
  googleAccessToken = 'local-dev-bypass';
  googleTokenExpiryAt = Date.now() + (60 * 60 * 1000);
  googleProfile = { email: ownerEmail, name: 'Jay Mansur (local dev)' };
  setAuthenticated(true);
  setOauthStatus('Modo local activo (sin login Google). Usa ?dev_auth_bypass=1 solo en localhost.');

  const toggleBtn = document.getElementById('google-auth-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = 'Dev Local';
    toggleBtn.disabled = true;
  }

  const gateBtn = document.getElementById('auth-gate-login');
  if (gateBtn) {
    gateBtn.textContent = 'Dev Local';
    gateBtn.disabled = true;
  }
}

const catalogSample = configuredTracks.length
  ? configuredTracks.map((track, index) => ({
      id: String(track.id || `track-config-${index + 1}`),
      obra: String(track.title || `Track ${index + 1}`).trim(),
      autores: String(track.artist || '—').trim(),
      generos: String(track.genre || '—').trim(),
      drive: String(track.drive || '').trim(),
      fileId: String(track.fileId || '').trim(),
      cover: String(track.cover || '').trim(),
    }))
  : [
      { obra: 'Tema Demo 1', autores: 'Jay Mansur', generos: 'Regional Mexicano', drive: '', fileId: '', cover: '' },
      { obra: 'Tema Demo 2', autores: 'Jay Mansur, Alejandro De Nigris', generos: 'Pop', drive: '', fileId: '', cover: '' }
    ];

const contactsSample = [
  {
    nombre: 'Ricardo Calanda',
    rol: 'Manager',
    correo: 'ricardo.calanda@gmail.com',
    telefono: '',
    whatsapp: '',
    instagram: '',
    tiktok: '',
    direccion: ''
  },
  {
    nombre: 'Xeronimo Mansur',
    rol: 'Compositor/Productor',
    correo: 'xeronimo3@gmail.com',
    telefono: '',
    whatsapp: '',
    instagram: '',
    tiktok: '',
    direccion: ''
  }
];

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`;
  return h;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: apiHeaders() });
  if (!r.ok) {
    let details = '';
    try {
      const body = await r.json();
      details = body?.error || body?.message || JSON.stringify(body);
    } catch {
      details = await r.text();
    }
    throw new Error(`HTTP ${r.status}${details ? ` - ${details}` : ''}`);
  }
  return r.json();
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseSubtasksInput(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((title) => ({ title, done: false }));
}

function setStatus(id, text, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', Boolean(isError));
  if (id === 'catalog-status') {
    const normalized = String(text || '').toUpperCase();
    el.classList.toggle('autoplay-hint', normalized.includes('DALE CLICK A LA CANCIÓN SELECCIONADA'));
  }
}

function setShareActions() {
  const mailShare = document.getElementById('mail-share');
  const waShare = document.getElementById('wa-share');
  if (!mailShare || !waShare) return;

  const subject = encodeURIComponent('Jay Mansur · Perfil para Manager');
  const body = encodeURIComponent(
    `Te comparto el perfil de ${profile.name}\n` +
    `Sitio: ${profile.website}\n` +
    `Contacto: ${profile.email}`
  );
  mailShare.href = `mailto:?subject=${subject}&body=${body}`;

  const waText = encodeURIComponent(
    `Perfil Manager de ${profile.name}\n${profile.website}\nContacto: ${profile.email}`
  );
  waShare.href = `https://wa.me/?text=${waText}`;
}

function setLinks(rows = socialLinksSample) {
  const list = document.getElementById('links-list');
  if (!list) return;

  list.innerHTML = rows
    .map((item) => {
      const name = item?.name || 'Sin nombre';
      const url = item?.url || '#';
      return `<li><a href="${url}" target="_blank" rel="noopener">${name}</a></li>`;
    })
    .join('');
}

function renderPlaylists() {
  const filter = document.getElementById('catalog-playlist-filter');
  const selectedLabel = document.getElementById('playlist-selected-label');
  if (filter) {
    filter.innerHTML = `<option value="">Selecciona playlist destino</option>${playlistsCache
      .map((pl) => `<option value="${escapeHtml(pl.id)}" ${selectedPlaylistId === pl.id ? 'selected' : ''}>${escapeHtml(pl.name)} (${Number(pl.trackCount || 0)})</option>`)
      .join('')}`;
  }

  const active = playlistsCache.find((pl) => pl.id === selectedPlaylistId);
  if (selectedLabel) selectedLabel.textContent = `Destino: ${active?.name || 'ninguna'}`;
}

function syncPlaylistCreateControlsVisibility() {
  // Controles de playlists viven dentro de la pestaña lateral en renderCatalog.
}

async function loadPlaylistsFromApi() {
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/playlists`);
    playlistsCache = Array.isArray(res.data)
      ? res.data.map((pl) => ({
          id: String(pl.id || ''),
          name: String(pl.name || 'Playlist').trim(),
          trackCount: Number(pl.trackCount || 0),
          tracks: Array.isArray(pl.tracks) ? pl.tracks : []
        }))
      : [];

    if (selectedPlaylistId && !playlistsCache.some((pl) => pl.id === selectedPlaylistId)) {
      selectedPlaylistId = '';
    }
    renderPlaylists();
    renderCatalog();
    applyCatalogDeepLinkIfNeeded();
  } catch (e) {
    playlistsCache = [];
    selectedPlaylistId = '';
    renderPlaylists();
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudieron cargar playlists: ${reason}`, true);
  }
}

async function createPlaylist(nameArg = '') {
  if (!isAuthenticated) return null;
  const input = document.getElementById('playlist-name');
  const name = String(nameArg || input?.value || '').trim();
  if (!name) {
    setStatus('catalog-status', 'Escribe nombre para la playlist.', true);
    return null;
  }

  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ name, ownerEmail: getViewerEmail() })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (input) input.value = '';
    const paneInput = document.getElementById('playlist-name-pane');
    if (paneInput) paneInput.value = '';
    setStatus('catalog-status', 'Playlist creada.');
    await loadPlaylistsFromApi();
    const payload = await r.json().catch(() => ({}));
    if (payload?.id) {
      selectedPlaylistId = String(payload.id);
      renderPlaylists();
      renderCatalog();
    }
    return String(payload?.id || '');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo crear playlist: ${reason}`, true);
    return null;
  }
}

async function deletePlaylist(playlistId = selectedPlaylistId) {
  if (!isAuthenticated) return;
  const targetId = String(playlistId || '').trim();
  if (!targetId) {
    setStatus('catalog-status', 'Selecciona una playlist para borrar.', true);
    return;
  }

  const target = playlistsCache.find((pl) => pl.id === targetId);
  const targetName = target?.name || 'playlist';
  const confirmed = window.confirm(`¿Borrar playlist \"${targetName}\"? Esta acción no se puede deshacer.`);
  if (!confirmed) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${targetId}`, {
      method: 'DELETE',
      headers: apiHeaders(),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (selectedPlaylistId === targetId) selectedPlaylistId = '';
    setStatus('catalog-status', `Playlist borrada: ${targetName}.`);
    await loadPlaylistsFromApi();
    renderCatalog();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo borrar playlist: ${reason}`, true);
  }
}

async function addSongToSpecificPlaylist(songId, targetPlaylistId) {
  if (!isAuthenticated || !songId || !targetPlaylistId) return;
  const song = catalogCache.find((s) => s.id === songId);
  if (!song) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${targetPlaylistId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'add_track', trackId: song.id, trackTitle: song.obra || 'Track' })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('catalog-status', `Agregada a playlist: ${song.obra || 'canción'}.`);
    await loadPlaylistsFromApi();
    renderCatalog();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo agregar a playlist: ${reason}`, true);
  }
}

let pendingPlaylistSongId = '';

function openPlaylistCreateModal(songId) {
  pendingPlaylistSongId = songId;
  const modal = document.getElementById('playlist-create-modal');
  const input = document.getElementById('playlist-modal-name');
  if (modal) modal.classList.remove('hidden');
  if (input) {
    input.value = '';
    input.focus();
  }
}

function closePlaylistCreateModal() {
  pendingPlaylistSongId = '';
  const modal = document.getElementById('playlist-create-modal');
  if (modal) modal.classList.add('hidden');
}

function setupPlaylistModal() {
  document.getElementById('playlist-modal-cancel')?.addEventListener('click', closePlaylistCreateModal);
  document.getElementById('playlist-modal-save')?.addEventListener('click', async () => {
    const input = document.getElementById('playlist-modal-name');
    const name = input?.value?.trim();
    if (!name) {
      alert('Ponle un nombre a tu playlist');
      return;
    }
    
    // createPlaylist already sets selectedPlaylistId and re-renders
    const newPlId = await createPlaylist(name);
    if (newPlId && pendingPlaylistSongId) {
       await addSongToSpecificPlaylist(pendingPlaylistSongId, newPlId);
    }
    closePlaylistCreateModal();
  });
}

async function removeSongFromPlaylist(songId) {
  if (!isAuthenticated || !songId) return;
  if (!selectedPlaylistId) {
    setStatus('catalog-status', 'Selecciona una playlist primero.', true);
    return;
  }

  const song = catalogCache.find((s) => s.id === songId);
  if (!song) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${selectedPlaylistId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'remove_track', trackId: song.id })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('catalog-status', `Quitada de playlist: ${song.obra || 'canción'}.`);
    await loadPlaylistsFromApi();
    renderCatalog();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo quitar de playlist: ${reason}`, true);
  }
}

function parseCatalogGenres(value) {
  return String(value || '')
    .split(/[,|/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function extractDriveFileId(raw) {
  const input = String(raw || '').trim();
  if (!input) return '';
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;

  try {
    const parsed = new URL(input);
    if (!parsed.hostname.includes('google.com')) return '';
    const pathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (pathMatch?.[1]) return pathMatch[1];
    const idQuery = parsed.searchParams.get('id');
    if (idQuery && /^[a-zA-Z0-9_-]{20,}$/.test(idQuery)) return idQuery;
    return '';
  } catch {
    return '';
  }
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getCatalogPlayerTrackByIndex(index = catalogPlayer.currentTrackIndex) {
  if (index < 0) return null;
  return catalogCache[index] || null;
}

function stopCatalogProgressTimer() {
  if (!catalogPlayer.progressTimer) return;
  clearInterval(catalogPlayer.progressTimer);
  catalogPlayer.progressTimer = null;
}

function refreshCatalogProgressUi() {
  const progress = document.getElementById('catalog-player-progress');
  const current = document.getElementById('catalog-player-current');
  const duration = document.getElementById('catalog-player-duration');
  const howl = catalogPlayer.howl;
  if (!progress || !current || !duration || !howl || !howl.state || howl.state() !== 'loaded') return;

  const total = Number(howl.duration() || 0);
  const seek = Number(howl.seek(catalogPlayer.activeSoundId || undefined) || 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, (seek / total) * 100)) : 0;

  if (!catalogPlayer.isSeeking) {
    progress.value = `${percent}`;
  }
  current.textContent = formatTime(seek);
  duration.textContent = formatTime(total);
}

function startCatalogProgressTimer() {
  stopCatalogProgressTimer();
  catalogPlayer.progressTimer = setInterval(() => {
    refreshCatalogProgressUi();
  }, CATALOG_PROGRESS_REFRESH_MS);
}

function setCatalogPlayerStatus(text, isError = false) {
  const status = document.getElementById('catalog-player-status');
  if (!status) return;
  const normalized = String(text || '').toUpperCase();
  status.textContent = normalized.includes('DALE CLICK A LA CANCIÓN SELECCIONADA') ? '' : text;
  status.classList.toggle('error', Boolean(isError));
}

function clearCatalogHowl() {
  stopCatalogProgressTimer();
  if (catalogPlayer.howl) {
    catalogPlayer.howl.unload();
  }
  catalogPlayer.howl = null;
  catalogPlayer.isPlaying = false;
  catalogPlayer.isLoading = false;
  catalogPlayer.activeSoundId = null;
  catalogPlayer.pendingPlay = false;
}

function requestCatalogPlay() {
  const howl = catalogPlayer.howl;
  if (!howl) return;
  if (catalogPlayer.pendingPlay) return;

  const activeId = catalogPlayer.activeSoundId;
  if (activeId && howl.playing(activeId)) return;

  catalogPlayer.pendingPlay = true;
  try {
    if (activeId) {
      howl.play(activeId);
      return;
    }
    const id = howl.play();
    catalogPlayer.activeSoundId = typeof id === 'number' ? id : catalogPlayer.activeSoundId;
  } catch {
    catalogPlayer.pendingPlay = false;
  }
}

function extractHowlerReasonText(idOrCode, maybeCode) {
  const bits = [idOrCode, maybeCode]
    .flatMap((value) => {
      if (value == null) return [];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [String(value)];
      }
      if (typeof value === 'object') {
        const msg = value.message ? String(value.message) : '';
        const name = value.name ? String(value.name) : '';
        const text = String(value);
        return [msg, name, text].filter(Boolean);
      }
      return [String(value)];
    })
    .filter(Boolean);

  return bits.join(' | ').toLowerCase();
}

function isAutoplayInteractionBlock(idOrCode, maybeCode) {
  const reason = extractHowlerReasonText(idOrCode, maybeCode);
  if (!reason) return false;
  return (
    reason.includes('notallowederror') ||
    reason.includes('user interaction') ||
    reason.includes('playback was unable to start') ||
    reason.includes('interactuar con el documento') ||
    reason.includes('gesture') ||
    reason.includes('play() failed')
  );
}

function updateCatalogPlayerUi() {
  const track = getCatalogPlayerTrackByIndex();
  const title = document.getElementById('catalog-player-track-title');
  const artist = document.getElementById('catalog-player-track-artist');
  const playBtn = document.getElementById('catalog-play-toggle');
  const randomBtn = document.getElementById('catalog-random');
  const cover = document.getElementById('catalog-player-cover');
  const coverPlaceholder = document.getElementById('catalog-player-cover-placeholder');
  const progress = document.getElementById('catalog-player-progress');

  if (title) title.textContent = track?.obra || 'Selecciona una canción';
  if (artist) artist.textContent = track?.autores || '—';
  if (playBtn) {
    if (catalogPlayer.isLoading) {
      playBtn.textContent = 'Cargando...';
      playBtn.disabled = true;
    } else {
      playBtn.disabled = !track;
      playBtn.textContent = catalogPlayer.isPlaying ? '⏸ Pause' : '▶️ Play';
    }
  }

  if (randomBtn) {
    randomBtn.classList.toggle('active', catalogRandomMode);
    randomBtn.setAttribute('aria-pressed', catalogRandomMode ? 'true' : 'false');
    randomBtn.textContent = catalogRandomMode ? '🔀 ON' : '🔀';
  }

  if (cover && coverPlaceholder) {
    if (track?.cover) {
      cover.src = track.cover;
      cover.classList.add('visible');
      coverPlaceholder.classList.add('hidden');
    } else {
      cover.removeAttribute('src');
      cover.classList.remove('visible');
      coverPlaceholder.classList.remove('hidden');
    }
  }

  if (!track && progress) {
    progress.value = '0';
    const current = document.getElementById('catalog-player-current');
    const duration = document.getElementById('catalog-player-duration');
    if (current) current.textContent = '0:00';
    if (duration) duration.textContent = '0:00';
  }
}

function buildSecureAudioUrl(track) {
  if (!track) return '';
  if (!API_BASE) return '';
  if (!track.fileId) return '';
  return `${API_BASE}/api/audio/${encodeURIComponent(track.fileId)}`;
}

function playNextCatalogTrack(step = 1) {
  if (!catalogCache.length) return;
  if (catalogRandomMode && step > 0) {
    playRandomCatalogTrack();
    return;
  }
  const current = catalogPlayer.currentTrackIndex >= 0 ? catalogPlayer.currentTrackIndex : 0;
  const next = (current + step + catalogCache.length) % catalogCache.length;
  void loadCatalogTrack(next, { autoplay: true });
}

function playRandomCatalogTrack() {
  if (!catalogCache.length) return;
  if (catalogCache.length === 1) {
    void loadCatalogTrack(0, { autoplay: true });
    return;
  }

  const current = catalogPlayer.currentTrackIndex;
  let next = current;
  while (next === current) {
    next = Math.floor(Math.random() * catalogCache.length);
  }
  void loadCatalogTrack(next, { autoplay: true });
}

function toggleCatalogRandomMode() {
  catalogRandomMode = !catalogRandomMode;
  updateCatalogPlayerUi();

  if (catalogRandomMode) {
    setStatus('catalog-status', 'Modo random activado. Se mezclará al avanzar y al terminar cada canción.');
    playRandomCatalogTrack();
    return;
  }

  setStatus('catalog-status', 'Modo random desactivado. Reproducción normal.');
}

async function loadCatalogTrack(index, { autoplay = false } = {}) {
  const track = catalogCache[index];
  if (!track) {
    setStatus('catalog-status', 'No existe la pista seleccionada.', true);
    return;
  }

  if (!window.Howl) {
    setStatus('catalog-status', 'Howler no está disponible. Ejecuta npm run sync:howler.', true);
    return;
  }

  if (!track.fileId) {
    setStatus('catalog-status', `La pista "${track.obra || 'sin título'}" no tiene fileId de Google Drive.`, true);
    setCatalogPlayerStatus('Falta fileId de Google Drive', true);
    return;
  }

  const secureUrl = buildSecureAudioUrl(track);
  if (!secureUrl) {
    setStatus('catalog-status', 'No hay apiBaseUrl para resolver audio seguro.', true);
    setCatalogPlayerStatus('apiBaseUrl faltante en config.js', true);
    return;
  }

  clearCatalogHowl();
  catalogPlayer.currentTrackIndex = index;
  catalogNowPlayingId = track.id;
  catalogNowCardOpen = false;
  catalogPlayer.isLoading = true;
  setCatalogPlayerStatus('Validando permisos y preparando stream...');
  updateCatalogPlayerUi();
  renderCatalog();

  const howl = new window.Howl({
    src: [secureUrl],
    html5: true,
    volume: catalogPlayer.volume,
    preload: true,
    autoplay: false,
  });

  catalogPlayer.howl = howl;

  howl.on('load', () => {
    if (catalogPlayer.howl !== howl) return;
    catalogPlayer.isLoading = false;
    setCatalogPlayerStatus('Pista lista');
    updateCatalogPlayerUi();
    refreshCatalogProgressUi();
  });

  howl.on('play', (id) => {
    if (catalogPlayer.howl !== howl) return;
    if (typeof id === 'number') catalogPlayer.activeSoundId = id;
    catalogPlayer.isPlaying = true;
    catalogPlayer.isLoading = false;
    catalogPlayer.pendingPlay = false;
    setCatalogPlayerStatus('Reproduciendo');
    setStatus('catalog-status', `Reproduciendo: ${track.obra || 'canción'}.`);
    updateCatalogPlayerUi();
    startCatalogProgressTimer();
    renderCatalog();
  });

  howl.on('pause', () => {
    if (catalogPlayer.howl !== howl) return;
    catalogPlayer.isPlaying = false;
    catalogPlayer.pendingPlay = false;
    setCatalogPlayerStatus('Pausado');
    updateCatalogPlayerUi();
    stopCatalogProgressTimer();
    refreshCatalogProgressUi();
  });

  howl.on('stop', () => {
    if (catalogPlayer.howl !== howl) return;
    catalogPlayer.isPlaying = false;
    catalogPlayer.pendingPlay = false;
    updateCatalogPlayerUi();
    stopCatalogProgressTimer();
    refreshCatalogProgressUi();
  });

  howl.on('end', () => {
    if (catalogPlayer.howl !== howl) return;
    catalogPlayer.pendingPlay = false;
    playNextCatalogTrack(1);
  });

  const onHowlerError = (eventName, id, code) => {
    if (catalogPlayer.howl !== howl) return;

    if (isAutoplayInteractionBlock(id, code)) {
      catalogPlayer.isLoading = false;
      catalogPlayer.isPlaying = false;
      catalogPlayer.pendingPlay = false;
      stopCatalogProgressTimer();
      updateCatalogPlayerUi();
      setCatalogPlayerStatus('');
      setStatus('catalog-status', CATALOG_AUTOPLAY_HINT);
      return;
    }

    catalogPlayer.isLoading = false;
    catalogPlayer.isPlaying = false;
    catalogPlayer.pendingPlay = false;
    stopCatalogProgressTimer();
    updateCatalogPlayerUi();
    setCatalogPlayerStatus('Error al cargar audio', true);
    const reason = code ? ` (${code})` : '';
    setStatus('catalog-status', `No se pudo reproducir "${track.obra || 'canción'}"${reason}. Revisa permisos de Google Drive.`, true);
    console.error(`[howler:${eventName}]`, { id, code, trackId: track.id, fileId: track.fileId });
  };

  howl.on('loaderror', (id, code) => onHowlerError('loaderror', id, code));
  howl.on('playerror', (id, code) => onHowlerError('playerror', id, code));

  if (autoplay) {
    requestCatalogPlay();
  }
}

function setCatalogNowCard(song) {
  const card = document.getElementById('catalog-now-card');
  if (!card) return;
  if (!song || !catalogNowCardOpen) {
    card.classList.add('hidden');
    card.innerHTML = '';
    return;
  }

  const share = song.drive ? `<a href="${escapeHtml(song.drive)}" target="_blank" rel="noopener">Abrir enlace original</a>` : 'Sin enlace';
  const secure = song.fileId ? 'Audio privado servido por /api/audio/:fileId' : 'Sin fileId configurado';
  card.innerHTML = `
    <div class="catalog-now-card-inner">
      <h4>${escapeHtml(song.obra || 'Sin título')}</h4>
      <p><strong>Compositores:</strong> ${escapeHtml(song.autores || '—')}</p>
      <p><strong>Géneros:</strong> ${escapeHtml(song.generos || '—')}</p>
      <p><strong>Stream:</strong> ${escapeHtml(secure)}</p>
      <p><strong>Enlace:</strong> ${share}</p>
    </div>
  `;
  card.classList.remove('hidden');
}

function getCurrentCatalogSong() {
  return catalogCache.find((s) => s.id === catalogNowPlayingId) || null;
}

function initCatalogDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const songId = String(params.get('song') || '').trim();
  const playlistId = String(params.get('playlist') || '').trim();
  const autoplay = String(params.get('autoplay') || '').trim();
  const targetTab = String(params.get('tab') || '').trim().toLowerCase();

  if (targetTab === 'catalog') {
    activateTab('catalog');
    updateAuthGateForCurrentTab();
  }

  if (!songId && !playlistId) return;
  catalogDeepLinkSongId = songId;
  catalogDeepLinkPlaylistId = playlistId;
  catalogDeepLinkAutoplay = autoplay === '1' || autoplay === 'true';
  catalogDeepLinkHandled = false;
}

function buildCatalogListenLink(songId) {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'catalog');
  url.searchParams.set('song', String(songId || ''));
  url.searchParams.delete('playlist');
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

function buildCatalogPlaylistListenLink(playlistId, songId = '') {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'catalog');
  url.searchParams.set('playlist', String(playlistId || ''));
  if (songId) {
    url.searchParams.set('song', String(songId));
  } else {
    url.searchParams.delete('song');
  }
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

function applyCatalogDeepLinkIfNeeded() {
  if (catalogDeepLinkHandled) return;

  if (catalogDeepLinkPlaylistId && playlistsCache.some((pl) => pl.id === catalogDeepLinkPlaylistId)) {
    selectedPlaylistId = catalogDeepLinkPlaylistId;
    renderPlaylists();
  }

  const playlist = playlistsCache.find((pl) => pl.id === selectedPlaylistId);
  const fallbackSongId = String(playlist?.tracks?.[0]?.id || '').trim();
  const targetSongId = String(catalogDeepLinkSongId || fallbackSongId || '').trim();

  if (!targetSongId) {
    if (catalogDeepLinkPlaylistId) {
      catalogDeepLinkHandled = true;
      catalogFilterView = 'playlists';
      catalogGenreFilter = 'Todas';
      activateTab('catalog');
      updateAuthGateForCurrentTab();
      renderCatalog();
    }
    return;
  }

  const index = catalogCache.findIndex((row) => String(row.id) === targetSongId);
  if (index < 0) return;

  const track = catalogCache[index];
  catalogDeepLinkHandled = true;
  if (catalogDeepLinkPlaylistId && playlistsCache.some((pl) => pl.id === catalogDeepLinkPlaylistId)) {
    selectedPlaylistId = catalogDeepLinkPlaylistId;
    renderPlaylists();
  }

  if (catalogDeepLinkPlaylistId) {
    catalogFilterView = 'playlists';
    catalogGenreFilter = 'Todas';
  } else {
    catalogFilterView = 'genres';
    catalogGenreFilter = parseCatalogGenres(track.generos)[0] || 'Todas';
  }
  catalogVisibleCount = Math.max(catalogVisibleCount, index + 1, CATALOG_PAGE_STEP);

  activateTab('catalog');
  updateAuthGateForCurrentTab();

  void loadCatalogTrack(index, { autoplay: catalogDeepLinkAutoplay });
}

function renderCatalog() {
  const genresEl = document.getElementById('catalog-genres');
  const songsEl = document.getElementById('catalog-songs');
  const selectedGenreEl = document.getElementById('catalog-selected-genre');
  const playingNowBtn = document.getElementById('catalog-playing-now');
  const playingNowTitle = document.getElementById('catalog-playing-now-title');
  const filterTabGenres = document.getElementById('catalog-filter-tab-genres');
  const filterTabPlaylists = document.getElementById('catalog-filter-tab-playlists');
  if (!genresEl || !songsEl || !selectedGenreEl || !playingNowBtn || !playingNowTitle || !filterTabGenres || !filterTabPlaylists) return;

  const genres = Array.from(new Set(catalogCache.flatMap((row) => parseCatalogGenres(row.generos))));
  const allGenres = ['Todas', ...genres.sort((a, b) => a.localeCompare(b, 'es'))];
  if (!allGenres.includes(catalogGenreFilter)) catalogGenreFilter = 'Todas';

  if (!['genres', 'playlists'].includes(catalogFilterView)) {
    catalogFilterView = 'genres';
  }

  filterTabGenres.classList.toggle('active', catalogFilterView === 'genres');
  filterTabPlaylists.classList.toggle('active', catalogFilterView === 'playlists');

  if (catalogFilterView === 'genres') {
    genresEl.innerHTML = `
      <li>
        <label class="catalog-genre-label" for="catalog-genre-select">Género</label>
        <select id="catalog-genre-select" class="catalog-genre-select">
          ${allGenres
            .map((g) => `<option value="${escapeHtml(g)}" ${catalogGenreFilter === g ? 'selected' : ''}>${escapeHtml(g)}</option>`)
            .join('')}
        </select>
      </li>
    `;
  } else {
    genresEl.innerHTML = `
      <li>
        <label class="catalog-genre-label" for="catalog-playlist-select-pane">Playlist</label>
        <select id="catalog-playlist-select-pane" class="catalog-genre-select">
          <option value="">Selecciona playlist</option>
          ${playlistsCache
            .map((pl) => `<option value="${escapeHtml(pl.id)}" ${selectedPlaylistId === pl.id ? 'selected' : ''}>${escapeHtml(pl.name)} (${Number(pl.trackCount || 0)})</option>`)
            .join('')}
        </select>
        ${isAuthenticated
          ? `<div class="catalog-playlist-pane-actions" style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <button class="mini-btn" id="playlist-create-pane-toggle" type="button" style="width: 100%;">Crear nueva playlist</button>
              <div id="playlist-create-pane-form" class="hidden" style="display: flex; flex-direction: column; gap: 0.25rem;">
                <input id="playlist-name-pane" class="catalog-genre-select" type="text" placeholder="Nombre..." />
                <button class="mini-btn" id="playlist-create-pane-submit" type="button" style="background: var(--brand); color: white;">Crear</button>
              </div>
              <button class="mini-btn" id="playlist-delete-pane" type="button" style="width: 100%;">Borrar seleccionada</button>
            </div>`
          : ''}
      </li>
    `;
  }

  const byGenre = catalogGenreFilter === 'Todas'
    ? catalogCache
    : catalogCache.filter((row) => parseCatalogGenres(row.generos).includes(catalogGenreFilter));

  const baseForSearch = catalogFilterView === 'playlists' ? catalogCache : byGenre;

  const bySearch = !catalogSearchQuery.trim()
    ? baseForSearch
    : baseForSearch.filter((row) => {
        const haystack = [row.obra, row.autores, row.generos, row.drive, row.fileId]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        return haystack.includes(catalogSearchQuery.trim().toLowerCase());
      });

  const selectedPlaylist = playlistsCache.find((pl) => pl.id === selectedPlaylistId);
  const selectedPlaylistTrackIds = new Set(Array.isArray(selectedPlaylist?.tracks) ? selectedPlaylist.tracks.map((t) => String(t.id || '')) : []);

  const visibleSongs = catalogFilterView === 'playlists'
    ? bySearch.filter((row) => selectedPlaylistTrackIds.has(String(row.id || '')))
    : bySearch;
  const pagedSongs = visibleSongs.slice(0, catalogVisibleCount);

  selectedGenreEl.textContent = catalogFilterView === 'playlists'
    ? (selectedPlaylist?.name || 'Playlist')
    : catalogGenreFilter;

  songsEl.innerHTML = pagedSongs.length
    ? pagedSongs
        .map((row) => `
          <li>
            <div class="catalog-song-row ${catalogNowPlayingId === row.id ? 'is-active' : ''}">
              <button class="catalog-song-main" data-catalog-play="${escapeHtml(row.id)}">
                <strong>${escapeHtml(row.obra || 'Sin título')}</strong>
                <span class="catalog-authors"><span class="catalog-authors-text">${escapeHtml(row.autores || '—')}</span></span>
              </button>
              <div class="actions">
                ${!isAuthenticated ? '' : (
                  (catalogFilterView === 'playlists' && selectedPlaylistId && selectedPlaylistTrackIds.has(String(row.id || '')))
                    ? `<button class="mini-btn" data-catalog-remove-playlist="${escapeHtml(row.id)}">−</button>`
                    : `<details class="task-actions-menu catalog-playlist-menu">
                        <summary>
                          <span class="task-actions-toggle" role="button" aria-label="Añadir a playlist" style="padding: 0 6px;">+</span>
                        </summary>
                        <div class="task-actions-dropdown">
                          <button class="mini-btn" data-catalog-create-playlist-for="${escapeHtml(row.id)}">Crear nueva playlist...</button>
                          ${playlistsCache.length ? '<hr class="soft-sep" style="margin: 0.25rem 0;" />' : ''}
                          ${playlistsCache.map(pl => `
                            <button class="mini-btn" data-catalog-add-to-specific="${escapeHtml(pl.id)}" data-song-id="${escapeHtml(row.id)}">
                              Añadir a: ${escapeHtml(pl.name)}
                            </button>
                          `).join('')}
                        </div>
                      </details>`
                )}
                ${isAuthenticated
                  ? `<details class="task-actions-menu catalog-share-menu">
                      <summary>
                        <span class="task-actions-toggle" role="button" aria-label="Compartir canción">⋯</span>
                      </summary>
                      <div class="task-actions-dropdown">
                        <button class="mini-btn" data-catalog-share-listen="${escapeHtml(row.id)}">Compartir escucha</button>
                        <button class="mini-btn" data-catalog-share-drive="${escapeHtml(row.id)}">Compartir Drive</button>
                      </div>
                    </details>`
                  : ''}
              </div>
            </div>
          </li>
        `)
        .join('')
    : `<li>${catalogFilterView === 'playlists' ? 'Sin canciones en esta playlist.' : 'Sin canciones en este género.'}</li>`;

  const genreSelect = document.getElementById('catalog-genre-select');
  if (genreSelect) {
    genreSelect.addEventListener('change', () => {
      catalogGenreFilter = String(genreSelect.value || 'Todas');
      catalogVisibleCount = CATALOG_PAGE_STEP;
      renderCatalog();
    });
  }

  const playlistPaneSelect = document.getElementById('catalog-playlist-select-pane');
  if (playlistPaneSelect) {
    playlistPaneSelect.addEventListener('change', () => {
      selectedPlaylistId = String(playlistPaneSelect.value || '');
      catalogVisibleCount = CATALOG_PAGE_STEP;
      renderPlaylists();
      renderCatalog();
    });
  }

  const playlistCreatePaneToggleBtn = document.getElementById('playlist-create-pane-toggle');
  const playlistCreatePaneForm = document.getElementById('playlist-create-pane-form');
  const playlistCreatePaneSubmit = document.getElementById('playlist-create-pane-submit');

  if (playlistCreatePaneToggleBtn && playlistCreatePaneForm) {
    playlistCreatePaneToggleBtn.addEventListener('click', () => {
      playlistCreatePaneForm.classList.toggle('hidden');
      const input = document.getElementById('playlist-name-pane');
      if (!playlistCreatePaneForm.classList.contains('hidden') && input) input.focus();
    });
  }

  if (playlistCreatePaneSubmit) {
    playlistCreatePaneSubmit.addEventListener('click', () => {
      const input = document.getElementById('playlist-name-pane');
      if (input && input.value) {
        createPlaylist(String(input.value.trim()));
      }
    });
  }

  const playlistDeletePaneBtn = document.getElementById('playlist-delete-pane');
  if (playlistDeletePaneBtn) {
    playlistDeletePaneBtn.addEventListener('click', () => {
      deletePlaylist();
    });
  }

  filterTabGenres.onclick = () => {
    catalogFilterView = 'genres';
    renderCatalog();
  };

  filterTabPlaylists.onclick = () => {
    catalogFilterView = 'playlists';
    catalogGenreFilter = 'Todas';
    renderCatalog();
  };

  songsEl.querySelectorAll('[data-catalog-play]').forEach((btn) => {
    btn.addEventListener('click', () => playCatalogSong(btn.dataset.catalogPlay || ''));
  });

  songsEl.querySelectorAll('[data-catalog-share-listen]').forEach((btn) => {
    btn.addEventListener('click', () => shareCatalogSongForListen(btn.dataset.catalogShareListen || ''));
  });

  songsEl.querySelectorAll('[data-catalog-share-drive]').forEach((btn) => {
    btn.addEventListener('click', () => shareCatalogSongDrive(btn.dataset.catalogShareDrive || ''));
  });

  songsEl.querySelectorAll('[data-catalog-create-playlist-for]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPlaylistCreateModal(btn.dataset.catalogCreatePlaylistFor || '');
      btn.closest('details')?.removeAttribute('open');
    });
  });

  songsEl.querySelectorAll('[data-catalog-add-to-specific]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const songId = btn.dataset.songId || '';
      const plId = btn.dataset.catalogAddToSpecific || '';
      if (songId && plId) {
        await addSongToSpecificPlaylist(songId, plId);
      }
      btn.closest('details')?.removeAttribute('open');
    });
  });

  songsEl.querySelectorAll('[data-catalog-remove-playlist]').forEach((btn) => {
    btn.addEventListener('click', () => removeSongFromPlaylist(btn.dataset.catalogRemovePlaylist || ''));
  });

  const currentSong = getCurrentCatalogSong();
  if (!currentSong) {
    playingNowBtn.classList.add('hidden');
    playingNowTitle.textContent = '—';
    setCatalogNowCard(null);
  } else {
    playingNowBtn.classList.remove('hidden');
    playingNowTitle.textContent = currentSong.obra || 'Sin título';
    setCatalogNowCard(currentSong);
  }

  playingNowBtn.onclick = () => {
    catalogNowCardOpen = !catalogNowCardOpen;
    setCatalogNowCard(getCurrentCatalogSong());
  };
}

function setCatalog(rows = catalogSample) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row, i) => ({
      id: String(row.id || `song-${i + 1}`),
      obra: String(row.obra || '').trim(),
      autores: String(row.autores || '').trim(),
      generos: String(row.generos || '').trim(),
      drive: String(row.drive || '').trim(),
      fileId: String(row.fileId || extractDriveFileId(row.drive || '')).trim(),
      cover: String(row.cover || '').trim(),
    }))
    .filter((row) => Boolean(row.obra || row.drive || row.fileId));

  const byKey = new Map();
  for (const row of normalized) {
    const key = [
      String(row.fileId || '').trim().toLowerCase(),
      String(row.drive || '').trim().toLowerCase(),
      String(row.obra || '').trim().toLowerCase(),
      String(row.autores || '').trim().toLowerCase()
    ].join('::');
    if (!byKey.has(key)) byKey.set(key, row);
  }

  catalogCache = Array.from(byKey.values());
  if (catalogNowPlayingId && !catalogCache.some((row) => row.id === catalogNowPlayingId)) {
    catalogNowPlayingId = '';
    catalogNowCardOpen = false;
    clearCatalogHowl();
    catalogPlayer.currentTrackIndex = -1;
    setCatalogPlayerStatus('Selecciona una canción para iniciar.');
  }

  if (!catalogCache.length) {
    clearCatalogHowl();
    catalogPlayer.currentTrackIndex = -1;
    setCatalogPlayerStatus('No hay pistas disponibles.');
  }

  updateCatalogPlayerUi();
  renderCatalog();
  applyCatalogDeepLinkIfNeeded();
}

async function shareCatalogSongForListen(songId) {
  const song = catalogCache.find((row) => row.id === songId);
  if (!song) {
    setStatus('catalog-status', 'No se encontró la canción para compartir.', true);
    return;
  }

  try {
    const listenLink = buildCatalogListenLink(song.id);
    const text = `${song.obra || 'Canción'} · Escúchala aquí`;
    if (navigator.share) {
      await navigator.share({
        title: song.obra || 'Canción',
        text,
        url: listenLink
      });
      setStatus('catalog-status', `Link de escucha compartido: ${song.obra || 'canción'}.`);
      return;
    }

    await navigator.clipboard.writeText(listenLink);
    setStatus('catalog-status', `Link de escucha copiado: ${song.obra || 'canción'}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo compartir para escucha: ${reason}`, true);
  }
}

async function shareSelectedPlaylistForListen() {
  const playlist = playlistsCache.find((pl) => pl.id === selectedPlaylistId);
  if (!playlist) {
    setStatus('catalog-status', 'Selecciona una playlist para compartir.', true);
    return;
  }

  const firstTrackId = String(playlist?.tracks?.[0]?.id || '').trim();

  try {
    const listenLink = buildCatalogPlaylistListenLink(playlist.id, firstTrackId);
    const text = `${playlist.name || 'Playlist'} · Escúchala aquí`;
    if (navigator.share) {
      await navigator.share({
        title: playlist.name || 'Playlist',
        text,
        url: listenLink
      });
      setStatus('catalog-status', `Playlist compartida: ${playlist.name || 'playlist'}.`);
      return;
    }

    await navigator.clipboard.writeText(listenLink);
    setStatus('catalog-status', `Link de playlist copiado: ${playlist.name || 'playlist'}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo compartir playlist: ${reason}`, true);
  }
}

async function shareCatalogSongDrive(songId) {
  const song = catalogCache.find((row) => row.id === songId);
  if (!song || !song.drive) {
    setStatus('catalog-status', 'Esta canción no tiene link de Google Drive para compartir.', true);
    return;
  }

  try {
    const text = `${song.obra || 'Canción'} · ${song.drive}`;
    if (navigator.share) {
      await navigator.share({
        title: song.obra || 'Canción',
        text,
        url: song.drive
      });
      setStatus('catalog-status', `Link de Drive compartido: ${song.obra || 'canción'}.`);
      return;
    }

    await navigator.clipboard.writeText(song.drive);
    setStatus('catalog-status', `Link de Drive copiado: ${song.obra || 'canción'}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo compartir Drive: ${reason}`, true);
  }
}

function playCatalogSong(songId) {
  const index = catalogCache.findIndex((row) => row.id === songId);
  if (index < 0) return;
  void loadCatalogTrack(index, { autoplay: true });
}

function setupCatalogPlayerControls() {
  const playToggle = document.getElementById('catalog-play-toggle');
  const prevBtn = document.getElementById('catalog-prev');
  const nextBtn = document.getElementById('catalog-next');
  const randomBtn = document.getElementById('catalog-random');
  const sharePlaylistBtn = document.getElementById('catalog-share-playlist');
  const progress = document.getElementById('catalog-player-progress');

  if (playToggle) {
    playToggle.addEventListener('click', () => {
      const track = getCatalogPlayerTrackByIndex();
      if (!track) {
        if (catalogCache.length) {
          void loadCatalogTrack(0, { autoplay: true });
        }
        return;
      }
      if (!catalogPlayer.howl) {
        void loadCatalogTrack(catalogPlayer.currentTrackIndex, { autoplay: true });
        return;
      }
      const activeId = catalogPlayer.activeSoundId;
      if (activeId && catalogPlayer.howl.playing(activeId)) {
        catalogPlayer.howl.pause(activeId);
      } else {
        requestCatalogPlay();
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      playNextCatalogTrack(-1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      playNextCatalogTrack(1);
    });
  }

  if (randomBtn) {
    randomBtn.addEventListener('click', () => {
      toggleCatalogRandomMode();
    });
  }

  if (sharePlaylistBtn) {
    sharePlaylistBtn.addEventListener('click', () => {
      shareSelectedPlaylistForListen();
    });
  }

  if (progress) {
    progress.addEventListener('input', () => {
      catalogPlayer.isSeeking = true;
      const howl = catalogPlayer.howl;
      if (!howl || howl.state() !== 'loaded') return;
      const duration = Number(howl.duration() || 0);
      const pct = Math.min(100, Math.max(0, Number(progress.value || 0)));
      howl.seek((pct / 100) * duration, catalogPlayer.activeSoundId || undefined);
      refreshCatalogProgressUi();
    });
    progress.addEventListener('change', () => {
      catalogPlayer.isSeeking = false;
      refreshCatalogProgressUi();
    });
  }

  setCatalogPlayerStatus('Selecciona una canción para iniciar.');
  updateCatalogPlayerUi();
}

function setTasks(rows = []) {
  tasksCache = rows;
  const list = document.getElementById('tasks-list');
  if (!list) return;

  list.innerHTML = rows
    .map((t) => {
      const assignee = t.assignee ? `Asignado: ${t.assignee}` : 'Sin asignar';
      const due = t.dueDate ? ` · Fecha: ${t.dueDate}` : '';
      const status = t.status || 'Pendiente';
      const canClose = status.toLowerCase() !== 'terminado';
      const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
      const subtasksHtml = subtasks.length
        ? `<ul class="subtasks-list">${subtasks
            .map((st, i) => `<li><label><input type="checkbox" data-task-subtoggle="${t.id}" data-subindex="${i}" ${st.done ? 'checked' : ''} /> ${escapeHtml(st.title)}</label></li>`)
            .join('')}</ul>`
        : '';

      return `
        <li>
          <div class="task-row">
            <div>
              <strong>${escapeHtml(t.title || 'Sin título')}</strong>
              <div class="task-meta">${escapeHtml(assignee)}${escapeHtml(due)} · Estatus: ${escapeHtml(status)}</div>
            </div>
            <details class="task-actions-menu">
              <summary class="task-actions-toggle" aria-label="Acciones de task">▾</summary>
              <div class="task-actions-dropdown">
                ${canClose ? `<button class="mini-btn" data-task-done="${t.id}">Terminar</button>` : ''}
                <button class="mini-btn" data-task-edit="${t.id}">Editar</button>
                <button class="mini-btn" data-task-delete="${t.id}">Borrar</button>
              </div>
            </details>
          </div>
          ${subtasksHtml}
        </li>
      `;
    })
    .join('');

  list.querySelectorAll('[data-task-done]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await markTaskDone(btn.dataset.taskDone || '');
    });
  });

  list.querySelectorAll('[data-task-edit]').forEach((btn) => {
    btn.addEventListener('click', () => beginEditTask(btn.dataset.taskEdit || ''));
  });

  list.querySelectorAll('[data-task-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteTask(btn.dataset.taskDelete || '');
    });
  });

  list.querySelectorAll('[data-task-subtoggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      await toggleSubtaskDone(input.dataset.taskSubtoggle || '', Number(input.dataset.subindex || -1), input.checked);
    });
  });

  const loadMore = document.getElementById('tasks-load-more');
  if (loadMore) {
    loadMore.disabled = !tasksHasMore;
    loadMore.textContent = tasksHasMore ? 'Cargar más' : 'Sin más tasks';
  }
}

function setMessages(rows = []) {
  messagesCache = rows;
  const list = document.getElementById('messages-list');
  const featuredList = document.getElementById('messages-featured');
  const loadMoreBtn = document.getElementById('messages-load-more');
  if (!list || !featuredList) return;

  const myEmail = String(googleProfile?.email || '').trim().toLowerCase();

  const featured = rows.filter((m) => Boolean(m.highlighted));

  featuredList.innerHTML = featured.length
    ? featured
        .map((m) => `
          <li>
            <strong>${escapeHtml(m.author || 'Anónimo')}</strong> ·
            <span>${escapeHtml(m.text || 'Sin mensaje')}</span>
          </li>
        `)
        .join('')
    : '<li>Sin mensajes destacados.</li>';

  const visibleRows = rows.slice(0, messagesVisibleCount);

  list.innerHTML = visibleRows
    .map((m) => {
      const author = m.author || 'Anónimo';
      const created = m.createdAt ? new Date(m.createdAt).toLocaleString('es-MX') : '';
      const label = m.highlighted ? 'Quitar destacado' : 'Destacar';
      const isMine = m.authorEmail && myEmail && m.authorEmail === myEmail;
      return `
        <li class="${isMine ? 'mine' : 'other'}">
          <div class="chat-bubble ${isMine ? 'mine' : ''}">
            <div class="chat-header">
              <div class="wa-meta">${escapeHtml(author)}${created ? ` · ${escapeHtml(created)}` : ''}</div>
              <button class="mini-btn message-feature-btn" data-message-feature="${m.id}" data-message-state="${m.highlighted ? '1' : '0'}">${label}</button>
            </div>
            <div class="message-text">${escapeHtml(m.text || 'Sin mensaje')}</div>
          </div>
        </li>
      `;
    })
    .join('');

  if (loadMoreBtn) {
    const canLoadMore = rows.length > visibleRows.length;
    loadMoreBtn.disabled = !canLoadMore;
    loadMoreBtn.textContent = canLoadMore ? 'Cargar más' : 'Sin más';
  }

  list.querySelectorAll('[data-message-feature]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.messageFeature || '';
      const current = btn.dataset.messageState === '1';
      await toggleFeaturedMessage(id, !current);
    });
  });

  const clearBtn = document.getElementById('clear-messages-log');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !isAdminUser());
  }

  if (rows.length) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
}

function isAdminUser() {
  const email = String(googleProfile?.email || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

function refreshAssigneeOptions() {
  const select = document.getElementById('task-assignee');
  if (!select) return;
  const current = select.value;
  const options = taskAssigneeUsers
    .map((u) => ({ email: String(u.email || '').trim().toLowerCase(), name: String(u.name || '').trim() }))
    .filter((u) => Boolean(u.email));

  select.innerHTML = `<option value="">Asignar a...</option>${options
    .map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name || u.email)}</option>`)
    .join('')}`;

  if (options.some((u) => u.email === current)) select.value = current;
}

function normalizeWhatsappLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}`;
}

function normalizeInstagramLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const user = raw.replace(/^@+/, '').trim();
  return user ? `https://www.instagram.com/${user}/` : '';
}

function normalizeTikTokLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const user = raw.replace(/^@+/, '').trim();
  return user ? `https://www.tiktok.com/@${user}` : '';
}

function applyContactsFilter(rows = []) {
  const q = contactsSearchQuery.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => {
    const haystack = [c.nombre, c.rol, c.correo, c.telefono, c.whatsapp, c.instagram, c.tiktok, c.direccion]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(q);
  });
}

function setContacts(rows = contactsSample) {
  contactsCache = rows;
  const list = document.getElementById('contacts-list');
  const loadMoreBtn = document.getElementById('contacts-load-more');
  if (!list) return;

  const filtered = applyContactsFilter(rows);
  const visible = filtered.slice(0, contactsVisibleCount);

  list.innerHTML = visible
    .map((c) => {
      const role = c.rol || 'Contacto';
      const email = c.correo ? `<a href="mailto:${escapeHtml(c.correo)}">${escapeHtml(c.correo)}</a>` : '';
      const phone = c.telefono || '';
      const whatsappHref = normalizeWhatsappLink(c.whatsapp);
      const whatsapp = whatsappHref ? `<a href="${whatsappHref}" target="_blank" rel="noopener">WhatsApp</a>` : '';
      const igHref = normalizeInstagramLink(c.instagram);
      const tiktokHref = normalizeTikTokLink(c.tiktok);
      const instagram = igHref ? `<a href="${igHref}" target="_blank" rel="noopener">Instagram</a>` : '';
      const tiktok = tiktokHref ? `<a href="${tiktokHref}" target="_blank" rel="noopener">TikTok</a>` : '';
      const address = c.direccion ? `Dirección: ${escapeHtml(c.direccion)}` : '';
      const parts = [role, email, phone, whatsapp, instagram, tiktok, address].filter(Boolean).join(' · ');
      return `
        <li>
          <div class="contact-card">
            <div class="contact-main">
              <div class="contact-name">${escapeHtml(c.nombre || 'Sin nombre')}</div>
              <div class="contact-meta">${parts || 'Sin detalles'}</div>
            </div>
            <div class="actions">
              <button class="mini-btn" data-contact-edit="${c.id || ''}">Editar</button>
              <button class="mini-btn" data-contact-delete="${c.id || ''}">Borrar</button>
            </div>
          </div>
        </li>
      `;
    })
    .join('');

  if (loadMoreBtn) {
    const canLoadMore = filtered.length > visible.length;
    loadMoreBtn.disabled = !canLoadMore;
    loadMoreBtn.textContent = canLoadMore ? 'Cargar más' : 'Sin más';
  }

  list.querySelectorAll('[data-contact-edit]').forEach((btn) => {
    btn.addEventListener('click', () => beginEditContact(btn.dataset.contactEdit || ''));
  });

  list.querySelectorAll('[data-contact-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteContact(btn.dataset.contactDelete || '');
    });
  });

  refreshAssigneeOptions();
}

function setOauthStatus(text, isError = false) {
  const el = document.getElementById('oauth-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#fda4af' : '';

  const gateStatus = document.getElementById('auth-gate-status');
  if (gateStatus) {
    gateStatus.textContent = text;
    gateStatus.style.color = isError ? '#fda4af' : '';
  }
}

function setAuthGate(locked) {
  const gate = document.getElementById('auth-gate');
  if (gate) gate.classList.toggle('active', locked);
  document.body.classList.toggle('auth-locked', locked);
}

function clearSensitiveData() {
  setContacts([]);
  setTasks([]);
  setMessages([]);
}

function clearStoredAuthSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // noop
  }
}

function persistAuthSession() {
  if (!googleAccessToken || !googleTokenExpiryAt) return;
  try {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: googleAccessToken,
        expiryAt: googleTokenExpiryAt,
        profile: googleProfile || null
      })
    );
  } catch {
    // noop
  }
}

function clearTokenRefreshTimer() {
  if (!googleTokenRefreshTimer) return;
  clearTimeout(googleTokenRefreshTimer);
  googleTokenRefreshTimer = null;
}

function requestTokenRefreshIfNeeded() {
  if (!isAuthenticated) return;
  requestGoogleTokenWithMode({ interactive: false });
}

function scheduleTokenRefresh() {
  clearTokenRefreshTimer();
  if (!googleTokenExpiryAt) return;

  const delay = Math.max(15_000, googleTokenExpiryAt - Date.now() - TOKEN_REFRESH_BUFFER_MS);
  googleTokenRefreshTimer = setTimeout(() => {
    requestTokenRefreshIfNeeded();
  }, delay);
}

function restoreStoredAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const savedToken = String(saved?.accessToken || '').trim();
    const savedExpiry = Number(saved?.expiryAt || 0);

    if (!savedToken || !savedExpiry || savedExpiry <= Date.now()) {
      clearStoredAuthSession();
      return false;
    }

    googleAccessToken = savedToken;
    googleTokenExpiryAt = savedExpiry;
    googleProfile = saved?.profile || null;
    setAuthenticated(true);
    setOauthStatus(`Sesión restaurada: ${googleProfile?.email || googleProfile?.name || 'usuario'}`);
    scheduleTokenRefresh();
    return true;
  } catch {
    clearStoredAuthSession();
    return false;
  }
}

function handleGoogleTokenSuccess(resp) {
  googleAccessToken = resp?.access_token || '';
  const expiresInSec = Number(resp?.expires_in || 3600);
  googleTokenExpiryAt = Date.now() + Math.max(300, expiresInSec) * 1000;

  const applyAuthState = (connectedLabel) => {
    setAuthenticated(true);
    setOauthStatus(connectedLabel);
    persistAuthSession();
    scheduleTokenRefresh();
  };

  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${googleAccessToken}` }
  })
    .then((infoResp) => {
      if (!infoResp.ok) throw new Error(`userinfo ${infoResp.status}`);
      return infoResp.json();
    })
    .then((profileResp) => {
      googleProfile = profileResp;
      applyAuthState(`Conectado: ${googleProfile.email || googleProfile.name || 'usuario'}`);
    })
    .catch(() => {
      applyAuthState('Conectado con Google (sin perfil).');
    });
}

function syncTabVisibility() {
  document.querySelectorAll('.tab').forEach((t) => {
    const tabName = t.dataset.tab;
    if (!isAuthenticated && !isPublicTab(tabName)) {
      t.style.display = 'none';
     } else {
      t.style.display = '';
     }
  });

  const refreshButtons = ['refresh-catalog', 'refresh-links'];
  refreshButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = isAuthenticated ? '' : 'none';
  });
}

function setAuthenticated(value) {
  isAuthenticated = Boolean(value);
  syncPlaylistCreateControlsVisibility();
  syncTabVisibility();

  const toggleBtn = document.getElementById('google-auth-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = isAuthenticated ? 'Cerrar sesión' : 'Login Google';
  }

  if (isAuthenticated) {
    loadMessagesFromApi();
    loadCatalogFromApi();
    loadPlaylistsFromApi();
    loadContactsFromNotion();
    loadTasksFromApi();
    loadLinksFromApi();
    updateAuthGateForCurrentTab();
    return;
  }

  tasksNextCursor = '';
  tasksHasMore = false;
  clearSensitiveData();
  loadCatalogFromApi();
  loadPlaylistsFromApi();
  loadLinksFromApi();
  if (!isPublicTab(getActiveTabName())) {
    activateTab('catalog');
  }
  updateAuthGateForCurrentTab();
}

function ensureGoogleOAuthClient() {
  if (googleTokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false;
  if (!GOOGLE_CLIENT_ID) {
    setOauthStatus('OAuth no disponible: falta googleClientId.', true);
    return false;
  }

  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (resp) => {
      if (resp?.error) {
        if (googleLastRequestInteractive) {
          setOauthStatus(`Error OAuth: ${resp.error}`, true);
        } else if (!isAuthenticated) {
          setOauthStatus('Tu sesión expiró. Presiona Login Google para reconectar.', true);
        }
        return;
      }
      handleGoogleTokenSuccess(resp);
    }
  });

  return true;
}

async function loadAppVersion() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`version HTTP ${res.status}`);
    const payload = await res.json();
    const version = String(payload?.version || '').trim();
    if (!version) return;

    const el = document.getElementById('app-version');
    if (el) el.textContent = version;
  } catch (e) {
    console.warn('No se pudo cargar version.json:', e);
  }
}

async function loadContactsFromNotion() {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/contacts`);
    contactsSource = res.source || 'api';
    const rows = (res.data || []).map((item) => ({
      id: item.id || '',
      nombre: item.nombre || 'Sin nombre',
      rol: item.rol || '—',
      correo: item.correo || '',
      telefono: item.telefono || '',
      whatsapp: item.whatsapp || '',
      instagram: item.instagram || '',
      tiktok: item.tiktok || '',
      direccion: item.direccion || ''
    }));
    contactsVisibleCount = CONTACTS_PAGE_STEP;
    setContacts(rows.length ? rows : contactsSample);
    const source = res.source || 'api';
    if (source === 'fallback') {
      setStatus('contacts-status', `${rows.length} contactos cargados (fallback local del backend).`);
      return;
    }
    setStatus('contacts-status', rows.length ? `${rows.length} contactos cargados desde Notion API.` : 'API sin contactos, usando muestra local.');
  } catch (e) {
    console.warn('No se pudieron cargar contactos desde Notion API:', e);
    contactsSource = 'fallback';
    contactsVisibleCount = CONTACTS_PAGE_STEP;
    setContacts(contactsSample);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('contacts-status', `Sin conexión a Notion/API: ${reason}`, true);
  }
}

function setContactFormVisibility(show) {
  const card = document.getElementById('contact-form-card');
  if (!card) return;
  card.classList.toggle('hidden', !show);
}

function resetContactForm() {
  const ids = [
    'contact-name',
    'contact-role',
    'contact-email',
    'contact-phone',
    'contact-whatsapp',
    'contact-instagram',
    'contact-tiktok',
    'contact-address',
    'contact-edit-id'
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const saveBtn = document.getElementById('contact-save');
  const cancelBtn = document.getElementById('contact-cancel');
  if (saveBtn) saveBtn.textContent = 'Guardar contacto';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function beginEditContact(contactId) {
  if (!contactId) {
    setStatus('contacts-status', 'Este contacto no es editable desde la API actual.', true);
    return;
  }
  const contact = contactsCache.find((c) => c.id === contactId);
  if (!contact) return;

  setContactFormVisibility(true);
  const nameEl = document.getElementById('contact-name');
  const roleEl = document.getElementById('contact-role');
  const emailEl = document.getElementById('contact-email');
  const phoneEl = document.getElementById('contact-phone');
  const waEl = document.getElementById('contact-whatsapp');
  const igEl = document.getElementById('contact-instagram');
  const tiktokEl = document.getElementById('contact-tiktok');
  const addressEl = document.getElementById('contact-address');
  const editIdEl = document.getElementById('contact-edit-id');
  const saveBtn = document.getElementById('contact-save');
  const cancelBtn = document.getElementById('contact-cancel');

  if (nameEl) nameEl.value = contact.nombre || '';
  if (roleEl) roleEl.value = contact.rol || '';
  if (emailEl) emailEl.value = contact.correo || '';
  if (phoneEl) phoneEl.value = contact.telefono || '';
  if (waEl) waEl.value = contact.whatsapp || '';
  if (igEl) igEl.value = contact.instagram || '';
  if (tiktokEl) tiktokEl.value = contact.tiktok || '';
  if (addressEl) addressEl.value = contact.direccion || '';
  if (editIdEl) editIdEl.value = contactId;
  if (saveBtn) saveBtn.textContent = 'Guardar cambios';
  if (cancelBtn) cancelBtn.classList.remove('hidden');
}

async function saveContact() {
  if (!isAuthenticated) return;
  const nameEl = document.getElementById('contact-name');
  const roleEl = document.getElementById('contact-role');
  const emailEl = document.getElementById('contact-email');
  const phoneEl = document.getElementById('contact-phone');
  const waEl = document.getElementById('contact-whatsapp');
  const igEl = document.getElementById('contact-instagram');
  const tiktokEl = document.getElementById('contact-tiktok');
  const addressEl = document.getElementById('contact-address');
  const editIdEl = document.getElementById('contact-edit-id');
  if (!nameEl || !roleEl || !emailEl || !phoneEl || !waEl || !igEl || !tiktokEl || !addressEl || !editIdEl) return;

  const nombre = String(nameEl.value || '').trim();
  if (!nombre) {
    setStatus('contacts-status', 'El nombre es obligatorio.', true);
    return;
  }

  const payload = {
    nombre,
    rol: String(roleEl.value || '').trim(),
    correo: String(emailEl.value || '').trim(),
    telefono: String(phoneEl.value || '').trim(),
    whatsapp: String(waEl.value || '').trim(),
    instagram: String(igEl.value || '').trim(),
    tiktok: String(tiktokEl.value || '').trim(),
    direccion: String(addressEl.value || '').trim()
  };

  const editingId = String(editIdEl.value || '').trim();

  try {
    const endpoint = editingId
      ? `${API_BASE}/api/manager/contacts/${editingId}`
      : `${API_BASE}/api/manager/contacts`;
    const method = editingId ? 'PATCH' : 'POST';

    const r = await fetch(endpoint, {
      method,
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    setStatus('contacts-status', editingId ? 'Contacto actualizado.' : 'Contacto creado.');
    resetContactForm();
    setContactFormVisibility(false);
    await loadContactsFromNotion();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('contacts-status', `No se pudo guardar contacto: ${reason}`, true);
  }
}

async function deleteContact(contactId) {
  if (!isAuthenticated || !contactId) {
    setStatus('contacts-status', 'Este contacto no es editable desde la API actual.', true);
    return;
  }

  const ok = window.confirm('¿Borrar este contacto? Esta acción lo archiva en Notion.');
  if (!ok) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/contacts/${contactId}`, {
      method: 'DELETE',
      headers: apiHeaders()
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('contacts-status', 'Contacto borrado.');
    await loadContactsFromNotion();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('contacts-status', `No se pudo borrar contacto: ${reason}`, true);
  }
}

function getViewerEmail() {
  return String(googleProfile?.email || '').trim().toLowerCase();
}

function setTaskFormVisibility(show) {
  const card = document.getElementById('task-form-card');
  if (!card) return;
  card.classList.toggle('hidden', !show);
}

function resetTaskForm() {
  const titleEl = document.getElementById('task-title');
  const assigneeEl = document.getElementById('task-assignee');
  const dueEl = document.getElementById('task-due');
  const subtaskEl = document.getElementById('task-subtasks');
  const editIdEl = document.getElementById('task-edit-id');
  const cancelBtn = document.getElementById('task-cancel-edit');
  const createBtn = document.getElementById('task-create');

  if (titleEl) titleEl.value = '';
  if (assigneeEl) assigneeEl.value = '';
  if (dueEl) dueEl.value = '';
  if (subtaskEl) subtaskEl.value = '';
  if (editIdEl) editIdEl.value = '';
  if (cancelBtn) cancelBtn.classList.add('hidden');
  if (createBtn) createBtn.textContent = 'Agregar task';
}

function beginEditTask(taskId) {
  const task = tasksCache.find((t) => t.id === taskId);
  if (!task) return;
  const titleEl = document.getElementById('task-title');
  const assigneeEl = document.getElementById('task-assignee');
  const dueEl = document.getElementById('task-due');
  const subtaskEl = document.getElementById('task-subtasks');
  const editIdEl = document.getElementById('task-edit-id');
  const cancelBtn = document.getElementById('task-cancel-edit');
  const createBtn = document.getElementById('task-create');

  setTaskFormVisibility(true);
  if (titleEl) titleEl.value = task.title || '';
  if (assigneeEl) assigneeEl.value = task.assigneeEmail || '';
  if (dueEl) dueEl.value = task.dueDate || '';
  if (subtaskEl) {
    subtaskEl.value = Array.isArray(task.subtasks)
      ? task.subtasks.map((st) => `${st.done ? '[x]' : '[ ]'} ${st.title}`).join('\n')
      : '';
  }
  if (editIdEl) editIdEl.value = taskId;
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  if (createBtn) createBtn.textContent = 'Guardar cambios';
}

function parseSubtasksForEdit(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const done = line.startsWith('[x]') || line.startsWith('[X]');
      const title = line.replace(/^\[(x|X| )\]\s*/, '').trim();
      return { title, done };
    })
    .filter((s) => Boolean(s.title));
}

async function loadTasksFromApi({ append = false } = {}) {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const params = new URLSearchParams({
      limit: '10',
      scope: tasksScope,
      viewer: getViewerEmail()
    });
    if (append && tasksNextCursor) params.set('cursor', tasksNextCursor);

    const res = await fetchJson(`${API_BASE}/api/manager/tasks?${params.toString()}`);

    taskAssigneeUsers = Array.isArray(res.users) && res.users.length
      ? res.users.map((u) => ({ email: String(u.email || '').toLowerCase(), name: String(u.name || u.email || '') }))
      : taskAssigneeUsers;
    refreshAssigneeOptions();

    const rows = (res.data || []).map((item) => ({
      id: item.id || '',
      title: item.title || 'Sin título',
      assignee: item.assignee || '',
      assigneeEmail: item.assigneeEmail || '',
      dueDate: item.dueDate || '',
      status: item.status || 'Pendiente',
      subtasks: Array.isArray(item.subtasks) ? item.subtasks : []
    }));

    tasksNextCursor = res?.pagination?.nextCursor || '';
    tasksHasMore = Boolean(res?.pagination?.hasMore);

    const merged = append ? [...tasksCache, ...rows] : rows;
    setTasks(merged);
    setStatus('tasks-status', merged.length ? `${merged.length} tasks visibles.` : 'No hay tasks todavía.');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    tasksNextCursor = '';
    tasksHasMore = false;
    setTasks([]);
    setStatus('tasks-status', `No se pudieron cargar tasks: ${reason}`, true);
  }
}

async function createTask() {
  if (!isAuthenticated) return;
  const titleEl = document.getElementById('task-title');
  const assigneeEl = document.getElementById('task-assignee');
  const dueEl = document.getElementById('task-due');
  const subtaskEl = document.getElementById('task-subtasks');
  const editIdEl = document.getElementById('task-edit-id');
  if (!titleEl || !assigneeEl || !dueEl || !subtaskEl || !editIdEl) return;

  const title = String(titleEl.value || '').trim();
  if (!title) {
    setStatus('tasks-status', 'Escribe un título para la task.', true);
    return;
  }

  try {
    const editingTaskId = String(editIdEl.value || '').trim();
    const subtasks = editingTaskId ? parseSubtasksForEdit(subtaskEl.value) : parseSubtasksInput(subtaskEl.value);
    const payload = {
      title,
      assignee: String(assigneeEl.value || '').trim(),
      dueDate: String(dueEl.value || '').trim(),
      subtasks
    };

    const method = editingTaskId ? 'PATCH' : 'POST';
    const endpoint = editingTaskId
      ? `${API_BASE}/api/manager/tasks/${editingTaskId}`
      : `${API_BASE}/api/manager/tasks`;

    const r = await fetch(endpoint, {
      method,
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    resetTaskForm();
    setTaskFormVisibility(false);
    setStatus('tasks-status', editingTaskId ? 'Task actualizada correctamente.' : 'Task creada correctamente.');
    await loadTasksFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('tasks-status', `Error al guardar task: ${reason}`, true);
  }
}

async function markTaskDone(taskId) {
  if (!isAuthenticated || !taskId) return;
  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${taskId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ status: 'Terminado' })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('tasks-status', 'Task marcada como terminada.');
    await loadTasksFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('tasks-status', `No se pudo cerrar task: ${reason}`, true);
  }
}

async function deleteTask(taskId) {
  if (!isAuthenticated || !taskId) return;
  const ok = window.confirm('¿Borrar esta task? Esta acción la archiva en Notion.');
  if (!ok) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${taskId}`, {
      method: 'DELETE',
      headers: apiHeaders()
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('tasks-status', 'Task borrada.');
    await loadTasksFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('tasks-status', `No se pudo borrar task: ${reason}`, true);
  }
}

async function toggleSubtaskDone(taskId, subIndex, checked) {
  if (!taskId || subIndex < 0) return;
  const task = tasksCache.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;

  const next = task.subtasks.map((st, i) => (i === subIndex ? { ...st, done: checked } : st));
  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${taskId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ subtasks: next })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadTasksFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('tasks-status', `No se pudo actualizar subtask: ${reason}`, true);
  }
}

async function loadCatalogFromApi() {
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    // Solo leemos Notion para evitar duplicados por auto-sync en cada refresh.
    const res = await fetchJson(`${API_BASE}/api/manager/catalog`);
    const rows = (res.data || []).map((item, i) => ({
      id: item.id || `song-api-${i + 1}`,
      obra: item.obra || 'Sin título',
      autores: item.autores || '—',
      generos: item.generos || '—',
      drive: item.drive || '',
      fileId: item.fileId || extractDriveFileId(item.drive || ''),
      cover: item.cover || ''
    }));
    catalogVisibleCount = CATALOG_PAGE_STEP;
    setCatalog(rows.length ? rows : catalogSample);
    setStatus('catalog-status', rows.length ? `${rows.length} canciones cargadas desde Notion.` : 'API sin catálogo, usando muestra local.');
  } catch (e) {
    console.warn('No se pudo cargar catálogo desde API:', e);
    catalogVisibleCount = CATALOG_PAGE_STEP;
    setCatalog(catalogSample);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `Sin conexión a catálogo/API: ${reason}`, true);
  }
}

async function syncCatalogNow() {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    setStatus('catalog-status', 'Sincronizando Drive ↔ Notion...');
    const r = await fetch(`${API_BASE}/api/manager/catalog/sync`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ manual: true })
    });
    if (!r.ok) {
      let reason = `HTTP ${r.status}`;
      try {
        const body = await r.json();
        if (body?.details || body?.error) reason = `${body.error || 'sync failed'}: ${body.details || ''}`;
      } catch {
        // noop
      }
      throw new Error(reason);
    }
    await loadCatalogFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (/DRIVE_API_KEY o DRIVE_CATALOG_FOLDER_ID missing/i.test(reason)) {
      setStatus('catalog-status', 'Sync Drive no configurado en backend. Catálogo sigue operando desde Notion.');
      return;
    }
    setStatus('catalog-status', `No se pudo sincronizar catálogo: ${reason}`, true);
  }
}

async function loadMessagesFromApi() {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/messages`);
    const rows = (res.data || []).map((item) => ({
      id: item.id || '',
      text: item.text || '',
      author: item.author || '',
      authorEmail: item.authorEmail || '',
      highlighted: Boolean(item.highlighted),
      createdAt: item.createdAt || ''
    }));
    messagesVisibleCount = MESSAGES_PAGE_STEP;
    setMessages(rows);
    setStatus('messages-status', rows.length ? `${rows.length} mensajes cargados.` : 'No hay anuncios todavía.');
  } catch (e) {
    messagesVisibleCount = MESSAGES_PAGE_STEP;
    setMessages([]);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudieron cargar anuncios: ${reason}`, true);
  }
}

async function createMessage() {
  if (!isAuthenticated) return;
  const input = document.getElementById('message-input');
  if (!input) return;

  const text = String(input.value || '').trim();
  if (!text) {
    setStatus('messages-status', 'Escribe un mensaje primero.', true);
    return;
  }

  const author = googleProfile?.name || googleProfile?.email || 'Anónimo';
  const authorEmail = String(googleProfile?.email || '').trim().toLowerCase();

  try {
    const r = await fetch(`${API_BASE}/api/manager/messages`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ text, author, authorEmail })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    input.value = '';
    setStatus('messages-status', 'Anuncio agregado.');
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo guardar anuncio: ${reason}`, true);
  }
}

async function toggleFeaturedMessage(messageId, highlighted) {
  if (!isAuthenticated || !messageId) return;
  try {
    const r = await fetch(`${API_BASE}/api/manager/messages/${messageId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ highlighted })
    });

    if (!r.ok) {
      let reason = `HTTP ${r.status}`;
      try {
        const body = await r.json();
        if (body?.error) reason = `${reason} - ${body.error}`;
      } catch {
        // noop
      }
      throw new Error(reason);
    }

    setStatus('messages-status', highlighted ? 'Mensaje destacado.' : 'Mensaje ya no está destacado.');
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo actualizar anuncio: ${reason}`, true);
  }
}

async function clearMessagesLog() {
  if (!isAuthenticated) return;
  if (!isAdminUser()) {
    setStatus('messages-status', 'Solo admin puede borrar el log.', true);
    return;
  }

  const password = window.prompt('Password para borrar log de mensajes:');
  if (!password) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/messages/clear`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ password, requesterEmail: String(googleProfile?.email || '').trim().toLowerCase() })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('messages-status', 'Log de mensajes borrado.');
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo borrar log: ${reason}`, true);
  }
}

async function loadLinksFromApi() {
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/social-links`);
    const rows = (res.data || [])
      .map((item) => ({
        name: item.name || 'Sin nombre',
        url: item.url || ''
      }))
      .filter((item) => Boolean(item.url));

    setLinks(rows.length ? rows : socialLinksSample);
    const source = res.source || 'api';
    if (source === 'fallback') {
      setStatus('links-status', `${rows.length} links cargados (fallback local del backend).`);
      return;
    }
    setStatus('links-status', rows.length ? `${rows.length} links cargados desde Notion API.` : 'API sin links, usando muestra local.');
  } catch (e) {
    setLinks(socialLinksSample);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('links-status', `Sin conexión a links/API: ${reason}`, true);
  }
}

function initGoogleOAuth() {
  if (!GOOGLE_CLIENT_ID) {
    setOauthStatus('OAuth no disponible: falta googleClientId en config.', true);
    return;
  }

  if (!window.google?.accounts?.oauth2) {
    setOauthStatus('Cargando Google OAuth...', false);
    return;
  }

  ensureGoogleOAuthClient();
  setOauthStatus('Listo para conectar con Google.');
}

function requestGoogleToken() {
  return requestGoogleTokenWithMode({ interactive: true });
}

function requestGoogleTokenWithMode({ interactive }) {
  if (!ensureGoogleOAuthClient()) {
    setOauthStatus('OAuth todavía está cargando, intenta de nuevo.', !interactive);
    return false;
  }

  try {
    googleLastRequestInteractive = Boolean(interactive);
    googleTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    return true;
  } catch {
    setOauthStatus('No se pudo abrir Google OAuth. Reintenta.', true);
    return;
  }
}

function startGoogleLogin({ auto = false } = {}) {
  if (ensureGoogleOAuthClient()) {
    requestGoogleTokenWithMode({ interactive: !auto });
    return;
  }

  const btn = document.getElementById('google-auth-toggle') || document.getElementById('auth-gate-login');
  if (!btn) return;

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Cargando...';
  setOauthStatus(auto ? 'Inicializando login automático...' : 'Esperando Google OAuth...', false);

  let elapsed = 0;
  if (googleInitInterval) clearInterval(googleInitInterval);

  googleInitInterval = setInterval(() => {
    elapsed += 200;
    if (ensureGoogleOAuthClient()) {
      clearInterval(googleInitInterval);
      googleInitInterval = null;
      btn.disabled = false;
      btn.textContent = prev;
      requestGoogleTokenWithMode({ interactive: !auto });
      return;
    }
    if (elapsed >= 10000) {
      clearInterval(googleInitInterval);
      googleInitInterval = null;
      btn.disabled = false;
      btn.textContent = prev;
      setOauthStatus('No se pudo inicializar Google OAuth. Reintenta.', true);
    }
  }, 200);
}

function autoLoginOnLoad() {
  if (restoreStoredAuthSession()) return;
  if (googleAccessToken || googleProfile || isAuthenticated) return;
  setOauthStatus('Catálogo y Links públicos activos. Inicia sesión para usar tabs privadas.');
}

function signOutGoogle() {
  clearTokenRefreshTimer();
  clearStoredAuthSession();
  if (window.google?.accounts?.oauth2 && googleAccessToken) {
    window.google.accounts.oauth2.revoke(googleAccessToken, () => {
      googleAccessToken = '';
      googleTokenExpiryAt = 0;
      googleProfile = null;
      setAuthenticated(false);
      setOauthStatus('Sesión cerrada.');
    });
    return;
  }
  googleAccessToken = '';
  googleTokenExpiryAt = 0;
  googleProfile = null;
  setAuthenticated(false);
  setOauthStatus('Sesión cerrada.');
}

function handleAuthToggle() {
  if (isAuthenticated) {
    signOutGoogle();
    return;
  }
  startGoogleLogin();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = String(tab.dataset.tab || 'overview');
      if (!isAuthenticated && !isPublicTab(targetTab)) {
        setOauthStatus('Solo Catálogo y Links son públicos. Inicia sesión con Google para ver esta sección.', true);
        setAuthGate(false);
        return;
      }
      activateTab(targetTab);
      updateAuthGateForCurrentTab();
    });
  });
}

function setupActions() {
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', handler);
  };

  bindClick('google-auth-toggle', handleAuthToggle);
  bindClick('auth-gate-login', startGoogleLogin);
  bindClick('refresh-messages', () => loadMessagesFromApi());
  bindClick('refresh-messages-overview', () => loadMessagesFromApi());
  bindClick('messages-load-more', () => {
    messagesVisibleCount += MESSAGES_PAGE_STEP;
    setMessages(messagesCache);
  });
  bindClick('message-create', createMessage);
  bindClick('clear-messages-log', clearMessagesLog);

  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        createMessage();
      }
    });
  }

  bindClick('refresh-catalog', () => loadCatalogFromApi());
  const catalogSearch = document.getElementById('catalog-search');
  if (catalogSearch) {
    catalogSearch.addEventListener('input', () => {
      catalogSearchQuery = String(catalogSearch.value || '');
      catalogVisibleCount = CATALOG_PAGE_STEP;
      renderCatalog();
    });
  }
  bindClick('refresh-contacts', () => loadContactsFromNotion());
  bindClick('contacts-load-more', () => {
    contactsVisibleCount += CONTACTS_PAGE_STEP;
    setContacts(contactsCache);
  });
  bindClick('contact-form-toggle', () => {
    const card = document.getElementById('contact-form-card');
    const shouldShow = card?.classList.contains('hidden');
    setContactFormVisibility(Boolean(shouldShow));
    if (!shouldShow) resetContactForm();
  });
  bindClick('contact-save', saveContact);
  bindClick('contact-cancel', () => {
    resetContactForm();
    setContactFormVisibility(false);
  });
  bindClick('refresh-links', () => loadLinksFromApi());
  bindClick('refresh-tasks', () => loadTasksFromApi());
  bindClick('task-create', createTask);
  bindClick('task-form-toggle', () => {
    const card = document.getElementById('task-form-card');
    const shouldShow = card?.classList.contains('hidden');
    setTaskFormVisibility(Boolean(shouldShow));
    if (!shouldShow) resetTaskForm();
  });
  bindClick('task-cancel-edit', () => {
    resetTaskForm();
    setTaskFormVisibility(false);
  });
  bindClick('tasks-load-more', () => loadTasksFromApi({ append: true }));

  const scope = document.getElementById('tasks-scope');
  if (scope) {
    scope.addEventListener('change', () => {
      tasksScope = String(scope.value || 'all');
      tasksNextCursor = '';
      tasksHasMore = false;
      loadTasksFromApi();
    });
  }

  const contactsSearch = document.getElementById('contacts-search');
  if (contactsSearch) {
    contactsSearch.addEventListener('input', () => {
      contactsSearchQuery = String(contactsSearch.value || '');
      contactsVisibleCount = CONTACTS_PAGE_STEP;
      setContacts(contactsCache);
    });
  }
}

function init() {
  initCatalogDeepLinkFromUrl();
  loadAppVersion();
  setShareActions();
  setupPlaylistModal();
  setLinks();
  clearSensitiveData();
  resetContactForm();
  setContactFormVisibility(false);
  refreshAssigneeOptions();
  resetTaskForm();
  setTaskFormVisibility(false);
  setupTabs();
  setupCatalogPlayerControls();
  setupActions();
  syncPlaylistCreateControlsVisibility();
  if (shouldBypassAuthForLocalDev()) {
    enableLocalDevBypassMode();
  } else {
    setAuthenticated(false);
    initGoogleOAuth();
    autoLoginOnLoad();
  }
  initNotifications();
}

function initNotifications() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => {
        checkNotificationStatus();
      })
      .catch(err => console.error('Error al registrar sw:', err));
  }
}

function checkNotificationStatus() {
  const btn = document.getElementById('notify-enable-btn');
  if (!btn) return;
  
  if (Notification.permission === 'granted') {
    btn.classList.add('hidden');
  } else if (Notification.permission !== 'denied') {
    btn.classList.remove('hidden');
    btn.onclick = async () => {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        btn.classList.add('hidden');
        alert('Notificaciones activadas. Ahora podrás recibir alertas de la app.');
      } else {
        alert('Permiso de notificaciones denegado.');
      }
    };
  }
}

init();
