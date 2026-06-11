const profile = {
  name: 'Jay Mansur',
  website: 'https://www.musicknobs.com',
  email: 'jgmansur2@gmail.com',
  whatsapp: '+528343537539',
  links: [
    ['YouTube Music Knobs', 'https://www.youtube.com/@musicknobs'],
    ['Instagram Music Knobs', 'https://www.instagram.com/musicknobs/'],
    ['TikTok Music Knobs', 'https://www.tiktok.com/@musicknobs'],
    ['Spotify Artista', 'https://open.spotify.com/artist/3bzFRaYQ7gRLdXnHh7rTts'],
    ['Patreon', 'https://www.patreon.com/c/JayMansur']
  ]
};

const socialLinksSample = profile.links.map(([name, url]) => ({ name, url }));
const salesKitSample = {
  title: 'Manager App White-Label para Operaciones Musicales',
  subtitle: 'Infraestructura digital premium para managers, productores y compositores.',
  pitch: 'Desplegamos una versión personalizada de Manager App para centralizar operación, catálogo, comunicación y seguimiento comercial con una presentación profesional frente a clientes y aliados.',
  offerings: [
    'Implementación white-label con branding propio (logo, identidad visual y naming)',
    'Módulos core listos para operar: Overview, Tasks, Contactos, Catálogo, Links y Venta',
    'Onboarding ejecutivo para equipo interno y estandarización de operación',
    'Acompañamiento inicial para adopción y salida a producción'
  ],
  highlights: [
    'Operación centralizada y auditable en un solo entorno',
    'Percepción de marca premium para propuestas, reuniones y cierre comercial',
    'Arquitectura escalable: nuevas secciones y automatizaciones bajo cotización'
  ],
  process: [
    'Diagnóstico operativo y definición de alcance',
    'Implementación base white-label con configuración inicial',
    'Ajustes de UX, estructura, copy y permisos por rol',
    'Cambios especiales y módulos extra por cotización independiente'
  ],
  scopeIncluded: [
    'Branding inicial (logo, nombre y paleta base)',
    'Configuración de módulos core y estructura inicial',
    'Onboarding operativo para arranque del equipo'
  ],
  scopeExcluded: [
    'Desarrollos nuevos fuera del alcance base',
    'Integraciones de terceros no contempladas',
    'Cambios especiales o módulos extra (se cotizan por separado)'
  ],
  packages: [
    {
      name: 'Implementación Manager App',
      oneTimePrice: '$25,000 MXN pago único',
      maintenancePrice: '$7,000 MXN / año mantenimiento',
      description: 'Implementación llave en mano de la app personalizada para tu operación musical.',
      includes: ['Branding inicial', 'Configuración de módulos core', 'Handoff + soporte de arranque']
    }
  ],
  testimonials: [
    {
      quote: 'La implementación elevó nuestra operación y nos dio una presentación mucho más sólida frente a clientes.',
      by: 'Dirección artística'
    },
    {
      quote: 'Centralizamos procesos críticos y redujimos fricción del equipo en el día a día.',
      by: 'Management team'
    }
  ],
  ctas: [
    { label: 'Agendar llamada', url: `https://wa.me/${String(profile.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent('Hola Jay, quiero agendar una llamada para revisar el paquete comercial.')}` },
    { label: 'Abrir sitio oficial', url: profile.website },
    { label: 'Enviar email', url: `mailto:${profile.email}` },
    { label: 'WhatsApp directo', url: `https://wa.me/${String(profile.whatsapp || '').replace(/\D/g, '')}` }
  ]
};

const cfg = window.MANAGER_APP_CONFIG || {};
const API_BASE = (cfg.apiBaseUrl || '').replace(/\/$/, '');
const API_TOKEN = cfg.apiToken || '';
const GOOGLE_CLIENT_ID = cfg.googleClientId || '';
const GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
// Portal: client files live here (My Drive/Manager App/Clientes/Archivos). The admin
// uploads version files directly to Drive (the service account has no storage quota).
const PORTAL_DRIVE_FOLDER = '1sequwARPJQcoVs52TlCZ0MWcxYS_1nb5';
// Receipts (proof of payment) folder — shared with the worker SA so it can display them.
const PORTAL_RECIBOS_FOLDER = '1LQ-9Pjvp-hnbmoYJlA-YAYCy0NXfqWpk';
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
let isSendingMessage = false;
const seenMessageIds = new Set();
const seenTaskIds = new Set();
let taskAssigneeUsers = [
  { email: 'jgmansur2@gmail.com', name: 'Jay Mansur' },
  { email: 'xeronimo3@gmail.com', name: 'Xeronimo' },
  { email: 'ricardo.calanda@gmail.com', name: 'Ricardo' }
];
let tasksNextCursor = '';
let tasksHasMore = false;
let tasksScope = 'all';
let focusTodayTasks = [];
let focusOverdueTasks = [];
let focusMode = 'today';
let focusTodayIndex = 0;
let focusOverdueIndex = 0;
let catalogCache = [];
let catalogGenreFilter = 'Todas';
let catalogNowPlayingId = '';
// Like de visitante: en memoria, se resetea en cada apertura de la app (1 like/sesión/canción).
const catalogLikedSongs = new Set();
// Play contado por canción en esta reproducción (evita doble conteo del mismo track).
let catalogPlayCountedId = '';
let catalogPlayerExpanded = false;
let catalogLyricsOn = false;
let catalogLyricsEditing = false;
let catalogLyricsTimer = null;
let catalogLyricLastIdx = -1;
let lyricsHintTimer = null;
let lyricsHintAnimTimers = [];
let catalogQueue = [];
let playlistsCache = [];
let selectedPlaylistId = '';
let playlistEditMode = false;            // modo edición (lista o detalle)
let playlistSelection = new Set();       // ids seleccionados (playlists o canciones)
let playlistAddMode = false;             // panel "+" para agregar canciones a la playlist
let playlistAddSelection = new Set();    // canciones elegidas para agregar
let playlistAddQuery = '';               // búsqueda dentro del panel de agregar
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
let salesBillingMode = 'upfront';

const CONTACTS_PAGE_STEP = 12;
const MESSAGES_PAGE_STEP = 20;
const CATALOG_PAGE_STEP = 20;
const CATALOG_PROGRESS_REFRESH_MS = 900;
const CATALOG_AUTOPLAY_HINT = '[DALE CLICK A LA CANCIÓN SELECCIONADA]';
const PUBLIC_TABS = new Set(['catalog', 'links', 'sale', 'book']);
const MOBILE_TABBAR_MEDIA_QUERY = '(max-width: 720px)';

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
  karaokeMode: false,
  karaokeSwapping: false,
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
  document.body.classList.toggle('focus-active', target === 'focus');
  document.body.classList.toggle('catalog-active', target === 'catalog');
  document.body.classList.toggle('messages-active', target === 'messages');
  document.body.classList.toggle('book-active', target === 'book');
}

function isMobileTabBarViewport() {
  try {
    return window.matchMedia(MOBILE_TABBAR_MEDIA_QUERY).matches;
  } catch {
    return window.innerWidth <= 720;
  }
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

function setSalesKit(payload = salesKitSample) {
  const root = document.getElementById('sale-kit');
  if (!root) return;

  const title = String(payload?.title || salesKitSample.title || '').trim();
  const subtitle = String(payload?.subtitle || salesKitSample.subtitle || '').trim();
  const pitch = String(payload?.pitch || salesKitSample.pitch || '').trim();
  const offerings = Array.isArray(payload?.offerings) ? payload.offerings : salesKitSample.offerings;
  const highlights = Array.isArray(payload?.highlights) ? payload.highlights : salesKitSample.highlights;
  const process = Array.isArray(payload?.process) ? payload.process : salesKitSample.process;
  const scopeIncluded = Array.isArray(payload?.scopeIncluded) ? payload.scopeIncluded : salesKitSample.scopeIncluded;
  const scopeExcluded = Array.isArray(payload?.scopeExcluded) ? payload.scopeExcluded : salesKitSample.scopeExcluded;
  const packages = Array.isArray(payload?.packages) ? payload.packages : salesKitSample.packages;
  const testimonials = Array.isArray(payload?.testimonials) ? payload.testimonials : salesKitSample.testimonials;
  const ctas = Array.isArray(payload?.ctas) ? payload.ctas : salesKitSample.ctas;

  const safeOfferings = offerings
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const safeHighlights = highlights
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const safeCtas = ctas
    .map((item) => ({ label: String(item?.label || '').trim(), url: String(item?.url || '').trim() }))
    .filter((item) => item.label && item.url)
    .slice(0, 4);

  const safeProcess = process
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const safeScopeIncluded = scopeIncluded
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const safeScopeExcluded = scopeExcluded
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const safePackages = packages
    .map((pkg) => ({
      name: String(pkg?.name || '').trim(),
      upfrontPrice: String(pkg?.oneTimePrice || pkg?.upfrontPrice || pkg?.monthlyPrice || pkg?.price || '').trim(),
      maintenancePrice: String(pkg?.maintenancePrice || pkg?.annualPrice || '').trim(),
      description: String(pkg?.description || '').trim(),
      includes: Array.isArray(pkg?.includes) ? pkg.includes.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6) : []
    }))
    .filter((pkg) => pkg.name || pkg.upfrontPrice || pkg.maintenancePrice || pkg.description)
    .slice(0, 6);

  const safeTestimonials = testimonials
    .map((item) => ({
      quote: String(item?.quote || '').trim(),
      by: String(item?.by || '').trim()
    }))
    .filter((item) => item.quote)
    .slice(0, 6);

  root.innerHTML = `
    <section class="sale-hero">
      <h4>${escapeHtml(title)}</h4>
      <p class="sale-subtitle">${escapeHtml(subtitle)}</p>
      <p>${escapeHtml(pitch)}</p>
    </section>

    <section class="sale-grid">
      <article class="sale-card">
        <h5>¿Qué se puede vender?</h5>
        <ul class="list compact-list">
          ${safeOfferings.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Sin servicios configurados.</li>'}
        </ul>
      </article>
      <article class="sale-card">
        <h5>Puntos fuertes</h5>
        <ul class="list compact-list">
          ${safeHighlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Sin highlights configurados.</li>'}
        </ul>
      </article>
    </section>

    <section class="sale-packages">
      <div class="sale-packages-head">
        <h5 class="sale-section-title">Inversión</h5>
        <div class="sale-billing-toggle" role="tablist" aria-label="Modo de precio">
          <button type="button" class="mini-btn ${salesBillingMode === 'upfront' ? 'active' : ''}" data-sale-billing="upfront">Pago único</button>
          <button type="button" class="mini-btn ${salesBillingMode === 'maintenance' ? 'active' : ''}" data-sale-billing="maintenance">Mantenimiento anual</button>
        </div>
      </div>
      <div class="sale-packages-grid">
        ${safePackages.map((pkg) => `
          <article class="sale-package-card">
            <h6>${escapeHtml(pkg.name || 'Paquete')}</h6>
            ${(salesBillingMode === 'maintenance' ? pkg.maintenancePrice : pkg.upfrontPrice) ? `<p class="sale-package-price">${escapeHtml(salesBillingMode === 'maintenance' ? pkg.maintenancePrice : pkg.upfrontPrice)}</p>` : ''}
            ${pkg.description ? `<p class="sale-package-desc">${escapeHtml(pkg.description)}</p>` : ''}
            ${pkg.includes.length ? `<ul class="list compact-list">${pkg.includes.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
          </article>
        `).join('')}
      </div>
    </section>

    <section class="sale-grid">
      <article class="sale-card">
        <h5>Proceso comercial</h5>
        <ol class="sale-process-list">
          ${safeProcess.map((step) => `<li>${escapeHtml(step)}</li>`).join('') || '<li>Define proceso comercial.</li>'}
        </ol>
      </article>
      <article class="sale-card">
        <h5>Prueba social</h5>
        <ul class="list compact-list">
          ${safeTestimonials.map((item) => `<li>“${escapeHtml(item.quote)}”${item.by ? ` — <strong>${escapeHtml(item.by)}</strong>` : ''}</li>`).join('') || '<li>Agrega testimonios de clientes.</li>'}
        </ul>
      </article>
    </section>

    <section class="sale-scope">
      <h5 class="sale-section-title">Alcance de implementación</h5>
      <div class="sale-scope-grid">
        <article class="sale-scope-card included">
          <h6>Incluye</h6>
          <ul class="list compact-list">
            ${safeScopeIncluded.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Definir alcance incluido.</li>'}
          </ul>
        </article>
        <article class="sale-scope-card excluded">
          <h6>No incluye</h6>
          <ul class="list compact-list">
            ${safeScopeExcluded.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Definir alcance no incluido.</li>'}
          </ul>
        </article>
      </div>
    </section>

    <section class="sale-actions">
      ${safeCtas.map((cta) => `<a class="btn" href="${escapeHtml(cta.url)}" target="_blank" rel="noopener">${escapeHtml(cta.label)}</a>`).join('')}
    </section>
  `;

  root.querySelectorAll('[data-sale-billing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMode = String(btn.getAttribute('data-sale-billing') || '').trim();
      if (!['upfront', 'maintenance'].includes(nextMode) || nextMode === salesBillingMode) return;
      salesBillingMode = nextMode;
      setSalesKit(payload);
    });
  });
}

async function loadSalesKitFromApi() {
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/sales-kit`);
    const data = res?.data && typeof res.data === 'object' ? res.data : salesKitSample;
    setSalesKit(data);
    setStatus('sale-status', 'Paquete de venta cargado.');
  } catch (e) {
    setSalesKit(salesKitSample);
    const reason = e instanceof Error ? e.message : String(e);
    const isNotFound = /HTTP\s*404/i.test(reason) || /not\s*found/i.test(reason);
    if (isNotFound) {
      setStatus('sale-status', 'Paquete de venta activo (modo local).');
      return;
    }
    setStatus('sale-status', `Usando paquete local (fallback): ${reason}`);
  }
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

// ── Vista Playlists estilo Apple Music ───────────────────────────────────────
// Lista de playlists (mosaico 2×2 + nombre + N canciones) → tap → detalle con
// Reproducir/Aleatorio + compartir + borrar. El detalle reusa #catalog-songs
// (mismas filas del catálogo) y solo inyecta un header arriba.

// Mosaico 2×2 con las primeras 4 portadas de la playlist (rellena con placeholder).
function buildPlaylistMosaic(playlist) {
  const ids = (Array.isArray(playlist?.tracks) ? playlist.tracks : []).map((t) => String(t.id || ''));
  const covers = [];
  for (const id of ids) {
    const song = catalogCache.find((s) => String(s.id) === id);
    if (song && song.cover) covers.push(song.cover);
    if (covers.length >= 4) break;
  }
  const cells = [];
  for (let i = 0; i < 4; i++) {
    cells.push(covers[i]
      ? `<span class="pl-mosaic-cell" style="background-image:url('${escapeHtml(covers[i])}')"></span>`
      : `<span class="pl-mosaic-cell pl-mosaic-empty">♪</span>`);
  }
  return `<span class="pl-mosaic">${cells.join('')}</span>`;
}

function renderPlaylistsView() {
  const el = document.getElementById('catalog-playlists-view');
  if (!el) return;

  // ── DETALLE ──
  if (selectedPlaylistId) {
    const pl = playlistsCache.find((p) => p.id === selectedPlaylistId);
    if (!pl) { selectedPlaylistId = ''; renderCatalog(); return; }
    if (playlistAddMode) { renderPlaylistAddPanel(el, pl); return; }
    const editing = playlistEditMode;
    // Canciones en ORDEN de la playlist (solo las que existen en el catálogo)
    const orderedIds = (pl.tracks || []).map((t) => String(t.id || '')).filter((id) => catalogCache.some((s) => String(s.id) === id));
    const songs = orderedIds.map((id) => catalogCache.find((s) => String(s.id) === id));
    const count = songs.length;
    const nSel = playlistSelection.size;

    const songRows = songs.map((s) => {
      const sel = playlistSelection.has(s.id);
      const cover = s.cover
        ? `<span class="pl-song-cover" style="background-image:url('${escapeHtml(s.cover)}')"></span>`
        : `<span class="pl-song-cover pl-song-cover-empty">♪</span>`;
      const meta = `<span class="pl-song-meta"><strong>${escapeHtml(s.obra || 'Sin título')}</strong><span class="pl-song-artist">${escapeHtml(s.autores || '—')}</span></span>`;
      if (editing) {
        return `<li class="pl-song-li" data-song-id="${escapeHtml(s.id)}">
          <div class="pl-song-row pl-song-row-edit ${sel ? 'is-selected' : ''}" data-song-toggle="${escapeHtml(s.id)}">
            <span class="pl-check ${sel ? 'on' : ''}">${sel ? '✓' : ''}</span>
            ${cover}${meta}
            <span class="pl-drag-handle" data-drag="${escapeHtml(s.id)}" aria-label="Reordenar" title="Arrastrá para reordenar" style="touch-action:none;">≡</span>
          </div>
        </li>`;
      }
      return `<li class="pl-song-li">
        <button class="pl-song-row ${catalogNowPlayingId === s.id ? 'is-active' : ''}" data-song-play="${escapeHtml(s.id)}" type="button">${cover}${meta}</button>
      </li>`;
    }).join('');

    const titleHtml = editing
      ? `<input id="pl-rename-input" class="pl-rename-input" type="text" value="${escapeHtml(pl.name)}" aria-label="Nombre de la playlist" placeholder="Nombre de la playlist" />`
      : `<h2 class="pl-detail-title">${escapeHtml(pl.name)}</h2>`;

    el.innerHTML = `
      <div class="pl-detail-head">
        <button class="pl-back" id="pl-detail-back" type="button" aria-label="Volver a playlists">‹ Playlists</button>
        ${titleHtml}
        <span class="pl-detail-count">${count} ${count === 1 ? 'canción' : 'canciones'}</span>
        <div class="pl-detail-actions">
          <div class="pl-detail-pills">
            <button class="pl-pill" id="pl-detail-play" type="button"><span class="pl-pill-ico">▶</span> Reproducir</button>
            <button class="pl-pill" id="pl-detail-shuffle" type="button"><span class="pl-pill-ico">🔀</span> Aleatorio</button>
          </div>
          <div class="pl-detail-icons">
            ${(isAuthenticated && count) ? `<button class="pl-text-btn" id="pl-detail-edit" type="button">${editing ? 'Listo' : 'Editar'}</button>` : ''}
            ${isAuthenticated ? `<button class="pl-icon-btn" id="pl-detail-add" type="button" aria-label="Agregar canciones" title="Agregar canciones">＋</button>` : ''}
            <button class="pl-icon-btn" id="pl-detail-share" type="button" aria-label="Compartir playlist" title="Compartir playlist">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"></line><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line></svg>
            </button>
            ${isAuthenticated ? `<button class="pl-icon-btn pl-danger" id="pl-detail-delete" type="button" aria-label="Borrar playlist" title="Borrar playlist">🗑</button>` : ''}
          </div>
        </div>
        ${editing ? `<div class="pl-edit-bar">
          <span class="pl-edit-count">${nSel} seleccionada${nSel === 1 ? '' : 's'} · arrastrá ≡ para reordenar</span>
          <button class="pl-danger-btn" id="pl-detail-remove-selected" type="button" ${nSel ? '' : 'disabled'}>🗑 Quitar</button>
        </div>` : ''}
      </div>
      <ul class="list pl-song-list" id="pl-song-list">${songRows || '<li class="pl-empty">Esta playlist no tiene canciones todavía.</li>'}</ul>`;

    document.getElementById('pl-detail-back')?.addEventListener('click', () => {
      selectedPlaylistId = '';
      catalogVisibleCount = CATALOG_PAGE_STEP;
      playlistEditMode = false;
      playlistSelection.clear();
      renderPlaylists();
      renderCatalog();
    });
    document.getElementById('pl-detail-play')?.addEventListener('click', () => { if (catalogQueue.length) playCatalogSong(catalogQueue[0]); });
    document.getElementById('pl-detail-shuffle')?.addEventListener('click', () => {
      if (!catalogQueue.length) return;
      if (!catalogRandomMode) toggleCatalogRandomMode(); else playRandomCatalogTrack();
    });
    document.getElementById('pl-detail-share')?.addEventListener('click', () => shareSelectedPlaylistForListen());
    document.getElementById('pl-detail-delete')?.addEventListener('click', () => deletePlaylist(selectedPlaylistId));
    document.getElementById('pl-detail-edit')?.addEventListener('click', () => {
      playlistEditMode = !playlistEditMode;
      playlistSelection.clear();
      renderPlaylistsView();
    });
    document.getElementById('pl-detail-add')?.addEventListener('click', () => {
      playlistAddMode = true;
      playlistEditMode = false;
      playlistAddSelection.clear();
      playlistAddQuery = '';
      renderPlaylistsView();
    });
    document.getElementById('pl-detail-remove-selected')?.addEventListener('click', () => removeSelectedSongsFromPlaylist(pl));
    const renameInput = document.getElementById('pl-rename-input');
    if (renameInput) {
      const commit = () => {
        const newName = String(renameInput.value || '').trim();
        if (newName && newName !== pl.name) renamePlaylist(pl, newName);
      };
      renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renameInput.blur(); } });
      renameInput.addEventListener('blur', commit);
    }

    el.querySelectorAll('[data-song-play]').forEach((b) => b.addEventListener('click', () => playCatalogSong(b.getAttribute('data-song-play'))));
    // En edición: tap en la fila (no en el agarradero) selecciona/deselecciona.
    el.querySelectorAll('[data-song-toggle]').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-drag]')) return;
      const id = row.getAttribute('data-song-toggle');
      if (playlistSelection.has(id)) playlistSelection.delete(id); else playlistSelection.add(id);
      renderPlaylistsView();
    }));
    if (editing) setupPlaylistDragReorder(pl);
    return;
  }

  // ── LISTA ── (con modo edición: seleccionar varias y borrarlas juntas)
  const editing = playlistEditMode;
  // En la vista lista, el buscador principal filtra PLAYLISTS por nombre.
  const plQuery = catalogSearchQuery.trim().toLowerCase();
  const listablePlaylists = plQuery
    ? playlistsCache.filter((pl) => String(pl.name || '').toLowerCase().includes(plQuery))
    : playlistsCache;
  const rows = listablePlaylists.map((pl) => {
    const count = Number(pl.trackCount || (pl.tracks || []).length || 0);
    const sel = playlistSelection.has(pl.id);
    const inner = `
      ${editing ? `<span class="pl-check ${sel ? 'on' : ''}">${sel ? '✓' : ''}</span>` : ''}
      ${buildPlaylistMosaic(pl)}
      <span class="pl-row-meta">
        <strong>${escapeHtml(pl.name)}</strong>
        <span class="pl-row-count">${count} ${count === 1 ? 'canción' : 'canciones'}</span>
      </span>
      ${editing ? '' : '<span class="pl-row-chevron">›</span>'}`;
    return editing
      ? `<li><div class="pl-row pl-row-edit ${sel ? 'is-selected' : ''}" data-pl-select="${escapeHtml(pl.id)}">${inner}</div></li>`
      : `<li><button class="pl-row" data-pl-open="${escapeHtml(pl.id)}" type="button">${inner}</button></li>`;
  }).join('');

  const nSel = playlistSelection.size;
  el.innerHTML = `
    <div class="pl-list-head">
      <h4>Playlists</h4>
      <div class="pl-list-head-actions">
        ${(playlistsCache.length && isAuthenticated) ? `<button class="pl-text-btn" id="pl-list-edit" type="button">${editing ? 'Listo' : 'Editar'}</button>` : ''}
        ${(!editing && isAuthenticated) ? `<button class="catalog-icon-btn" id="pl-list-create" type="button" aria-label="Crear nueva playlist" title="Nueva playlist">＋</button>` : ''}
      </div>
    </div>
    ${editing ? `<div class="pl-edit-bar">
      <span class="pl-edit-count">${nSel} seleccionada${nSel === 1 ? '' : 's'}</span>
      <button class="pl-danger-btn" id="pl-list-delete-selected" type="button" ${nSel ? '' : 'disabled'}>🗑 Borrar</button>
    </div>` : ''}
    ${(!editing && isAuthenticated) ? `<div id="pl-list-create-form" class="hidden catalog-playlist-create-form">
      <input id="pl-list-create-input" class="catalog-genre-select" type="text" placeholder="Nombre de la nueva playlist..." />
      <button class="mini-btn" id="pl-list-create-submit" type="button">Crear</button>
    </div>` : ''}
    <ul class="list pl-list">${rows || `<li class="pl-empty">${plQuery ? 'No hay playlists que coincidan con la búsqueda.' : 'No hay playlists todavía. Creá una con ＋.'}</li>`}</ul>`;

  el.querySelectorAll('[data-pl-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPlaylistId = String(btn.getAttribute('data-pl-open') || '');
      catalogVisibleCount = CATALOG_PAGE_STEP;
      catalogSearchQuery = '';
      renderPlaylists();
      renderCatalog();
    });
  });
  el.querySelectorAll('[data-pl-select]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = String(row.getAttribute('data-pl-select') || '');
      if (playlistSelection.has(id)) playlistSelection.delete(id); else playlistSelection.add(id);
      renderPlaylistsView();
    });
  });
  document.getElementById('pl-list-edit')?.addEventListener('click', () => {
    playlistEditMode = !playlistEditMode;
    playlistSelection.clear();
    renderPlaylistsView();
  });
  document.getElementById('pl-list-delete-selected')?.addEventListener('click', () => deleteSelectedPlaylists());
  const createBtn = document.getElementById('pl-list-create');
  const createForm = document.getElementById('pl-list-create-form');
  if (createBtn && createForm) {
    createBtn.addEventListener('click', () => {
      createForm.classList.toggle('hidden');
      if (!createForm.classList.contains('hidden')) document.getElementById('pl-list-create-input')?.focus();
    });
  }
  document.getElementById('pl-list-create-submit')?.addEventListener('click', () => {
    const input = document.getElementById('pl-list-create-input');
    const name = String(input?.value || '').trim();
    if (name) createPlaylist(name);
  });
}

// Borra varias playlists seleccionadas en una acción (una sola confirmación).
async function deleteSelectedPlaylists() {
  if (!isAuthenticated) return;
  const ids = [...playlistSelection];
  if (!ids.length) return;
  const names = ids.map((id) => playlistsCache.find((p) => p.id === id)?.name || 'playlist');
  if (!window.confirm(`¿Borrar ${ids.length} playlist${ids.length === 1 ? '' : 's'}?\n${names.join(', ')}\nEsta acción no se puede deshacer.`)) return;
  setStatus('catalog-status', `Borrando ${ids.length} playlists...`);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const r = await fetch(`${API_BASE}/api/manager/playlists/${id}`, { method: 'DELETE', headers: apiHeaders() });
      if (r.ok) ok += 1; else fail += 1;
    } catch { fail += 1; }
  }
  playlistSelection.clear();
  playlistEditMode = false;
  setStatus('catalog-status', `Playlists borradas: ${ok}${fail ? ` · fallaron ${fail}` : ''}.`, fail > 0);
  await loadPlaylistsFromApi();
  renderCatalog();
}

// Persiste el orden/contenido de tracks de una playlist (reorder + borrado múltiple).
async function setManagerPlaylistTracks(playlistId, orderedIds, { silent = false } = {}) {
  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${playlistId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'set_tracks', trackIds: orderedIds }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!silent) setStatus('catalog-status', 'Playlist actualizada.');
    await loadPlaylistsFromApi();
    renderCatalog();
  } catch (e) {
    setStatus('catalog-status', `No se pudo actualizar la playlist: ${e instanceof Error ? e.message : e}`, true);
    await loadPlaylistsFromApi();
    renderCatalog();
  }
}

// Renombra la playlist (actualiza la propiedad título en Notion vía worker).
async function renamePlaylist(pl, newName) {
  if (!isAuthenticated || !newName || newName === pl.name) return;
  setStatus('catalog-status', `Renombrando a "${newName}"...`);
  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${pl.id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'rename', name: newName }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('catalog-status', `Playlist renombrada a "${newName}".`);
    await loadPlaylistsFromApi();
    renderCatalog();
  } catch (e) {
    setStatus('catalog-status', `No se pudo renombrar: ${e instanceof Error ? e.message : e}`, true);
    await loadPlaylistsFromApi();
    renderCatalog();
  }
}

// Quita las canciones seleccionadas SOLO de la playlist (no del catálogo).
async function removeSelectedSongsFromPlaylist(pl) {
  if (!isAuthenticated || !playlistSelection.size) return;
  const n = playlistSelection.size;
  if (!window.confirm(`¿Quitar ${n} canción${n === 1 ? '' : 'es'} de "${pl.name}"?\nNo se borra del catálogo, solo de esta playlist.`)) return;
  const remaining = (pl.tracks || []).map((t) => String(t.id || '')).filter((id) => id && !playlistSelection.has(id));
  playlistSelection.clear();
  setStatus('catalog-status', `Quitando ${n} canción${n === 1 ? '' : 'es'} de la playlist...`);
  await setManagerPlaylistTracks(pl.id, remaining, { silent: true });
}

// ── Panel "+" para agregar canciones a la playlist actual ──
function renderPlaylistAddPanel(el, pl) {
  const inPlaylist = new Set((pl.tracks || []).map((t) => String(t.id || '')));
  const buildRows = () => {
    const q = playlistAddQuery.trim().toLowerCase();
    const candidates = catalogCache.filter((s) => !inPlaylist.has(String(s.id)) && (!q || buildCatalogSearchBlob(s).includes(q)));
    return candidates.map((s) => {
      const sel = playlistAddSelection.has(s.id);
      const cover = s.cover
        ? `<span class="pl-song-cover" style="background-image:url('${escapeHtml(s.cover)}')"></span>`
        : `<span class="pl-song-cover pl-song-cover-empty">♪</span>`;
      return `<li class="pl-song-li"><div class="pl-song-row pl-song-row-edit ${sel ? 'is-selected' : ''}" data-add-toggle="${escapeHtml(s.id)}">
        <span class="pl-check ${sel ? 'on' : ''}">${sel ? '✓' : ''}</span>${cover}
        <span class="pl-song-meta"><strong>${escapeHtml(s.obra || 'Sin título')}</strong><span class="pl-song-artist">${escapeHtml(s.autores || '—')}</span></span>
      </div></li>`;
    }).join('') || '<li class="pl-empty">No hay más canciones para agregar.</li>';
  };
  const nSel = playlistAddSelection.size;
  el.innerHTML = `
    <div class="pl-detail-head">
      <button class="pl-back" id="pl-add-back" type="button">‹ ${escapeHtml(pl.name)}</button>
      <h2 class="pl-detail-title">Agregar canciones</h2>
      <input id="pl-add-search" class="catalog-genre-select" type="search" placeholder="Buscar canción, compositor, género..." value="${escapeHtml(playlistAddQuery)}" />
      <div class="pl-edit-bar">
        <span class="pl-edit-count" id="pl-add-count">${nSel} seleccionada${nSel === 1 ? '' : 's'}</span>
        <button class="pl-danger-btn" id="pl-add-confirm" type="button">＋ Agregar</button>
      </div>
    </div>
    <ul class="list pl-song-list" id="pl-add-list">${buildRows()}</ul>`;

  const exit = () => { playlistAddMode = false; playlistAddSelection.clear(); playlistAddQuery = ''; renderPlaylistsView(); };
  document.getElementById('pl-add-back')?.addEventListener('click', exit);
  document.getElementById('pl-add-confirm')?.addEventListener('click', () => addSelectedSongsToPlaylist(pl));
  const search = document.getElementById('pl-add-search');
  if (search) search.addEventListener('input', () => {
    playlistAddQuery = String(search.value || '');
    const list = document.getElementById('pl-add-list');
    if (list) list.innerHTML = buildRows();
  });
  document.getElementById('pl-add-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-add-toggle]');
    if (!row) return;
    const id = row.getAttribute('data-add-toggle');
    if (playlistAddSelection.has(id)) playlistAddSelection.delete(id); else playlistAddSelection.add(id);
    row.classList.toggle('is-selected');
    const chk = row.querySelector('.pl-check');
    if (chk) { const on = playlistAddSelection.has(id); chk.classList.toggle('on', on); chk.textContent = on ? '✓' : ''; }
    const n = playlistAddSelection.size;
    const cnt = document.getElementById('pl-add-count'); if (cnt) cnt.textContent = `${n} seleccionada${n === 1 ? '' : 's'}`;
  });
}

async function addSelectedSongsToPlaylist(pl) {
  const ids = [...playlistAddSelection];
  if (!ids.length) return;
  playlistAddMode = false;
  playlistAddSelection.clear();
  playlistAddQuery = '';

  // Optimista: agregamos a la playlist en memoria y renderizamos YA, sin esperar
  // a la red. Las peticiones van en paralelo en segundo plano y al terminar
  // reconciliamos silenciosamente con el server.
  const target = playlistsCache.find((p) => p.id === pl.id) || pl;
  const existing = new Set((target.tracks || []).map((t) => String(t.id || '')));
  const added = [];
  for (const id of ids) {
    if (existing.has(String(id))) continue;
    const song = catalogCache.find((s) => String(s.id) === String(id));
    const track = { id: String(id), title: song?.obra || String(id) };
    target.tracks = [...(target.tracks || []), track];
    added.push(track);
  }
  target.trackCount = (target.tracks || []).length;
  setStatus('catalog-status', `${added.length} agregada${added.length === 1 ? '' : 's'} a "${target.name}".`);
  renderPlaylists();
  renderCatalog();

  // Persistir en paralelo (no bloquea la UI) y reconciliar al final.
  await Promise.all(added.map((t) =>
    fetch(`${API_BASE}/api/manager/playlists/${pl.id}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ action: 'add_track', trackId: t.id, trackTitle: t.title }),
    }).catch(() => null)
  ));
  await loadPlaylistsFromApi();
  renderCatalog();
}

// ── Drag iOS-style para reordenar canciones (agarradero ≡) ──
// El ítem arrastrado sigue al dedo (translateY 1:1) y los demás se deslizan
// suavemente para abrir el hueco donde va a caer. Al soltar persiste el orden.
let plDrag = null;
function setupPlaylistDragReorder(pl) {
  const list = document.getElementById('pl-song-list');
  if (!list) return;
  list.querySelectorAll('.pl-drag-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => beginPlDrag(e, handle, list, pl));
  });
}

function beginPlDrag(e, handle, list, pl) {
  e.preventDefault();
  const li = handle.closest('.pl-song-li');
  if (!li) return;
  const items = [...list.querySelectorAll('.pl-song-li')];
  const from = items.indexOf(li);
  if (from < 0) return;
  // Posiciones originales (para calcular destino y desplazamientos).
  const metrics = items.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, mid: r.top + r.height / 2 };
  });
  const draggedH = li.getBoundingClientRect().height;
  try { handle.setPointerCapture(e.pointerId); } catch {}
  li.classList.add('pl-dragging');
  plDrag = { li, list, pl, items, metrics, from, to: from, startY: e.clientY, draggedH };

  const move = (ev) => onPlDragMove(ev);
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    onPlDragEnd();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function onPlDragMove(ev) {
  if (!plDrag) return;
  const { li, metrics, from, draggedH } = plDrag;
  const dy = ev.clientY - plDrag.startY;
  li.style.transform = `translateY(${dy}px)`;                 // el ítem sigue al dedo
  const center = metrics[from].mid + dy;
  // Índice destino: cuántos OTROS ítems tienen su centro por encima del dedo.
  let to = 0;
  for (let i = 0; i < metrics.length; i++) {
    if (i === from) continue;
    if (center > metrics[i].mid) to += 1;
  }
  plDrag.to = to;
  // Abrir el hueco: los ítems entre origen y destino se deslizan.
  for (let i = 0; i < metrics.length; i++) {
    if (i === from) continue;
    let shift = 0;
    if (to > from && i > from && i <= to) shift = -draggedH;
    else if (to < from && i >= to && i < from) shift = draggedH;
    metrics[i].el.style.transform = shift ? `translateY(${shift}px)` : '';
  }
}

function onPlDragEnd() {
  if (!plDrag) return;
  const { li, list, pl, items, from, to } = plDrag;
  items.forEach((el) => { el.style.transform = ''; });        // limpiar transforms
  li.classList.remove('pl-dragging');
  if (to !== from && items[to]) {                              // reordenar DOM
    if (to > from) items[to].after(li); else items[to].before(li);
  }
  const newOrder = [...list.querySelectorAll('.pl-song-li')]
    .map((el) => el.getAttribute('data-song-id'))
    .filter(Boolean);
  plDrag = null;
  if (to === from) return;
  // OPTIMISTA: el DOM ya muestra el nuevo orden; actualizamos la cache local y
  // persistimos en background (sin recargar/re-render → instantáneo).
  const byId = new Map((pl.tracks || []).map((t) => [String(t.id), t]));
  pl.tracks = newOrder.map((id) => byId.get(id)).filter(Boolean);
  pl.trackCount = pl.tracks.length;
  void persistPlaylistOrder(pl.id, newOrder);
}

async function persistPlaylistOrder(playlistId, orderedIds) {
  try {
    const r = await fetch(`${API_BASE}/api/manager/playlists/${playlistId}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ action: 'set_tracks', trackIds: orderedIds }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('catalog-status', 'Orden guardado.');
  } catch (e) {
    setStatus('catalog-status', `No se pudo guardar el orden: ${e instanceof Error ? e.message : e}`, true);
  }
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

function parseCatalogAiTags(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildCatalogSearchBlob(row = {}) {
  const tokens = [
    row.obra,
    row.autores,
    row.generos,
    row.drive,
    row.fileId,
    row.letra,
    row.lyricsText,
    row.searchText,
    row.aiTagsRaw,
    ...(Array.isArray(row.aiTags) ? row.aiTags : []),
  ];

  if (row.certificadaIndautor || Number(row.certificadaIndautorCount || 0) > 0) {
    tokens.push('registrada', 'registrado', 'registro', 'indautor', 'certificada', 'certificado');
  }
  if (row.registradaSacm) {
    tokens.push('sacm', 'registrada en sacm', 'registro sacm');
  }
  if (row.registradaBmi) {
    tokens.push('bmi', 'registrada en bmi', 'registro bmi');
  }
  if (row.letra) {
    tokens.push('con letra', 'lyrics', 'letra disponible');
  }

  return tokens
    .map((v) => String(v || '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
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
  // Getter correcto de Howler: seek([position], [id]).
  // Antes se pasaba el soundId como primer argumento, provocando seeks involuntarios
  // que podían generar micro-cortes (especialmente notable en Bluetooth/CarPlay).
  const seek = Number(howl.seek(undefined, catalogPlayer.activeSoundId || undefined) || 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, (seek / total) * 100)) : 0;

  if (!catalogPlayer.isSeeking) {
    progress.value = `${percent}`;
  }
  const fill = document.getElementById('player-mini-fill');
  if (fill) fill.style.width = `${percent}%`;
  current.textContent = formatTime(seek);
  duration.textContent = formatTime(total);

  // Cuenta un play cuando se escuchó ≥10s o ≥25% (una sola vez por reproducción).
  if (catalogNowPlayingId && catalogPlayCountedId !== catalogNowPlayingId
      && (seek >= 10 || (total > 0 && seek / total >= 0.25))) {
    catalogPlayCountedId = catalogNowPlayingId;
    countCatalogPlay(catalogNowPlayingId);
  }
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

function setPlayButtonState(btn) {
  if (!btn) return;
  btn.classList.toggle('is-loading', catalogPlayer.isLoading);
  btn.disabled = catalogPlayer.isLoading ? true : !getCatalogPlayerTrackByIndex();
  btn.textContent = catalogPlayer.isPlaying ? '⏸' : '▶';
}

function setCoverEl(coverId, placeholderId, track) {
  const cover = document.getElementById(coverId);
  const placeholder = document.getElementById(placeholderId);
  if (!cover || !placeholder) return;
  if (track?.cover) {
    cover.src = track.cover;
    cover.classList.add('visible');
    placeholder.classList.add('hidden');
  } else {
    cover.removeAttribute('src');
    cover.classList.remove('visible');
    placeholder.classList.remove('hidden');
  }
}

function updateCatalogPlayerUi() {
  const track = getCatalogPlayerTrackByIndex();
  const player = document.getElementById('catalog-player');
  if (player) player.classList.toggle('has-track', Boolean(track));

  // Mini-bar
  const miniTitle = document.getElementById('catalog-player-track-title');
  const miniArtist = document.querySelector('#catalog-player-track-artist .catalog-authors-text')
    || document.getElementById('catalog-player-track-artist');
  if (miniTitle) miniTitle.textContent = track?.obra || 'Selecciona una canción';
  if (miniArtist) miniArtist.textContent = track?.autores || '—';
  setCoverEl('catalog-player-cover', 'catalog-player-cover-placeholder', track);
  setPlayButtonState(document.getElementById('catalog-play-toggle'));

  // Vista expandida
  const expTitle = document.getElementById('player-exp-title');
  const expArtist = document.getElementById('player-exp-artist');
  if (expTitle) expTitle.textContent = track?.obra || 'Selecciona una canción';
  if (expArtist) expArtist.textContent = track?.autores || '—';
  setCoverEl('player-exp-cover', 'player-exp-cover-placeholder', track);
  setPlayButtonState(document.getElementById('player-exp-toggle'));

  const randomBtn = document.getElementById('catalog-random');
  if (randomBtn) {
    randomBtn.classList.toggle('active', catalogRandomMode);
    randomBtn.setAttribute('aria-pressed', catalogRandomMode ? 'true' : 'false');
  }

  updateLyricsButtonVisibility();
  updateKaraokeButtonUi();
  updatePlayerLikeButton();

  if (!track) {
    const progress = document.getElementById('catalog-player-progress');
    if (progress) progress.value = '0';
    const fill = document.getElementById('player-mini-fill');
    if (fill) fill.style.width = '0%';
    const current = document.getElementById('catalog-player-current');
    const duration = document.getElementById('catalog-player-duration');
    if (current) current.textContent = '0:00';
    if (duration) duration.textContent = '0:00';
    setCatalogPlayerExpanded(false);
  }
}

function setCatalogPlayerExpanded(expanded) {
  catalogPlayerExpanded = Boolean(expanded);
  const player = document.getElementById('catalog-player');
  const exp = document.getElementById('player-expanded');
  if (player) player.classList.toggle('is-expanded', catalogPlayerExpanded);
  if (exp) exp.setAttribute('aria-hidden', catalogPlayerExpanded ? 'false' : 'true');
  // El karaoke solo corre mientras el Now Playing está expandido y la letra visible
  if (catalogPlayerExpanded && catalogLyricsOn) {
    renderLyricsPanel();
    startLyricsKaraoke();
  } else {
    stopLyricsKaraoke();
  }
  // Leyenda "Ver letra": ciclo solo mientras el Now Playing está expandido
  if (catalogPlayerExpanded) startLyricsHintCycle();
  else stopLyricsHintCycle();
}

// Leyenda "Ver letra" que aparece de vez en cuando (solo en vista portada, con letra)
function flashLyricsHint() {
  const pill = document.getElementById('player-lyrics-hint');
  const track = getCatalogPlayerTrackByIndex();
  const hasLyrics = Boolean(track && String(track.lyricsText || '').trim());
  if (!pill || !catalogPlayerExpanded || catalogLyricsOn || !hasLyrics) return;
  lyricsHintAnimTimers.forEach(clearTimeout);
  lyricsHintAnimTimers = [];

  const text = '... ver letra';
  const writeOnce = () => {
    // Cada letra cae desde arriba con bounce, escalonada (typewriter)
    pill.innerHTML = text.split('').map((ch, i) =>
      `<span class="hint-char" style="animation-delay:${(i * 0.045).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`
    ).join('');
    pill.classList.remove('show');
    void pill.offsetWidth; // reflow para reiniciar la animación
    pill.classList.add('show');
  };

  const ANIM = 1100; // dura aprox la escritura completa
  writeOnce();                                                   // 1ª escritura
  lyricsHintAnimTimers.push(setTimeout(writeOnce, ANIM + 2000)); // espera 2s, repite
  lyricsHintAnimTimers.push(setTimeout(() => pill.classList.remove('show'), ANIM + 2000 + ANIM + 2000)); // 2s y desaparece
}

function startLyricsHintCycle() {
  stopLyricsHintCycle();
  lyricsHintTimer = setTimeout(function loop() {
    flashLyricsHint();
    lyricsHintTimer = setTimeout(loop, 22000);
  }, 3000);
}

function stopLyricsHintCycle() {
  if (lyricsHintTimer) clearTimeout(lyricsHintTimer);
  lyricsHintTimer = null;
  lyricsHintAnimTimers.forEach(clearTimeout);
  lyricsHintAnimTimers = [];
  const pill = document.getElementById('player-lyrics-hint');
  if (pill) pill.classList.remove('show');
}

// ── Letra / karaoke ──
function parseLyrics(text) {
  const raw = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = [];
  let synced = false;
  for (const line of raw) {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]\s*(.*)$/);
    if (m) {
      synced = true;
      lines.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: m[3] });
    } else {
      lines.push({ t: null, text: line });
    }
  }
  return { synced, lines };
}

function updateLyricsButtonVisibility() {
  const btn = document.getElementById('player-lyrics-toggle');
  const editBtn = document.getElementById('player-lyrics-edit');
  const track = getCatalogPlayerTrackByIndex();
  const hasLyrics = Boolean(track && String(track.lyricsText || '').trim());
  if (btn) btn.classList.toggle('hidden', !hasLyrics);
  if (editBtn) editBtn.classList.toggle('hidden', !(hasLyrics && catalogLyricsOn && isAuthenticated));
  if (!hasLyrics && catalogLyricsOn) setLyricsVisible(false);
  else if (hasLyrics && catalogLyricsOn && !catalogLyricsEditing) renderLyricsPanel();
}

function renderLyricsPanel() {
  const panel = document.getElementById('player-lyrics');
  if (!panel) return;
  const track = getCatalogPlayerTrackByIndex();
  const parsed = parseLyrics(track?.lyricsText || '');
  panel.classList.toggle('plain', !parsed.synced);
  catalogLyricLastIdx = -1;

  if (!parsed.lines.length) {
    panel.innerHTML = '<p class="lyric-line" style="cursor:default">Sin letra disponible.</p>';
    return;
  }

  panel.innerHTML = parsed.lines
    .map((l, i) => `<p class="lyric-line" data-i="${i}"${l.t !== null ? ` data-t="${l.t}"` : ''}>${escapeHtml(l.text)}</p>`)
    .join('');

  // Tocar una línea con tiempo salta a ese punto de la canción
  panel.querySelectorAll('.lyric-line[data-t]').forEach((el) => {
    el.addEventListener('click', () => {
      const t = Number(el.getAttribute('data-t'));
      const howl = catalogPlayer.howl;
      if (howl && howl.state && howl.state() === 'loaded') {
        howl.seek(t, catalogPlayer.activeSoundId || undefined);
        refreshCatalogProgressUi();
      }
    });
  });
}

function highlightActiveLyric() {
  const panel = document.getElementById('player-lyrics');
  if (!panel || panel.classList.contains('plain')) return;
  const howl = catalogPlayer.howl;
  const cur = (howl && howl.state && howl.state() === 'loaded')
    ? Number(howl.seek(undefined, catalogPlayer.activeSoundId || undefined) || 0)
    : 0;
  const lines = panel.querySelectorAll('.lyric-line[data-t]');
  if (!lines.length) return;
  let activeIdx = -1;
  lines.forEach((el, i) => {
    if (Number(el.getAttribute('data-t')) <= cur) activeIdx = i;
  });
  lines.forEach((el, i) => {
    el.classList.toggle('is-active', i === activeIdx);
    el.classList.toggle('is-past', i < activeIdx);
  });
  // Antes de que entre la primera línea, centra la línea 0 (arranca en el centro).
  const focusIdx = activeIdx >= 0 ? activeIdx : 0;
  if (focusIdx !== catalogLyricLastIdx && lines[focusIdx]) {
    catalogLyricLastIdx = focusIdx;
    // Scroll SOLO vertical (evita el bamboleo horizontal del scrollIntoView)
    const pr = panel.getBoundingClientRect();
    const lr = lines[focusIdx].getBoundingClientRect();
    const delta = (lr.top + lr.height / 2) - (pr.top + pr.height / 2);
    panel.scrollTo({ top: panel.scrollTop + delta, behavior: 'smooth' });
  }
}

function startLyricsKaraoke() {
  stopLyricsKaraoke();
  highlightActiveLyric();
  catalogLyricsTimer = setInterval(highlightActiveLyric, 120);
}

function stopLyricsKaraoke() {
  if (catalogLyricsTimer) clearInterval(catalogLyricsTimer);
  catalogLyricsTimer = null;
}

function setLyricsVisible(on) {
  catalogLyricsOn = Boolean(on);
  const player = document.getElementById('catalog-player');
  const btn = document.getElementById('player-lyrics-toggle');
  if (player) player.classList.toggle('lyrics-on', catalogLyricsOn);
  if (btn) btn.classList.toggle('active', catalogLyricsOn);
  if (catalogLyricsOn) {
    const pill = document.getElementById('player-lyrics-hint');
    if (pill) pill.classList.remove('show');
    renderLyricsPanel();
    startLyricsKaraoke();
  } else {
    if (catalogLyricsEditing) setLyricsEditing(false);
    stopLyricsKaraoke();
    setLyricsPeek(false); // al salir de la letra, resetea el estado de controles
  }
  updateLyricsButtonVisibility();
}

// Estado "peek": en la vista de letra, asoma la fila de controles (prev/play/
// next/share). El título + compositores + barra de tiempo siempre están visibles.
// Se queda hasta que el usuario lo esconda (swipe-down) o salga de la letra.
function setLyricsPeek(on) {
  const player = document.getElementById('catalog-player');
  if (player) player.classList.toggle('lyrics-peek', Boolean(on));
}

// ── Editor de letra (solo logueado) ──
function setLyricsEditing(on) {
  catalogLyricsEditing = Boolean(on);
  const player = document.getElementById('catalog-player');
  const editBtn = document.getElementById('player-lyrics-edit');
  const bar = document.getElementById('lyrics-edit-bar');
  if (player) player.classList.toggle('lyrics-editing', catalogLyricsEditing);
  if (editBtn) editBtn.classList.toggle('active', catalogLyricsEditing);
  if (bar) bar.classList.toggle('hidden', !catalogLyricsEditing);
  if (catalogLyricsEditing) {
    stopLyricsKaraoke();
    renderLyricEditor();
  } else {
    renderLyricsPanel();
    startLyricsKaraoke();
  }
}

function renderLyricEditor() {
  const panel = document.getElementById('player-lyrics');
  if (!panel) return;
  const track = getCatalogPlayerTrackByIndex();
  const parsed = parseLyrics(track?.lyricsText || '');
  panel.classList.remove('plain');
  panel.innerHTML = parsed.lines.map((l, i) => {
    const tlabel = l.t !== null ? formatTime(l.t) : '–:––';
    return `<div class="lyric-edit-row">
      <button class="lyric-set-time" data-i="${i}" data-t="${l.t !== null ? l.t : ''}" title="Marcar el tiempo actual">${tlabel} ⌖</button>
      <input class="lyric-edit-text" data-i="${i}" value="${escapeHtml(l.text)}" />
    </div>`;
  }).join('') || '<p class="lyric-line" style="cursor:default">Sin letra para editar.</p>';

  panel.querySelectorAll('.lyric-set-time').forEach((btn) => {
    btn.addEventListener('click', () => {
      const howl = catalogPlayer.howl;
      const cur = (howl && howl.state && howl.state() === 'loaded')
        ? Number(howl.seek(undefined, catalogPlayer.activeSoundId || undefined) || 0) : 0;
      btn.setAttribute('data-t', cur.toFixed(2));
      btn.textContent = `${formatTime(cur)} ⌖`;
    });
  });
}

function buildLrcFromEditor() {
  const panel = document.getElementById('player-lyrics');
  const lines = [];
  panel.querySelectorAll('.lyric-edit-row').forEach((row) => {
    const btn = row.querySelector('.lyric-set-time');
    const input = row.querySelector('.lyric-edit-text');
    const text = (input.value || '').trim();
    if (!text) return;
    const t = btn.getAttribute('data-t');
    if (t !== '' && t !== null && !isNaN(Number(t))) {
      const sec = Number(t);
      const mm = Math.floor(sec / 60);
      const ss = sec - mm * 60;
      lines.push(`[${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}]${text}`);
    } else {
      lines.push(text);
    }
  });
  return lines.join('\n');
}

async function saveLyrics() {
  const track = getCatalogPlayerTrackByIndex();
  if (!track) return;
  const lrc = buildLrcFromEditor();
  const saveBtn = document.getElementById('lyrics-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/manager/lyrics`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ lyricUrl: track.letra || '', lrc }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    track.lyricsText = lrc; // refresca cache local
    setCatalogPlayerStatus('Letra guardada ✓');
    setLyricsEditing(false);
  } catch (e) {
    setCatalogPlayerStatus('Error al guardar la letra', true);
    alert('No se pudo guardar la letra: ' + (e instanceof Error ? e.message : e));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
  }
}

// fileId activo según el modo (original vs instrumental karaoke).
function activeFileId(track) {
  if (!track) return '';
  const useKaraoke = catalogPlayer.karaokeMode && track.fileIdInstrumental;
  return useKaraoke ? track.fileIdInstrumental : track.fileId;
}

function streamUrlForFileId(fid) {
  if (!API_BASE || !fid) return '';
  return `${API_BASE}/api/audio/${encodeURIComponent(fid)}`;
}

function buildSecureAudioUrl(track) {
  return streamUrlForFileId(activeFileId(track));
}

// ── Descarga COMPLETA a Blob (fix CarPlay wireless) ──────────────────────────
// Reproducir desde un Blob en memoria (no streaming progresivo) evita los
// micro-cortes en CarPlay wireless: una vez en memoria, la reproducción no
// depende de la red aunque el WiFi esté saturado por el enlace al coche.
// Se cachea por fileId y se prefetchea la canción siguiente.
const audioBlobCache = new Map();      // fileId -> { url, ts }
const audioBlobInflight = new Map();   // fileId -> Promise<string|null>
const AUDIO_BLOB_CACHE_MAX = 4;

function evictAudioBlobs() {
  // Nunca revocar el blob que se está reproduciendo ahora.
  const protectedFid = activeFileId(getCurrentCatalogSong());
  for (const key of [...audioBlobCache.keys()]) {
    if (audioBlobCache.size <= AUDIO_BLOB_CACHE_MAX) break;
    if (key === protectedFid) continue;
    const entry = audioBlobCache.get(key);
    audioBlobCache.delete(key);
    if (entry && entry.url) {
      try { URL.revokeObjectURL(entry.url); } catch {}
    }
  }
}

// Devuelve un object URL del archivo COMPLETO ya descargado, o null si falla.
function fetchAudioBlobUrl(fid) {
  if (!fid || !API_BASE) return Promise.resolve(null);
  const cached = audioBlobCache.get(fid);
  if (cached) {
    // refrescar orden de recencia
    audioBlobCache.delete(fid);
    audioBlobCache.set(fid, cached);
    return Promise.resolve(cached.url);
  }
  if (audioBlobInflight.has(fid)) return audioBlobInflight.get(fid);

  const p = fetch(streamUrlForFileId(fid))
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      audioBlobCache.set(fid, { url, ts: Date.now() });
      evictAudioBlobs();
      return url;
    })
    .catch((e) => {
      console.warn('[audio-blob] fallo descarga completa, fallback a streaming:', fid, e?.message || e);
      return null;
    })
    .finally(() => audioBlobInflight.delete(fid));

  audioBlobInflight.set(fid, p);
  return p;
}

// Prefetch (fire-and-forget) del original de la canción siguiente en la cola.
function prefetchNextAudioBlob() {
  try {
    const queue = getCatalogQueue();
    if (!queue.length) return;
    let pos = queue.indexOf(catalogNowPlayingId);
    if (pos < 0) pos = 0;
    const nextId = queue[(pos + 1) % queue.length];
    if (!nextId || nextId === catalogNowPlayingId) return;
    const nextTrack = catalogCache.find((s) => s.id === nextId);
    if (nextTrack && nextTrack.fileId) void fetchAudioBlobUrl(nextTrack.fileId);
  } catch {}
}

// Cola contextual: navega sobre lo que se está viendo (género/playlist/búsqueda),
// no sobre el catálogo global. Fallback al catálogo completo si no hay vista.
function getCatalogQueue() {
  return catalogQueue.length ? catalogQueue : catalogCache.map((s) => s.id);
}

function playNextCatalogTrack(step = 1) {
  const queue = getCatalogQueue();
  if (!queue.length) return;
  if (catalogRandomMode && step > 0) {
    playRandomCatalogTrack();
    return;
  }
  let pos = queue.indexOf(catalogNowPlayingId);
  pos = pos < 0 ? 0 : (pos + step + queue.length) % queue.length;
  playCatalogSong(queue[pos]);
}

function playRandomCatalogTrack() {
  const queue = getCatalogQueue();
  if (!queue.length) return;
  if (queue.length === 1) {
    playCatalogSong(queue[0]);
    return;
  }
  let nextId = catalogNowPlayingId;
  while (nextId === catalogNowPlayingId) {
    nextId = queue[Math.floor(Math.random() * queue.length)];
  }
  playCatalogSong(nextId);
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
  // Cada canción nueva arranca con la voz (no karaoke). El swap es por-canción.
  catalogPlayer.karaokeMode = false;
  catalogPlayer.isLoading = true;
  setCatalogPlayerStatus('Validando permisos y preparando stream...');
  updateCatalogPlayerUi();
  updateActiveSongRow();
  updateKaraokeButtonUi();

  mountCatalogHowl(track, { autoplay });
}

// Monta (o re-monta) el Howl de la pista actual respetando catalogPlayer.karaokeMode.
// startAt: segundo donde arrancar (para conservar posición al hacer swap 🎤).
// Descarga el archivo COMPLETO a Blob primero (fix CarPlay wireless) y reproduce
// desde memoria; si la descarga falla, cae a streaming progresivo.
function mountCatalogHowl(track, { startAt = 0, autoplay = false } = {}) {
  const fid = activeFileId(track);
  const streamUrl = streamUrlForFileId(fid);
  if (!streamUrl) {
    setCatalogPlayerStatus('No se pudo resolver el audio', true);
    return;
  }
  const loadId = track.id;             // token para detectar cambio de pista
  const mode = catalogPlayer.karaokeMode;
  setCatalogPlayerStatus('Descargando pista…');

  fetchAudioBlobUrl(fid).then((blobUrl) => {
    // Si cambió la canción o el modo karaoke mientras descargaba, abortar.
    if (catalogNowPlayingId !== loadId || catalogPlayer.karaokeMode !== mode) return;
    createCatalogHowl(track, blobUrl || streamUrl, { startAt, autoplay });
  });
}

function createCatalogHowl(track, src, { startAt = 0, autoplay = false } = {}) {
  const howl = new window.Howl({
    src: [src],
    format: ['mp3'],          // los blob: URLs no tienen extensión; forzar formato
    html5: true,
    volume: catalogPlayer.volume,
    preload: true,
    autoplay: false,
  });

  catalogPlayer.howl = howl;

  howl.on('load', () => {
    if (catalogPlayer.howl !== howl) return;
    catalogPlayer.isLoading = false;
    if (startAt > 0) {
      try { howl.seek(startAt); } catch {}
    }
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
    prefetchNextAudioBlob();   // pre-descarga la siguiente para arranque instantáneo y sin cortes
    updateActiveSongRow();
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

// 🎤 Swap voz ↔ instrumental para la canción actual, conservando posición y
// estado de reproducción. Solo aplica si la pista tiene fileIdInstrumental.
// La pista de karaoke se descarga COMPLETA (no se prefetchea): mientras baja,
// la canción actual SIGUE SONANDO y se avisa "Descargando instrumental…"; el
// swap ocurre recién cuando el archivo está en memoria (mismo punto, sin cortes).
let karaokeSwapToken = 0;
function toggleKaraoke() {
  const track = getCurrentCatalogSong();
  if (!track || !track.fileIdInstrumental) return;

  const newMode = !catalogPlayer.karaokeMode;
  const fid = newMode ? track.fileIdInstrumental : track.fileId;
  const token = ++karaokeSwapToken;

  // Aviso claro de descarga + botón en estado de carga. NO cortamos el audio aún.
  catalogPlayer.karaokeSwapping = true;
  setCatalogPlayerStatus(newMode ? 'Descargando instrumental…' : 'Descargando voz…');
  setStatus('catalog-status', newMode ? 'Descargando pista instrumental (karaoke)…' : 'Descargando voz…');
  updateKaraokeButtonUi();

  fetchAudioBlobUrl(fid).then((blobUrl) => {
    // Abortar si el usuario volvió a tocar el botón o cambió de canción mientras bajaba.
    if (token !== karaokeSwapToken) return;
    if ((getCurrentCatalogSong() || {}).id !== track.id) {
      catalogPlayer.karaokeSwapping = false;
      updateKaraokeButtonUi();
      return;
    }
    // Capturar posición/estado JUSTO antes del swap (la canción siguió avanzando).
    const howl = catalogPlayer.howl;
    const wasPlaying = catalogPlayer.isPlaying || catalogPlayer.pendingPlay;
    const at = (howl && howl.state && howl.state() === 'loaded')
      ? Number(howl.seek(undefined, catalogPlayer.activeSoundId || undefined) || 0)
      : 0;

    catalogPlayer.karaokeMode = newMode;
    catalogPlayer.karaokeSwapping = false;
    clearCatalogHowl();
    catalogPlayer.isLoading = true;
    updateCatalogPlayerUi();
    updateKaraokeButtonUi();
    createCatalogHowl(track, blobUrl || streamUrlForFileId(fid), { startAt: at, autoplay: wasPlaying });
  });
}

function updateKaraokeButtonUi() {
  const btn = document.getElementById('player-karaoke');
  if (!btn) return;
  const track = getCurrentCatalogSong();
  const has = Boolean(track && track.fileIdInstrumental);
  btn.classList.toggle('hidden', !has);
  const on = has && catalogPlayer.karaokeMode;
  const loading = Boolean(catalogPlayer.karaokeSwapping);
  btn.classList.toggle('active', on);
  btn.classList.toggle('loading', loading);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  btn.title = loading ? 'Descargando instrumental…' : (on ? 'Volver a la voz' : 'Quitar voz líder (karaoke)');
}

// Update quirúrgico: solo mueve el highlight de la fila activa, sin re-render completo.
function updateActiveSongRow() {
  const songsEl = document.getElementById('catalog-songs');
  if (!songsEl) return;
  songsEl.querySelectorAll('.catalog-song-row').forEach((row) => {
    const btn = row.querySelector('[data-catalog-play]');
    const id = btn ? btn.getAttribute('data-catalog-play') : '';
    const active = Boolean(id) && id === catalogNowPlayingId;
    row.classList.toggle('is-active', active);
    // El título solo hace marquee si NO cabe. Medimos el ancho natural (sin la
    // clase de scroll, que mete padding y falsearía la medición).
    const titleline = row.querySelector('.catalog-song-titleline');
    if (titleline) {
      titleline.classList.remove('is-overflowing');
      if (active) {
        const inner = titleline.querySelector('.catalog-song-titleline-inner');
        if (inner && inner.scrollWidth > titleline.clientWidth + 1) {
          titleline.classList.add('is-overflowing');
        }
      }
    }
  });
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

  renderCatalog(); // Asegura de pintar la UI en el modo correcto

  // Link de canción compartida → abrir directo en la vista de portada (Now Playing
  // expandido), no solo el mini-player. Así el que recibe el link cae en la portada.
  const openInCover = catalogDeepLinkAutoplay && !!catalogDeepLinkSongId;

  void loadCatalogTrack(index, { autoplay: catalogDeepLinkAutoplay }).then(() => {
    if (openInCover && catalogNowPlayingId === String(track.id)) setCatalogPlayerExpanded(true);
  });
}

function renderCatalog() {
  const genresEl = document.getElementById('catalog-genres');
  const songsEl = document.getElementById('catalog-songs');
  const selectedGenreEl = document.getElementById('catalog-selected-genre');
  const filterTabGenres = document.getElementById('catalog-filter-tab-genres');
  const filterTabPlaylists = document.getElementById('catalog-filter-tab-playlists');
  if (!genresEl || !songsEl || !selectedGenreEl || !filterTabGenres || !filterTabPlaylists) return;

  const genres = Array.from(new Set(catalogCache.flatMap((row) => parseCatalogGenres(row.generos))));
  const allGenres = ['Todas', ...genres.sort((a, b) => a.localeCompare(b, 'es'))];
  if (!allGenres.includes(catalogGenreFilter)) catalogGenreFilter = 'Todas';

  if (!['genres', 'playlists'].includes(catalogFilterView)) {
    catalogFilterView = 'genres';
  }

  filterTabGenres.classList.toggle('active', catalogFilterView === 'genres');
  filterTabPlaylists.classList.toggle('active', catalogFilterView === 'playlists');
  // Vista géneros: selector en el mismo renglón que los tabs (compacto)
  if (genresEl.parentElement) {
    genresEl.parentElement.classList.toggle('is-genres-view', catalogFilterView === 'genres');
  }

  // Vista Playlists estilo Apple Music (se renderiza en el panel derecho, donde
  // van las canciones; el aside conserva sus tabs intactos como antes):
  // - LISTA (sin playlist abierta): se ocultan canciones + encabezado, se muestra la lista.
  // - DETALLE (playlist abierta): se muestra el header de la playlist + sus canciones.
  const playlistsMode = catalogFilterView === 'playlists';
  const playlistDetailOpen = playlistsMode && !!selectedPlaylistId;
  const playlistsViewEl = document.getElementById('catalog-playlists-view');
  const songsHeadEl = document.querySelector('#tab-catalog .catalog-songs-head');
  // En modo playlists la lista de canciones la renderiza renderPlaylistsView
  // (en orden de la playlist), así que ocultamos #catalog-songs siempre.
  const showSongs = !playlistsMode;
  if (songsEl) songsEl.style.display = showSongs ? '' : 'none';
  if (songsHeadEl) songsHeadEl.style.display = playlistsMode ? 'none' : '';
  if (playlistsViewEl) {
    playlistsViewEl.classList.toggle('hidden', !playlistsMode);
    if (playlistsMode) renderPlaylistsView();
  }
  // El buscador principal cambia de objetivo: en la vista LISTA de playlists
  // busca playlists por nombre; en cualquier otra vista, canciones.
  const catalogSearchEl = document.getElementById('catalog-search');
  if (catalogSearchEl) {
    catalogSearchEl.placeholder = (playlistsMode && !selectedPlaylistId)
      ? 'Buscar playlists...'
      : 'Buscar canciones (nombre, compositor, género, link...)';
  }

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
    // Modo Playlists: el aside solo muestra los tabs (la lista/detalle de
    // playlists vive full en el panel derecho, estilo Apple Music).
    genresEl.innerHTML = '';
  }

  const byGenre = catalogGenreFilter === 'Todas'
    ? catalogCache
    : catalogCache.filter((row) => parseCatalogGenres(row.generos).includes(catalogGenreFilter));

  const baseForSearch = catalogFilterView === 'playlists' ? catalogCache : byGenre;

  const bySearch = !catalogSearchQuery.trim()
    ? baseForSearch
    : baseForSearch.filter((row) => {
        const haystack = buildCatalogSearchBlob(row);
        return haystack.includes(catalogSearchQuery.trim().toLowerCase());
      });

  const selectedPlaylist = playlistsCache.find((pl) => pl.id === selectedPlaylistId);
  const selectedPlaylistTrackIds = new Set(Array.isArray(selectedPlaylist?.tracks) ? selectedPlaylist.tracks.map((t) => String(t.id || '')) : []);

  const visibleSongs = catalogFilterView === 'playlists'
    ? bySearch.filter((row) => selectedPlaylistTrackIds.has(String(row.id || '')))
    : bySearch;
  // La cola de reproducción sigue la vista actual (no el catálogo global)
  catalogQueue = visibleSongs.map((row) => row.id);
  // En el detalle de una playlist, la cola sigue el ORDEN de la playlist.
  if (playlistDetailOpen) {
    const pl = playlistsCache.find((p) => p.id === selectedPlaylistId);
    catalogQueue = (pl?.tracks || [])
      .map((t) => String(t.id || ''))
      .filter((id) => catalogCache.some((s) => String(s.id) === id));
  }
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
                <span class="catalog-song-titleline"><span class="catalog-song-titleline-inner"><strong>${escapeHtml(row.obra || 'Sin título')}</strong>${buildCatalogStats(row)}</span></span>
                <span class="catalog-authors"><span class="catalog-authors-text">${escapeHtml(row.autores || '—')}</span></span>
              </button>
              <div class="actions">
                ${isAuthenticated ? buildCatalogStars(row) : ''}
                ${!isAuthenticated ? '' : (
                  (catalogFilterView === 'playlists' && selectedPlaylistId && selectedPlaylistTrackIds.has(String(row.id || '')))
                    ? `<button class="mini-btn" data-catalog-remove-playlist="${escapeHtml(row.id)}">−</button>`
                    : `<details class="task-actions-menu catalog-playlist-menu">
                        <summary>
                          <span class="task-actions-toggle" role="button" aria-label="Añadir a playlist" style="padding: 0 6px;">+</span>
                        </summary>
                        <div class="task-actions-dropdown">
                          <button class="mini-btn catalog-add-row" data-catalog-create-playlist-for="${escapeHtml(row.id)}"><span class="catalog-add-plus">+</span> Nueva playlist</button>
                          ${playlistsCache.length ? '<hr class="soft-sep" style="margin: 0.25rem 0;" />' : ''}
                          ${playlistsCache.map(pl => `
                            <button class="mini-btn catalog-add-row" data-catalog-add-to-specific="${escapeHtml(pl.id)}" data-song-id="${escapeHtml(row.id)}">
                              <span class="catalog-add-plus">+</span> ${escapeHtml(pl.name)}
                            </button>
                          `).join('')}
                        </div>
                      </details>`
                )}
                ${!isAuthenticated ? buildCatalogLikeBtn(row) : ''}
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

  // Carga infinita: ver setupCatalogInfiniteScroll (sin botón, el player ya no lo tapa)

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

  const playlistSharePaneBtn = document.getElementById('playlist-share-pane');
  if (playlistSharePaneBtn) {
    playlistSharePaneBtn.addEventListener('click', () => {
      shareSelectedPlaylistForListen();
    });
  }

  filterTabGenres.onclick = () => {
    catalogFilterView = 'genres';
    renderCatalog();
  };

  filterTabPlaylists.onclick = () => {
    catalogFilterView = 'playlists';
    catalogGenreFilter = 'Todas';
    selectedPlaylistId = '';   // siempre arrancar en la lista de playlists
    catalogSearchQuery = '';
    playlistEditMode = false;
    playlistSelection.clear();
    playlistAddMode = false;
    playlistAddSelection.clear();
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

  songsEl.querySelectorAll('[data-catalog-rate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCatalogRating(btn.dataset.catalogRate || '', Number(btn.dataset.star || 0));
    });
  });

  songsEl.querySelectorAll('[data-catalog-like]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      likeCatalogSong(btn.dataset.catalogLike || '');
    });
  });

  updateActiveSongRow();
}

// ── Rating (admin) + Likes (visitante) + Plays: helpers ──────────────────────
const THUMB_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a2.5 2.5 0 0 1 2.5 2.5z"/></svg>';

function catalogIsLiked(songId) { return catalogLikedSongs.has(String(songId)); }

// Estrellitas de rating (solo admin). Tap en una estrella ya fijada como rating
// exacto la limpia a 0; si no, fija ese valor.
function buildCatalogStars(row) {
  const r = Number(row.rating || 0);
  return `<span class="catalog-stars" role="group" aria-label="Calificación">${[1, 2, 3]
    .map((n) => `<button type="button" class="catalog-star ${r >= n ? 'on' : ''}" data-catalog-rate="${escapeHtml(row.id)}" data-star="${n}" aria-label="${n} estrella${n > 1 ? 's' : ''}">★</button>`)
    .join('')}</span>`;
}

// Botón de like (solo visitante).
function buildCatalogLikeBtn(row) {
  return `<button type="button" class="catalog-like ${catalogIsLiked(row.id) ? 'liked' : ''}" data-catalog-like="${escapeHtml(row.id)}" aria-label="Me gusta" title="Me gusta">${THUMB_SVG}</button>`;
}

// Formato compacto estilo YouTube: 999 / 1.2K / 3.4M.
function formatCount(n) {
  n = Math.max(0, Math.round(Number(n || 0)));
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`.replace('.0K', 'K');
  return `${(n / 1e6).toFixed(1)}M`.replace('.0M', 'M');
}

// Stats al lado del nombre (plays ▶ + likes ♥), chico, sin bold, estilo YouTube.
function buildCatalogStats(row) {
  const plays = Number(row.plays || 0);
  const likes = Number(row.likes || 0);
  return `<span class="catalog-song-stats">`
    + `<span class="catalog-stat" title="Reproducciones">▶ ${formatCount(plays)}</span>`
    + `<span class="catalog-stat" title="Me gusta">♥ ${formatCount(likes)}</span>`
    + `</span>`;
}

// Reordena el cache: rating desc → likes desc → abecedario.
function resortCatalog() {
  catalogCache.sort((a, b) =>
    (Number(b.rating || 0) - Number(a.rating || 0))
    || (Number(b.likes || 0) - Number(a.likes || 0))
    || String(a.obra || '').localeCompare(String(b.obra || ''), 'es', { sensitivity: 'base' }));
}

// Admin fija el rating de una canción (0-3). Optimista + reordena.
async function setCatalogRating(songId, star) {
  if (!isAuthenticated) return;
  const song = catalogCache.find((s) => String(s.id) === String(songId));
  if (!song) return;
  const current = Number(song.rating || 0);
  const next = (current === star) ? 0 : star;
  song.rating = next;
  // No reordenar al instante (evita que la fila salte mientras calificás).
  // El orden por rating se aplica en el próximo refresh (setCatalog → resortCatalog).
  renderCatalog();
  try {
    const r = await fetch(`${API_BASE}/api/manager/catalog/${songId}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ action: 'set_rating', value: next }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    setStatus('catalog-status', `No se pudo guardar el rating: ${e instanceof Error ? e.message : e}`, true);
  }
}

// Visitante da like (1 por sesión por canción). No reordena de golpe para no
// hacer saltar la fila; el orden por likes se aplica en la próxima carga.
async function likeCatalogSong(songId) {
  if (!songId || catalogIsLiked(songId)) return;
  const song = catalogCache.find((s) => String(s.id) === String(songId));
  catalogLikedSongs.add(String(songId));
  if (song) song.likes = Number(song.likes || 0) + 1;
  document.querySelectorAll('[data-catalog-like]').forEach((b) => {
    if (b.getAttribute('data-catalog-like') === String(songId)) b.classList.add('liked');
  });
  updatePlayerLikeButton();
  try {
    await fetch(`${API_BASE}/api/manager/catalog/${songId}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ action: 'increment_like' }),
    });
  } catch { /* best-effort: no molestar al visitante */ }
}

// Refleja el estado de like en los botones del reproductor (portada + mini).
// Solo visibles para visitantes.
function updatePlayerLikeButton() {
  const liked = catalogIsLiked(catalogNowPlayingId);
  ['player-like', 'mini-like'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle('liked', liked);
    b.classList.toggle('hidden', isAuthenticated || !catalogNowPlayingId);
  });
}

// Cuenta un play (best-effort) cuando la canción se escuchó lo suficiente.
async function countCatalogPlay(songId) {
  const song = catalogCache.find((s) => String(s.id) === String(songId));
  if (song) song.plays = Number(song.plays || 0) + 1;
  try {
    await fetch(`${API_BASE}/api/manager/catalog/${songId}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ action: 'increment_play' }),
    });
  } catch { /* best-effort */ }
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
      fileIdInstrumental: String(row.fileIdInstrumental || extractDriveFileId(row.instrumental || '')).trim(),
      cover: String(row.cover || '').trim(),
      letra: String(row.letra || '').trim(),
      lyricsText: String(row.lyricsText || '').trim(),
      aiTags: parseCatalogAiTags(row.aiTags),
      aiTagsRaw: String(row.aiTagsRaw || '').trim(),
      certificadaIndautor: Boolean(row.certificadaIndautor),
      certificadaIndautorCount: Number(row.certificadaIndautorCount || 0),
      registradaSacm: Boolean(row.registradaSacm),
      registradaBmi: Boolean(row.registradaBmi),
      rating: Math.max(0, Math.min(3, Math.round(Number(row.rating || 0)))),
      likes: Math.max(0, Number(row.likes || 0)),
      plays: Math.max(0, Number(row.plays || 0)),
      searchText: String(row.searchText || '').trim(),
    }))
    .filter((row) => Boolean(row.obra || row.drive || row.fileId));

  const byKey = new Map();
  for (const row of normalized) {
    const key = [
      String(row.fileId || '').trim().toLowerCase(),
      String(row.drive || '').trim().toLowerCase(),
      String(row.obra || '').trim().toLowerCase(),
      String(row.autores || '').trim().toLowerCase(),
      String(row.lyricsText || '').trim().toLowerCase(),
      String((row.aiTags || []).join('|') || '').trim().toLowerCase(),
      String(row.aiTagsRaw || '').trim().toLowerCase(),
    ].join('::');
    if (!byKey.has(key)) byKey.set(key, row);
  }

  // Orden: primero rating (admin) desc, luego likes desc, luego abecedario.
  // Visitantes y admin ven el MISMO orden; solo cambia qué widgets se renderizan.
  catalogCache = Array.from(byKey.values())
    .sort((a, b) =>
      (Number(b.rating || 0) - Number(a.rating || 0))
      || (Number(b.likes || 0) - Number(a.likes || 0))
      || String(a.obra || '').localeCompare(String(b.obra || ''), 'es', { sensitivity: 'base' }));
  if (catalogNowPlayingId && !catalogCache.some((row) => row.id === catalogNowPlayingId)) {
    catalogNowPlayingId = '';
    setCatalogPlayerExpanded(false);
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
    const playlistName = playlist.name || 'Playlist';
    const text = `Escucha la playlist: ${playlistName}\n1. Da click en el link.\n2. Busca la playlist con el nombre: [${playlistName}]\n3. ¡Dale Play!...`;
    
    if (navigator.share) {
      await navigator.share({
        title: playlistName,
        text,
        url: listenLink
      });
      setStatus('catalog-status', `Playlist compartida: ${playlistName}.`);
      return;
    }

    await navigator.clipboard.writeText(`${text}\n\n${listenLink}`);
    setStatus('catalog-status', `Link de playlist copiado: ${playlist.name || 'playlist'}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo compartir playlist: ${reason}`, true);
  }
}

async function shareAppProfile() {
  const url = window.location.href.split('?')[0];
  const text = `Te comparto el Catálogo y Perfil Manager de Jay Mansur:\n¡Explora música y proyectos!`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Jay Mansur · Perfil Manager',
        text,
        url
      });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n\n${url}`);
    
    const statusEl = document.getElementById('oauth-status');
    if (statusEl) {
      statusEl.textContent = 'Link de la App copiado al portapapeles.';
      setTimeout(() => statusEl.textContent = isAuthenticated ? 'Sesión Manager Activa' : 'Sin sesión', 3000);
    } else {
      alert('Link de la App copiado al portapapeles.');
    }
  } catch (e) {
    console.warn('No se pudo compartir la app:', e);
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

function toggleCatalogPlayback() {
  const track = getCatalogPlayerTrackByIndex();
  if (!track) {
    const queue = getCatalogQueue();
    if (queue.length) playCatalogSong(queue[0]);
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
}

function catalogSeekTo(pos) {
  const howl = catalogPlayer.howl;
  if (!howl || !howl.state || howl.state() !== 'loaded') return;
  const dur = Number(howl.duration() || 0);
  const clamped = Math.max(0, Math.min(dur || pos, pos));
  howl.seek(clamped, catalogPlayer.activeSoundId || undefined);
  refreshCatalogProgressUi();
}

function catalogSeekRelative(delta) {
  const howl = catalogPlayer.howl;
  if (!howl || !howl.state || howl.state() !== 'loaded') return;
  const cur = Number(howl.seek(undefined, catalogPlayer.activeSoundId || undefined) || 0);
  catalogSeekTo(cur + delta);
}

// Carga infinita de contactos al scrollear (reemplaza el botón "Cargar más").
function setupContactsInfiniteScroll() {
  const container = document.querySelector('main.container');
  if (!container) return;
  let loading = false;
  container.addEventListener('scroll', () => {
    if (loading) return;
    if (getActiveTabName() !== 'contacts') return;
    const filtered = applyContactsFilter(contactsCache);
    if (filtered.length <= contactsVisibleCount) return;
    if (container.scrollTop + container.clientHeight < container.scrollHeight - 600) return;
    loading = true;
    contactsVisibleCount += CONTACTS_PAGE_STEP;
    setContacts(contactsCache);
    requestAnimationFrame(() => { loading = false; });
  }, { passive: true });
}

// Solo un menú <details> abierto a la vez + cerrar al hacer click fuera.
function setupMenuAutoClose() {
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    if (!d.classList.contains('task-actions-menu')) return;
    document.querySelectorAll('details.task-actions-menu[open]').forEach((other) => {
      if (other !== d) other.open = false;
    });
    // Decide si el menú debe abrir hacia arriba: si el botón está en la mitad
    // inferior de la pantalla (o no cabe abajo), invertimos la dirección.
    const summary = d.querySelector('summary');
    const dropdown = d.querySelector('.task-actions-dropdown');
    if (summary) {
      const rect = summary.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const needed = (dropdown ? dropdown.scrollHeight : 220) + 24;
      const spaceBelow = vh - rect.bottom;
      d.classList.toggle('drop-up', spaceBelow < needed && rect.top > vh * 0.45);
    }
  }, true); // capture: el evento toggle no burbujea

  // Click fuera de un menú abierto lo cierra
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.task-actions-menu[open]').forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
}

// Carga infinita del catálogo: al acercarse al fondo, muestra más canciones
// automáticamente (reemplaza el botón "Cargar más" que el mini-player tapaba).
function setupCatalogInfiniteScroll() {
  let loading = false;
  // Escucha el scroll del elemento que realmente scrollea: el .container (desktop)
  // o la lista #catalog-songs (móvil, donde los filtros quedan fijos).
  const handler = (e) => {
    if (loading) return;
    if (getActiveTabName() !== 'catalog') return;
    if (catalogQueue.length <= catalogVisibleCount) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 700) return;
    loading = true;
    catalogVisibleCount += CATALOG_PAGE_STEP;
    renderCatalog();
    requestAnimationFrame(() => { loading = false; });
  };
  const container = document.querySelector('main.container');
  const songs = document.getElementById('catalog-songs');
  if (container) container.addEventListener('scroll', handler, { passive: true });
  if (songs) songs.addEventListener('scroll', handler, { passive: true });
}

function setupCatalogPlayerControls() {
  const playToggle = document.getElementById('catalog-play-toggle');
  const expToggle = document.getElementById('player-exp-toggle');
  const expandBtn = document.getElementById('player-expand-btn');
  const collapseBtn = document.getElementById('player-collapse-btn');
  const prevBtn = document.getElementById('catalog-prev');
  const nextBtn = document.getElementById('catalog-next');
  const randomBtn = document.getElementById('catalog-random');
  const shareSongBtn = document.getElementById('catalog-share-song');
  const progress = document.getElementById('catalog-player-progress');

  if (playToggle) playToggle.addEventListener('click', toggleCatalogPlayback);
  if (expToggle) expToggle.addEventListener('click', toggleCatalogPlayback);

  // Botones de like del reproductor (portada + mini), solo para visitantes.
  ['player-like', 'mini-like'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.innerHTML = THUMB_SVG;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      likeCatalogSong(catalogNowPlayingId);
    });
  });

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      if (getCatalogPlayerTrackByIndex()) setCatalogPlayerExpanded(true);
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => setCatalogPlayerExpanded(false));
  }

  const lyricsToggleBtn = document.getElementById('player-lyrics-toggle');
  if (lyricsToggleBtn) {
    lyricsToggleBtn.addEventListener('click', () => setLyricsVisible(!catalogLyricsOn));
  }
  const lyricsEditBtn = document.getElementById('player-lyrics-edit');
  if (lyricsEditBtn) {
    lyricsEditBtn.addEventListener('click', () => setLyricsEditing(!catalogLyricsEditing));
  }
  const lyricsHintPill = document.getElementById('player-lyrics-hint');
  if (lyricsHintPill) {
    lyricsHintPill.addEventListener('click', () => setLyricsVisible(true));
  }
  const karaokeBtn = document.getElementById('player-karaoke');
  if (karaokeBtn) {
    karaokeBtn.addEventListener('click', toggleKaraoke);
  }
  const miniRestart = document.getElementById('mini-restart');
  if (miniRestart) miniRestart.addEventListener('click', () => catalogSeekTo(0));
  const miniBack15 = document.getElementById('mini-back15');
  if (miniBack15) miniBack15.addEventListener('click', () => catalogSeekRelative(-15));
  const miniFwd15 = document.getElementById('mini-fwd15');
  if (miniFwd15) miniFwd15.addEventListener('click', () => catalogSeekRelative(15));
  const lyricsSaveBtn = document.getElementById('lyrics-save');
  if (lyricsSaveBtn) lyricsSaveBtn.addEventListener('click', () => saveLyrics());
  const lyricsCancelBtn = document.getElementById('lyrics-cancel');
  if (lyricsCancelBtn) lyricsCancelBtn.addEventListener('click', () => setLyricsEditing(false));

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

  if (shareSongBtn) {
    shareSongBtn.addEventListener('click', () => {
      if (!catalogNowPlayingId) {
        setStatus('catalog-status', 'Pon una canción para compartirla.', true);
        return;
      }
      shareCatalogSongForListen(catalogNowPlayingId);
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

  // Cerrar el Now Playing con swipe-down (gesto Apple Music)
  const expanded = document.getElementById('player-expanded');
  if (expanded) {
    let startY = null;
    let deltaY = 0;
    expanded.addEventListener('touchstart', (e) => {
      const t = e.target;
      // Desde la barra (grabber): siempre permite deslizar para cerrar
      if (t && t.closest && t.closest('.player-collapse')) {
        startY = e.touches[0].clientY;
        deltaY = 0;
        return;
      }
      // Con la letra abierta: el gesto sobre la letra la scrollea, NO cierra
      if (catalogLyricsOn) { startY = null; return; }
      // En vista portada: no cerrar si el gesto empieza en un control
      if (t && t.closest && t.closest('input, button')) { startY = null; return; }
      startY = e.touches[0].clientY;
      deltaY = 0;
    }, { passive: true });
    expanded.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      deltaY = e.touches[0].clientY - startY;
    }, { passive: true });
    expanded.addEventListener('touchend', () => {
      if (startY !== null && deltaY > 80) setCatalogPlayerExpanded(false);
      startY = null;
    });
  }

  // Gesto en la vista de letra (Pointer Events = mouse + touch + pen en una sola
  // API, así funciona igual en web y en el teléfono):
  //   swipe-up corto  → asoma los botones (peek)
  //   swipe-down      → esconde los botones
  //   swipe-up largo  → regresa a la portada
  //   tap/click       → alterna los botones
  // Zonas para iniciar el gesto: la franja del grabber Y el bloque del título
  // (para que sea fácil de agarrar con el dedo). El slider de tiempo queda libre.
  const lyricsGestureBar = document.getElementById('lyrics-gesture-bar');
  const lyricsMetaZone = document.querySelector('#player-expanded .player-exp-meta');
  const lyricsGestureZones = [lyricsGestureBar, lyricsMetaZone].filter(Boolean);
  if (lyricsGestureZones.length) {
    let gStartY = null;
    let gDelta = 0;
    let gMoved = false;
    const usePointer = 'PointerEvent' in window;
    const isPeek = () => document.getElementById('catalog-player')?.classList.contains('lyrics-peek');
    const yOf = (e) => (e.clientY != null)
      ? e.clientY
      : (e.touches && e.touches[0]) ? e.touches[0].clientY
      : (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY
      : null;

    // El rastreo del movimiento vive en window: aunque el dedo/cursor salga de la
    // franja delgada, los eventos siguen llegando y el delta se calcula bien.
    const onMove = (e) => {
      if (gStartY === null) return;
      const y = yOf(e);
      if (y === null) return;
      gDelta = y - gStartY;
      if (Math.abs(gDelta) > 4) gMoved = true;
      if (e.cancelable) e.preventDefault(); // evita que la página haga scroll mientras deslizas
    };
    const onUp = () => {
      if (usePointer) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      } else {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
      }
      if (gStartY === null) return;
      const d = gDelta;
      gStartY = null;
      gDelta = 0;
      if (d < -120) {
        setLyricsVisible(false);   // swipe-up largo → portada
      } else if (d < -18) {
        setLyricsPeek(true);       // swipe-up corto → asoma los botones
      } else if (d > 18) {
        setLyricsPeek(false);      // swipe-down → esconde los botones
      } else if (!gMoved) {
        setLyricsPeek(!isPeek());  // tap → alterna los botones
      }
    };
    const onDown = (e) => {
      if (!catalogLyricsOn) return;
      const y = yOf(e);
      if (y === null) return;
      gStartY = y;
      gDelta = 0;
      gMoved = false;
      if (usePointer) {
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
      } else {
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
      }
    };

    lyricsGestureZones.forEach((el) => {
      if (usePointer) el.addEventListener('pointerdown', onDown);
      else el.addEventListener('touchstart', onDown, { passive: true });
    });
  }

  // Escape cierra el Now Playing (desktop)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && catalogPlayerExpanded) setCatalogPlayerExpanded(false);
  });

  setCatalogPlayerStatus('Selecciona una canción para iniciar.');
  updateCatalogPlayerUi();
}

function linkifyText(text) {
  const escaped = escapeHtml(String(text || ''));
  return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="subtask-link">$1</a>');
}

function notionPageUrl(id) {
  const clean = String(id || '').replace(/-/g, '');
  return clean ? `https://www.notion.so/${clean}` : '';
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
            .map((st, i) => `<li class="subtask-item"><input type="checkbox" class="subtask-check" data-task-subtoggle="${t.id}" data-subindex="${i}" ${st.done ? 'checked' : ''} aria-label="Completar subtask" /><span class="subtask-text">${linkifyText(st.title)}</span></li>`)
            .join('')}</ul>`
        : '';

      const notionUrl = notionPageUrl(t.id);
      const titleHtml = notionUrl
        ? `<a class="task-title-link" href="${notionUrl}" target="_blank" rel="noopener" title="Abrir en Notion">${escapeHtml(t.title || 'Sin título')}</a>`
        : `<strong>${escapeHtml(t.title || 'Sin título')}</strong>`;

      return `
        <li>
          <div class="task-row">
            <div class="task-main">
              ${titleHtml}
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

  if (!list || !featuredList) return;

  const myEmail = String(googleProfile?.email || '').trim().toLowerCase();

  const featured = rows.filter((m) => Boolean(m.highlighted));

  featuredList.innerHTML = featured.length
    ? featured
        .map((m) => {
          const fecha = m.createdAt
            ? new Date(m.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
            : '';
          return `
          <li>
            <strong>${escapeHtml(m.author || 'Anónimo')}</strong> ·
            <span class="featured-text">${escapeHtml(m.text || 'Sin mensaje')}</span>
            ${fecha ? `<div class="featured-date">${escapeHtml(fecha)}</div>` : ''}
          </li>
        `;
        })
        .join('')
    : '<li>Sin mensajes destacados.</li>';

  const visibleRows = rows.slice(0, messagesVisibleCount);

  list.innerHTML = visibleRows
    .map((m) => {
      const author = m.author || 'Anónimo';
      const created = m.createdAt ? new Date(m.createdAt).toLocaleString('es-MX') : '';
      const isMine = m.authorEmail && myEmail && m.authorEmail === myEmail;
      const starClass = m.highlighted ? 'active' : '';
      const starIcon = m.highlighted ? '★' : '☆';
      const editBtn = isMine
        ? `<button class="message-action-btn message-edit-btn" data-message-edit="${m.id}" title="Editar">✎</button>`
        : '';
      const deleteBtn = isMine
        ? `<button class="message-action-btn message-delete-btn" data-message-delete="${m.id}" title="Borrar">🗑</button>`
        : '';
      return `
        <li class="${isMine ? 'mine' : 'other'}">
          <div class="chat-bubble ${isMine ? 'mine' : ''}">
            <div class="chat-header">
              <div class="wa-meta">${escapeHtml(author)}${created ? ` · ${escapeHtml(created)}` : ''}</div>
              <div style="display:flex;align-items:center;gap:2px;">
                ${editBtn}
                ${deleteBtn}
                <button class="message-star-btn ${starClass}" data-message-feature="${m.id}" data-message-state="${m.highlighted ? '1' : '0'}" title="${m.highlighted ? 'Quitar destacado' : 'Destacar'}">${starIcon}</button>
              </div>
            </div>
            <div class="message-text">${escapeHtml(m.text || 'Sin mensaje')}</div>
          </div>
        </li>
      `;
    })
    .join('');

  list.querySelectorAll('[data-message-feature]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.messageFeature || '';
      const current = btn.dataset.messageState === '1';
      await toggleFeaturedMessage(id, !current);
    });
  });

  list.querySelectorAll('[data-message-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.messageEdit || '';
      const msg = messagesCache.find((m) => m.id === id);
      openEditMessageModal(id, msg?.text || '');
    });
  });

  list.querySelectorAll('[data-message-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.messageDelete || '';
      await deleteMessageConfirm(id);
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

function toIsoDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function getTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function formatFocusTaskDate(isoDate) {
  const value = toIsoDateOnly(isoDate);
  if (!value) return 'Sin fecha';
  return value;
}

function formatFocusTaskTime(startIso, endIso) {
  const extractTime = (iso) => {
    const raw = String(iso || '').trim();
    if (!raw || raw.length <= 10) return '';
    const timePart = raw.slice(11, 16);
    if (!timePart || timePart === '00:00') return '';
    const [h, m] = timePart.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${suffix}` : `${hour}:${m.toString().padStart(2, '0')}${suffix}`;
  };
  const start = extractTime(startIso);
  const end = extractTime(endIso);
  if (!start) return '';
  if (!end) return start;
  return `${start} - ${end}`;
}

function getCurrentFocusTask() {
  const list = focusMode === 'today' ? focusTodayTasks : focusOverdueTasks;
  if (!list.length) return null;
  const idx = focusMode === 'today' ? focusTodayIndex : focusOverdueIndex;
  if (idx < 0 || idx >= list.length) return list[0];
  return list[idx];
}

function setFocusMode(nextMode) {
  focusMode = nextMode === 'overdue' ? 'overdue' : 'today';
  renderFocusTaskBoard();
}

function rotateFocusTask(direction = 1) {
  const list = focusMode === 'today' ? focusTodayTasks : focusOverdueTasks;
  if (!list.length) {
    if (focusMode === 'today' && direction > 0 && focusOverdueTasks.length) {
      focusMode = 'overdue';
      focusOverdueIndex = 0;
    }
    renderFocusTaskBoard();
    return;
  }

  const step = direction >= 0 ? 1 : -1;
  if (focusMode === 'today') {
    focusTodayIndex = (focusTodayIndex + step + list.length) % list.length;
  } else {
    focusOverdueIndex = (focusOverdueIndex + step + list.length) % list.length;
  }
  renderFocusTaskBoard();
}

function renderFocusTaskBoard() {
  const root = document.getElementById('focus-task-board');
  const hint = document.getElementById('focus-task-hint');
  const modeChip = document.getElementById('focus-switch-mode');
  const progress = document.getElementById('focus-progress');
  const completeBtn = document.getElementById('focus-complete-btn');
  const postponeBtn = document.getElementById('focus-postpone-btn');
  const rescheduleBtn = document.getElementById('focus-reschedule-trigger');
  const prevBtn = document.getElementById('focus-prev');
  const nextBtn = document.getElementById('focus-next');
  if (!root || !hint || !modeChip || !progress || !completeBtn) return;

  const isAfter9pm = new Date().getHours() >= 21;
  if (postponeBtn) {
    postponeBtn.classList.toggle('hidden', !isAfter9pm);
  }

  root.classList.remove('focus-board-done');
  const current = getCurrentFocusTask();
  const list = focusMode === 'today' ? focusTodayTasks : focusOverdueTasks;
  const idx = focusMode === 'today' ? focusTodayIndex : focusOverdueIndex;

  const canNavigate = list.length > 1;
  if (prevBtn) prevBtn.disabled = !canNavigate;
  if (nextBtn) nextBtn.disabled = !canNavigate;

  modeChip.textContent = focusMode === 'today' ? 'Hoy' : 'BLG';

  if (current) {
    const dueLabel = formatFocusTaskDate(current.dueDate);
    const timeLabel = formatFocusTaskTime(current.dueDate, current.dueEndDate);
    const assignee = current.assignee || current.assigneeEmail || 'Sin asignar';
    const hasLink = Boolean(String(current.notionUrl || '').trim());
    const preview = String(current.taskPreview || '').trim();
    const titleHtml = hasLink
      ? `<a class="focus-task-link" href="${escapeHtml(current.notionUrl)}" target="_blank" rel="noopener">${escapeHtml(current.title || 'Sin título')}</a>`
      : escapeHtml(current.title || 'Sin título');
    const timeHtml = timeLabel
      ? `<span class="focus-task-time">${escapeHtml(timeLabel)}</span>`
      : '';
    const previewHtml = preview
      ? `<p class="focus-task-note">${escapeHtml(preview)}${current.hasExtraInfo ? '…' : ''}</p>`
      : '';
    const extraInfoNote = current.hasExtraInfo
      ? '<p class="focus-task-note">ℹ️ Hay más información en la nota de Notion.</p>'
      : '';
    root.innerHTML = `
      <article class="focus-task-card" data-focus-task-id="${escapeHtml(current.id || '')}">
        <h2 class="focus-task-title">${titleHtml}</h2>
        <p class="focus-task-meta">${escapeHtml(assignee)} · ${escapeHtml(dueLabel)}${timeHtml ? ' · ' : ''}${timeHtml} · ${escapeHtml(current.status || '')} · ${escapeHtml(current.priority || '')}</p>
        ${previewHtml}
        ${extraInfoNote}
      </article>
    `;
    progress.textContent = `${idx + 1}/${list.length}`;
    hint.textContent = focusMode === 'today'
      ? 'Modo HOY: si lo saltas, vuelve a aparecer al cerrar el ciclo.'
      : 'Modo ATRASADAS: backlog pendiente por resolver.';
    completeBtn.disabled = false;
    completeBtn.textContent = 'Completar task';
    if (postponeBtn) postponeBtn.disabled = false;
    if (rescheduleBtn) rescheduleBtn.disabled = false;
    document.getElementById('focus-status')?.classList.add('clickable');
    return;
  }

  document.getElementById('focus-status')?.classList.remove('clickable');

  if (focusMode === 'today') {
    root.classList.add('focus-board-done');
    root.innerHTML = '<article class="focus-task-card"><h2 class="focus-task-title">Terminaste por hoy ✅</h2><p class="focus-task-meta">Fondo azul = todo el plan del día está cerrado.</p></article>';
    progress.textContent = '0/0';
    hint.textContent = focusOverdueTasks.length
      ? 'Dale a ➡ para entrar al backlog (tasks con fecha pasada).'
      : 'No hay backlog con fecha pasada.';
    completeBtn.disabled = true;
    completeBtn.textContent = 'Sin task activa';
    if (postponeBtn) postponeBtn.disabled = true;
    if (rescheduleBtn) rescheduleBtn.disabled = true;
    return;
  }

  root.innerHTML = '<article class="focus-task-card"><h2 class="focus-task-title">Sin tasks atrasadas 🎯</h2><p class="focus-task-meta">No hay pendientes de días anteriores con este filtro.</p></article>';
  progress.textContent = '0/0';
  hint.textContent = 'Dale a ⬅ para regresar al modo HOY.';
  completeBtn.disabled = true;
  completeBtn.textContent = 'Sin task activa';
  if (postponeBtn) postponeBtn.disabled = true;
  if (rescheduleBtn) rescheduleBtn.disabled = true;
}

function mapTaskApiItem(item = {}) {
  return {
    id: item.id || '',
    title: item.title || 'Sin título',
    assignee: item.assignee || '',
    assigneeEmail: item.assigneeEmail || '',
    dueDate: item.dueDate || '',
    dueEndDate: item.dueEndDate || '',
    status: item.status || 'Pendiente',
    priority: item.priority || '',
    tipo: item.tipo || '',
    focusOnly: Boolean(item.focusOnly),
    showInManager: item.showInManager !== undefined ? Boolean(item.showInManager) : true,
    notionUrl: item.notionUrl || '',
    hasExtraInfo: Boolean(item.hasExtraInfo),
    taskPreview: item.taskPreview || '',
    subtasks: Array.isArray(item.subtasks) ? item.subtasks : []
  };
}

function splitFocusBuckets(rows = []) {
  const todayIso = getTodayIso();
  const today = [];
  const overdue = [];

  rows.forEach((task) => {
    const status = String(task.status || '').trim().toLowerCase();
    const priority = String(task.priority || '').trim().toLowerCase();
    if (status !== 'empezó' || priority !== 'alta') return;

    const due = toIsoDateOnly(task.dueDate);
    if (!due) return;
    if (due === todayIso) {
      today.push(task);
      return;
    }
    if (due < todayIso) overdue.push(task);
  });

  today.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'es'));
  overdue.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'es'));

  return { today, overdue };
}

async function fetchFocusBucketsFallback({ scope = 'all', viewerEmail = '' } = {}) {
  const rows = [];
  let cursor = '';
  let pageCount = 0;

  while (pageCount < 6) {
    const params = new URLSearchParams({
      limit: '50',
      scope,
      viewer: viewerEmail
    });
    if (cursor) params.set('cursor', cursor);

    const res = await fetchJson(`${API_BASE}/api/manager/tasks?${params.toString()}`);
    rows.push(...(res.data || []).map(mapTaskApiItem));

    const nextCursor = String(res?.pagination?.nextCursor || '').trim();
    const hasMore = Boolean(res?.pagination?.hasMore) && Boolean(nextCursor);
    if (!hasMore) break;
    cursor = nextCursor;
    pageCount += 1;
  }

  return splitFocusBuckets(rows);
}

async function loadFocusTasks({ keepMode = true } = {}) {
  if (!isAuthenticated) {
    focusTodayTasks = [];
    focusOverdueTasks = [];
    focusMode = 'today';
    focusTodayIndex = 0;
    focusOverdueIndex = 0;
    renderFocusTaskBoard();
    return;
  }

  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const viewerEmail = getViewerEmail();
    const scope = 'mine';
    let usedFallback = false;

    try {
      const params = new URLSearchParams({ scope, viewer: viewerEmail });
      const res = await fetchJson(`${API_BASE}/api/manager/tasks/focus?${params.toString()}`);
      focusTodayTasks = (res.today || []).map(mapTaskApiItem);
      focusOverdueTasks = (res.overdue || []).map(mapTaskApiItem);
    } catch {
      const buckets = await fetchFocusBucketsFallback({ scope, viewerEmail });
      focusTodayTasks = buckets.today;
      focusOverdueTasks = buckets.overdue;
      usedFallback = true;
    }

    if (!keepMode) {
      focusMode = 'today';
      focusTodayIndex = 0;
      focusOverdueIndex = 0;
    } else {
      if (focusMode === 'today') {
        focusTodayIndex = Math.min(focusTodayIndex, Math.max(0, focusTodayTasks.length - 1));
      } else {
        focusOverdueIndex = Math.min(focusOverdueIndex, Math.max(0, focusOverdueTasks.length - 1));
      }
    }

    const who = isAdminUser() ? 'admin' : 'usuario';
    const statusText = usedFallback
      ? `Focus (${who}): ${focusTodayTasks.length} de hoy · ${focusOverdueTasks.length} atrasadas. (modo compatibilidad)`
      : `Focus (${who}): ${focusTodayTasks.length} de hoy · ${focusOverdueTasks.length} atrasadas.`;
    setStatus('focus-status', statusText, false);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo sincronizar focus tasks: ${reason}`, true);
  }

  renderFocusTaskBoard();
}

async function manualSyncFocusTasks() {
  if (!isAuthenticated) return;
  setStatus('focus-status', 'Sincronizando focus tasks con Notion...');
  await Promise.all([
    loadFocusTasks({ keepMode: true }),
    loadTasksFromApi()
  ]);
}

async function postponeCurrentFocusTask() {
  if (!isAuthenticated) return;
  const current = getCurrentFocusTask();
  if (!current?.id) return;

  const tomorrowDate = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) + 'T00:00:00');
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const dateStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const tomorrowIso = `${dateStr}T09:00:00.000-06:00`;

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${current.id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ dueDate: tomorrowIso })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('focus-status', `Task movida a mañana (${tomorrowIso}). Sincronizando...`);
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo posponer task: ${reason}`, true);
  }
}

async function openFocusEditModal() {
  const current = getCurrentFocusTask();
  if (!current?.id) return;

  const modal = document.getElementById('focus-edit-modal');
  if (!modal) return;

  document.getElementById('focus-edit-id').value = current.id;
  document.getElementById('focus-edit-name').value = current.title || '';

  const dateStr = current.dueDate ? current.dueDate.slice(0, 10) : '';
  const timeStr = current.dueDate ? (current.dueDate.slice(11, 16) || '09:00') : '09:00';
  document.getElementById('focus-edit-date').value = dateStr;
  document.getElementById('focus-edit-time').value = timeStr;
  document.getElementById('focus-edit-focus-only').checked = Boolean(current.focusOnly);
  document.getElementById('focus-edit-show-in-manager').checked = current.showInManager !== false;

  const tipoSel = document.getElementById('focus-edit-tipo');
  const statusSel = document.getElementById('focus-edit-status');
  const prioridadSel = document.getElementById('focus-edit-prioridad');
  const assigneeSel = document.getElementById('focus-edit-assignee');

  tipoSel.innerHTML = statusSel.innerHTML = prioridadSel.innerHTML = assigneeSel.innerHTML = '<option value="">Cargando...</option>';
  document.getElementById('focus-edit-delete-confirm')?.classList.add('hidden');
  document.getElementById('focus-edit-delete')?.classList.remove('hidden');
  modal.classList.add('active');

  try {
    const res = await fetchJson(`${API_BASE}/api/manager/tasks/field-options`);
    const makeOptions = (arr, current) => arr.map((o) =>
      `<option value="${escapeHtml(o)}"${o === current ? ' selected' : ''}>${escapeHtml(o)}</option>`
    ).join('');

    tipoSel.innerHTML = makeOptions(res.tipo || [], current.tipo);
    statusSel.innerHTML = makeOptions(res.status || [], current.status);
    prioridadSel.innerHTML = makeOptions(res.prioridad || [], current.priority);

    const users = res.users || [];
    assigneeSel.innerHTML = `<option value="">Sin asignar</option>` +
      users.map((u) =>
        `<option value="${escapeHtml(u.email)}"${u.email === current.assigneeEmail ? ' selected' : ''}>${escapeHtml(u.name || u.email)}</option>`
      ).join('');
  } catch {
    tipoSel.innerHTML = statusSel.innerHTML = prioridadSel.innerHTML = '<option value="">Error</option>';
  }
}

function closeFocusEditModal() {
  document.getElementById('focus-edit-modal')?.classList.remove('active');
  document.getElementById('focus-edit-delete-confirm')?.classList.add('hidden');
}

function showFocusEditDeleteConfirm() {
  document.getElementById('focus-edit-delete-confirm')?.classList.remove('hidden');
  document.getElementById('focus-edit-delete')?.classList.add('hidden');
}

async function confirmDeleteFocusTask() {
  const id = document.getElementById('focus-edit-id')?.value;
  if (!id) return;

  const yesBtn = document.getElementById('focus-edit-delete-confirm-yes');
  if (yesBtn) { yesBtn.disabled = true; yesBtn.textContent = 'Borrando...'; }

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${id}`, {
      method: 'DELETE',
      headers: apiHeaders()
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    closeFocusEditModal();
    setStatus('focus-status', 'Task borrada. Sincronizando...');
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo borrar: ${reason}`, true);
    if (yesBtn) { yesBtn.disabled = false; yesBtn.textContent = 'Sí, borrar'; }
  }
}

async function saveFocusEditTask() {
  if (!isAuthenticated) return;
  const id = document.getElementById('focus-edit-id')?.value;
  if (!id) return;

  const title = String(document.getElementById('focus-edit-name')?.value || '').trim();
  if (!title) { document.getElementById('focus-edit-name')?.focus(); return; }

  const tipo = document.getElementById('focus-edit-tipo')?.value || '';
  const status = document.getElementById('focus-edit-status')?.value || '';
  const prioridad = document.getElementById('focus-edit-prioridad')?.value || '';
  const assignee = document.getElementById('focus-edit-assignee')?.value || '';
  const dateVal = document.getElementById('focus-edit-date')?.value || '';
  const timeVal = document.getElementById('focus-edit-time')?.value || '09:00';
  const dueDate = dateVal ? `${dateVal}T${timeVal}:00.000-06:00` : '';
  const focusOnly = document.getElementById('focus-edit-focus-only')?.checked ?? false;
  const showInManager = document.getElementById('focus-edit-show-in-manager')?.checked ?? true;

  const saveBtn = document.getElementById('focus-edit-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ title, tipo, status, prioridad, assignee, dueDate, focusOnly, showInManager })
    });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { const body = await r.json(); detail += ` — ${body.error || ''} ${body.details || ''}`.trim(); } catch {}
      throw new Error(detail);
    }
    closeFocusEditModal();
    setStatus('focus-status', 'Task actualizada. Sincronizando...');
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo guardar: ${reason}`, true);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
  }
}

async function openFocusNewTaskModal() {
  const modal = document.getElementById('focus-new-task-modal');
  const nameInput = document.getElementById('focus-new-task-name');
  const tipoSelect = document.getElementById('focus-new-task-tipo');
  const dateInput = document.getElementById('focus-new-task-date');
  const timeInput = document.getElementById('focus-new-task-time');
  if (!modal || !nameInput || !tipoSelect || !dateInput || !timeInput) return;

  nameInput.value = '';
  const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  dateInput.value = todayMx;
  timeInput.value = '09:00';

  tipoSelect.innerHTML = '<option value="">Cargando...</option>';
  modal.classList.add('active');
  nameInput.focus();

  try {
    const res = await fetchJson(`${API_BASE}/api/manager/tasks/tipo-options`);
    const options = Array.isArray(res.options) ? res.options : [];
    tipoSelect.innerHTML = options.length
      ? options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')
      : '<option value="">Sin opciones</option>';
  } catch {
    tipoSelect.innerHTML = '<option value="">Error al cargar</option>';
  }
}

function closeFocusNewTaskModal() {
  document.getElementById('focus-new-task-modal')?.classList.remove('active');
}

async function createFocusTask() {
  if (!isAuthenticated) return;
  const nameInput = document.getElementById('focus-new-task-name');
  const tipoSelect = document.getElementById('focus-new-task-tipo');
  const dateInput = document.getElementById('focus-new-task-date');
  const timeInput = document.getElementById('focus-new-task-time');

  const title = String(nameInput?.value || '').trim();
  if (!title) {
    nameInput?.focus();
    return;
  }
  const tipo = String(tipoSelect?.value || '').trim();
  const time = timeInput?.value || '09:00';
  const dueDate = dateInput?.value ? `${dateInput.value}T${time}:00.000-06:00` : '';

  const saveBtn = document.getElementById('focus-new-task-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Creando...'; }

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ title, tipo, dueDate, assignee: 'jgmansur2@gmail.com', focusOnly: tipo !== 'Hnos. Mansur' })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    closeFocusNewTaskModal();
    setStatus('focus-status', `Task "${title}" creada. Sincronizando...`);
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo crear la task: ${reason}`, true);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Crear task'; }
  }
}

function openFocusRescheduleModal() {
  const current = getCurrentFocusTask();
  if (!current?.id) return;

  const modal = document.getElementById('focus-reschedule-modal');
  const nameEl = document.getElementById('focus-reschedule-task-name');
  const dateInput = document.getElementById('focus-reschedule-date');
  const timeInput = document.getElementById('focus-reschedule-time');
  if (!modal || !dateInput || !timeInput) return;

  if (nameEl) nameEl.textContent = current.title || 'Sin título';

  const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  dateInput.value = todayMx;
  timeInput.value = '09:00';

  modal.classList.add('active');
  dateInput.focus();
}

function closeFocusRescheduleModal() {
  document.getElementById('focus-reschedule-modal')?.classList.remove('active');
}

async function rescheduleCurrentFocusTask() {
  if (!isAuthenticated) return;
  const current = getCurrentFocusTask();
  if (!current?.id) return;

  const dateInput = document.getElementById('focus-reschedule-date');
  const timeInput = document.getElementById('focus-reschedule-time');
  if (!dateInput?.value) {
    setStatus('focus-status', 'Seleccioná una fecha para reagendar.', true);
    return;
  }

  const time = timeInput?.value || '09:00';
  const isoDate = `${dateInput.value}T${time}:00.000-06:00`;

  closeFocusRescheduleModal();

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${current.id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ dueDate: isoDate })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('focus-status', `Task reagendada para ${dateInput.value} ${time}. Sincronizando...`);
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo reagendar: ${reason}`, true);
  }
}

async function completeCurrentFocusTask() {
  if (!isAuthenticated) return;
  const current = getCurrentFocusTask();
  if (!current?.id) return;

  try {
    const r = await fetch(`${API_BASE}/api/manager/tasks/${current.id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ status: 'Terminado' })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('focus-status', 'Task completada. Sincronizando...');
    await Promise.all([loadFocusTasks({ keepMode: true }), loadTasksFromApi()]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('focus-status', `No se pudo completar task: ${reason}`, true);
  }
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
      const phone = c.telefono ? `<a href="tel:${escapeHtml(c.telefono.replace(/[\s\-().]/g, ''))}">${escapeHtml(c.telefono)}</a>` : '';
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
    loadMoreBtn.style.display = canLoadMore ? '' : 'none';
    loadMoreBtn.disabled = !canLoadMore;
    loadMoreBtn.textContent = 'Cargar más';
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
  focusTodayTasks = [];
  focusOverdueTasks = [];
  focusMode = 'today';
  focusTodayIndex = 0;
  focusOverdueIndex = 0;
  renderFocusTaskBoard();
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
    if (tabName === 'focus' || tabName === 'quotes') {
      t.style.display = isAuthenticated ? '' : 'none';
      return;
    }
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
  const wasAuthenticated = isAuthenticated;
  isAuthenticated = Boolean(value);
  syncPlaylistCreateControlsVisibility();
  syncTabVisibility();

   if (getActiveTabName() === 'focus' && !isAuthenticated) {
    activateTab(isAuthenticated ? 'overview' : 'catalog');
  }

  const toggleBtn = document.getElementById('google-auth-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = isAuthenticated ? 'Cerrar sesión' : 'Login Google';
  }

  if (isAuthenticated) {
    if (!wasAuthenticated) {
      activateTab('focus');
    }
    loadMessagesFromApi();
    loadCatalogFromApi();
    loadPlaylistsFromApi();
    loadContactsFromNotion();
    loadTasksFromApi();
    loadFocusTasks({ keepMode: false });
    loadLinksFromApi();
    loadSalesKitFromApi();
    updateAuthGateForCurrentTab();
    return;
  }

  tasksNextCursor = '';
  tasksHasMore = false;
  clearSensitiveData();
  loadCatalogFromApi();
  loadPlaylistsFromApi();
  loadLinksFromApi();
  loadSalesKitFromApi();
  if (!isPublicTab(getActiveTabName())) {
    activateTab('catalog');
  }
  updateAuthGateForCurrentTab();
}

function bindAntiZoomForFocusArrows() {
  const arrowIds = ['focus-next', 'focus-prev'];
  arrowIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.touchAction = 'manipulation';
    let lastTouchEnd = 0;

    el.addEventListener('touchend', (ev) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) {
        ev.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });

    el.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
    });
  });
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

    const rows = (res.data || []).map(mapTaskApiItem);

    tasksNextCursor = res?.pagination?.nextCursor || '';
    tasksHasMore = Boolean(res?.pagination?.hasMore);

    const merged = append ? [...tasksCache, ...rows] : rows;
    setTasks(merged);
    setStatus('tasks-status', merged.length ? `${merged.length} tasks visibles.` : 'No hay tasks todavía.');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    tasksNextCursor = '';
    tasksHasMore = false;
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
    if (!editingTaskId) maybeNotify('Nueva task', title);
    await Promise.all([loadTasksFromApi(), loadFocusTasks({ keepMode: true })]);
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
    maybeNotify('Task completada ✓', '');
    await Promise.all([loadTasksFromApi(), loadFocusTasks({ keepMode: true })]);
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
    await Promise.all([loadTasksFromApi(), loadFocusTasks({ keepMode: true })]);
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
    await Promise.all([loadTasksFromApi(), loadFocusTasks({ keepMode: true })]);
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
      fileIdInstrumental: item.fileIdInstrumental || extractDriveFileId(item.instrumental || ''),
      cover: item.cover || '',
      letra: item.letra || '',
      lyricsText: item.lyricsText || '',
      aiTags: Array.isArray(item.aiTags) ? item.aiTags : [],
      aiTagsRaw: item.aiTagsRaw || '',
      certificadaIndautor: Boolean(item.certificadaIndautor),
      certificadaIndautorCount: Number(item.certificadaIndautorCount || 0),
      registradaSacm: Boolean(item.registradaSacm),
      registradaBmi: Boolean(item.registradaBmi),
      searchText: item.searchText || '',
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
    rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
  if (!isAuthenticated || isSendingMessage) return;
  const input = document.getElementById('message-input');
  if (!input) return;

  const text = String(input.value || '').trim();
  if (!text) {
    setStatus('messages-status', 'Escribe un mensaje primero.', true);
    return;
  }

  const author = googleProfile?.name || googleProfile?.email || 'Anónimo';
  const authorEmail = String(googleProfile?.email || '').trim().toLowerCase();

  isSendingMessage = true;
  const sendBtn = document.getElementById('message-create');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const r = await fetch(`${API_BASE}/api/manager/messages`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ text, author, authorEmail })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    input.value = '';
    setStatus('messages-status', 'Anuncio agregado.');
    maybeNotify('Nuevo mensaje', `${googleProfile?.name || 'Alguien'}: ${text.slice(0, 80)}`);
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo guardar anuncio: ${reason}`, true);
  } finally {
    isSendingMessage = false;
    if (sendBtn) sendBtn.disabled = false;
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

function openEditMessageModal(id, text) {
  const modal = document.getElementById('message-edit-modal');
  const idEl = document.getElementById('message-edit-id');
  const textEl = document.getElementById('message-edit-text');
  if (!modal || !idEl || !textEl) return;
  idEl.value = id;
  textEl.value = text;
  modal.classList.add('active');
  setTimeout(() => textEl.focus(), 50);
}

function closeEditMessageModal() {
  const modal = document.getElementById('message-edit-modal');
  if (modal) modal.classList.remove('active');
}

async function saveEditMessage() {
  const id = String(document.getElementById('message-edit-id')?.value || '').trim();
  const text = String(document.getElementById('message-edit-text')?.value || '').trim();
  if (!id || !text) return;
  try {
    const r = await fetch(`${API_BASE}/api/manager/messages/${id}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    closeEditMessageModal();
    setStatus('messages-status', 'Mensaje actualizado.');
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo actualizar mensaje: ${reason}`, true);
  }
}

async function deleteMessageConfirm(id) {
  if (!id || !isAuthenticated) return;
  if (!window.confirm('¿Borrar este mensaje?')) return;
  messagesCache = messagesCache.filter((m) => m.id !== id);
  setMessages(messagesCache);
  try {
    const r = await fetch(`${API_BASE}/api/manager/messages/${id}`, {
      method: 'DELETE',
      headers: apiHeaders()
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus('messages-status', 'Mensaje borrado.');
    await loadMessagesFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('messages-status', `No se pudo borrar mensaje: ${reason}`, true);
    await loadMessagesFromApi();
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
    googleTokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
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
  setOauthStatus('');
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
      if (targetTab === 'quotes' && isAuthenticated && quotesCache.length === 0) {
        loadQuotesFromApi();
      }
      if (targetTab === 'portal' && isAuthenticated) {
        loadPortalCotizaciones();
      }
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
  bindClick('share-app-btn', shareAppProfile);
  bindClick('auth-gate-login', startGoogleLogin);
  bindClick('quote-detail-back', async () => {
    await mkFlushNegotiationSave(); // persist any pending negotiation before leaving
    quotesCurrentPageId = null;
    showQuoteDetail(false);
    loadQuotesFromApi(); // refresh the list so totals reflect the latest negotiation
  });
  bindClick('quotes-delete-btn', mkDeleteSelectedQuotes);
  bindClick('quotes-archive-btn', mkArchiveSelectedQuotes);
  bindClick('quotes-select-toggle', mkToggleSelectMode);
  const quotesSearchEl = document.getElementById('quotes-search');
  if (quotesSearchEl) quotesSearchEl.addEventListener('input', (e) => {
    quotesSearchTerm = e.target.value || '';
    mkRefreshQuotesView();
  });
  bindClick('quote-contract-btn', mkGenerateContract);
  bindClick('portal-refresh', () => loadPortalCotizaciones());
  bindClick('portal-back', () => showPortalDetail(false));
  bindClick('portal-upload-btn', uploadPortalVersion);
  bindClick('portal-abono-btn', registerPortalAbono);
  const bulkChk = document.getElementById('portal-bulk-songs');
  if (bulkChk) bulkChk.addEventListener('change', () => {
    const f = document.getElementById('portal-track-name-field');
    if (f) f.style.display = bulkChk.checked ? 'none' : '';
  });
  setupPortalPlayer();
  bindClick('refresh-messages', () => loadMessagesFromApi());
  bindClick('refresh-messages-overview', () => loadMessagesFromApi());
  // messages-load-more removed from UI — load-more handled via scroll
  bindClick('message-create', createMessage);
  bindClick('clear-messages-log', clearMessagesLog);
  bindClick('message-edit-save', saveEditMessage);
  bindClick('message-edit-cancel', closeEditMessageModal);

  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        createMessage();
      }
    });
  }

  bindClick('refresh-catalog', () => {
    catalogGenreFilter = 'Todas';
    catalogFilterView = 'genres';
    loadCatalogFromApi();
  });
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
  bindClick('refresh-tasks', () => Promise.all([loadTasksFromApi(), loadFocusTasks({ keepMode: true })]));
  bindClick('focus-sync', manualSyncFocusTasks);
  bindClick('focus-next', () => rotateFocusTask(1));
  bindClick('focus-prev', () => rotateFocusTask(-1));
  bindClick('focus-complete-btn', completeCurrentFocusTask);
  bindClick('focus-postpone-btn', postponeCurrentFocusTask);
  bindClick('focus-status', openFocusEditModal);
  bindClick('focus-edit-save', saveFocusEditTask);
  bindClick('focus-edit-cancel', closeFocusEditModal);
  bindClick('focus-edit-delete', showFocusEditDeleteConfirm);
  bindClick('focus-edit-delete-confirm-yes', confirmDeleteFocusTask);
  bindClick('focus-edit-delete-confirm-no', () => {
    document.getElementById('focus-edit-delete-confirm')?.classList.add('hidden');
    document.getElementById('focus-edit-delete')?.classList.remove('hidden');
  });
  bindClick('focus-new-task-trigger', openFocusNewTaskModal);
  bindClick('focus-new-task-save', createFocusTask);
  bindClick('focus-new-task-cancel', closeFocusNewTaskModal);
  bindClick('focus-reschedule-trigger', openFocusRescheduleModal);
  bindClick('focus-reschedule-save', rescheduleCurrentFocusTask);
  bindClick('focus-reschedule-cancel', closeFocusRescheduleModal);
  bindClick('focus-switch-mode', () => setFocusMode(focusMode === 'today' ? 'overdue' : 'today'));
  bindAntiZoomForFocusArrows();
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
  setupCatalogInfiniteScroll();
  setupContactsInfiniteScroll();
  setupMenuAutoClose();
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

function maybeNotify(title, body) {
  if (Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: 'icon-192.png' })).catch(() => {});
    } else {
      new Notification(title, { body, icon: 'icon-192.png' });
    }
  } catch { /* silently fail */ }
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

// ─── QUOTES / SEGUIMIENTO ────────────────────────────────────────────────────

let quotesCache = [];
let quotesCurrentPageId = null;
let quotesCurrentDetail = null; // last loaded quote detail object (for the contract prompt)
let quotesFxRate = null; // USD→MXN FIX from Banxico, provided by the API

const QUOTE_DATE_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const QUOTE_DATE_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function formatQuoteDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // "YYYY-MM-DD" (date only) → parse as LOCAL to avoid UTC day-shift
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let d, hasTime;
  if (dateOnly) {
    d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    hasTime = false;
  } else {
    d = new Date(s);
    hasTime = true;
  }
  if (isNaN(d.getTime())) return s; // fallback: original text
  let out = `${QUOTE_DATE_DAYS[d.getDay()]} ${d.getDate()} de ${QUOTE_DATE_MONTHS[d.getMonth()]} del ${d.getFullYear()}`;
  if (hasTime) {
    let h = d.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    out += ` a las ${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`;
  }
  return out;
}

// ─── Cotizador clone (mirror of musicknobs-web catalogES) ─────────────────────
// Keep in sync via the mk-cotizador-catalog-sync skill. `name` is the join key.
const MK_QUOTE_CATALOG = [
  { id: 'produccion', title: 'Producción Musical', services: [
    { id: 'produccion-mezcla-master', name: 'Producción + Mezcla + Master', description: 'El paquete completo. Desde la idea hasta el archivo listo para distribuir.', priceLabel: '$3,920 USD / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 3920, calcPrice: (q) => q * 3920, currency: 'USD' },
    { id: 'produccion-mezcla', name: 'Producción + Mezcla', description: 'Arreglos, músicos de sesión, grabación y mezcla profesional.', priceLabel: '$3,800 USD / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 3800, calcPrice: (q) => q * 3800, currency: 'USD' },
    { id: 'produccion', name: 'Producción Completa', description: 'Arreglos, músicos y grabación. Mezcla por separado.', priceLabel: '$3,500 USD / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 3500, calcPrice: (q) => q * 3500, currency: 'USD' },
  ]},
  { id: 'postproduccion', title: 'Post-producción', services: [
    { id: 'mezcla', name: 'Mezcla Profesional', description: 'Hasta 40 tracks. 2 rondas de revisión incluidas.', priceLabel: '$300 USD / track', hasQty: true, qtyLabel: 'Tracks', basePrice: 300, calcPrice: (q) => q * 300, currency: 'USD' },
    { id: 'mastering', name: 'Mastering', description: 'LUFS optimizado para Spotify, Apple Music y más.', priceLabel: 'Desde $120 USD / track', hasQty: true, qtyLabel: 'Tracks', basePrice: 120, calcPrice: (q) => q * 120, currency: 'USD' },
    { id: 'afinacion', name: 'Afinación (Melodyne)', description: 'Corrección natural de afinación de voces o instrumentos.', priceLabel: '$30 primer track · $20 desde el 2do', hasQty: true, qtyLabel: 'Tracks', basePrice: 30, calcPrice: (q) => (q === 1 ? 30 : 30 + (q - 1) * 20), currency: 'USD' },
    { id: 'edicion', name: 'Edición y reparación de audio', description: 'Limpieza de ruidos, edición de takes, corrección de timing.', priceLabel: '$100 hasta 5 tracks · +$20 por track extra', hasQty: true, qtyLabel: 'Tracks', basePrice: 100, calcPrice: (q) => (q <= 5 ? 100 : 100 + (q - 5) * 20), currency: 'USD' },
  ]},
  { id: 'consultoria', title: 'Consultoría', services: [
    { id: 'consultoria-hora', name: 'Sesión de Consultoría', description: 'Orientación de carrera, estrategia de lanzamiento, revisión de material.', priceLabel: '$150 USD / hora', hasQty: true, qtyLabel: 'Horas', basePrice: 150, calcPrice: (q) => q * 150, currency: 'USD' },
    { id: 'consultoria-paquete', name: 'Paquete Consultoría (8 horas)', description: '8 horas para trabajar en profundidad tu proyecto y carrera.', priceLabel: '$1,200 USD', hasQty: false, basePrice: 1200, currency: 'USD' },
  ]},
  { id: 'jingle', title: 'Jingle y Corporativo', services: [
    { id: 'jingle', name: 'Jingle / Música Corporativa', description: 'Composición original para marcas, campañas y audiovisual. Sin inteligencia artificial.', priceLabel: '$3,000 USD / pieza', hasQty: true, qtyLabel: 'Piezas', basePrice: 3000, calcPrice: (q) => q * 3000, currency: 'USD' },
  ]},
  { id: 'distribucion', title: 'Distribución y Promoción', services: [
    { id: 'distribucion-label', name: 'Lanzamiento bajo Music Knobs Label', description: 'Distribución completa en todas las plataformas. Conservás el 80% de regalías y todos los derechos.', priceLabel: '$100 USD primer año · $50 USD / año renovación', hasQty: false, basePrice: 100, currency: 'USD' },
    { id: 'asesoria-distribucion', name: 'Asesoría para publicación propia', description: 'Elección de plataforma, metadata, ISRC y derechos.', priceLabel: '$300 USD', hasQty: false, basePrice: 300, currency: 'USD' },
    { id: 'spotify-positioning', name: 'Posicionamiento en Spotify', description: '~60,000 plays auténticos en playlists orgánicas. Resultados en 2-4 semanas.', priceLabel: '$300 USD / track', hasQty: true, qtyLabel: 'Tracks', basePrice: 300, calcPrice: (q) => q * 300, currency: 'USD' },
  ]},
  { id: 'arte', title: 'Arte y Diseño', services: [
    { id: 'diseño-portada', name: 'Diseño de Portada Profesional', description: 'Portada diseñada por un artista humano. 2 revisiones incluidas. Revisión extra: $1,000 MXN.', priceLabel: '$4,000 MXN / diseño · Revisión extra $1,000 MXN', hasQty: true, qtyLabel: 'Diseños', basePrice: 4000, currency: 'MXN' },
    { id: 'fotografia-profesional', name: 'Fotografía Profesional', description: 'Sesión con fotógrafo profesional y cámaras de gama alta.', priceLabel: 'A cotizar', hasQty: false, basePrice: 0, currency: 'quote' },
    { id: 'pintura-oleo', name: 'Pintura al Óleo', description: 'Tu imagen o la portada de tu disco convertida en pintura al óleo. Disponible en 3 tamaños.', priceLabel: 'Desde $12,000 MXN · 3 tamaños disponibles', hasQty: true, qtyLabel: 'Obras', basePrice: 12000, currency: 'MXN' },
  ]},
  { id: 'estudio', title: 'Estudio Profesional · exclusivo seguimiento', services: [
    { id: 'dia-estudio', name: 'Día de Estudio Profesional — Troubled Cleff Studios', description: 'Día completo de grabación en Troubled Cleff Studios, San Miguel de Allende.', priceLabel: '$2,000 USD / día', hasQty: true, qtyLabel: 'Días', basePrice: 2000, calcPrice: (q) => q * 2000, currency: 'USD', managerOnly: true },
  ]},
];

// Local market catalog — mirror of musicknobs-web/app/locales/cotizar (catalogLocalES).
// Separate from the international catalog: same `name` can carry a different price.
const MK_QUOTE_CATALOG_LOCAL = [
  { id: 'produccion', title: 'Producción Musical', services: [
    { id: 'prod-musicos', name: 'Producción completa con músicos locales', description: 'Arreglos, músicos de sesión locales, grabación, mezcla y mastering.', priceLabel: '$13,500 MXN / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 13500, calcPrice: (q) => q * 13500, currency: 'MXN' },
    { id: 'prod-programada', name: 'Producción completa con pista programada', description: 'Arreglos y programación completa. 1 día de grabación de voces o guitarras si aplica.', priceLabel: '$10,000 MXN / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 10000, calcPrice: (q) => q * 10000, currency: 'MXN' },
  ]},
  { id: 'grabacion', title: 'Grabación en Estudio', services: [
    { id: 'grabacion-5hrs', name: 'Paquete 5 horas', description: '5 horas en el home studio de Jay. Ingeniería de grabación incluida.', priceLabel: '$3,500 MXN / paquete', hasQty: true, qtyLabel: 'Paquetes', basePrice: 3500, calcPrice: (q) => q * 3500, currency: 'MXN' },
    { id: 'grabacion-hora-extra', name: 'Hora extra de grabación', description: 'Horas adicionales el mismo día, después del paquete de 5 horas.', priceLabel: '$700 MXN / hora', hasQty: true, qtyLabel: 'Horas', basePrice: 700, calcPrice: (q) => q * 700, currency: 'MXN' },
  ]},
  { id: 'postproduccion', title: 'Post-producción', services: [
    { id: 'mezcla-local', name: 'Mezcla profesional', description: 'Hasta 40 tracks. 2 rondas de revisión incluidas.', priceLabel: '$2,000 MXN / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 2000, calcPrice: (q) => q * 2000, currency: 'MXN' },
    { id: 'mastering-local', name: 'Mastering', description: 'LUFS optimizado para Spotify, Apple Music y más. 1 revisión incluida.', priceLabel: '$1,000 MXN / canción', hasQty: true, qtyLabel: 'Canciones', basePrice: 1000, calcPrice: (q) => q * 1000, currency: 'MXN' },
    { id: 'afinacion-local', name: 'Afinación (Melodyne)', description: 'Corrección natural de afinación. 1er track $500 MXN, desde el 2do $200 MXN c/u.', priceLabel: '$500 MXN 1er track · $200 MXN desde el 2do', hasQty: true, qtyLabel: 'Tracks', basePrice: 500, calcPrice: (q) => (q === 1 ? 500 : 500 + (q - 1) * 200), currency: 'MXN' },
    { id: 'edicion-local', name: 'Edición y reparación de audio', description: 'Limpieza de ruidos, edición de takes, corrección de timing.', priceLabel: '$1,000 MXN hasta 5 tracks · +$100 MXN por track extra', hasQty: true, qtyLabel: 'Tracks', basePrice: 1000, calcPrice: (q) => (q <= 5 ? 1000 : 1000 + (q - 5) * 100), currency: 'MXN' },
  ]},
  { id: 'distribucion', title: 'Distribución y Promoción', services: [
    { id: 'spotify-local', name: 'Posicionamiento en Spotify', description: '~60,000 plays auténticos en playlists orgánicas. Resultados en 2-4 semanas.', priceLabel: '$300 USD / track', hasQty: true, qtyLabel: 'Tracks', basePrice: 300, calcPrice: (q) => q * 300, currency: 'USD' },
    { id: 'label-local', name: 'Distribución bajo Music Knobs Label', description: 'Distribución completa en todas las plataformas. Conservás el 80% de regalías y todos los derechos.', priceLabel: '$100 USD primer año · $50 USD / año renovación', hasQty: false, basePrice: 100, currency: 'USD' },
    { id: 'consultoria-local', name: 'Consultoría para artistas', description: 'Orientación de carrera, estrategia de lanzamiento, revisión de material.', priceLabel: '$150 USD / hora · $1,200 USD paquete 8 horas', hasQty: true, qtyLabel: 'Horas', basePrice: 150, calcPrice: (q) => (q >= 8 ? 1200 : q * 150), currency: 'USD' },
  ]},
  { id: 'arte', title: 'Arte y Diseño', services: [
    { id: 'diseño-portada', name: 'Diseño de Portada Profesional', description: 'Portada diseñada por un artista humano. 2 revisiones incluidas. Revisión extra: $1,000 MXN.', priceLabel: '$4,000 MXN / diseño · Revisión extra $1,000 MXN', hasQty: true, qtyLabel: 'Diseños', basePrice: 4000, calcPrice: (q) => q * 4000, currency: 'MXN' },
    { id: 'fotografia-profesional', name: 'Fotografía Profesional', description: 'Sesión con fotógrafo profesional y cámaras de gama alta.', priceLabel: 'A cotizar', hasQty: false, basePrice: 0, currency: 'quote' },
    { id: 'pintura-oleo', name: 'Pintura al Óleo', description: 'Tu imagen o la portada de tu disco convertida en pintura al óleo. Disponible en 3 tamaños.', priceLabel: 'Desde $12,000 MXN · 3 tamaños disponibles', hasQty: true, qtyLabel: 'Obras', basePrice: 12000, calcPrice: (q) => q * 12000, currency: 'MXN' },
  ]},
  { id: 'estudio', title: 'Estudio Profesional · exclusivo seguimiento', services: [
    { id: 'dia-estudio', name: 'Día de Estudio Profesional — Troubled Cleff Studios', description: 'Día completo de grabación en Troubled Cleff Studios, San Miguel de Allende.', priceLabel: '$1,000 USD / día', hasQty: true, qtyLabel: 'Días', basePrice: 1000, calcPrice: (q) => q * 1000, currency: 'USD', managerOnly: true },
  ]},
];

let quoteDetailSelection = {};
let quoteDetailPriceOverrides = {}; // per-service negotiated price (by service id), this quote only
let quoteDetailUnmatched = []; // client services not found in the active catalog
let mkActiveCatalog = MK_QUOTE_CATALOG; // switched per quote origin in mkInitCotizadorClone
let negotiationSaveTimer = null; // debounce for autosave

function mkAllServices() {
  return mkActiveCatalog.flatMap((c) => c.services);
}

// Normalize for robust join: Unicode NFC (accents), trim, case-insensitive.
// Notion may return accented chars in NFD form, which breaks naive === matching.
function mkNormalizeName(s) {
  return String(s == null ? '' : s).normalize('NFC').trim().toLowerCase();
}

// English service names → catalog service id, so quotes submitted through the
// English cotizador still map to the (Spanish) catalog. Keyed by service id to
// avoid cross-catalog collisions (e.g. the "Release under Music Knobs Label"
// label points to different services in the international vs local catalog).
// Keep in sync via the mk-cotizador-catalog-sync skill (mirror of catalogEN).
const MK_SERVICE_ALIASES = {
  // International (MK_QUOTE_CATALOG)
  'produccion-mezcla-master': ['Production + Mix + Master'],
  'produccion-mezcla': ['Production + Mix'],
  'produccion': ['Full Production'],
  'mezcla': ['Professional Mixing'],
  'afinacion': ['Pitch Correction (Melodyne)'],
  'edicion': ['Audio Editing & Repair'],
  'consultoria-hora': ['Consulting Session'],
  'consultoria-paquete': ['Consulting Package (8 hours)'],
  'jingle': ['Jingle / Corporate Music'],
  'distribucion-label': ['Release under Music Knobs Label'],
  'asesoria-distribucion': ['Self-publishing Advisory'],
  'spotify-positioning': ['Spotify Positioning'],
  // Local (MK_QUOTE_CATALOG_LOCAL)
  'prod-musicos': ['Full production with local musicians'],
  'prod-programada': ['Full production with programmed track'],
  'grabacion-5hrs': ['5-hour package'],
  'grabacion-hora-extra': ['Extra recording hour'],
  'mezcla-local': ['Professional mix'],
  'afinacion-local': ['Pitch Correction (Melodyne)'],
  'edicion-local': ['Audio Editing & Repair'],
  'spotify-local': ['Spotify Positioning'],
  'label-local': ['Release under Music Knobs Label'],
  'consultoria-local': ['Artist Consulting'],
  // Shared ids across both catalogs (same English name)
  'diseño-portada': ['Professional Cover Design'],
  'fotografia-profesional': ['Professional Photography'],
  'pintura-oleo': ['Oil Painting'],
  // 'mastering' / 'mastering-local' are identical in EN/ES — no alias needed.
};

function mkFindByName(name) {
  const target = mkNormalizeName(name);
  if (!target) return null;
  return mkAllServices().find((s) => {
    if (mkNormalizeName(s.name) === target) return true;
    const aliases = MK_SERVICE_ALIASES[s.id];
    return Array.isArray(aliases) && aliases.some((a) => mkNormalizeName(a) === target);
  }) || null;
}

function mkHasOverride(id) {
  return Object.prototype.hasOwnProperty.call(quoteDetailPriceOverrides, id);
}

function mkItemPrice(svc, qty) {
  if (mkHasOverride(svc.id)) return Math.max(0, Number(quoteDetailPriceOverrides[svc.id]) || 0);
  if (svc.currency === 'quote') return 0;
  if (svc.calcPrice) return svc.calcPrice(qty);
  return svc.basePrice * (svc.hasQty ? qty : 1);
}

// A "quote" service counts as USD once it has a negotiated price.
function mkEffectiveCurrency(svc) {
  if (svc.currency === 'quote') return mkHasOverride(svc.id) ? 'USD' : 'quote';
  return svc.currency;
}

function mkBuildSummaryHtml() {
  const ids = Object.keys(quoteDetailSelection).filter((id) => quoteDetailSelection[id] > 0);
  if (ids.length === 0 && quoteDetailUnmatched.length === 0) return '<p class="hint" style="text-align:center;padding:.75rem 0;">Sin servicios seleccionados.</p>';
  let usd = 0, mxn = 0;
  const rows = ids.map((id) => {
    const svc = mkAllServices().find((s) => s.id === id);
    if (!svc) return '';
    const qty = quoteDetailSelection[id];
    const price = mkItemPrice(svc, qty);
    const cur = mkEffectiveCurrency(svc);
    if (cur === 'MXN') mxn += price;
    else if (cur !== 'quote') usd += price;
    const priceStr = cur === 'quote'
      ? 'A cotizar'
      : cur === 'MXN'
        ? `$${price.toLocaleString('en-US')} MXN`
        : `$${price.toLocaleString('en-US')}`;
    const edited = mkHasOverride(id) ? ' <span class="mk-sum-edited">editado</span>' : '';
    return `<div class="mk-sum-item"><span>${escapeHtml(svc.name)}${svc.hasQty ? ` ×${qty}` : ''}${edited}</span><span>${priceStr}</span></div>`;
  }).join('');
  // Unmatched client services: show them and fold their amount into the totals.
  const extraRows = quoteDetailUnmatched.map((item) => {
    const m = mkParseMoney(item.price);
    if (m.currency === 'MXN') mxn += m.amount;
    else if (m.currency !== 'quote') usd += m.amount;
    return `<div class="mk-sum-item"><span>${escapeHtml(item.name)} <span class="mk-sum-edited">adicional</span></span><span>${escapeHtml(String(item.price || '—'))}</span></div>`;
  }).join('');
  const allRows = rows + extraRows;
  const totals = (usd > 0 && mxn > 0)
    ? `<div class="mk-sum-total"><span>Total USD</span><span>$${usd.toLocaleString('en-US')}</span></div><div class="mk-sum-total"><span>Total MXN</span><span>$${mxn.toLocaleString('en-US')} MXN</span></div>`
    : mxn > 0
      ? `<div class="mk-sum-total"><span>Total</span><span>$${mxn.toLocaleString('en-US')} MXN</span></div>`
      : `<div class="mk-sum-total"><span>Total</span><span>$${usd.toLocaleString('en-US')} USD</span></div>`;
  return `<div class="mk-sum-title">Resumen</div><div class="mk-sum-items">${allRows}</div>${totals}`;
}

function mkPriceRowHtml(svc) {
  const qty = quoteDetailSelection[svc.id] || 1;
  const price = mkItemPrice(svc, qty);
  const curLabel = mkEffectiveCurrency(svc) === 'MXN' ? 'MXN' : 'USD';
  const edited = mkHasOverride(svc.id);
  return `<div class="mk-price-row${edited ? ' mk-price-edited' : ''}"><span class="mk-price-label">Precio negociado</span><span class="mk-price-cur">$</span><input type="number" class="mk-price-input" data-svc-price="${escapeHtml(svc.id)}" value="${price}" min="0" step="1" inputmode="decimal"><span class="mk-price-cur">${escapeHtml(curLabel)}</span></div>`;
}

function mkBuildCatalogHtml(unmatchedItems) {
  const sel = quoteDetailSelection;
  const market = mkActiveCatalog === MK_QUOTE_CATALOG_LOCAL
    ? '<span class="mk-market-chip mk-market-local">Mercado local · precios MXN</span>'
    : '<span class="mk-market-chip">Cotización internacional</span>';
  const cats = mkActiveCatalog.map((cat) => {
    const cards = cat.services.map((svc) => {
      const on = Boolean(sel[svc.id]);
      const qty = sel[svc.id] || 1;
      const qtyRow = (on && svc.hasQty)
        ? `<div class="mk-qty-row"><button class="mk-qty-btn" data-svc="${escapeHtml(svc.id)}" data-op="dec" type="button">−</button><span class="mk-qty-num" data-svc-qty="${escapeHtml(svc.id)}">${qty}</span><button class="mk-qty-btn" data-svc="${escapeHtml(svc.id)}" data-op="inc" type="button">+</button><span class="mk-qty-unit">${escapeHtml(svc.qtyLabel || '')}</span></div>`
        : '';
      const priceRow = on ? mkPriceRowHtml(svc) : '';
      return `<div class="mk-svc-card${on ? ' mk-svc-on' : ''}" data-svc-card="${escapeHtml(svc.id)}"><label class="mk-svc-label"><input type="checkbox" class="mk-svc-chk" data-svc="${escapeHtml(svc.id)}"${on ? ' checked' : ''}><div class="mk-svc-info"><span class="mk-svc-name">${escapeHtml(svc.name)}</span><span class="mk-svc-price">${escapeHtml(svc.priceLabel)}</span></div></label><p class="mk-svc-desc">${escapeHtml(svc.description)}</p>${qtyRow}${priceRow}</div>`;
    }).join('');
    return `<div class="mk-cat-block"><div class="mk-cat-label">${escapeHtml(cat.title)}</div><div class="mk-cat-cards">${cards}</div></div>`;
  }).join('');

  const extra = unmatchedItems.length > 0
    ? `<div class="mk-cat-block"><div class="mk-cat-label">Servicios adicionales</div><div class="mk-cat-cards">${unmatchedItems.map((item) => {
        const pr = escapeHtml(String(item.price || ''));
        return `<div class="mk-svc-card mk-svc-on"><label class="mk-svc-label"><input type="checkbox" checked disabled><div class="mk-svc-info"><span class="mk-svc-name">${escapeHtml(item.name)}</span><span class="mk-svc-price">${pr}</span></div></label>${item.qty ? `<p class="mk-svc-desc">Cantidad: ${escapeHtml(String(item.qty))}</p>` : ''}</div>`;
      }).join('')}</div></div>`
    : '';

  return `<div class="mk-cotizador-clone"><div class="mk-clone-catalog">${market}${cats}${extra}</div><div class="mk-clone-summary" id="mk-clone-summary">${mkBuildSummaryHtml()}</div></div>`;
}

function mkParseMoney(str) {
  const s = String(str || '');
  if (/cotizar/i.test(s)) return { amount: 0, currency: 'quote' };
  const currency = /mxn/i.test(s) ? 'MXN' : 'USD';
  const amount = Number(s.replace(/[^0-9.]/g, '')) || 0;
  return { amount, currency };
}

// Initializes from the saved negotiated version if present, else from the
// client's original services. Negotiated prices that differ from the catalog
// become per-service overrides (so they show as "editado").
function mkInitCotizadorClone(services, origen, negotiated) {
  mkActiveCatalog = origen === 'local' ? MK_QUOTE_CATALOG_LOCAL : MK_QUOTE_CATALOG;
  quoteDetailSelection = {};
  quoteDetailPriceOverrides = {};
  const fromNeg = Array.isArray(negotiated) && negotiated.length > 0;
  const source = fromNeg ? negotiated : (services || []);
  const unmatched = [];
  for (const item of source) {
    const svc = mkFindByName(item.name);
    if (svc) {
      const qty = parseInt(item.qty, 10) || 1;
      quoteDetailSelection[svc.id] = qty;
      if (fromNeg) {
        const m = mkParseMoney(item.price);
        if (m.currency !== 'quote' && m.amount !== mkItemPrice(svc, qty)) {
          quoteDetailPriceOverrides[svc.id] = m.amount;
        }
      }
    } else {
      unmatched.push(item);
    }
  }
  quoteDetailUnmatched = unmatched;
  return mkBuildCatalogHtml(unmatched);
}

// Full re-render of the clone. Safe for checkbox/qty changes (no focused text
// input). NOT called from the price input handler, to preserve typing focus.
// Negotiated subtotals from the current live selection + overrides.
function mkNegotiatedSubtotals() {
  let usd = 0, mxn = 0;
  for (const id of Object.keys(quoteDetailSelection)) {
    if (!(quoteDetailSelection[id] > 0)) continue;
    const svc = mkAllServices().find((s) => s.id === id);
    if (!svc) continue;
    const price = mkItemPrice(svc, quoteDetailSelection[id]);
    const cur = mkEffectiveCurrency(svc);
    if (cur === 'MXN') mxn += price;
    else if (cur !== 'quote') usd += price;
  }
  // Unmatched (client) services still count toward the total, parsed from their
  // original price string, so the detail total matches the quote-list total.
  for (const item of quoteDetailUnmatched) {
    const m = mkParseMoney(item.price);
    if (m.currency === 'MXN') mxn += m.amount;
    else if (m.currency !== 'quote') usd += m.amount;
  }
  return { totalMXN: mxn, totalUSD: usd };
}

// Keep the top "Total cotizado" field in sync with live negotiation.
function mkUpdateQdTotal() {
  const el = document.getElementById('qd-total');
  if (!el) return;
  el.textContent = formatQuoteTotal(mkNegotiatedSubtotals(), quotesFxRate) || '—';
}

function mkRefreshClone() {
  const servicesEl = document.getElementById('qd-services-list');
  if (!servicesEl) return;
  servicesEl.innerHTML = mkBuildCatalogHtml(quoteDetailUnmatched);
  const clone = servicesEl.querySelector('.mk-cotizador-clone');
  if (clone) mkBindCloneEvents(clone);
  mkUpdateQdTotal();
}

function mkHandleQty(e) {
  const id = e.currentTarget.dataset.svc;
  const op = e.currentTarget.dataset.op;
  if (!id || !quoteDetailSelection[id]) return;
  quoteDetailSelection[id] = op === 'inc' ? quoteDetailSelection[id] + 1 : Math.max(1, quoteDetailSelection[id] - 1);
  delete quoteDetailPriceOverrides[id]; // qty change recalculates the price from the catalog
  mkRefreshClone();
  mkScheduleNegotiationSave();
}

function mkHandlePriceInput(e) {
  const id = e.currentTarget.dataset.svcPrice;
  if (!id) return;
  const val = e.currentTarget.value;
  if (val === '') delete quoteDetailPriceOverrides[id];
  else quoteDetailPriceOverrides[id] = Math.max(0, Number(val) || 0);
  const container = e.currentTarget.closest('.mk-cotizador-clone');
  if (!container) return;
  const sumEl = container.querySelector('#mk-clone-summary');
  if (sumEl) sumEl.innerHTML = mkBuildSummaryHtml();
  mkUpdateQdTotal();
  mkScheduleNegotiationSave();
}

// Snapshot of the current negotiation: selected services with final prices.
function mkCollectNegotiated() {
  const out = [];
  for (const id of Object.keys(quoteDetailSelection)) {
    if (!(quoteDetailSelection[id] > 0)) continue;
    const svc = mkAllServices().find((s) => s.id === id);
    if (!svc) continue;
    const qty = quoteDetailSelection[id];
    const price = mkItemPrice(svc, qty);
    const cur = mkEffectiveCurrency(svc);
    const priceStr = cur === 'quote'
      ? 'A cotizar'
      : cur === 'MXN'
        ? `$${price.toLocaleString('en-US')} MXN`
        : `$${price.toLocaleString('en-US')} USD`;
    out.push({ name: svc.name, qty: svc.hasQty ? String(qty) : '—', price: priceStr });
  }
  for (const item of quoteDetailUnmatched) {
    out.push({ name: item.name, qty: item.qty != null ? String(item.qty) : '—', price: String(item.price || '') });
  }
  return out;
}

function mkSetSaveStatus(text, cls) {
  const el = document.getElementById('qd-save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'qd-save-status' + (cls ? ' ' + cls : '');
}

let negotiationSaveChain = Promise.resolve();

// Serialize saves: two overlapping negotiation writes make the worker's
// read-modify-write of the "Versión negociada" section duplicate it. Chaining
// guarantees each save reads the page only after the previous one finished.
function mkSaveNegotiation() {
  negotiationSaveChain = negotiationSaveChain.then(mkSaveNegotiationNow, mkSaveNegotiationNow);
  return negotiationSaveChain;
}

async function mkSaveNegotiationNow() {
  if (!quotesCurrentPageId || !API_BASE) return;
  mkSetSaveStatus('Guardando…', 'saving');
  try {
    const r = await fetch(`${API_BASE}/api/manager/quotes/${quotesCurrentPageId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ negotiated: mkCollectNegotiated() }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    mkSetSaveStatus('Guardado ✓', 'saved');
  } catch (e) {
    mkSetSaveStatus('Error al guardar', 'error');
  }
}

// Autosave: debounce so rapid edits collapse into one Notion write.
function mkScheduleNegotiationSave() {
  if (!quotesCurrentPageId) return;
  mkSetSaveStatus('Editando…', 'editing');
  clearTimeout(negotiationSaveTimer);
  negotiationSaveTimer = setTimeout(mkSaveNegotiation, 1000);
}

// Flush a pending (debounced) negotiation save immediately. Used when leaving
// the detail so the list reload reflects the latest prices.
async function mkFlushNegotiationSave() {
  if (negotiationSaveTimer) {
    clearTimeout(negotiationSaveTimer);
    negotiationSaveTimer = null;
    mkSaveNegotiation(); // enqueue a final save with the latest state
  }
  await negotiationSaveChain; // wait for all queued/in-flight saves to finish
}

function mkBindCloneEvents(container) {
  container.querySelectorAll('.mk-svc-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.svc;
      if (!id) return;
      if (e.target.checked) quoteDetailSelection[id] = quoteDetailSelection[id] || 1;
      else { delete quoteDetailSelection[id]; delete quoteDetailPriceOverrides[id]; }
      mkRefreshClone();
      mkScheduleNegotiationSave();
    });
  });
  container.querySelectorAll('.mk-qty-btn').forEach((b) => b.addEventListener('click', mkHandleQty));
  container.querySelectorAll('.mk-price-input').forEach((inp) => inp.addEventListener('input', mkHandlePriceInput));
}

async function loadQuotesFromApi(search = '', status = '') {
  if (!isAuthenticated) return;
  const statusEl = document.getElementById('quotes-status');
  if (statusEl) statusEl.textContent = 'Cargando cotizaciones...';
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (status) params.set('status', status);
    const qs = params.toString();
    const res = await fetchJson(`${API_BASE}/api/manager/quotes${qs ? `?${qs}` : ''}`);
    const data = res?.data || [];
    quotesFxRate = typeof res?.fxRate === 'number' && res.fxRate > 0 ? res.fxRate : null;
    quotesCache = data;
    renderQuotesList(data);
    mkUpdateQuotesStatusCount();
  } catch (e) {
    if (statusEl) statusEl.textContent = `Error: ${e.message}`;
  }
}

function formatQuoteTotal(q, fxRate) {
  const mxn = Number(q.totalMXN) || 0;
  const usd = Number(q.totalUSD) || 0;
  if (mxn === 0 && usd === 0) return '';
  if (fxRate && fxRate > 0) {
    const total = mxn + usd * fxRate;
    const approx = usd > 0 ? '≈ ' : ''; // approximate only when USD was converted
    return `${approx}$${Math.round(total).toLocaleString('en-US')} MXN`;
  }
  // No FX rate → show each currency separately, never a wrong combined total
  const parts = [];
  if (usd > 0) parts.push(`$${usd.toLocaleString('en-US')} USD`);
  if (mxn > 0) parts.push(`$${mxn.toLocaleString('en-US')} MXN`);
  return parts.join(' + ');
}

const QUOTE_ESTADOS = ['Idea Por Checar', 'Pendiente', 'Empezó', 'Terminado', 'Rechazado'];
let quotesSelectedIds = new Set();
let quotesSelectMode = false; // checkboxes hidden until the user taps "Seleccionar"
let quotesShowArchived = false; // archived = status "Terminado"; hidden from the default list
let quotesSearchTerm = ''; // free-text filter: number, name, email, phone, date

// "Terminado" quotes count as archived: hidden unless the user opts to show them.
const QUOTE_ARCHIVED_STATUS = 'Terminado';

function mkQuoteMatchesSearch(q, term) {
  const fields = [q.quoteNumber, q.name, q.email, q.phone, formatQuoteDate(q.date), q.date];
  return fields.some((v) => String(v || '').toLowerCase().includes(term));
}

function mkVisibleQuotes(quotes) {
  const list = quotes || [];
  const term = quotesSearchTerm.trim().toLowerCase();
  // A search spans EVERYTHING, including archived (Terminado) quotes.
  if (term) return list.filter((q) => mkQuoteMatchesSearch(q, term));
  if (quotesShowArchived) return list;
  return list.filter((q) => (q.estatus || '') !== QUOTE_ARCHIVED_STATUS);
}

function mkUpdateQuotesStatusCount() {
  const statusEl = document.getElementById('quotes-status');
  if (!statusEl) return;
  const data = quotesCache || [];
  const shown = mkVisibleQuotes(data).length;
  if (quotesSearchTerm.trim()) {
    statusEl.textContent = shown === 0 ? 'Sin resultados.' : `${shown} resultado${shown === 1 ? '' : 's'}.`;
    return;
  }
  if (data.length === 0) { statusEl.textContent = 'Sin cotizaciones para mostrar.'; return; }
  const nonArchived = data.filter((q) => (q.estatus || '') !== QUOTE_ARCHIVED_STATUS).length;
  const archived = data.length - nonArchived;
  const archivedNote = (!quotesShowArchived && archived > 0) ? ` (${archived} archivada${archived === 1 ? '' : 's'})` : '';
  const n = quotesShowArchived ? data.length : nonArchived;
  statusEl.textContent = n === 0 ? 'Sin cotizaciones para mostrar.' : `${n} cotización${n === 1 ? '' : 'es'}${archivedNote}.`;
}

// Re-render from the in-memory cache (search/archived filters are applied in render).
function mkRefreshQuotesView() {
  renderQuotesList(quotesCache);
  mkUpdateQuotesStatusCount();
}

function mkEstatusOptionsHtml(current) {
  const inList = QUOTE_ESTADOS.includes(current);
  const extra = (current && !inList) ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>` : '';
  const opts = QUOTE_ESTADOS.map((e) => `<option value="${escapeHtml(e)}"${e === current ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('');
  return extra + opts;
}

async function mkChangeEstatus(pageId, nuevo) {
  if (!pageId || !API_BASE) return false;
  try {
    const r = await fetch(`${API_BASE}/api/manager/quotes/${pageId}`, {
      method: 'PATCH', headers: apiHeaders(), body: JSON.stringify({ estatus: nuevo }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const q = quotesCache.find((x) => x.id === pageId);
    if (q) q.estatus = nuevo;
    return true;
  } catch (e) { return false; }
}

function mkUpdateSelectionUI() {
  const n = quotesSelectedIds.size;
  const list = document.getElementById('quotes-list');
  if (list) list.classList.toggle('selecting', quotesSelectMode);
  const bar = document.getElementById('quotes-action-bar');
  if (bar) bar.classList.toggle('hidden', !quotesSelectMode);
  const toggle = document.getElementById('quotes-select-toggle');
  if (toggle) toggle.textContent = quotesSelectMode ? 'Cancelar' : 'Seleccionar';
  const countEl = document.getElementById('quotes-select-count');
  if (countEl) countEl.textContent = String(n);
  const delBtn = document.getElementById('quotes-delete-btn');
  if (delBtn) delBtn.disabled = n === 0;
  const arcBtn = document.getElementById('quotes-archive-btn');
  if (arcBtn) arcBtn.disabled = n === 0;
}

function mkToggleSelectMode() {
  quotesSelectMode = !quotesSelectMode;
  if (!quotesSelectMode) {
    quotesSelectedIds = new Set();
    document.querySelectorAll('.quote-select').forEach((c) => { c.checked = false; });
  }
  mkUpdateSelectionUI();
}

// New flow: the button no longer generates the PDF itself. It builds a
// MK-CONTRATO prompt (with the LIVE negotiation as the price source of truth)
// and shows it in an editable bottom-sheet, auto-copied to the clipboard, so
// Jay reads/edits it and pastes it to Claude, which renders the contract PDF.
function mkGenerateContract() {
  if (!quotesCurrentPageId) return;
  const q = quotesCurrentDetail || {};
  const prompt = mkBuildContractPrompt(q, mkCollectNegotiated());
  mkShowContractPromptCard(prompt);
}

function mkBuildContractPrompt(q, negotiated) {
  const pageId = String(quotesCurrentPageId || '');
  const notionUrl = pageId ? `https://www.notion.so/${pageId.replace(/-/g, '')}` : '(sin id de página)';
  const origen = (q.origen && String(q.origen).trim()) || 'internacional';
  const lines = (negotiated || []).map((it) => {
    const qty = it.qty && it.qty !== '—' ? ` (x${it.qty})` : '';
    return `- ${it.name}${qty}: ${it.price}`;
  });
  const totalEl = document.getElementById('qd-total');
  const total = totalEl ? totalEl.textContent.trim() : '';
  const idiomaRaw = String(q.idioma || '').toLowerCase();
  const idioma = (idiomaRaw.includes('english') || idiomaRaw === 'en')
    ? 'English — REDACTÁ EL CONTRATO EN INGLÉS'
    : 'Español — redactá el contrato en español';
  const outFolder = '/Users/jaymansur-m5/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/Manager App/Contratos/Contratos sin Firmar';
  return [
    'MK-CONTRATO',
    '',
    'Generá el contrato de Music Knobs con estos datos. Dispará el skill mk-contrato y seguí su procedimiento completo, incluida la FASE DE REVISIÓN obligatoria antes de entregar.',
    '',
    `• Idioma del contrato: ${idioma}`,
    `• Tipo de cliente (origen): ${origen}`,
    `• Cliente: ${q.clientName || '—'}`,
    `• Email: ${q.email || '—'}`,
    `• Teléfono: ${q.phone || '—'}`,
    `• N.º de cotización: ${q.quoteNumber || '—'}`,
    `• Fecha: ${formatQuoteDate(q.date) || '—'}`,
    `• Nota de Notion (contexto y decisiones de la llamada): ${notionUrl}`,
    `• Carpeta de salida (Drive local, ya montado): ${outFolder}`,
    '',
    'NEGOCIACIÓN VIVA — verdad absoluta de precios. Ignorá cualquier precio viejo de la cotización original:',
    ...(lines.length ? lines : ['- (sin servicios seleccionados — revisá la negociación antes de generar)']),
    '',
    `Total acordado (referencia de la app): ${total || '—'}`,
    '',
    'Generá el PDF en la carpeta de salida con nombre Contrato-<n>-<Cliente>.pdf, revisalo con el checklist del skill, y reportame la ruta + un resumen de los términos clave.',
  ].join('\n');
}

async function mkCopyText(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) { statusEl.textContent = 'Copiado al portapapeles ✓'; statusEl.className = 'mk-prompt-status ok'; }
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'No se pudo copiar automáticamente — copialo a mano.'; statusEl.className = 'mk-prompt-status err'; }
  }
}

function mkHideContractPromptCard() {
  const overlay = document.getElementById('mk-contract-prompt-overlay');
  if (overlay) overlay.classList.remove('open');
}

function mkShowContractPromptCard(promptText) {
  let overlay = document.getElementById('mk-contract-prompt-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mk-contract-prompt-overlay';
    overlay.className = 'mk-prompt-overlay';
    overlay.innerHTML = `
      <div class="mk-prompt-card" role="dialog" aria-modal="true" aria-label="Prompt del contrato">
        <div class="mk-prompt-head">
          <div>
            <div class="mk-prompt-title">Prompt del contrato</div>
            <div class="mk-prompt-sub">Ya se copió al portapapeles. Leelo, editalo si querés y pegáselo a Claude.</div>
          </div>
          <button type="button" class="mk-prompt-close" aria-label="Cerrar">✕</button>
        </div>
        <textarea class="mk-prompt-text" spellcheck="false"></textarea>
        <div class="mk-prompt-actions">
          <span class="mk-prompt-status"></span>
          <button type="button" class="mk-prompt-copy btn">Copiar texto completo</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.mk-prompt-close').addEventListener('click', mkHideContractPromptCard);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) mkHideContractPromptCard(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) mkHideContractPromptCard();
    });
    overlay.querySelector('.mk-prompt-copy').addEventListener('click', () => {
      const ta = overlay.querySelector('.mk-prompt-text');
      mkCopyText(ta.value, overlay.querySelector('.mk-prompt-status'));
    });
  }
  const ta = overlay.querySelector('.mk-prompt-text');
  ta.value = promptText;
  const statusEl = overlay.querySelector('.mk-prompt-status');
  statusEl.textContent = '';
  statusEl.className = 'mk-prompt-status';
  overlay.classList.add('open');
  mkCopyText(promptText, statusEl); // auto-copy on open (click gesture is still active)
}

async function mkDeleteSelectedQuotes() {
  const ids = Array.from(quotesSelectedIds);
  if (ids.length === 0 || !API_BASE) return;
  if (!confirm(`¿Borrar ${ids.length} cotización${ids.length === 1 ? '' : 'es'}? Van a la papelera de Notion (recuperables 30 días).`)) return;
  const statusEl = document.getElementById('quotes-status');
  if (statusEl) statusEl.textContent = 'Borrando…';
  for (const id of ids) {
    try { await fetch(`${API_BASE}/api/manager/quotes/${id}`, { method: 'DELETE', headers: apiHeaders() }); } catch {}
  }
  quotesSelectedIds = new Set();
  quotesSelectMode = false;
  loadQuotesFromApi();
}

// Archive = mark as "Terminado". Archived quotes are simply the finished ones;
// they drop out of the default list but stay in Notion (no real archiving),
// reversible by changing the status back. Findable by a future search/toggle.
async function mkArchiveSelectedQuotes() {
  const ids = Array.from(quotesSelectedIds);
  if (ids.length === 0 || !API_BASE) return;
  const statusEl = document.getElementById('quotes-status');
  if (statusEl) statusEl.textContent = 'Archivando…';
  for (const id of ids) {
    await mkChangeEstatus(id, 'Terminado');
  }
  quotesSelectedIds = new Set();
  quotesSelectMode = false;
  loadQuotesFromApi();
}

function renderQuotesList(quotes) {
  const container = document.getElementById('quotes-list');
  if (!container) return;
  quotesSelectedIds = new Set();
  quotesSelectMode = false;
  mkUpdateSelectionUI();
  const visible = mkVisibleQuotes(quotes);
  if (visible.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = visible.map((q) => {
    const id = escapeHtml(q.id);
    const estatus = q.estatus || '';
    const quoteNumber = escapeHtml(q.quoteNumber || '—');
    const name = escapeHtml(q.name || '—');
    const date = escapeHtml(formatQuoteDate(q.date));
    const total = escapeHtml(formatQuoteTotal(q, quotesFxRate));
    return `
      <div class="quote-card" data-id="${id}">
        <input type="checkbox" class="quote-select" data-id="${id}" aria-label="Seleccionar cotización">
        <div class="quote-card-main">
          <div class="quote-card-top">
            <span class="quote-number-badge">${quoteNumber}</span>
            <span class="quote-client-name">${name}</span>
          </div>
          <div class="quote-card-meta">
            ${date ? `<span>${date}</span>` : ''}
            ${total ? `<span>${total}</span>` : ''}
          </div>
        </div>
        <select class="quote-estatus-select" data-quote-id="${id}">${mkEstatusOptionsHtml(estatus)}</select>
      </div>`;
  }).join('');

  container.querySelectorAll('.quote-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.quote-estatus-select')) return;
      const pageId = card.dataset.id;
      if (!pageId) return;
      // In selection mode a tap toggles the checkbox; otherwise it opens detail.
      if (quotesSelectMode) {
        if (e.target.closest('.quote-select')) return; // checkbox handles itself
        const chk = card.querySelector('.quote-select');
        if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      if (e.target.closest('.quote-select')) return;
      loadQuoteDetail(pageId);
    });
  });
  container.querySelectorAll('.quote-select').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) quotesSelectedIds.add(id);
      else quotesSelectedIds.delete(id);
      mkUpdateSelectionUI();
    });
  });
  container.querySelectorAll('.quote-estatus-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const ok = await mkChangeEstatus(e.target.dataset.quoteId, e.target.value);
      if (!ok) alert('No se pudo cambiar el estado.');
    });
  });
}

function showQuoteDetail(show) {
  const listView = document.getElementById('quotes-list-view');
  const detailView = document.getElementById('quote-detail-view');
  if (listView) listView.classList.toggle('hidden', show);
  if (detailView) detailView.classList.toggle('hidden', !show);
}

async function loadQuoteDetail(pageId) {
  quotesCurrentPageId = pageId;
  showQuoteDetail(true);
  const numberEl = document.getElementById('quote-detail-number');
  if (numberEl) numberEl.textContent = 'Cargando...';
  const servicesEl = document.getElementById('qd-services-list');
  if (servicesEl) servicesEl.innerHTML = '';
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/quotes/${pageId}`);
    const q = res?.data;
    if (!q) throw new Error('Sin datos de cotización');
    if (typeof res?.fxRate === 'number' && res.fxRate > 0) quotesFxRate = res.fxRate;
    renderQuoteDetail(q);
  } catch (e) {
    if (numberEl) numberEl.textContent = 'Error';
    if (servicesEl) servicesEl.innerHTML = `<p class="hint">Error al cargar: ${escapeHtml(e.message)}</p>`;
  }
}

function renderQuoteDetail(q) {
  quotesCurrentDetail = q; // remember for the contract prompt
  const numberEl = document.getElementById('quote-detail-number');
  if (numberEl) numberEl.textContent = q.quoteNumber || '—';

  const estatusSel = document.getElementById('quote-detail-estatus-select');
  if (estatusSel) {
    const st = q.status || q.estatus || '';
    estatusSel.innerHTML = mkEstatusOptionsHtml(st);
    estatusSel.value = st;
    estatusSel.onchange = async () => {
      const ok = await mkChangeEstatus(quotesCurrentPageId, estatusSel.value);
      if (!ok) alert('No se pudo cambiar el estado.');
    };
  }

  const setSpan = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };
  const setHtml = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html || '—';
  };
  setSpan('qd-client-name', q.clientName);
  const email = q.email || '';
  setHtml('qd-client-email', email ? `<a class="qd-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '—');
  const phone = q.phone || '';
  const waDigits = phone.replace(/\D/g, ''); // wa.me needs digits only, incl. country code
  setHtml('qd-client-phone', phone
    ? (waDigits ? `<a class="qd-link" href="https://wa.me/${waDigits}" target="_blank" rel="noopener">${escapeHtml(phone)}</a>` : escapeHtml(phone))
    : '—');
  setSpan('qd-date', formatQuoteDate(q.date));
  setSpan('qd-total', formatQuoteTotal(q, quotesFxRate) || '—');

  mkSetSaveStatus('', '');
  const contractStatusEl = document.getElementById('quote-contract-status');
  if (contractStatusEl) contractStatusEl.textContent = '';
  const servicesEl = document.getElementById('qd-services-list');
  if (servicesEl) {
    servicesEl.innerHTML = mkInitCotizadorClone(q.services || [], q.origen, q.negotiated);
    const clone = servicesEl.querySelector('.mk-cotizador-clone');
    if (clone) mkBindCloneEvents(clone);
    mkUpdateQdTotal(); // keep the top total in sync with the clone from the start
  }
}

// ─── PORTAL DE CLIENTES (admin) ───────────────────────────────────────────────
let portalCotizacionesCache = [];
let portalActiveQuote = null; // { id, quoteNumber, clientName, tracks }

function portalSetStatus(msg) {
  const el = document.getElementById('portal-status');
  if (el) el.textContent = msg || '';
}

function portalUploadStatus(msg) {
  const el = document.getElementById('portal-upload-status');
  if (el) el.textContent = msg || '';
}

function showPortalDetail(show) {
  const list = document.getElementById('portal-list-view');
  const detail = document.getElementById('portal-detail-view');
  if (list) list.classList.toggle('hidden', show);
  if (detail) detail.classList.toggle('hidden', !show);
}

// Transient toast — used to confirm optimistic actions and surface failures.
let portalToastTimer = null;
function portalNotify(message, isError = false) {
  let el = document.getElementById('portal-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'portal-toast';
    el.className = 'portal-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.classList.add('show');
  if (portalToastTimer) clearTimeout(portalToastTimer);
  portalToastTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2500);
}

async function loadPortalCotizaciones() {
  showPortalDetail(false);
  portalSetStatus('Cargando cotizaciones…');
  try {
    const data = await fetchJson(`${API_BASE}/portal/admin/cotizaciones`);
    portalCotizacionesCache = data?.quotes || [];
    renderPortalCotizaciones(portalCotizacionesCache);
    portalSetStatus(portalCotizacionesCache.length ? '' : 'No hay cotizaciones todavía.');
  } catch (e) {
    portalSetStatus('Error al cargar: ' + (e?.message || e));
  }
}

function renderPortalCotizaciones(quotes) {
  const root = document.getElementById('portal-cotizaciones');
  if (!root) return;
  root.innerHTML = '';
  quotes.forEach((q) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'portal-card';
    card.innerHTML = `<span class="portal-card-name">${escapeHtmlSafe(q.name || '—')}</span>` +
      `<span class="portal-card-meta">${escapeHtmlSafe(q.quoteNumber || q.id.slice(0, 6))}${q.estatus ? ' · ' + escapeHtmlSafe(q.estatus) : ''}</span>`;
    card.addEventListener('click', () => openPortalCotizacion(q.id, q.name, q.quoteNumber));
    root.appendChild(card);
  });
}

function escapeHtmlSafe(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function openPortalCotizacion(quoteId, clientName, quoteNumber) {
  portalUploadStatus('');
  showPortalDetail(true);
  const numEl = document.getElementById('portal-detail-number');
  const cliEl = document.getElementById('portal-detail-client');
  if (numEl) numEl.textContent = quoteNumber || quoteId.slice(0, 8);
  if (cliEl) cliEl.textContent = clientName || '';
  const tracksRoot = document.getElementById('portal-tracks');
  if (tracksRoot) tracksRoot.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const data = await fetchJson(`${API_BASE}/portal/admin/cotizacion/${quoteId}`);
    portalActiveQuote = { id: quoteId, quoteNumber, clientName, tracks: data?.tracks || [], estadoCuenta: data?.estadoCuenta || null };
    renderPortalTracks(portalActiveQuote.tracks);
    renderPortalAccount(portalActiveQuote.estadoCuenta);
  } catch (e) {
    if (tracksRoot) tracksRoot.innerHTML = `<p class="hint">Error: ${escapeHtmlSafe(e?.message || String(e))}</p>`;
  }
}

function portalMoney(amount, currency) {
  return `${currency} ${Number(amount || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

function renderPortalAccount(ec) {
  const root = document.getElementById('portal-account-summary');
  if (!root) return;
  if (!ec) { root.innerHTML = '<p class="hint">Sin datos de cuenta.</p>'; return; }
  const rows = [];
  const addRow = (cur, total, pagado, saldo) => {
    const paid = saldo <= 0;
    rows.push(`<tr>
      <td class="pa-cur">${cur}</td>
      <td class="pa-num">${portalMoney(total, cur)}</td>
      <td class="pa-num">${portalMoney(pagado, cur)}</td>
      <td class="pa-num pa-saldo ${paid ? 'is-paid' : 'is-due'}">${portalMoney(saldo, cur)}</td>
    </tr>`);
  };
  if (ec.totalMXN || ec.totalAbonosMXN) addRow('MXN', ec.totalMXN, ec.totalAbonosMXN, ec.saldoMXN);
  if (ec.totalUSD || ec.totalAbonosUSD) addRow('USD', ec.totalUSD, ec.totalAbonosUSD, ec.saldoUSD);
  if (!rows.length) { root.innerHTML = '<p class="hint">Cotización sin total.</p>'; }
  else root.innerHTML = `<table class="pa-table">
    <thead><tr><th>Moneda</th><th class="pa-num">Total</th><th class="pa-num">Pagado</th><th class="pa-num">Saldo</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
  renderPortalAbonosList(ec.abonos || []);
}

let portalAbonoEditId = null;

function renderPortalAbonosList(abonos) {
  const list = document.getElementById('portal-abono-list');
  if (!list) return;
  list.innerHTML = '';
  if (!abonos.length) return;
  abonos.forEach((a) => {
    const li = document.createElement('li');
    li.className = 'portal-abono-row';

    const amount = document.createElement('span');
    amount.className = 'portal-abono-amount';
    amount.textContent = portalMoney(a.monto, a.moneda);
    const date = document.createElement('span');
    date.className = 'portal-abono-date';
    date.textContent = a.fecha || '';
    li.appendChild(amount);
    li.appendChild(date);

    if (a.recibo) {
      const link = document.createElement('a');
      link.className = 'portal-abono-recibo-link';
      link.href = `${API_BASE}/api/audio/${a.recibo}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = 'ver recibo';
      li.appendChild(link);
    } else {
      li.appendChild(Object.assign(document.createElement('span'), { className: 'portal-abono-norecibo', textContent: 'sin recibo' }));
    }

    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'portal-icon-btn'; edit.textContent = '✎'; edit.title = 'Editar abono';
    edit.disabled = !a.id;
    edit.addEventListener('click', () => editAbono(a));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'portal-icon-btn portal-icon-danger'; del.textContent = '🗑'; del.title = 'Borrar abono';
    del.disabled = !a.id;
    del.addEventListener('click', () => deleteAbono(a));
    li.appendChild(edit);
    li.appendChild(del);
    list.appendChild(li);
  });
}

function editAbono(a) {
  if (!a.id) return;
  portalAbonoEditId = a.id;
  const montoEl = document.getElementById('portal-abono-monto');
  const monedaEl = document.getElementById('portal-abono-moneda');
  const fechaEl = document.getElementById('portal-abono-fecha');
  if (montoEl) montoEl.value = a.monto;
  if (monedaEl) monedaEl.value = a.moneda || 'MXN';
  if (fechaEl) fechaEl.value = a.fecha || '';
  const btn = document.getElementById('portal-abono-btn');
  if (btn) btn.textContent = 'Guardar cambios';
  montoEl?.focus();
  portalNotify('Editando abono — cambiá y guardá (el recibo solo si subís uno nuevo).');
}

async function deleteAbono(a) {
  if (!a.id) return;
  if (!confirm(`¿Borrar este abono de ${portalMoney(a.monto, a.moneda)}?\nSi tiene recibo también se borra de Drive.`)) return;
  const ec = portalActiveQuote.estadoCuenta;
  const snapshot = JSON.parse(JSON.stringify(ec));
  ec.abonos = (ec.abonos || []).filter((x) => x.id !== a.id);
  if (a.moneda === 'USD') { ec.totalAbonosUSD -= a.monto; ec.saldoUSD = ec.totalUSD - ec.totalAbonosUSD; }
  else { ec.totalAbonosMXN -= a.monto; ec.saldoMXN = ec.totalMXN - ec.totalAbonosMXN; }
  renderPortalAccount(ec);
  try {
    if (a.recibo) { try { await portalDeleteFromDrive(a.recibo); } catch { /* ignore drive errors */ } }
    const res = await fetch(`${API_BASE}/portal/admin/abono/${a.id}`, { method: 'DELETE', headers: apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    portalNotify('Abono borrado.');
  } catch (e) {
    portalActiveQuote.estadoCuenta = snapshot;
    renderPortalAccount(snapshot);
    portalNotify('No se pudo borrar el abono: ' + (e?.message || e), true);
  }
}

async function registerPortalAbono() {
  if (!portalActiveQuote) return;
  const montoEl = document.getElementById('portal-abono-monto');
  const monedaEl = document.getElementById('portal-abono-moneda');
  const fechaEl = document.getElementById('portal-abono-fecha');
  const statusEl = document.getElementById('portal-abono-status');
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m || ''; };
  const monto = Number(montoEl?.value || 0);
  if (!monto || monto <= 0) return setStatus('Poné un monto válido.');

  const moneda = monedaEl?.value || 'MXN';
  const fecha = fechaEl?.value || '';
  const reciboEl = document.getElementById('portal-abono-recibo');
  const reciboFile = reciboEl?.files?.[0];

  const btn = document.getElementById('portal-abono-btn');
  if (btn) btn.disabled = true;

  // Upload the receipt first (browser → Drive as the admin), then register the abono.
  let reciboFileId = '';
  try {
    if (reciboFile) {
      setStatus('Subiendo recibo…');
      reciboFileId = await portalUploadToDrive(reciboFile, `Recibo ${fecha || ''} - ${portalActiveQuote.quoteNumber || ''}`, PORTAL_RECIBOS_FOLDER);
    }
  } catch (e) {
    setStatus('');
    portalNotify('No se pudo subir el recibo: ' + (e?.message || e), true);
    if (btn) btn.disabled = false;
    return;
  }

  // EDIT mode: PATCH the existing abono, then refresh the statement.
  if (portalAbonoEditId) {
    try {
      const body = { monto, moneda, fecha };
      if (reciboFileId) body.reciboFileId = reciboFileId;
      const res = await fetch(`${API_BASE}/portal/admin/abono/${portalAbonoEditId}`, {
        method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      portalNotify('Abono actualizado.');
      portalAbonoEditId = null;
      if (btn) btn.textContent = 'Registrar abono';
      if (montoEl) montoEl.value = '';
      if (reciboEl) reciboEl.value = '';
      await openPortalCotizacion(portalActiveQuote.id, portalActiveQuote.clientName, portalActiveQuote.quoteNumber);
    } catch (e) {
      portalNotify('No se pudo actualizar el abono: ' + (e?.message || e), true);
    } finally {
      if (btn) btn.disabled = false;
    }
    return;
  }

  // CREATE (optimistic): update the statement now, undo + notify if the server rejects it.
  const ec = portalActiveQuote.estadoCuenta;
  const snapshot = ec ? JSON.parse(JSON.stringify(ec)) : null;
  const optimistic = { monto, moneda, fecha, recibo: reciboFileId };
  if (ec) {
    ec.abonos = ec.abonos || [];
    ec.abonos.push(optimistic);
    if (moneda === 'USD') { ec.totalAbonosUSD += monto; ec.saldoUSD = ec.totalUSD - ec.totalAbonosUSD; }
    else { ec.totalAbonosMXN += monto; ec.saldoMXN = ec.totalMXN - ec.totalAbonosMXN; }
    renderPortalAccount(ec);
  }
  if (montoEl) montoEl.value = '';
  if (reciboEl) reciboEl.value = '';
  setStatus('');

  try {
    const res = await fetch(`${API_BASE}/portal/admin/abono`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ cotizacionId: portalActiveQuote.id, monto, moneda, fecha, reciboFileId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    optimistic.id = data.id; // so it can be edited/deleted without a reload
    renderPortalAccount(ec);
    portalNotify('Abono registrado.');
  } catch (e) {
    if (snapshot) { portalActiveQuote.estadoCuenta = snapshot; renderPortalAccount(snapshot); }
    portalNotify('No se pudo registrar el abono: ' + (e?.message || e), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderPortalTracks(tracks) {
  const root = document.getElementById('portal-tracks');
  if (!root) return;
  root.innerHTML = '';
  // Track-name suggestions for the upload form
  const datalist = document.getElementById('portal-track-list');
  if (datalist) datalist.innerHTML = tracks.map((t) => `<option value="${escapeHtmlSafe(t.name)}">`).join('');

  if (!tracks.length) {
    root.innerHTML = '<p class="hint">Todavía no hay canciones. Subí la primera versión abajo.</p>';
    return;
  }

  tracks.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'portal-track';

    const head = document.createElement('div');
    head.className = 'portal-track-head';
    const title = document.createElement('strong');
    title.textContent = t.name;
    head.appendChild(title);

    // All track actions grouped to the right (consistent with version rows).
    const headActions = document.createElement('span');
    headActions.className = 'portal-version-controls';

    // Descarga habilitada toggle (track level)
    const dl = document.createElement('label');
    dl.className = 'portal-toggle';
    const dlInput = document.createElement('input');
    dlInput.type = 'checkbox';
    dlInput.checked = Boolean(t.descargaHabilitada);
    dlInput.addEventListener('change', async () => {
      dlInput.disabled = true;
      try {
        await portalPatchTrack(t.id, { descargaHabilitada: dlInput.checked });
        t.descargaHabilitada = dlInput.checked;
      } catch (e) {
        dlInput.checked = !dlInput.checked;
        portalNotify('No se pudo cambiar la descarga: ' + (e?.message || e), true);
      } finally {
        dlInput.disabled = false;
      }
    });
    dl.appendChild(dlInput);
    dl.appendChild(Object.assign(document.createElement('span'), { textContent: 'Descarga' }));
    headActions.appendChild(dl);

    const trackRename = document.createElement('button');
    trackRename.type = 'button';
    trackRename.className = 'portal-icon-btn';
    trackRename.textContent = '✎';
    trackRename.title = 'Renombrar canción';
    trackRename.addEventListener('click', () => renamePortalTrack(t));
    headActions.appendChild(trackRename);

    const trackDelete = document.createElement('button');
    trackDelete.type = 'button';
    trackDelete.className = 'portal-icon-btn portal-icon-danger';
    trackDelete.textContent = '🗑';
    trackDelete.title = 'Borrar canción y todas sus versiones';
    trackDelete.addEventListener('click', () => deletePortalTrack(t));
    headActions.appendChild(trackDelete);

    head.appendChild(headActions);
    el.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'portal-version-list';
    (t.versions || []).forEach((v) => {
      const li = document.createElement('li');
      li.className = 'portal-version';

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'portal-row-play';
      play.textContent = '▶';
      play.title = 'Reproducir';
      play.disabled = !v.driveFileId;
      play.addEventListener('click', () => portalPlayVersion(v, t.name));

      const name = document.createElement('span');
      name.className = 'portal-version-name';
      name.textContent = v.name + (v.duracion ? ` · ${Math.round(v.duracion)}s` : '');

      const controls = document.createElement('span');
      controls.className = 'portal-version-controls';

      // Favorita (exclusive per track)
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'portal-fav' + (v.favorita ? ' is-fav' : '');
      fav.textContent = '★';
      fav.title = 'Versión principal';
      fav.addEventListener('click', async () => {
        const next = !v.favorita;
        // Optimistic: favorita is exclusive per track — set this, clear siblings.
        const prev = t.versions.map((x) => x.favorita);
        t.versions.forEach((x) => { x.favorita = (x.id === v.id) ? next : false; });
        renderPortalTracks(portalActiveQuote.tracks);
        try {
          await portalPatchVersion(v.id, { favorita: next });
        } catch (e) {
          t.versions.forEach((x, i) => { x.favorita = prev[i]; });
          renderPortalTracks(portalActiveQuote.tracks);
          portalNotify('No se pudo cambiar la favorita: ' + (e?.message || e), true);
        }
      });

      // Visible toggle
      const vis = document.createElement('label');
      vis.className = 'portal-toggle';
      const visInput = document.createElement('input');
      visInput.type = 'checkbox';
      visInput.checked = Boolean(v.visible);
      visInput.addEventListener('change', async () => {
        visInput.disabled = true;
        try {
          await portalPatchVersion(v.id, { visible: visInput.checked });
          v.visible = visInput.checked;
        } catch (e) {
          visInput.checked = !visInput.checked;
          portalNotify('No se pudo cambiar la visibilidad: ' + (e?.message || e), true);
        } finally {
          visInput.disabled = false;
        }
      });
      vis.appendChild(visInput);
      vis.appendChild(Object.assign(document.createElement('span'), { textContent: 'Visible' }));

      const verRename = document.createElement('button');
      verRename.type = 'button';
      verRename.className = 'portal-icon-btn';
      verRename.textContent = '✎';
      verRename.title = 'Renombrar versión';
      verRename.addEventListener('click', () => renamePortalVersion(v));

      const verDelete = document.createElement('button');
      verDelete.type = 'button';
      verDelete.className = 'portal-icon-btn portal-icon-danger';
      verDelete.textContent = '🗑';
      verDelete.title = 'Borrar versión';
      verDelete.addEventListener('click', () => deletePortalVersion(v, t));

      controls.appendChild(fav);
      controls.appendChild(vis);
      controls.appendChild(verRename);
      controls.appendChild(verDelete);

      li.appendChild(play);
      li.appendChild(name);
      li.appendChild(controls);
      list.appendChild(li);
    });
    el.appendChild(list);
    root.appendChild(el);
  });
}

async function portalPatchVersion(versionId, body) {
  const res = await fetch(`${API_BASE}/portal/admin/version/${versionId}`, {
    method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function portalPatchTrack(trackId, body) {
  const res = await fetch(`${API_BASE}/portal/admin/track/${trackId}`, {
    method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Delete a Drive file as the logged-in admin (we created it via drive.file, so we can
// remove it). 404 = already gone (OK). The service account can't delete it (only writer).
async function portalDeleteFromDrive(fileId) {
  if (!fileId) return;
  if (!googleAccessToken) throw new Error('Sesión de Google no disponible. Volvé a iniciar sesión.');
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${googleAccessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Falta permiso de Drive. Cerrá sesión y volvé a entrar.');
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive ${res.status}`);
  }
}

// Delete a version optimistically: remove from the UI now, undo + notify if it fails.
async function deletePortalVersion(version, track) {
  if (!confirm(`¿Borrar la versión "${version.name}"?\nSe elimina también el archivo de Drive. No se puede deshacer.`)) return;
  const idx = track.versions.indexOf(version);
  if (idx === -1) return;
  track.versions.splice(idx, 1);
  renderPortalTracks(portalActiveQuote.tracks);
  try {
    await portalDeleteFromDrive(version.driveFileId);
    const res = await fetch(`${API_BASE}/portal/admin/version/${version.id}`, { method: 'DELETE', headers: apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    portalNotify('Versión borrada.');
  } catch (e) {
    track.versions.splice(idx, 0, version); // undo
    renderPortalTracks(portalActiveQuote.tracks);
    portalNotify('No se pudo borrar la versión: ' + (e?.message || e), true);
  }
}

// Delete a track + all versions optimistically.
async function deletePortalTrack(track) {
  const n = (track.versions || []).length;
  if (!confirm(`¿Borrar la canción "${track.name}" y sus ${n} versión(es)?\nSe eliminan también los archivos de Drive. No se puede deshacer.`)) return;
  const idx = portalActiveQuote.tracks.indexOf(track);
  if (idx === -1) return;
  portalActiveQuote.tracks.splice(idx, 1);
  renderPortalTracks(portalActiveQuote.tracks);
  try {
    for (const v of (track.versions || [])) {
      await portalDeleteFromDrive(v.driveFileId);
    }
    const res = await fetch(`${API_BASE}/portal/admin/track/${track.id}`, { method: 'DELETE', headers: apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    portalNotify('Canción borrada.');
  } catch (e) {
    portalActiveQuote.tracks.splice(idx, 0, track); // undo
    renderPortalTracks(portalActiveQuote.tracks);
    portalNotify('No se pudo borrar la canción: ' + (e?.message || e), true);
  }
}

async function renamePortalTrack(track) {
  const name = prompt('Nuevo nombre de la canción:', track.name);
  if (name === null || !name.trim() || name.trim() === track.name) return;
  const prev = track.name;
  track.name = name.trim();
  renderPortalTracks(portalActiveQuote.tracks);
  try {
    await portalPatchTrack(track.id, { name: name.trim() });
    portalNotify('Renombrado.');
  } catch (e) {
    track.name = prev;
    renderPortalTracks(portalActiveQuote.tracks);
    portalNotify('No se pudo renombrar: ' + (e?.message || e), true);
  }
}

async function renamePortalVersion(version) {
  const name = prompt('Nuevo nombre de la versión:', version.name);
  if (name === null || !name.trim() || name.trim() === version.name) return;
  const prev = version.name;
  version.name = name.trim();
  renderPortalTracks(portalActiveQuote.tracks);
  try {
    await portalPatchVersion(version.id, { name: name.trim() });
    portalNotify('Renombrado.');
  } catch (e) {
    version.name = prev;
    renderPortalTracks(portalActiveQuote.tracks);
    portalNotify('No se pudo renombrar: ' + (e?.message || e), true);
  }
}

// ── Admin waveform player (vanilla, reuses Drive stream + stored peaks) ──────
let portalPlayerState = { peaks: [], duration: 0, versionId: '', comments: [] };

function portalDrawWaveform() {
  const canvas = document.getElementById('portal-player-canvas');
  const audio = document.getElementById('portal-player-audio');
  if (!canvas || !audio) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const data = portalPlayerState.peaks.length ? portalPlayerState.peaks : new Array(120).fill(0.04);
  const max = Math.max(...data, 0.0001);
  const mid = h / 2;
  const barW = w / data.length;
  const dur = portalPlayerState.duration || audio.duration || 0;
  const progress = dur > 0 ? audio.currentTime / dur : 0;
  const playedX = progress * w;
  for (let i = 0; i < data.length; i++) {
    const x = i * barW;
    const amp = (data[i] / max) * (mid - 1);
    const barH = Math.max(amp, 1);
    ctx.fillStyle = x < playedX ? '#ff1097' : '#424242';
    ctx.fillRect(x, mid - barH, Math.max(barW - (barW > 2 ? 1 : 0), 1), barH * 2);
  }
  if (dur > 0) {
    for (const cm of (portalPlayerState.comments || [])) {
      const cx = (cm.timestamp / dur) * w;
      ctx.fillStyle = '#ffc127';
      ctx.fillRect(cx - 1, 0, 2, 8);
      ctx.beginPath(); ctx.arc(cx, 4, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (progress > 0) { ctx.fillStyle = '#ff1097'; ctx.fillRect(playedX - 1, 0, 2, h); }
}

function portalFmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function portalPlayVersion(version, trackName) {
  const wrap = document.getElementById('portal-player');
  const audio = document.getElementById('portal-player-audio');
  const titleEl = document.getElementById('portal-player-title');
  if (!wrap || !audio) return;
  if (!version.driveFileId) { portalUploadStatus('Esta versión no tiene archivo.'); return; }

  portalPlayerState = { peaks: version.peaks || [], duration: version.duracion || 0, versionId: version.id, comments: [] };
  wrap.classList.remove('hidden');
  if (titleEl) titleEl.textContent = `${trackName} — ${version.name}`;
  audio.src = `${API_BASE}/api/audio/${version.driveFileId}`;
  const durEl = document.getElementById('portal-player-dur');
  if (durEl) durEl.textContent = portalFmtTime(version.duracion || 0);
  audio.play().catch(() => {});
  portalDrawWaveform();
  loadAdminComments(version.id);
}

async function loadAdminComments(versionId) {
  try {
    const data = await fetchJson(`${API_BASE}/portal/admin/comments/${versionId}`);
    if (portalPlayerState.versionId === versionId) {
      portalPlayerState.comments = data?.comments || [];
      renderAdminComments();
      portalDrawWaveform();
    }
  } catch {
    renderAdminComments();
  }
}

function renderAdminComments() {
  const root = document.getElementById('portal-comment-list');
  if (!root) return;
  const comments = portalPlayerState.comments || [];
  if (!comments.length) { root.innerHTML = '<li class="portal-comment-empty">Sin comentarios todavía.</li>'; return; }
  root.innerHTML = '';
  comments.forEach((cm) => {
    const li = document.createElement('li');
    li.className = 'portal-comment' + (cm.esAdmin ? ' is-admin' : '');
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'portal-comment-jump';
    t.textContent = portalFmtTime(cm.timestamp);
    t.addEventListener('click', () => {
      const audio = document.getElementById('portal-player-audio');
      if (audio) { audio.currentTime = cm.timestamp; portalDrawWaveform(); }
    });
    const body = document.createElement('div');
    body.innerHTML = `<div class="portal-comment-text"></div><div class="portal-comment-meta"></div>`;
    body.querySelector('.portal-comment-text').textContent = cm.texto;
    body.querySelector('.portal-comment-meta').textContent = cm.esAdmin ? `${cm.autor} · admin` : cm.autor;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'portal-icon-btn portal-icon-danger portal-comment-del';
    del.textContent = '🗑';
    del.title = 'Borrar comentario';
    del.addEventListener('click', () => deleteAdminComment(cm));
    li.appendChild(t);
    li.appendChild(body);
    li.appendChild(del);
    root.appendChild(li);
  });
}

async function deleteAdminComment(cm) {
  if (String(cm.id).startsWith('tmp')) return; // not persisted yet
  if (!confirm(`¿Borrar este comentario?\n"${cm.texto}"`)) return;
  const prev = portalPlayerState.comments || [];
  portalPlayerState.comments = prev.filter((c) => c.id !== cm.id);
  renderAdminComments(); portalDrawWaveform();
  try {
    const res = await fetch(`${API_BASE}/portal/admin/comment/${cm.id}`, { method: 'DELETE', headers: apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    portalNotify('Comentario borrado.');
  } catch (e) {
    portalPlayerState.comments = prev;
    renderAdminComments(); portalDrawWaveform();
    portalNotify('No se pudo borrar el comentario: ' + (e?.message || e), true);
  }
}

async function postAdminComment() {
  const input = document.getElementById('portal-comment-text');
  const audio = document.getElementById('portal-player-audio');
  const texto = (input?.value || '').trim();
  if (!texto || !portalPlayerState.versionId) return;
  const timestamp = audio ? audio.currentTime : 0;
  const btn = document.getElementById('portal-comment-btn');
  if (btn) btn.disabled = true;
  // optimistic
  const optimistic = { id: 'tmp' + Date.now(), texto, timestamp, autor: 'Music Knobs', esAdmin: true, fecha: '' };
  portalPlayerState.comments = [...(portalPlayerState.comments || []), optimistic].sort((a, b) => a.timestamp - b.timestamp);
  renderAdminComments(); portalDrawWaveform();
  if (input) input.value = '';
  try {
    const res = await fetch(`${API_BASE}/portal/admin/comment`, {
      method: 'POST', headers: apiHeaders(),
      body: JSON.stringify({ versionId: portalPlayerState.versionId, texto, timestamp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // Swap the temp id for the real one so delete works immediately (no refetch).
    const real = (portalPlayerState.comments || []).find((c) => c.id === optimistic.id);
    if (real && data.id) { real.id = data.id; renderAdminComments(); }
    portalNotify('Comentario enviado.');
  } catch (e) {
    portalPlayerState.comments = (portalPlayerState.comments || []).filter((c) => c.id !== optimistic.id);
    renderAdminComments(); portalDrawWaveform();
    portalNotify('No se pudo comentar: ' + (e?.message || e), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setupPortalPlayer() {
  const audio = document.getElementById('portal-player-audio');
  const canvas = document.getElementById('portal-player-canvas');
  const toggle = document.getElementById('portal-player-toggle');
  const closeBtn = document.getElementById('portal-player-close');
  const curEl = document.getElementById('portal-player-cur');
  const durEl = document.getElementById('portal-player-dur');
  if (!audio) return;

  if (toggle) toggle.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  if (audio) {
    audio.addEventListener('play', () => { if (toggle) toggle.textContent = '⏸'; });
    audio.addEventListener('pause', () => { if (toggle) toggle.textContent = '▶'; });
    audio.addEventListener('timeupdate', () => {
      if (curEl) curEl.textContent = portalFmtTime(audio.currentTime);
      const ct = document.getElementById('portal-comment-time');
      if (ct) ct.textContent = portalFmtTime(audio.currentTime);
      portalDrawWaveform();
    });
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) { portalPlayerState.duration = portalPlayerState.duration || audio.duration; if (durEl) durEl.textContent = portalFmtTime(portalPlayerState.duration); }
    });
    audio.addEventListener('ended', () => { if (toggle) toggle.textContent = '▶'; portalDrawWaveform(); });
  }
  if (canvas) canvas.addEventListener('click', (e) => {
    const dur = portalPlayerState.duration || audio.duration || 0;
    if (!dur) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * dur;
    portalDrawWaveform();
  });
  if (closeBtn) closeBtn.addEventListener('click', () => {
    audio.pause();
    document.getElementById('portal-player')?.classList.add('hidden');
  });
  const commentBtn = document.getElementById('portal-comment-btn');
  if (commentBtn) commentBtn.addEventListener('click', postAdminComment);
  const commentInput = document.getElementById('portal-comment-text');
  if (commentInput) commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); postAdminComment(); }
  });
}

// Decode an audio file → { peaks: number[] (0..1), duration: seconds }.
async function generatePeaks(file, buckets = 400) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channel.length / buckets) || 1;
    const peaks = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const v = Math.abs(channel[start + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(Math.round(max * 1000) / 1000);
    }
    const duration = audioBuffer.duration;
    ctx.close();
    return { peaks, duration };
  } catch {
    return { peaks: [], duration: 0 }; // fallback: empty peaks
  }
}

// Returns the track object (existing or newly created + added to local state).
async function portalEnsureTrack(name) {
  const existing = (portalActiveQuote?.tracks || []).find(
    (t) => String(t.name).trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing) return existing;
  const res = await fetch(`${API_BASE}/portal/admin/track`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ cotizacionId: portalActiveQuote.id, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(data.error || 'No se pudo crear la canción');
  const track = { id: data.id, name: name.trim(), estado: 'En progreso', descargaHabilitada: false, moneda: '', versions: [] };
  portalActiveQuote.tracks.push(track);
  return track;
}

// Upload a file straight to Drive as the logged-in admin (we have an OAuth token
// with drive.file scope). Service accounts can't own files in a personal My Drive,
// so the upload must happen here, not in the worker. Returns the new file id.
async function portalUploadToDrive(file, name, folderId = PORTAL_DRIVE_FOLDER) {
  if (!googleAccessToken) throw new Error('Sesión de Google no disponible. Volvé a iniciar sesión.');
  const boundary = '-mkportal' + Date.now();
  const metadata = { name, parents: [folderId], mimeType: file.type || 'application/octet-stream' };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${googleAccessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Falta permiso de Drive. Cerrá sesión y volvé a entrar para autorizar la subida de archivos.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(data?.error?.message || `Drive HTTP ${res.status}`);
  return data.id;
}

// Upload one file → a version under `track`. Appends locally on success.
async function portalUploadOneVersion(file, track, label, favorita) {
  const { peaks, duration } = await generatePeaks(file);
  const driveFileId = await portalUploadToDrive(file, `${label} - ${file.name}`);
  const res = await fetch(`${API_BASE}/portal/admin/version`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ trackId: track.id, label, favorita, duracion: duration, peaks, driveFileId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (favorita) track.versions.forEach((v) => { v.favorita = false; });
  track.versions.push({ id: data.id, name: label, favorita, visible: true, duracion: duration, fecha: '', driveFileId, peaks });
  renderPortalTracks(portalActiveQuote.tracks);
}

const fileStem = (name) => String(name || 'audio').replace(/\.[^.]+$/, '');

async function uploadPortalVersion() {
  if (!portalActiveQuote) return;
  const trackName = (document.getElementById('portal-track-name')?.value || '').trim();
  const label = (document.getElementById('portal-version-label')?.value || '').trim();
  const favorita = Boolean(document.getElementById('portal-version-favorita')?.checked);
  const asSongs = Boolean(document.getElementById('portal-bulk-songs')?.checked);
  const fileInput = document.getElementById('portal-version-file');
  const files = Array.from(fileInput?.files || []);

  if (!files.length) return portalUploadStatus('Elegí uno o más archivos de audio.');
  if (!asSongs && !trackName) return portalUploadStatus('Poné el nombre de la canción (o marcá "cada archivo es una canción distinta").');

  const btn = document.getElementById('portal-upload-btn');
  if (btn) btn.disabled = true;
  const multi = files.length > 1;
  let ok = 0, failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    portalUploadStatus(`Subiendo ${i + 1}/${files.length}: ${file.name}…`);
    try {
      let track, verLabel;
      if (asSongs) {
        track = await portalEnsureTrack(fileStem(file.name));   // each file → its own song
        verLabel = label || 'Versión';
      } else {
        track = await portalEnsureTrack(trackName);             // all files → versions of one song
        verLabel = multi ? fileStem(file.name) : (label || fileStem(file.name));
      }
      // favorita only applies to a single-file upload
      await portalUploadOneVersion(file, track, verLabel, multi ? false : favorita);
      ok++;
    } catch (e) {
      failed++;
      portalNotify(`Falló ${file.name}: ${(e?.message || e)}`, true);
    }
  }

  portalUploadStatus('');
  if (ok) portalNotify(ok === 1 ? 'Versión subida.' : `${ok} archivo(s) subido(s).` + (failed ? ` ${failed} fallaron.` : ''));
  if (fileInput) fileInput.value = '';
  document.getElementById('portal-version-label').value = '';
  document.getElementById('portal-version-favorita').checked = false;
  if (btn) btn.disabled = false;
}
// ──────────────────────────────────────────────────────────────────────────────

init();
