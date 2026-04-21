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

let googleTokenClient = null;
let googleAccessToken = '';
let googleProfile = null;
let googleInitInterval = null;
let googleTokenExpiryAt = 0;
let googleTokenRefreshTimer = null;
let googleLastRequestInteractive = true;
let isAuthenticated = false;
let contactsCache = [];
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
            <div class="actions">
              ${canClose ? `<button class="mini-btn" data-task-done="${t.id}">Terminar</button>` : ''}
              <button class="mini-btn" data-task-edit="${t.id}">Editar</button>
              <button class="mini-btn" data-task-delete="${t.id}">Borrar</button>
            </div>
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
        .map((m) => `
          <li>
            <strong>${escapeHtml(m.author || 'Anónimo')}</strong> ·
            <span>${escapeHtml(m.text || 'Sin mensaje')}</span>
          </li>
        `)
        .join('')
    : '<li>Sin mensajes destacados.</li>';

  list.innerHTML = rows
    .map((m) => {
      const author = m.author ? `Por: ${m.author}` : 'Por: Anónimo';
      const created = m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString('es-MX')}` : '';
      const label = m.highlighted ? 'Quitar destacado' : 'Destacar';
      const isMine = m.authorEmail && myEmail && m.authorEmail === myEmail;
      return `
        <li>
          <div class="chat-bubble ${isMine ? 'mine' : ''}">
            <div class="chat-header">
              <div class="task-meta">${author}${created}</div>
              <button class="mini-btn" data-message-feature="${m.id}" data-message-state="${m.highlighted ? '1' : '0'}">${label}</button>
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

  const clearBtn = document.getElementById('clear-messages-log');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !isAdminUser());
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
      authorEmail: item.authorEmail || '',
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
  bindClick('message-create', createMessage);
  bindClick('clear-messages-log', clearMessagesLog);
  bindClick('refresh-catalog', () => loadCatalogFromApi());
  bindClick('refresh-contacts', () => loadContactsFromNotion());
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
}

function init() {
  loadAppVersion();
  setShareActions();
  setLinks();
  clearSensitiveData();
  refreshAssigneeOptions();
  resetTaskForm();
  setTaskFormVisibility(false);
  setupTabs();
  setupActions();
  setAuthenticated(false);
  initGoogleOAuth();
  autoLoginOnLoad();
}

init();
