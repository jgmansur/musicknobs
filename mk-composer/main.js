// =============================================
// MK COMPOSER — main.js
// =============================================

const APP_VERSION = 'v1.0.3';
const CLIENT_ID   = '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com';
const SCOPES      = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const TOKEN_KEY      = 'mkcomposer_token_v1';
const EXPIRY_KEY     = 'mkcomposer_expiry_v1';
const USER_KEY       = 'mkcomposer_user_v1';
const GROQ_KEY_STORE = 'mkcomposer_groq_key_v1';
const SESSIONS_KEY   = 'mkcomposer_sessions_v1';
const CONFIG_KEY     = 'mkcomposer_config_v1';

const ALLOWED_EMAIL  = 'jgmansur2@gmail.com';

// =============================================
// STATE
// =============================================
let accessToken       = localStorage.getItem(TOKEN_KEY) || '';
let tokenExpiry       = Number(localStorage.getItem(EXPIRY_KEY) || 0);
let currentUser       = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let tokenClient       = null;
let currentTab        = 'composer';
let activeSession     = null;   // the session currently open in the editor
let suggestionTimeout = null;
let currentSuggestion = '';
let isStreaming       = false;
let autoSaveTimeout   = null;

// =============================================
// HELPERS
// =============================================
function showToast(msg, dur = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
}

function getConfig() {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{"model":"llama-3.1-70b-versatile","defaultGenre":""}');
}
function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function getGroqKey() {
    return localStorage.getItem(GROQ_KEY_STORE) || '';
}

// =============================================
// GOOGLE AUTH
// =============================================
function isTokenValid() {
    return accessToken && Date.now() < tokenExpiry - 60_000;
}

function clearAuthCache() {
    accessToken = '';
    tokenExpiry = 0;
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(USER_KEY);
}

function showLoginModal() {
    document.getElementById('modal-backdrop').classList.add('visible');
    document.getElementById('modal-login').classList.add('visible');
}
function hideLoginModal() {
    document.getElementById('modal-backdrop').classList.remove('visible');
    document.getElementById('modal-login').classList.remove('visible');
}

async function fetchUserInfo(token) {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

function requestToken(interactive = true) {
    if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (res) => {
                if (!res?.access_token) { showToast('Error al autenticar'); return; }
                accessToken = res.access_token;
                const expiresIn = Number(res.expires_in) || 3600;
                tokenExpiry = Date.now() + expiresIn * 1000;
                localStorage.setItem(TOKEN_KEY, accessToken);
                localStorage.setItem(EXPIRY_KEY, String(tokenExpiry));

                // Fetch user info & validate
                const user = await fetchUserInfo(accessToken);
                if (!user) { showToast('No se pudo obtener perfil'); return; }
                if (user.email !== ALLOWED_EMAIL) {
                    showToast('Cuenta no autorizada');
                    clearAuthCache();
                    return;
                }
                currentUser = user;
                localStorage.setItem(USER_KEY, JSON.stringify(user));
                hideLoginModal();
                onAuthReady();
            }
        });
    }
    if (interactive) tokenClient.requestAccessToken({ prompt: 'consent' });
    else tokenClient.requestAccessToken({ prompt: '' });
}

function startGoogleLogin() {
    if (window.google?.accounts?.oauth2) { requestToken(true); return; }
    const btn = document.getElementById('login-google-btn');
    btn.textContent = 'Cargando...'; btn.disabled = true;
    const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(iv);
            btn.textContent = 'Iniciar Sesión con Google'; btn.disabled = false;
            requestToken(true);
        }
    }, 200);
    setTimeout(() => { clearInterval(iv); btn.textContent = 'Reintenta'; btn.disabled = false; }, 10000);
}

function logout() {
    clearAuthCache();
    if (window.google?.accounts?.oauth2 && accessToken) {
        google.accounts.oauth2.revoke(accessToken);
    }
    showLoginModal();
}

// =============================================
// TABS
// =============================================
function showTab(name) {
    if (currentTab === name) return;
    currentTab = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const view = document.getElementById(`view-${name}`);
    const btn  = document.getElementById(`tab-${name}`);
    if (view) view.classList.add('active');
    if (btn)  btn.classList.add('active');
    if (name === 'sessions') renderSessions();
    if (name === 'config')   renderConfig();
}

// =============================================
// SESSIONS
// =============================================
const GENRE_EMOJI = {
    'Pop': '🎤', 'Rock': '🎸', 'Hip-Hop': '🎧', 'Reggaeton': '🔥',
    'Corrido': '🤠', 'Banda': '🎺', 'R&B': '🎷', 'Folk': '🪕',
    'Cumbia': '💃', 'Balada': '🎹', 'Otro': '🎵', '': '🎵'
};

function getSessions() {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
}
function saveSessions(sessions) {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function createSession(setupData) {
    return {
        id: 'session_' + Date.now(),
        title: setupData.tema || 'Sin título',
        genre: setupData.genre || 'Pop',
        tema: setupData.tema || '',
        mood: setupData.mood || 'Romántico',
        rima: setupData.rima || 'Libre',
        tempo: setupData.tempo || 'Medio',
        extraContext: setupData.extraContext || '',
        lyrics: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function openSession(session) {
    activeSession = session;

    // Show composer
    document.getElementById('composer-empty').style.display = 'none';
    document.getElementById('composer-active').style.display = 'block';

    // Editor title
    document.getElementById('editor-session-title').textContent = session.title || 'Sin título';

    // Context pills
    const bar = document.getElementById('context-bar');
    bar.innerHTML = `
        <span class="context-pill">${GENRE_EMOJI[session.genre] || '🎵'} ${session.genre}</span>
        ${session.tema ? `<span class="context-pill yellow">📝 ${session.tema}</span>` : ''}
        <span class="context-pill blue">${session.mood}</span>
        <span class="context-pill">Rima ${session.rima}</span>
        <span class="context-pill">${session.tempo}</span>
    `;

    // Load lyrics into editor
    const editor = document.getElementById('editor-input');
    clearGhostSuggestion();
    editor.textContent = session.lyrics || '';

    // Place cursor at end
    setCursorToEnd();
    updateEditorStat();
    showTab('composer');
}

function autoSave() {
    if (!activeSession) return;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        const lyrics = getEditorText();
        activeSession.lyrics = lyrics;
        activeSession.updatedAt = new Date().toISOString();
        const sessions = getSessions();
        const idx = sessions.findIndex(s => s.id === activeSession.id);
        if (idx >= 0) sessions[idx] = activeSession;
        else sessions.unshift(activeSession);
        saveSessions(sessions);
    }, 800);
}

function deleteSession(id) {
    const sessions = getSessions().filter(s => s.id !== id);
    saveSessions(sessions);
    if (activeSession?.id === id) {
        activeSession = null;
        document.getElementById('composer-empty').style.display = 'block';
        document.getElementById('composer-active').style.display = 'none';
    }
    renderSessions();
    showToast('Canción eliminada');
}

function renderSessions() {
    const sessions = getSessions();
    const list = document.getElementById('sessions-list');
    if (!sessions.length) {
        list.innerHTML = '<div class="empty-sessions"><span class="emoji">🎵</span>No hay canciones guardadas aún</div>';
        return;
    }
    list.innerHTML = sessions.map(s => {
        const date = new Date(s.updatedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
        const words = s.lyrics ? s.lyrics.trim().split(/\s+/).length : 0;
        const preview = s.lyrics ? s.lyrics.split('\n').find(l => l.trim()) || '' : '';
        return `
        <div class="session-card" onclick="window._openSessionById('${s.id}')">
            <div class="session-emoji">${GENRE_EMOJI[s.genre] || '🎵'}</div>
            <div class="session-info">
                <div class="session-name">${escapeHtml(s.title || 'Sin título')}</div>
                <div class="session-meta">${s.genre} · ${s.mood} · ${date} · ${words} palabras</div>
                ${preview ? `<div class="session-preview">${escapeHtml(preview.slice(0, 60))}${preview.length > 60 ? '…' : ''}</div>` : ''}
            </div>
            <div class="session-actions">
                <span class="session-pill">${s.rima}</span>
                <button class="btn-danger" onclick="event.stopPropagation();window._deleteSession('${s.id}')" style="padding:.3rem .6rem;font-size:.72rem;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

window._openSessionById = (id) => {
    const s = getSessions().find(s => s.id === id);
    if (s) openSession(s);
};
window._deleteSession = deleteSession;

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =============================================
// SESSION SETUP MODAL
// =============================================
function showSetupModal() {
    const cfg = getConfig();
    if (cfg.defaultGenre) document.getElementById('setup-genre').value = cfg.defaultGenre;
    document.getElementById('setup-tema').value = '';
    document.getElementById('setup-context').value = '';
    document.getElementById('modal-backdrop').classList.add('visible');
    document.getElementById('modal-session-setup').classList.add('visible');
    setTimeout(() => document.getElementById('setup-tema').focus(), 100);
}
function hideSetupModal() {
    document.getElementById('modal-backdrop').classList.remove('visible');
    document.getElementById('modal-session-setup').classList.remove('visible');
}
function startSession() {
    const tema  = document.getElementById('setup-tema').value.trim();
    const genre = document.getElementById('setup-genre').value;
    const mood  = document.getElementById('setup-mood').value;
    const rima  = document.getElementById('setup-rima').value;
    const tempo = document.getElementById('setup-tempo').value;
    const extra = document.getElementById('setup-context').value.trim();

    if (!tema) { showToast('Escribe el tema de la canción'); return; }

    hideSetupModal();
    const session = createSession({ tema, genre, mood, rima, tempo, extraContext: extra });

    // Save immediately
    const sessions = getSessions();
    sessions.unshift(session);
    saveSessions(sessions);

    openSession(session);
    showToast(`🎵 "${tema}" lista para componer`);
}

// =============================================
// EDITOR — GHOST TEXT
// =============================================
function getEditorText() {
    const editor = document.getElementById('editor-input');
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.ghost-suggestion').forEach(el => el.remove());
    // Normalize BRs and divs to newlines
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('div, p').forEach(el => {
        if (el.previousSibling) el.prepend('\n');
    });
    return clone.textContent;
}

function setCursorToEnd() {
    const editor = document.getElementById('editor-input');
    const range = document.createRange();
    const sel   = window.getSelection();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
}

function showGhostSuggestion(text) {
    clearGhostSuggestion();
    if (!text) return;
    currentSuggestion = text;

    const bar  = document.getElementById('suggestion-hint');
    const hint = document.getElementById('hint-text');
    bar.classList.add('has-suggestion');
    hint.innerHTML = `<span class="suggestion-preview">${escapeHtml(text)}</span><span class="hint-actions">&nbsp;&nbsp;<span class="kbd">Tab</span> aceptar&nbsp;<span class="kbd">Esc</span> saltar</span>`;
}

function clearGhostSuggestion() {
    currentSuggestion = '';
    const bar  = document.getElementById('suggestion-hint');
    const hint = document.getElementById('hint-text');
    if (bar)  bar.classList.remove('has-suggestion');
    if (hint) hint.textContent = 'Escribe y la IA sugerirá la siguiente línea…';
}

function acceptGhostSuggestion() {
    if (!currentSuggestion) return;
    const text = currentSuggestion;
    clearGhostSuggestion();
    const editor = document.getElementById('editor-input');
    // Append the suggestion as plain text + newline
    const textNode = document.createTextNode(text + '\n');
    editor.appendChild(textNode);
    setCursorToEnd();
    autoSave();
    updateEditorStat();
}

function updateEditorStat() {
    const text = getEditorText().trim();
    const lines = text ? text.split('\n').filter(l => l.trim()).length : 0;
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    document.getElementById('editor-stat').textContent = `${lines} líneas · ${words} palabras`;
}

function initEditor() {
    const editor = document.getElementById('editor-input');

    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (currentSuggestion) acceptGhostSuggestion();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            clearGhostSuggestion();
            clearTimeout(suggestionTimeout);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            clearGhostSuggestion();
            clearTimeout(suggestionTimeout);
            document.execCommand('insertLineBreak');
            autoSave();
            updateEditorStat();
            return;
        }
        // Any typing clears existing suggestion
        if (currentSuggestion && !e.metaKey && !e.ctrlKey && !e.altKey) {
            clearGhostSuggestion();
        }
    });

    editor.addEventListener('input', () => {
        if (!activeSession) return;
        clearTimeout(suggestionTimeout);
        autoSave();
        updateEditorStat();
        // Only request suggestion if Groq key is set
        if (!getGroqKey()) return;
        const text = getEditorText();
        // Need at least 3 words on current/last line
        const lines = text.split('\n');
        const lastLine = lines[lines.length - 1] || '';
        if (lastLine.trim().split(/\s+/).length < 2) return;
        suggestionTimeout = setTimeout(requestSuggestion, 700);
    });

    // Placeholder behavior
    editor.addEventListener('focus', () => {
        if (!editor.textContent.trim()) editor.textContent = '';
    });
}

// =============================================
// GROQ AI
// =============================================
function buildSystemPrompt(session) {
    const parts = [
        'Eres un asistente de composición de canciones profesional.',
        `Estás ayudando a componer una canción con estas características:`,
        `- Género: ${session.genre}`,
        `- Tema: ${session.tema || 'libre'}`,
        `- Mood: ${session.mood}`,
        `- Esquema de rima: ${session.rima}`,
        `- Tempo: ${session.tempo}`,
    ];
    if (session.extraContext) parts.push(`- Contexto adicional: ${session.extraContext}`);
    parts.push('');
    parts.push('INSTRUCCIONES ESTRICTAS:');
    parts.push('1. Responde ÚNICAMENTE con la siguiente línea de la letra. Sin explicaciones, sin comillas, sin prefijos.');
    parts.push('2. La línea debe ser corta (máximo 10 palabras).');
    parts.push('3. Sigue el mood, esquema de rima y estilo indicados.');
    parts.push('4. Si el esquema es AABB, la línea debe rimar con la anterior.');
    parts.push('5. Si el esquema es ABAB, rima con la línea de hace dos.');
    parts.push('6. Continúa naturalmente desde lo que ya está escrito.');
    return parts.join('\n');
}

async function requestSuggestion() {
    if (isStreaming || !activeSession) return;
    const groqKey = getGroqKey();
    if (!groqKey) return;

    const text = getEditorText().trim();
    if (!text) return;

    // Send last 6 lines as context
    const lines = text.split('\n').filter(l => l.trim());
    const context = lines.slice(-6).join('\n');

    const cfg = getConfig();
    const model = cfg.model || 'llama-3.1-70b-versatile';

    isStreaming = true;
    setAIThinking(true);

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: buildSystemPrompt(activeSession) },
                    { role: 'user', content: `Continúa la siguiente línea de esta letra:\n\n${context}\n\nSiguiente línea:` }
                ],
                max_tokens: 60,
                temperature: 0.85,
                stream: false,
            }),
        });

        if (!res.ok) { isStreaming = false; setAIThinking(false); return; }

        const data = await res.json();
        let suggestion = (data.choices?.[0]?.message?.content || '').trim();

        // Clean up common AI artifacts
        suggestion = suggestion
            .replace(/^["'"'"]|["'"'"]$/g, '')  // Remove surrounding quotes
            .replace(/^(Siguiente línea:|Línea:|Respuesta:)\s*/i, '')
            .replace(/\n.*/s, '')  // Only first line
            .trim();

        if (suggestion && suggestion.length > 2) {
            showGhostSuggestion(suggestion);
        }
    } catch (err) {
        console.warn('Groq error:', err);
    } finally {
        isStreaming = false;
        setAIThinking(false);
    }
}

function setAIThinking(on) {
    const hint = document.getElementById('hint-text');
    if (on) {
        hint.innerHTML = `<span class="ai-thinking"><span class="dot-pulse"><span></span><span></span><span></span></span> IA pensando…</span>`;
    } else if (!currentSuggestion) {
        hint.textContent = 'Escribe y la IA sugerirá la siguiente línea…';
    }
}

// =============================================
// CONFIG VIEW
// =============================================
function renderConfig() {
    const cfg = getConfig();

    // Groq key
    const keyInput = document.getElementById('groq-key-input');
    keyInput.value = getGroqKey();

    // Model selector
    document.querySelectorAll('.model-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.model === cfg.model);
    });

    // Default genre
    document.getElementById('default-genre').value = cfg.defaultGenre || '';

    // User info
    if (currentUser) {
        document.getElementById('config-user-name').textContent = currentUser.name || '—';
        document.getElementById('config-user-email').textContent = currentUser.email || '—';
    }

    updateAIStatus();
}

function updateAIStatus() {
    const badge = document.getElementById('ai-status');
    if (getGroqKey()) {
        badge.textContent = 'Groq ✓';
        badge.className = 'status-badge connected';
    } else {
        badge.textContent = 'Sin Groq Key';
        badge.className = 'status-badge';
    }
}

async function testGroqConnection() {
    const key = document.getElementById('groq-key-input').value.trim();
    const result = document.getElementById('groq-test-result');
    if (!key) { result.textContent = 'Ingresa tu API key primero'; result.className = 'test-result err'; return; }

    result.textContent = 'Probando…'; result.className = 'test-result';

    try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` }
        });
        if (res.ok) {
            localStorage.setItem(GROQ_KEY_STORE, key);
            result.textContent = '✓ Conexión exitosa — key guardada';
            result.className = 'test-result ok';
            updateAIStatus();
            showToast('Groq API key guardada ✓');
        } else {
            result.textContent = 'Key inválida o expirada';
            result.className = 'test-result err';
        }
    } catch {
        result.textContent = 'Error de red';
        result.className = 'test-result err';
    }
}

// =============================================
// ON AUTH READY
// =============================================
function onAuthReady() {
    updateAIStatus();
    if (currentUser) {
        document.getElementById('config-user-name').textContent = currentUser.name || '—';
        document.getElementById('config-user-email').textContent = currentUser.email || '—';
    }
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {

    // Check auth
    if (!isTokenValid()) {
        showLoginModal();
    } else {
        onAuthReady();
    }

    // Tab bar
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    // Login
    document.getElementById('login-google-btn').addEventListener('click', startGoogleLogin);

    // Logout buttons
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('config-logout-btn').addEventListener('click', logout);

    // New session buttons
    document.getElementById('btn-new-session-empty').addEventListener('click', showSetupModal);
    document.getElementById('btn-new-session').addEventListener('click', showSetupModal);
    document.getElementById('btn-new-session-list').addEventListener('click', showSetupModal);

    // Setup modal
    document.getElementById('btn-cancel-setup').addEventListener('click', hideSetupModal);
    document.getElementById('btn-start-session').addEventListener('click', startSession);
    document.getElementById('setup-tema').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startSession();
    });

    // Config
    document.getElementById('btn-test-groq').addEventListener('click', testGroqConnection);

    document.getElementById('groq-key-input').addEventListener('change', () => {
        const v = document.getElementById('groq-key-input').value.trim();
        if (v) {
            localStorage.setItem(GROQ_KEY_STORE, v);
            updateAIStatus();
        }
    });

    document.querySelectorAll('.model-option').forEach(el => {
        el.addEventListener('click', () => {
            const cfg = getConfig();
            cfg.model = el.dataset.model;
            saveConfig(cfg);
            document.querySelectorAll('.model-option').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected');
            showToast(`Modelo: ${el.querySelector('.model-option-name').textContent}`);
        });
    });

    document.getElementById('default-genre').addEventListener('change', (e) => {
        const cfg = getConfig();
        cfg.defaultGenre = e.target.value;
        saveConfig(cfg);
    });

    // Close setup modal on backdrop click (only if login not shown)
    document.getElementById('modal-backdrop').addEventListener('click', () => {
        if (document.getElementById('modal-session-setup').classList.contains('visible')) {
            hideSetupModal();
        }
    });

    // Init editor
    initEditor();

    // Placeholder CSS trick via attribute
    const editor = document.getElementById('editor-input');
    editor.addEventListener('input', () => {
        editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
    });
    editor.dataset.empty = 'true';

    // Float suggestion bar above iOS virtual keyboard using Visual Viewport API
    function updateSuggestionBarPosition() {
        const bar = document.getElementById('suggestion-hint');
        if (!bar || !window.visualViewport) return;
        const keyboardHeight = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
        if (keyboardHeight > 80) {
            bar.style.bottom = (keyboardHeight + 8) + 'px';
            bar.style.transition = 'none';
        } else {
            bar.style.bottom = '';
            bar.style.transition = '';
        }
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateSuggestionBarPosition);
        window.visualViewport.addEventListener('scroll', updateSuggestionBarPosition);
    }
});
