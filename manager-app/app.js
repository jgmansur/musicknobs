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
let contactsVisibleCount = 12;
let messagesVisibleCount = 20;
let catalogVisibleCount = 20;

const CONTACTS_PAGE_STEP = 12;
const MESSAGES_PAGE_STEP = 20;
const CATALOG_PAGE_STEP = 20;

function isLocalDevHost() {
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
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

const catalogSample = [
  { obra: 'Tema Demo 1', autores: 'Jay Mansur', generos: 'Regional Mexicano', drive: 'https://drive.google.com/file/d/1abCDefghIJkLmNoPqRsTUvwxYZ/view?usp=sharing' },
  { obra: 'Tema Demo 2', autores: 'Jay Mansur, Alejandro De Nigris', generos: 'Pop', drive: 'https://www.dropbox.com/scl/fi/demo-track.mp3?dl=0' }
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

function parseCatalogGenres(value) {
  return String(value || '')
    .split(/[,|/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function resolvePlayableAudioUrl(raw) {
  const input = String(raw || '').trim();
  if (!input || input === '#') return '';

  try {
    const u = new URL(input);

    if (u.hostname.includes('drive.google.com')) {
      const match = u.pathname.match(/\/file\/d\/([^/]+)/);
      const id = match?.[1] || u.searchParams.get('id') || '';
      if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    }

    if (u.hostname.includes('dropbox.com')) {
      u.searchParams.set('raw', '1');
      u.searchParams.delete('dl');
      return u.toString();
    }

    return u.toString();
  } catch {
    return input;
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
  card.innerHTML = `
    <div class="catalog-now-card-inner">
      <h4>${escapeHtml(song.obra || 'Sin título')}</h4>
      <p><strong>Compositores:</strong> ${escapeHtml(song.autores || '—')}</p>
      <p><strong>Géneros:</strong> ${escapeHtml(song.generos || '—')}</p>
      <p><strong>Enlace:</strong> ${share}</p>
    </div>
  `;
  card.classList.remove('hidden');
}

function getCurrentCatalogSong() {
  return catalogCache.find((s) => s.id === catalogNowPlayingId) || null;
}

function renderCatalog() {
  const genresEl = document.getElementById('catalog-genres');
  const songsEl = document.getElementById('catalog-songs');
  const selectedGenreEl = document.getElementById('catalog-selected-genre');
  const playingNowBtn = document.getElementById('catalog-playing-now');
  const playingNowTitle = document.getElementById('catalog-playing-now-title');
  if (!genresEl || !songsEl || !selectedGenreEl || !playingNowBtn || !playingNowTitle) return;

  const genres = Array.from(new Set(catalogCache.flatMap((row) => parseCatalogGenres(row.generos))));
  const allGenres = ['Todas', ...genres.sort((a, b) => a.localeCompare(b, 'es'))];
  if (!allGenres.includes(catalogGenreFilter)) catalogGenreFilter = 'Todas';

  genresEl.innerHTML = allGenres
    .map((g) => `
      <li>
        <button class="mini-btn ${catalogGenreFilter === g ? 'active' : ''}" data-catalog-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>
      </li>
    `)
    .join('');

  const visibleSongs = catalogGenreFilter === 'Todas'
    ? catalogCache
    : catalogCache.filter((row) => parseCatalogGenres(row.generos).includes(catalogGenreFilter));
  const pagedSongs = visibleSongs.slice(0, catalogVisibleCount);

  selectedGenreEl.textContent = catalogGenreFilter;

  songsEl.innerHTML = pagedSongs.length
    ? pagedSongs
        .map((row) => `
          <li>
            <div class="catalog-song-row">
              <button class="catalog-song-main" data-catalog-play="${escapeHtml(row.id)}">
                <strong>${escapeHtml(row.obra || 'Sin título')}</strong>
                <span>${escapeHtml(row.autores || '—')}</span>
              </button>
              <div class="actions">
                <button class="mini-btn" data-catalog-share="${escapeHtml(row.id)}">Compartir</button>
              </div>
            </div>
          </li>
        `)
        .join('')
    : '<li>Sin canciones en este género.</li>';

  const catalogLoadMoreBtn = document.getElementById('catalog-load-more');
  if (catalogLoadMoreBtn) {
    const canLoadMore = visibleSongs.length > pagedSongs.length;
    catalogLoadMoreBtn.disabled = !canLoadMore;
    catalogLoadMoreBtn.textContent = canLoadMore ? 'Cargar más' : 'Sin más';
  }

  genresEl.querySelectorAll('[data-catalog-genre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      catalogGenreFilter = btn.dataset.catalogGenre || 'Todas';
      catalogVisibleCount = CATALOG_PAGE_STEP;
      renderCatalog();
    });
  });

  songsEl.querySelectorAll('[data-catalog-play]').forEach((btn) => {
    btn.addEventListener('click', () => playCatalogSong(btn.dataset.catalogPlay || ''));
  });

  songsEl.querySelectorAll('[data-catalog-share]').forEach((btn) => {
    btn.addEventListener('click', () => shareCatalogSong(btn.dataset.catalogShare || ''));
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
      drive: String(row.drive || '').trim()
    }))
    .filter((row) => Boolean(row.obra || row.drive));

  catalogCache = normalized;
  if (catalogNowPlayingId && !catalogCache.some((row) => row.id === catalogNowPlayingId)) {
    catalogNowPlayingId = '';
    catalogNowCardOpen = false;
  }

  if (!catalogCache.length) {
    const audio = document.getElementById('catalog-audio');
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }

  renderCatalog();
}

async function shareCatalogSong(songId) {
  const song = catalogCache.find((row) => row.id === songId);
  if (!song || !song.drive) {
    setStatus('catalog-status', 'Esta canción no tiene link para compartir.', true);
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
      setStatus('catalog-status', `Link compartido: ${song.obra || 'canción'}.`);
      return;
    }

    await navigator.clipboard.writeText(song.drive);
    setStatus('catalog-status', `Link copiado al portapapeles: ${song.obra || 'canción'}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `No se pudo compartir: ${reason}`, true);
  }
}

function playCatalogSong(songId) {
  const song = catalogCache.find((row) => row.id === songId);
  if (!song) return;

  const audio = document.getElementById('catalog-audio');
  if (!audio) return;

  const playable = resolvePlayableAudioUrl(song.drive);
  if (!playable) {
    setStatus('catalog-status', 'Esta canción no tiene URL reproducible.', true);
    return;
  }

  catalogNowPlayingId = song.id;
  catalogNowCardOpen = false;
  audio.src = playable;
  audio.play()
    .then(() => {
      setStatus('catalog-status', `Reproduciendo: ${song.obra || 'canción'}.`);
      renderCatalog();
    })
    .catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      setStatus('catalog-status', `No se pudo reproducir audio: ${reason}`, true);
      renderCatalog();
    });
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
  setCatalog([]);
  setContacts([]);
  setTasks([]);
  setMessages([]);
  setLinks([]);
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

function setAuthenticated(value) {
  isAuthenticated = Boolean(value);
  setAuthGate(!isAuthenticated);

  const toggleBtn = document.getElementById('google-auth-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = isAuthenticated ? 'Cerrar sesión' : 'Login Google';
  }

  if (isAuthenticated) {
    loadMessagesFromApi();
    loadCatalogFromApi();
    loadContactsFromNotion();
    loadTasksFromApi();
    loadLinksFromApi();
    return;
  }

  tasksNextCursor = '';
  tasksHasMore = false;
  clearSensitiveData();
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
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/catalog?sync=1`);
    const rows = (res.data || []).map((item, i) => ({
      id: item.id || `song-api-${i + 1}`,
      obra: item.obra || 'Sin título',
      autores: item.autores || '—',
      generos: item.generos || '—',
      drive: item.drive || '#'
    }));
    catalogVisibleCount = CATALOG_PAGE_STEP;
    setCatalog(rows.length ? rows : catalogSample);
    setStatus('catalog-status', rows.length ? `${rows.length} canciones cargadas y sincronizadas.` : 'API sin catálogo, usando muestra local.');
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
  if (!isAuthenticated) return;
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
  setTimeout(() => startGoogleLogin({ auto: true }), 350);
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
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
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
  bindClick('catalog-sync', () => syncCatalogNow());
  bindClick('catalog-load-more', () => {
    catalogVisibleCount += CATALOG_PAGE_STEP;
    renderCatalog();
  });
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
  loadAppVersion();
  setShareActions();
  setLinks();
  clearSensitiveData();
  resetContactForm();
  setContactFormVisibility(false);
  refreshAssigneeOptions();
  resetTaskForm();
  setTaskFormVisibility(false);
  setupTabs();
  setupActions();
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
