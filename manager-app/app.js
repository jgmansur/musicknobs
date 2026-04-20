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

const cfg = window.MANAGER_APP_CONFIG || {};
const API_BASE = (cfg.apiBaseUrl || '').replace(/\/$/, '');
const API_TOKEN = cfg.apiToken || '';
const GOOGLE_CLIENT_ID = cfg.googleClientId || '';
const GOOGLE_SCOPES = 'openid email profile';

let googleTokenClient = null;
let googleAccessToken = '';
let googleProfile = null;

const catalogSample = [
  { obra: 'Tema Demo 1', autores: 'Jay Mansur', generos: 'Regional Mexicano', drive: '#' },
  { obra: 'Tema Demo 2', autores: 'Jay Mansur, Alejandro De Nigris', generos: 'Pop', drive: '#' }
];

const contactsSample = [
  { nombre: 'Ricardo Calanda', rol: 'Manager', correo: 'ricardo.calanda@gmail.com' },
  { nombre: 'Xeronimo Mansur', rol: 'Compositor/Productor', correo: 'xeronimo3@gmail.com' }
];

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`;
  return h;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: apiHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function setShareActions() {
  const subject = encodeURIComponent('Jay Mansur · Perfil para Manager');
  const body = encodeURIComponent(
    `Te comparto el perfil de ${profile.name}\n` +
    `Sitio: ${profile.website}\n` +
    `Contacto: ${profile.email}`
  );
  document.getElementById('mail-share').href = `mailto:?subject=${subject}&body=${body}`;

  const waText = encodeURIComponent(
    `Perfil Manager de ${profile.name}\n${profile.website}\nContacto: ${profile.email}`
  );
  document.getElementById('wa-share').href = `https://wa.me/?text=${waText}`;
}

function setLinks() {
  const list = document.getElementById('links-list');
  list.innerHTML = profile.links
    .map(([name, url]) => `<li><a href="${url}" target="_blank" rel="noopener">${name}</a></li>`)
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

function setContacts(rows = contactsSample) {
  const list = document.getElementById('contacts-list');
  list.innerHTML = rows
    .map((c) => `<li><strong>${c.nombre}</strong> · ${c.rol} · <a href="mailto:${c.correo}">${c.correo}</a></li>`)
    .join('');
}

function setOauthStatus(text, isError = false) {
  const el = document.getElementById('oauth-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#fda4af' : '';
}

async function loadContactsFromNotion() {
  try {
    if (!API_BASE) throw new Error('apiBaseUrl no configurado');
    const res = await fetchJson(`${API_BASE}/api/manager/contacts`);
    const rows = (res.data || []).map((item) => ({
      nombre: item.nombre || 'Sin nombre',
      rol: item.rol || '—',
      correo: item.correo || ''
    }));
    setContacts(rows.length ? rows : contactsSample);
  } catch (e) {
    console.warn('No se pudieron cargar contactos desde Notion API:', e);
    setContacts(contactsSample);
  }
}

async function loadCatalogFromApi() {
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
  } catch (e) {
    console.warn('No se pudo cargar catálogo desde API:', e);
    setCatalog(catalogSample);
  }
}

function initGoogleOAuth() {
  if (!window.google?.accounts?.oauth2 || !GOOGLE_CLIENT_ID) {
    setOauthStatus('OAuth no disponible (falta clientId/config).', true);
    return;
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
        setOauthStatus(`Conectado: ${googleProfile.email || googleProfile.name || 'usuario'}`);
      } catch (e) {
        setOauthStatus('Conectado con Google (sin perfil).');
      }
    }
  });
  setOauthStatus('Listo para conectar con Google.');
}

function requestGoogleToken() {
  if (!googleTokenClient) {
    setOauthStatus('OAuth no inicializado.', true);
    return;
  }
  googleTokenClient.requestAccessToken({ prompt: 'consent' });
}

function signOutGoogle() {
  if (window.google?.accounts?.oauth2 && googleAccessToken) {
    window.google.accounts.oauth2.revoke(googleAccessToken, () => {
      googleAccessToken = '';
      googleProfile = null;
      setOauthStatus('Sesión cerrada.');
    });
    return;
  }
  googleAccessToken = '';
  googleProfile = null;
  setOauthStatus('Sesión cerrada.');
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
  document.getElementById('print-btn').addEventListener('click', () => window.print());
  document.getElementById('google-auth').addEventListener('click', requestGoogleToken);
  document.getElementById('google-signout').addEventListener('click', signOutGoogle);
  document.getElementById('refresh-catalog').addEventListener('click', () => loadCatalogFromApi());
  document.getElementById('refresh-contacts').addEventListener('click', () => loadContactsFromNotion());
}

function init() {
  setShareActions();
  setLinks();
  setCatalog();
  setContacts();
  setupTabs();
  setupActions();
  initGoogleOAuth();
  loadCatalogFromApi();
  loadContactsFromNotion();
}

init();
