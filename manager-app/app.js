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

let googleTokenClient = null;
let googleAccessToken = '';
let googleProfile = null;
let googleInitInterval = null;
let isAuthenticated = false;
let contactsCache = [];
let tasksCache = [];
let messagesCache = [];

const catalogSample = [
  { obra: 'Tema Demo 1', autores: 'Jay Mansur', generos: 'Regional Mexicano', drive: '#' },
  { obra: 'Tema Demo 2', autores: 'Jay Mansur, Alejandro De Nigris', generos: 'Pop', drive: '#' }
];

const contactsSample = [
  {
    nombre: 'Ricardo Calanda',
    rol: 'Manager',
    correo: 'ricardo.calanda@gmail.com',
    telefono: '',
    whatsapp: ''
  },
  {
    nombre: 'Xeronimo Mansur',
    rol: 'Compositor/Productor',
    correo: 'xeronimo3@gmail.com',
    telefono: '',
    whatsapp: ''
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

function setCatalog(rows = catalogSample) {
  const body = document.getElementById('catalog-body');
  body.innerHTML = rows
    .map((r) => `
      <tr>
        <td>${r.obra}</td>
        <td>${r.autores}</td>
        <td>${r.generos}</td>
        <td><a href="${r.drive}" target="_blank" rel="noopener">Abrir</a></td>
      </tr>
    `)
    .join('');
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
      return `
        <li>
          <div class="task-row">
            <div>
              <strong>${t.title || 'Sin título'}</strong>
              <div class="task-meta">${assignee}${due} · Estatus: ${status}</div>
            </div>
            ${canClose ? `<button class="mini-btn" data-task-done="${t.id}">Terminar</button>` : ''}
          </div>
        </li>
      `;
    })
    .join('');

  list.querySelectorAll('[data-task-done]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await markTaskDone(btn.dataset.taskDone || '');
    });
  });
}

function setMessages(rows = []) {
  messagesCache = rows;
  const list = document.getElementById('messages-list');
  const featuredList = document.getElementById('messages-featured');
  if (!list || !featuredList) return;

  const featured = rows.filter((m) => Boolean(m.highlighted));

  featuredList.innerHTML = featured.length
    ? featured
        .map((m) => `
          <li>
            <strong>${m.author || 'Anónimo'}</strong> ·
            <span>${m.text || 'Sin mensaje'}</span>
          </li>
        `)
        .join('')
    : '<li>Sin mensajes destacados.</li>';

  list.innerHTML = rows
    .map((m) => {
      const author = m.author ? `Por: ${m.author}` : 'Por: Anónimo';
      const created = m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString('es-MX')}` : '';
      const label = m.highlighted ? 'Quitar destacado' : 'Destacar';
      return `
        <li>
          <div class="message-row">
            <div>
              <div class="message-text">${m.text || 'Sin mensaje'}</div>
              <div class="task-meta">${author}${created}</div>
            </div>
            <button class="mini-btn" data-message-feature="${m.id}" data-message-state="${m.highlighted ? '1' : '0'}">${label}</button>
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
}

function refreshAssigneeOptions() {
  const select = document.getElementById('task-assignee');
  if (!select) return;
  const current = select.value;
  const options = contactsCache
    .map((c) => (c.nombre || '').trim())
    .filter(Boolean);

  select.innerHTML = `<option value="">Asignar a...</option>${options
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('')}`;

  if (options.includes(current)) select.value = current;
}

function setContacts(rows = contactsSample) {
  contactsCache = rows;
  const list = document.getElementById('contacts-list');
  list.innerHTML = rows
    .map((c) => {
      const role = c.rol || 'Contacto';
      const email = c.correo ? `<a href="mailto:${c.correo}">${c.correo}</a>` : '';
      const phone = c.telefono || '';
      const whatsapp = c.whatsapp ? `<a href="${c.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>` : '';
      const parts = [role, email, phone, whatsapp].filter(Boolean).join(' · ');
      return `<li><strong>${c.nombre}</strong>${parts ? ` · ${parts}` : ''}</li>`;
    })
    .join('');

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
    callback: async (resp) => {
      if (resp?.error) {
        setOauthStatus(`Error OAuth: ${resp.error}`, true);
        return;
      }
      googleAccessToken = resp.access_token || '';
      try {
        const infoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${googleAccessToken}` }
        });
        if (!infoResp.ok) throw new Error(`userinfo ${infoResp.status}`);
        googleProfile = await infoResp.json();
        setAuthenticated(true);
        setOauthStatus(`Conectado: ${googleProfile.email || googleProfile.name || 'usuario'}`);
      } catch {
        setAuthenticated(true);
        setOauthStatus('Conectado con Google (sin perfil).');
      }
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
    const rows = (res.data || []).map((item) => ({
      nombre: item.nombre || 'Sin nombre',
      rol: item.rol || '—',
      correo: item.correo || '',
      telefono: item.telefono || '',
      whatsapp: item.whatsapp || ''
    }));
    setContacts(rows.length ? rows : contactsSample);
    const source = res.source || 'api';
    if (source === 'fallback') {
      setStatus('contacts-status', `${rows.length} contactos cargados (fallback local del backend).`);
      return;
    }
    setStatus('contacts-status', rows.length ? `${rows.length} contactos cargados desde Notion API.` : 'API sin contactos, usando muestra local.');
  } catch (e) {
    console.warn('No se pudieron cargar contactos desde Notion API:', e);
    setContacts(contactsSample);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('contacts-status', `Sin conexión a Notion/API: ${reason}`, true);
  }
}

async function loadTasksFromApi() {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/tasks`);
    const rows = (res.data || []).map((item) => ({
      id: item.id || '',
      title: item.title || 'Sin título',
      assignee: item.assignee || '',
      dueDate: item.dueDate || '',
      status: item.status || 'Pendiente'
    }));
    setTasks(rows);
    setStatus('tasks-status', rows.length ? `${rows.length} tasks cargadas.` : 'No hay tasks todavía.');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setTasks([]);
    setStatus('tasks-status', `No se pudieron cargar tasks: ${reason}`, true);
  }
}

async function createTask() {
  if (!isAuthenticated) return;
  const titleEl = document.getElementById('task-title');
  const assigneeEl = document.getElementById('task-assignee');
  const dueEl = document.getElementById('task-due');
  if (!titleEl || !assigneeEl || !dueEl) return;

  const title = String(titleEl.value || '').trim();
  if (!title) {
    setStatus('tasks-status', 'Escribe un título para la task.', true);
    return;
  }

  try {
    const payload = {
      title,
      assignee: String(assigneeEl.value || '').trim(),
      dueDate: String(dueEl.value || '').trim()
    };

    const r = await fetch(`${API_BASE}/api/manager/tasks`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    titleEl.value = '';
    dueEl.value = '';
    setStatus('tasks-status', 'Task creada correctamente.');
    await loadTasksFromApi();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('tasks-status', `Error al crear task: ${reason}`, true);
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

async function loadCatalogFromApi() {
  if (!isAuthenticated) return;
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/catalog`);
    const rows = (res.data || []).map((item) => ({
      obra: item.obra || 'Sin título',
      autores: item.autores || '—',
      generos: item.generos || '—',
      drive: item.drive || '#'
    }));
    setCatalog(rows.length ? rows : catalogSample);
    setStatus('catalog-status', rows.length ? `${rows.length} canciones cargadas desde API.` : 'API sin catálogo, usando muestra local.');
  } catch (e) {
    console.warn('No se pudo cargar catálogo desde API:', e);
    setCatalog(catalogSample);
    const reason = e instanceof Error ? e.message : String(e);
    setStatus('catalog-status', `Sin conexión a catálogo/API: ${reason}`, true);
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
      highlighted: Boolean(item.highlighted),
      createdAt: item.createdAt || ''
    }));
    setMessages(rows);
    setStatus('messages-status', rows.length ? `${rows.length} mensajes cargados.` : 'No hay anuncios todavía.');
  } catch (e) {
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

  try {
    const r = await fetch(`${API_BASE}/api/manager/messages`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ text, author })
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
    googleTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    return true;
  } catch {
    setOauthStatus('No se pudo abrir Google OAuth. Reintenta.', true);
    return;
  }
}

function startGoogleLogin({ auto = false } = {}) {
  if (ensureGoogleOAuthClient()) {
    requestGoogleTokenWithMode({ interactive: true });
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
      requestGoogleTokenWithMode({ interactive: true });
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
  if (googleAccessToken || googleProfile || isAuthenticated) return;
  setTimeout(() => startGoogleLogin({ auto: true }), 350);
}

function signOutGoogle() {
  if (window.google?.accounts?.oauth2 && googleAccessToken) {
    window.google.accounts.oauth2.revoke(googleAccessToken, () => {
      googleAccessToken = '';
      googleProfile = null;
      setAuthenticated(false);
      setOauthStatus('Sesión cerrada.');
    });
    return;
  }
  googleAccessToken = '';
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
  document.getElementById('google-auth-toggle').addEventListener('click', handleAuthToggle);
  document.getElementById('auth-gate-login').addEventListener('click', startGoogleLogin);
  document.getElementById('refresh-messages').addEventListener('click', () => loadMessagesFromApi());
  document.getElementById('message-create').addEventListener('click', createMessage);
  document.getElementById('refresh-catalog').addEventListener('click', () => loadCatalogFromApi());
  document.getElementById('refresh-contacts').addEventListener('click', () => loadContactsFromNotion());
  document.getElementById('refresh-links').addEventListener('click', () => loadLinksFromApi());
  document.getElementById('refresh-tasks').addEventListener('click', () => loadTasksFromApi());
  document.getElementById('task-create').addEventListener('click', createTask);
}

function init() {
  loadAppVersion();
  setShareActions();
  setLinks();
  clearSensitiveData();
  setupTabs();
  setupActions();
  setAuthenticated(false);
  initGoogleOAuth();
  autoLoginOnLoad();
}

init();
