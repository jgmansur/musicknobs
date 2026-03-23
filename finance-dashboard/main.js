import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp, LogOut, CreditCard, CarFront, Wrench, Home } from 'lucide';
import ApexCharts from 'apexcharts';
import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, GoogleAuthProvider, getRedirectResult, onAuthStateChanged, setPersistence, signInWithCredential, signInWithPopup, signInWithRedirect, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';

// =============================================
// CONFIG
// =============================================
const CLIENT_ID = '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com';
// OAuth: add drive scope for creating the accounts spreadsheet in Drive
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
const SPREADSHEET_LOG_ID   = '1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw'; // Control de Gastos
const SPREADSHEET_FIXED_ID = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA'; // Gastos Fijos
const SPREADSHEET_DEUDAS_ID = '1dKxhgqazskm15lx0f6FNCA0gpJ7i5glfxkusiH3b0Uk'; // Control de Deudas
const SPREADSHEET_AUTOS_ID = SPREADSHEET_DEUDAS_ID; // Autos + Reparaciones live in same workbook
const SPREADSHEET_ESTUDIO_ID = SPREADSHEET_DEUDAS_ID; // Estudio + Plugins in same workbook
const APP_VERSION  = 'v7.2.3';
const MELI_CLIENT_ID = '8274124056462040';
const MELI_AUTH_URL = 'https://auth.mercadolibre.com.mx/authorization';
const MELI_BROKER_BASE_URL = 'https://opengravity-meli-broker.fly.dev';
// Bump token keys to force re-auth with the new drive scope
const TOKEN_KEY    = 'google_access_token_v4';
const EXPIRY_KEY   = 'google_token_expiry_v4';
const TOKEN_LIFETIME_FALLBACK_SEC = 3500;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const ACCOUNTS_SHEET_KEY = 'finance_accounts_sheet_v1'; // localStorage key for the accounts spreadsheet ID

// =============================================
// FIREBASE
// =============================================
const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyCvYPZLCQdfuGLD4WDVnMUSerhPVutThy8',
    authDomain:        'opengravity-telebot-2026.firebaseapp.com',
    projectId:         'opengravity-telebot-2026',
    storageBucket:     'opengravity-telebot-2026.firebasestorage.app',
    messagingSenderId: '27971024867',
    appId:             '1:27971024867:web:ac2a8ecc8d65d5566792d6',
};
const _fbApp  = initializeApp(FIREBASE_CONFIG);
const _fbAuth = getAuth(_fbApp);
const _fbDb   = getFirestore(_fbApp);
let   _fbUid  = null; // current Firebase UID, set after sign-in
const FB_FORCE_INTERACTIVE_KEY = 'firebase_force_interactive_v1';

setPersistence(_fbAuth, browserLocalPersistence).catch((e) => {
    console.warn('[Firebase] setPersistence failed:', e.message);
});

onAuthStateChanged(_fbAuth, (user) => {
    _fbUid = user?.uid || null;
    debugUpdate({ auth: user ? 'Sesion Firebase activa' : 'Sin sesion Firebase', uid: _fbUid || '-' });
    balance_handleFirebaseAuthChange();
});

function isStandaloneAppMode() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

async function firebase_signInWithPopup() {
    if (isStandaloneAppMode()) {
        try {
            const provider = new GoogleAuthProvider();
            debugUpdate({ auth: 'Modo app: redirigiendo a Firebase...', uid: '-' });
            await signInWithRedirect(_fbAuth, provider);
            return false;
        } catch (redirectErr) {
            debugUpdate({ auth: `Redirect Firebase error: ${debugShort(redirectErr.message)}`, uid: '-' });
            console.warn('[Firebase] redirect sign-in failed:', redirectErr.code || '', redirectErr.message);
            return false;
        }
    }
    try {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(_fbAuth, provider);
        _fbUid = result.user.uid;
        localStorage.setItem(FB_FORCE_INTERACTIVE_KEY, '1');
        debugUpdate({ auth: 'Firebase popup OK', uid: _fbUid, token: accessToken ? 'Si' : 'No' });
        return true;
    } catch (e) {
        _fbUid = null;
        if (e?.code === 'auth/popup-blocked') {
            try {
                const provider = new GoogleAuthProvider();
                debugUpdate({ auth: 'Popup bloqueado, redirigiendo a Firebase...', uid: '-' });
                await signInWithRedirect(_fbAuth, provider);
                return false;
            } catch (redirectErr) {
                debugUpdate({ auth: `Redirect Firebase error: ${debugShort(redirectErr.message)}`, uid: '-' });
                console.warn('[Firebase] redirect sign-in failed:', redirectErr.code || '', redirectErr.message);
                return false;
            }
        }
        debugUpdate({ auth: `Popup Firebase error: ${debugShort(e.message)}`, uid: '-' });
        console.warn('[Firebase] popup sign-in failed:', e.code || '', e.message);
        return false;
    }
}

async function firebase_restoreRedirectResult() {
    try {
        const result = await getRedirectResult(_fbAuth);
        if (result?.user?.uid) {
            _fbUid = result.user.uid;
            debugUpdate({ auth: 'Firebase redirect OK', uid: _fbUid, token: accessToken ? 'Si' : 'No' });
        }
    } catch (e) {
        debugUpdate({ auth: `Redirect result error: ${debugShort(e.message)}`, uid: '-' });
        console.warn('[Firebase] getRedirectResult failed:', e.code || '', e.message);
    }
}

async function firebase_signIn(googleAccessToken, opts = {}) {
    const { allowPopupFallback = false } = opts;
    if (_fbAuth.currentUser?.uid) {
        _fbUid = _fbAuth.currentUser.uid;
        debugUpdate({ auth: 'Sesion Firebase reutilizada', uid: _fbUid, token: accessToken ? 'Si (cache)' : 'No' });
        return;
    }
    const forceInteractive = localStorage.getItem(FB_FORCE_INTERACTIVE_KEY) === '1';
    if (forceInteractive) {
        if (allowPopupFallback) {
            await firebase_signInWithPopup();
        } else {
            debugUpdate({ auth: 'Firebase pendiente (requiere popup/redirect una vez)' });
        }
        return;
    }
    try {
        debugUpdate({ auth: 'Conectando Firebase...' });
        const credential = GoogleAuthProvider.credential(null, googleAccessToken);
        const result = await signInWithCredential(_fbAuth, credential);
        _fbUid = result.user.uid;
        localStorage.removeItem(FB_FORCE_INTERACTIVE_KEY);
        debugUpdate({ auth: 'Firebase OK', uid: _fbUid, token: accessToken ? 'Si (cache)' : 'No' });
        console.log('[Firebase] signed in as', result.user.email, '| uid:', _fbUid);
    } catch (e) {
        console.warn('[Firebase] sign-in failed:', e.message);
        _fbUid = null;
        debugUpdate({ auth: `Firebase error: ${debugShort(e.message)}`, uid: '-' });
        const isInvalidCredential = e?.code === 'auth/invalid-credential' || String(e?.message || '').includes('Invalid Idp Response');
        if (allowPopupFallback && isInvalidCredential) {
            localStorage.setItem(FB_FORCE_INTERACTIVE_KEY, '1');
            debugUpdate({ auth: 'Reintentando Firebase con popup...' });
            await firebase_signInWithPopup();
        }
    }
}

async function firebase_signOut() {
    try { await fbSignOut(_fbAuth); } catch (_) {}
    _fbUid = null;
}

// =============================================
// STATE
// =============================================
let accessToken = null;
let tokenClient = null;
let tokenRefreshTimer = null;
let tokenRequestInFlight = null;
let tokenRequestInteractive = true;
let tokenRequestWatchdog = null;
let currentTab  = 'dashboard';
let tabInited   = { dashboard: false, gastos: false, fijos: false, deudas: false, plan: false, autos: false, propiedades: false, estudio: false };
const MELI_ACCESS_TOKEN_KEY = 'meli_access_token_v1';
const MELI_REFRESH_TOKEN_KEY = 'meli_refresh_token_v1';
const MELI_EXPIRES_AT_KEY = 'meli_expires_at_v1';
const MELI_PKCE_VERIFIER_KEY = 'meli_pkce_verifier_v1';
const MELI_OAUTH_STATE_KEY = 'meli_oauth_state_v1';
const MELI_DEBUG_INFO_KEY = 'meli_debug_info_v1';

function meli_loadDebugInfo() {
    try {
        const raw = localStorage.getItem(MELI_DEBUG_INFO_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

const meliAuthState = {
    accessToken: localStorage.getItem(MELI_ACCESS_TOKEN_KEY) || '',
    refreshToken: localStorage.getItem(MELI_REFRESH_TOKEN_KEY) || '',
    expiresAt: parseInt(localStorage.getItem(MELI_EXPIRES_AT_KEY) || '0', 10) || 0,
    lastError: '',
    debugInfo: meli_loadDebugInfo(),
};

const BUDGET_BUCKETS = [
    'Seguros',
    'Gasolina y Autos',
    'Super',
    'Mantenimiento y Pago de Servicios',
    'Muchachas y Pago de Deudas',
];

const dashboardFixedState = {
    entries: [],
    query: '',
};

const fixedPressState = {
    timer: null,
    suppressKey: null,
};

const dashboardFixedPayerStats = {
    yo: { pending: 0, paid: 0, total: 0 },
    esposa: { pending: 0, paid: 0, total: 0 },
};

const debugState = {
    auth: 'No autenticado',
    uid: '-',
    token: 'No',
    load: '-',
    save: '-',
};

function debugShort(text) {
    const v = String(text || '');
    return v.length > 70 ? `${v.slice(0, 67)}...` : v;
}

function debugRender() {
    const body = document.getElementById('debug-panel-body');
    if (!body) return;
    body.innerHTML = [
        `<div><strong>Auth:</strong> ${debugState.auth}</div>`,
        `<div><strong>UID:</strong> ${debugState.uid}</div>`,
        `<div><strong>Token:</strong> ${debugState.token}</div>`,
        `<div><strong>Load:</strong> ${debugState.load}</div>`,
        `<div><strong>Save:</strong> ${debugState.save}</div>`,
    ].join('');
}

function debugUpdate(patch) {
    Object.assign(debugState, patch || {});
    debugRender();
}

function debugInitPanel() {
    // Debug window disabled in production UI.
}

// migrate away from old token keys
['google_access_token', 'google_access_token_v2', 'google_access_token_v3'].forEach(k => localStorage.removeItem(k));
// Load stored token only if not expired (tokens live ~3600s, we use 3500s to be safe)
const _stored  = localStorage.getItem(TOKEN_KEY);
const _expiry  = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
if (_stored && _stored !== 'undefined' && _stored !== 'null' && Date.now() < _expiry) {
    accessToken = _stored;
} else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
}

function clearAccessTokenCache() {
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    tokenRequestInFlight = null;
    if (tokenRequestWatchdog) {
        clearTimeout(tokenRequestWatchdog);
        tokenRequestWatchdog = null;
    }
    if (tokenRefreshTimer) {
        clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
}

function scheduleTokenRefresh() {
    if (tokenRefreshTimer) {
        clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
    if (!accessToken) return;
    const expiryTs = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
    if (!expiryTs) return;
    const delayMs = Math.max(10_000, expiryTs - Date.now() - TOKEN_REFRESH_MARGIN_MS);
    tokenRefreshTimer = setTimeout(() => {
        requestToken({ interactive: false }).catch(() => {});
    }, delayMs);
}

function meli_getRedirectUri() {
    return `${window.location.origin}${window.location.pathname}`;
}

function meli_saveAuthTokens(payload = {}) {
    meliAuthState.accessToken = (payload.access_token || '').toString();
    meliAuthState.refreshToken = (payload.refresh_token || meliAuthState.refreshToken || '').toString();
    const expiresIn = parseInt(payload.expires_in || '0', 10) || 0;
    meliAuthState.expiresAt = Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 0);
    localStorage.setItem(MELI_ACCESS_TOKEN_KEY, meliAuthState.accessToken || '');
    localStorage.setItem(MELI_REFRESH_TOKEN_KEY, meliAuthState.refreshToken || '');
    localStorage.setItem(MELI_EXPIRES_AT_KEY, String(meliAuthState.expiresAt || 0));
}

function meli_updateDebugInfo(patch = {}) {
    meliAuthState.debugInfo = {
        ...(meliAuthState.debugInfo || {}),
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(MELI_DEBUG_INFO_KEY, JSON.stringify(meliAuthState.debugInfo));
}

function meli_isAccessTokenValid() {
    return !!meliAuthState.accessToken && !!meliAuthState.expiresAt && (meliAuthState.expiresAt - Date.now() > 90 * 1000);
}

function meli_base64UrlEncode(bytes) {
    let str = '';
    bytes.forEach((b) => { str += String.fromCharCode(b); });
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function meli_randomString(len = 64) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return meli_base64UrlEncode(bytes).slice(0, len);
}

async function meli_pkceChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return meli_base64UrlEncode(new Uint8Array(hash));
}

async function meli_startOAuthLogin() {
    const verifier = meli_randomString(96);
    const challenge = await meli_pkceChallenge(verifier);
    const state = `meli-${Date.now()}-${meli_randomString(24)}`;
    localStorage.setItem(MELI_PKCE_VERIFIER_KEY, verifier);
    localStorage.setItem(MELI_OAUTH_STATE_KEY, state);
    meli_updateDebugInfo({
        phase: 'oauth_start',
        redirectUri: meli_getRedirectUri(),
        statePreview: state.slice(0, 24),
        hasVerifier: true,
    });
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: MELI_CLIENT_ID,
        redirect_uri: meli_getRedirectUri(),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    });
    window.location.href = `${MELI_AUTH_URL}?${params.toString()}`;
}

async function meli_exchangeCodeForToken(code, verifier) {
    const body = {
        code,
        code_verifier: verifier,
        redirect_uri: meli_getRedirectUri(),
    };
    meli_updateDebugInfo({ phase: 'token_exchange', hasCode: !!code, hasVerifier: !!verifier });
    const res = await fetch(`${MELI_BROKER_BASE_URL}/meli/token/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const detail = payload?.message || payload?.error_description || payload?.error || `HTTP ${res.status}`;
        meli_updateDebugInfo({ phase: 'token_exchange_error', tokenExchangeStatus: res.status, tokenExchangeDetail: String(detail) });
        throw new Error(`Meli token error: ${detail}`);
    }
    meli_updateDebugInfo({
        phase: 'token_exchange_ok',
        tokenExchangeStatus: res.status,
        tokenExchangeDetail: '-',
        hasAccessToken: !!payload?.access_token,
        hasRefreshToken: !!payload?.refresh_token,
    });
    return payload;
}

async function meli_refreshAccessToken() {
    if (!meliAuthState.refreshToken) return null;
    const body = { refresh_token: meliAuthState.refreshToken };
    meli_updateDebugInfo({ phase: 'token_refresh' });
    const res = await fetch(`${MELI_BROKER_BASE_URL}/meli/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        meli_updateDebugInfo({ phase: 'token_refresh_error', tokenRefreshStatus: res.status });
        return null;
    }
    const payload = await res.json().catch(() => null);
    if (!payload?.access_token) {
        meli_updateDebugInfo({ phase: 'token_refresh_invalid_payload' });
        return null;
    }
    meli_saveAuthTokens(payload);
    meli_updateDebugInfo({ phase: 'token_refresh_ok', hasAccessToken: true, hasRefreshToken: !!payload?.refresh_token });
    return meliAuthState.accessToken || null;
}

async function meli_handleOAuthCallbackIfPresent() {
    const url = new URL(window.location.href);
    const oauthError = (url.searchParams.get('error') || '').trim();
    const oauthErrorDesc = (url.searchParams.get('error_description') || '').trim();
    const code = (url.searchParams.get('code') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    const verifier = (localStorage.getItem(MELI_PKCE_VERIFIER_KEY) || '').trim();
    const expectedState = (localStorage.getItem(MELI_OAUTH_STATE_KEY) || '').trim();
    if (oauthError) {
        meliAuthState.lastError = oauthErrorDesc || oauthError;
        meli_updateDebugInfo({ phase: 'oauth_callback_error', oauthError, oauthErrorDesc, callbackState: state || '' });
        showToast(`⚠️ Mercado Libre: ${meliAuthState.lastError}`);
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        return true;
    }
    if (!code || !state || !state.startsWith('meli-')) return false;
    if (!verifier || !expectedState || state !== expectedState) {
        meli_updateDebugInfo({
            phase: 'oauth_callback_invalid_state',
            callbackState: state,
            expectedState,
            hasVerifier: !!verifier,
        });
        showToast('⚠️ No se pudo validar login de Mercado Libre');
        return false;
    }
    try {
        meli_updateDebugInfo({ phase: 'oauth_callback_ok', callbackState: state, hasCode: !!code });
        const payload = await meli_exchangeCodeForToken(code, verifier);
        meli_saveAuthTokens(payload);
        meliAuthState.lastError = '';
        showToast('✅ Mercado Libre conectado');
    } catch (err) {
        console.warn('Meli OAuth callback failed:', err);
        meliAuthState.lastError = String(err?.message || 'Error de OAuth');
        meli_updateDebugInfo({ phase: 'oauth_callback_exchange_failed', callbackError: meliAuthState.lastError });
        showToast(`⚠️ Mercado Libre no conecto: ${meliAuthState.lastError}`);
    } finally {
        localStorage.removeItem(MELI_PKCE_VERIFIER_KEY);
        localStorage.removeItem(MELI_OAUTH_STATE_KEY);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');
        const clean = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', clean);
    }
    return true;
}

async function meli_ensureAccessToken(interactive = false) {
    if (meli_isAccessTokenValid()) return meliAuthState.accessToken;
    const refreshed = await meli_refreshAccessToken();
    if (refreshed) return refreshed;
    if (!interactive) return null;
    await meli_startOAuthLogin();
    return null;
}

window.autos_connectMercadoLibre = () => {
    meli_ensureAccessToken(true).catch((err) => {
        console.warn('No se pudo iniciar login Mercado Libre:', err);
        showToast('⚠️ No se pudo iniciar Mercado Libre');
    });
};
window.autos_openMeliDebug = autos_openMeliDebug;
window.autos_closeMeliDebug = autos_closeMeliDebug;
window.autos_copyMeliDebug = autos_copyMeliDebug;
window.autos_handleCarImageLoad = autos_handleCarImageLoad;
window.autos_handleCarImageError = autos_handleCarImageError;
window.autos_handleDocPreviewLoad = autos_handleDocPreviewLoad;
window.autos_handleDocPreviewError = autos_handleDocPreviewError;

// =============================================
// DOM READY
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    meli_handleOAuthCallbackIfPresent().catch((err) => {
        console.warn('Meli callback error:', err);
    });
    debugInitPanel();
    debugUpdate({ token: accessToken ? 'Si (cache)' : 'No' });
    if (accessToken) scheduleTokenRefresh();
    createIcons({ icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp, LogOut, CreditCard, CarFront, Wrench, Home } });
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.innerText = `Music Knobs | ${APP_VERSION}`;

    // Tab bar
    document.querySelectorAll('.tab').forEach(btn =>
        btn.addEventListener('click', () => showTab(btn.dataset.tab))
    );

    // Refresh
    document.getElementById('refresh-btn').addEventListener('click', () => {
        if (accessToken) refreshCurrentTab();
        else showLoginModal();
    });

    // Login/Logout
    document.getElementById('login-google-btn').addEventListener('click', startGoogleLogin);
    document.getElementById('logout-btn').addEventListener('click', logout);

    // Bind module events
    gastos_bindEvents();
    fijos_bindEvents();
    deudas_bindEvents();
    autos_bindEvents();
    propiedades_bindEvents();
    estudio_bindEvents();

    document.getElementById('fixed-search-open')?.addEventListener('click', dashboard_openFixedSearch);
    document.getElementById('fixed-search-close')?.addEventListener('click', dashboard_closeFixedSearch);
    document.getElementById('fixed-search-overlay')?.addEventListener('click', dashboard_closeFixedSearch);
    const fixedSearchInput = document.getElementById('fixed-search-input');
    if (fixedSearchInput) {
        fixedSearchInput.addEventListener('input', () => {
            dashboardFixedState.query = fixedSearchInput.value.toLowerCase().trim();
            renderFixedTable();
        });
    }

    // Hormiga Panel events
    document.getElementById('kpi-hormiga-card')?.addEventListener('click', hormiga_openPanel);
    document.getElementById('hormiga-panel-close')?.addEventListener('click', hormiga_closePanel);
    document.getElementById('hormiga-panel-overlay')?.addEventListener('click', hormiga_closePanel);
    document.getElementById('kpi-fixed-card')?.addEventListener('click', fixed_openPanel);
    document.getElementById('fixed-panel-close')?.addEventListener('click', fixed_closePanel);
    document.getElementById('fixed-panel-overlay')?.addEventListener('click', fixed_closePanel);

    // Balance panel
    balance_init();

    // Boot
    if (accessToken) {
        hideLoginModal();
        // Recover Firebase redirect auth if present; avoid token-credential sign-in here
        // because some environments return invalid audience for GIS access tokens.
        firebase_restoreRedirectResult().then(() => {
            if (!_fbUid) debugUpdate({ auth: 'Firebase pendiente (se conecta al guardar cuentas)' });
            balance_loadAccounts().then(() => balance_updateKpi());
            showTab('dashboard');
        });
    } else {
        showLoginModal();
        // One silent attempt only; do not block interactive login.
        if (window.google?.accounts?.oauth2) {
            requestToken({ interactive: false }).then(ok => {
                if (!ok) return;
                hideLoginModal();
                firebase_restoreRedirectResult().then(() => {
                    if (!_fbUid) debugUpdate({ auth: 'Google OK · Firebase pendiente' });
                    balance_loadAccounts().then(() => balance_updateKpi());
                    showTab('dashboard');
                });
            });
        }
    }
});

// =============================================
// BALANCE MODULE
// =============================================
const DEFAULT_ACCOUNTS = [
    { id: 1, name: 'Santander',               balance: 0, type: 'bank',   hidden: false },
    { id: 2, name: 'BBVA',                    balance: 0, type: 'bank',   hidden: false },
    { id: 3, name: 'Bank of America',         balance: 0, type: 'other',  hidden: false },
    { id: 4, name: 'Tarjeta de Cr\u00e9dito', balance: 0, type: 'credit', hidden: false, creditLimit: 0, creditLimitVisible: false },
];

const ACCOUNT_ICONS  = { bank:'🏦', credit:'💳', cash:'💵', invest:'📈', other:'🌎' };
const ACCOUNT_COLORS = { bank:'#3b82f6', credit:'#ef4444', cash:'#22c55e', invest:'#a855f7', other:'#f59e0b' };
const ACCOUNT_TYPE_LABEL = { bank:'Cuenta bancaria', credit:'Tarjeta de crédito', cash:'Efectivo', invest:'Inversión', other:'Otro' };
const FX_CACHE_KEY = 'usd_mxn_rate_cache_v1';
const BTC_CACHE_KEY = 'btc_mxn_rate_cache_v1';
const INVEST_RATE_CACHE_KEY = 'investment_rate_cache_v1';
const DEBT_VISIBLE_KEY = 'debt_visible_in_balance_v1';

let balanceUsdMxnRate = (() => {
    try {
        const raw = localStorage.getItem(FX_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Number(parsed?.rate) || null;
    } catch {
        return null;
    }
})();
let balanceFxFetchInFlight = false;
let balanceBtcMxnRate = (() => {
    try {
        const raw = localStorage.getItem(BTC_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Number(parsed?.rate) || null;
    } catch {
        return null;
    }
})();
let balanceBtcFetchInFlight = false;
let balanceInvestRates = (() => {
    try {
        const raw = localStorage.getItem(INVEST_RATE_CACHE_KEY);
        if (!raw) return { date: null, cetes: 10.5, mifel: 10.0 };
        const parsed = JSON.parse(raw);
        return {
            date: parsed?.date || null,
            cetes: Number(parsed?.cetes) || 10.5,
            mifel: Number(parsed?.mifel) || 10.0,
        };
    } catch {
        return { date: null, cetes: 10.5, mifel: 10.0 };
    }
})();
let balanceInvestFetchInFlight = false;
let debtVisibleInBalance = localStorage.getItem(DEBT_VISIBLE_KEY) !== '0';

function balance_normalizeAccount(a = {}) {
    const currency = (a.currency || 'MXN').toString().toUpperCase();
    return {
        id: a.id || Date.now(),
        name: a.name || '',
        balance: typeof a.balance === 'number' ? a.balance : parseSheetValue(a.balance),
        type: a.type || 'bank',
        hidden: !!a.hidden,
        creditLimit: typeof a.creditLimit === 'number' ? a.creditLimit : parseSheetValue(a.creditLimit),
        creditLimitVisible: !!a.creditLimitVisible,
        currency: ['MXN', 'USD', 'BTC'].includes(currency) ? currency : 'MXN',
        investmentType: ['cetes', 'mifel', 'bitcoin', 'custom'].includes((a.investmentType || '').toString().toLowerCase())
            ? (a.investmentType || '').toString().toLowerCase()
            : 'custom',
        customAnnualRate: typeof a.customAnnualRate === 'number' ? a.customAnnualRate : parseSheetValue(a.customAnnualRate),
        bitcoinInitialMxn: typeof a.bitcoinInitialMxn === 'number' ? a.bitcoinInitialMxn : parseSheetValue(a.bitcoinInitialMxn),
    };
}

function balance_convertToMxn(amount, currency) {
    const curr = (currency || 'MXN').toUpperCase();
    if (curr === 'USD') {
        return amount * (balanceUsdMxnRate || 1);
    }
    if (curr === 'BTC') {
        return amount * (balanceBtcMxnRate || 1);
    }
    return amount;
}

async function balance_refreshUsdMxnRate(force = false) {
    const needsRate = balanceAccounts.some(a => a.currency === 'USD');
    if (!needsRate && !force) return;
    if (balanceFxFetchInFlight) return;
    balanceFxFetchInFlight = true;
    try {
        const today = new Date().toISOString().slice(0, 10);
        const raw = localStorage.getItem(FX_CACHE_KEY);
        if (!force && raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.date === today && Number(parsed?.rate) > 0) {
                balanceUsdMxnRate = Number(parsed.rate);
                return;
            }
        }
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) return;
        const data = await res.json();
        const rate = Number(data?.rates?.MXN);
        if (!rate || Number.isNaN(rate)) return;
        balanceUsdMxnRate = rate;
        localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ date: today, rate }));
        balance_updateKpi();
        const panel = document.getElementById('balance-panel');
        if (panel && !panel.classList.contains('hidden')) balance_renderPanel();
    } catch (_) {
        // Keep cached rate if available
    } finally {
        balanceFxFetchInFlight = false;
    }
}

async function balance_refreshBtcMxnRate(force = false) {
    const needsRate = balanceAccounts.some(a => a.currency === 'BTC');
    if (!needsRate && !force) return;
    if (balanceBtcFetchInFlight) return;
    balanceBtcFetchInFlight = true;
    try {
        const today = new Date().toISOString().slice(0, 10);
        const raw = localStorage.getItem(BTC_CACHE_KEY);
        if (!force && raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.date === today && Number(parsed?.rate) > 0) {
                balanceBtcMxnRate = Number(parsed.rate);
                return;
            }
        }
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=mxn');
        if (!res.ok) return;
        const data = await res.json();
        const rate = Number(data?.bitcoin?.mxn);
        if (!rate || Number.isNaN(rate)) return;
        balanceBtcMxnRate = rate;
        localStorage.setItem(BTC_CACHE_KEY, JSON.stringify({ date: today, rate }));
        balance_updateKpi();
        const panel = document.getElementById('balance-panel');
        if (panel && !panel.classList.contains('hidden')) balance_renderPanel();
    } catch (_) {
        // Keep cached rate if available
    } finally {
        balanceBtcFetchInFlight = false;
    }
}

function balance_getEffectiveAnnualRate(acc) {
    if (acc.type !== 'invest') return 0;
    if (acc.investmentType === 'cetes') return balanceInvestRates.cetes;
    if (acc.investmentType === 'mifel') return balanceInvestRates.mifel;
    if (acc.investmentType === 'bitcoin') return Math.max(0, Number(acc.customAnnualRate) || 0);
    return Math.max(0, Number(acc.customAnnualRate) || 0);
}

async function balance_refreshInvestmentRates(force = false) {
    const hasAutoInvestment = balanceAccounts.some(a => a.type === 'invest' && (a.investmentType === 'cetes' || a.investmentType === 'mifel'));
    if (!hasAutoInvestment && !force) return;
    if (balanceInvestFetchInFlight) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!force && balanceInvestRates.date === today) return;

    balanceInvestFetchInFlight = true;
    try {
        const next = { ...balanceInvestRates, date: today };

        if (hasAutoInvestment) {
            // CETES (best effort scrape)
            try {
                const cetesRes = await fetch('https://api.allorigins.win/raw?url=https%3A%2F%2Fwww.cetesdirecto.com%2Fsites%2Fportal%2Finvertir-en-cetes');
                if (cetesRes.ok) {
                    const html = await cetesRes.text();
                    const m = html.match(/(\d{1,2}[\.,]\d{1,2})\s*%/);
                    if (m) next.cetes = parseFloat(m[1].replace(',', '.')) || next.cetes;
                }
            } catch (_) {}

            // MIFEL (best effort scrape)
            try {
                const mifelRes = await fetch('https://api.allorigins.win/raw?url=https%3A%2F%2Fwww.mifel.com.mx%2Finversiones');
                if (mifelRes.ok) {
                    const html = await mifelRes.text();
                    const m = html.match(/(\d{1,2}[\.,]\d{1,2})\s*%/);
                    if (m) next.mifel = parseFloat(m[1].replace(',', '.')) || next.mifel;
                }
            } catch (_) {}
        }

        balanceInvestRates = {
            date: today,
            cetes: Math.max(0, Number(next.cetes) || 10.5),
            mifel: Math.max(0, Number(next.mifel) || 10.0),
        };
        localStorage.setItem(INVEST_RATE_CACHE_KEY, JSON.stringify(balanceInvestRates));
        balance_updateKpi();
    } finally {
        balanceInvestFetchInFlight = false;
    }
}

let balanceAccounts   = [];
let balanceEditingId  = null;
let balancePendingFixed = 0; // Set by dashboard when fixed expenses load
let balancePendingFixedIncome = 0; // Unpaid fixed ingresos pending this month
let balancePaidFixedTotal = 0;
let balancePaidFixedAnchor = parseFloat(localStorage.getItem('balance_paid_anchor_v1') || '0') || 0;
let balanceLogNetTotal = 0;
let balanceLogNetAnchor = (() => {
    const raw = localStorage.getItem('balance_log_anchor_v1');
    if (raw === null) return null;
    return parseFloat(raw) || 0;
})();
let balanceAnchorNeedsMigration = false;
let balanceRealtimeUnsub = null;
let balanceRealtimeUid = null;
let balanceSheetSyncQueue = Promise.resolve();

function balance_getPaidFixedDeduction() {
    // v3.4.1: keep at 0; fixed payments now affect balance through
    // Control de Gastos net movements so manual edits there are reflected.
    return 0;
}

function balance_getLogNetAdjustment() {
    if (balanceLogNetAnchor === null) return 0;
    return balanceLogNetTotal - balanceLogNetAnchor;
}

function balance_resetDynamicAnchors() {
    balancePaidFixedAnchor = balancePaidFixedTotal;
    localStorage.setItem('balance_paid_anchor_v1', String(balancePaidFixedAnchor));
    balanceLogNetAnchor = balanceLogNetTotal;
    localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
}

function balance_updateLogNetFromRows(logRows) {
    balanceLogNetTotal = (logRows || []).reduce((sum, row) => {
        const tipo = (row[4] || '').toString().trim().toLowerCase();
        const montoRaw = Math.abs(parseSheetValue(row[3]));
        const moneda = parseCurrencyCode(row[7]);
        const monto = convertTransactionAmountToMxn(montoRaw, moneda);
        if (tipo === 'ingreso') return sum + monto;
        if (tipo === 'gasto') return sum - monto;
        return sum;
    }, 0);
    if (balanceLogNetAnchor === null) {
        balanceLogNetAnchor = balanceLogNetTotal;
        localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
    }
    if (balanceAnchorNeedsMigration) {
        balanceLogNetAnchor = balanceLogNetTotal;
        localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
        balanceAnchorNeedsMigration = false;
        if (_fbUid) balance_saveToFirestore().catch(console.warn);
    }
}

function balance_stopRealtimeSync() {
    if (balanceRealtimeUnsub) {
        balanceRealtimeUnsub();
        balanceRealtimeUnsub = null;
    }
    balanceRealtimeUid = null;
}

function balance_startRealtimeSync() {
    if (!_fbUid) {
        balance_stopRealtimeSync();
        return;
    }
    if (balanceRealtimeUnsub && balanceRealtimeUid === _fbUid) return;
    balance_stopRealtimeSync();
    const ref = doc(_fbDb, 'users', _fbUid, 'balance', 'accounts');
    balanceRealtimeUid = _fbUid;
    balanceRealtimeUnsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const nextAccounts = (data.accounts || []).map(balance_normalizeAccount);
        balanceAccounts = nextAccounts;
        const cloudAnchor = Number(data.logNetAnchor);
        if (Number.isFinite(cloudAnchor)) {
            balanceLogNetAnchor = cloudAnchor;
            localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
            balanceAnchorNeedsMigration = false;
        }
        localStorage.setItem('finance_accounts_v1', JSON.stringify(balanceAccounts));
        balance_updateKpi();
        const panel = document.getElementById('balance-panel');
        if (panel && !panel.classList.contains('hidden')) {
            balance_renderPanel();
        }
        debugUpdate({ load: `Firestore realtime (${balanceAccounts.length})`, uid: _fbUid || '-' });
    }, (err) => {
        console.warn('[Firebase] realtime listener failed:', err.message);
        debugUpdate({ load: `Firestore realtime error (${debugShort(err.message)})` });
    });
}

function balance_handleFirebaseAuthChange() {
    if (_fbUid) {
        balance_startRealtimeSync();
    } else {
        balance_stopRealtimeSync();
    }
}

// ── Sheet-backed persistence ─────────────────────────────
async function balance_getOrCreateSheet() {
    let sheetId = localStorage.getItem(ACCOUNTS_SHEET_KEY);
    // Find 'Jay App' folder in Drive
    const folderId = await driveFindFolder('Jay App');
    // Prefer canonical spreadsheet by name so all devices share the same file.
    const canonicalSheetId = await driveFindSpreadsheetByName('Finance Dashboard - Cuentas', folderId);
    if (canonicalSheetId) {
        localStorage.setItem(ACCOUNTS_SHEET_KEY, canonicalSheetId);
        return canonicalSheetId;
    }
    // Fallback to cached sheet id only if no canonical file was found.
    if (sheetId) {
        try { await sheetsGet(sheetId, 'A1:A1'); return sheetId; }
        catch { localStorage.removeItem(ACCOUNTS_SHEET_KEY); }
    }
    // Create the spreadsheet (in Jay App folder if found, else root Drive)
    sheetId = await driveCreateSpreadsheet('Finance Dashboard - Cuentas', folderId);
    // Initialize header row
    await sheetsUpdate(sheetId, 'A1:K1', [['ID', 'Nombre', 'Saldo', 'Tipo', 'Oculto', 'LimiteCredito', 'LimiteVisible', 'Moneda', 'TipoInversion', 'TasaPersonal', 'BitcoinInicialMXN']]);
    localStorage.setItem(ACCOUNTS_SHEET_KEY, sheetId);
    return sheetId;
}

async function balance_loadAccounts() {
    if (!accessToken) {
        // Not logged in — use localStorage fallback
        try {
            const raw = localStorage.getItem('finance_accounts_v1');
            balanceAccounts = raw ? JSON.parse(raw).map(balance_normalizeAccount) : DEFAULT_ACCOUNTS.map(a => balance_normalizeAccount(a));
        } catch { balanceAccounts = DEFAULT_ACCOUNTS.map(a => balance_normalizeAccount(a)); }
        balance_refreshUsdMxnRate();
        balance_refreshBtcMxnRate();
        balance_refreshInvestmentRates();
        debugUpdate({ load: `localStorage (${balanceAccounts.length})`, token: 'No' });
        return;
    }
    // ── 1. Try Firestore first (fastest, cloud-native) ──────────
    if (_fbUid) {
        try {
            const ref  = doc(_fbDb, 'users', _fbUid, 'balance', 'accounts');
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const data = snap.data();
                balanceAccounts = (data.accounts || []).map(balance_normalizeAccount);
                const cloudAnchor = Number(data.logNetAnchor);
                if (Number.isFinite(cloudAnchor)) {
                    balanceLogNetAnchor = cloudAnchor;
                    localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
                    balanceAnchorNeedsMigration = false;
                } else {
                    balanceAnchorNeedsMigration = true;
                }
                // Update localStorage cache
                localStorage.setItem('finance_accounts_v1', JSON.stringify(balanceAccounts));
                balance_refreshUsdMxnRate();
                balance_refreshBtcMxnRate();
                balance_refreshInvestmentRates();
                debugUpdate({ load: `Firestore (${balanceAccounts.length})`, uid: _fbUid || '-' });
                return;
            }
            // No Firestore data yet — fall through to Sheets to migrate
        } catch (err) {
            debugUpdate({ load: `Firestore error -> Sheets (${debugShort(err.code || err.message)})` });
            console.warn('[Firebase] Firestore load failed, falling back to Sheets:', err.message);
        }
    }
    // ── 2. Fallback: Google Sheets ──────────────────────────────
    try {
        const sid  = await balance_getOrCreateSheet();
        const rows = await sheetsGet(sid, 'A2:K');
        if (!rows.length) {
            balanceAccounts = DEFAULT_ACCOUNTS.map(a => balance_normalizeAccount(a));
            await balance_writeToSheet(sid); // seed defaults
        } else {
            balanceAccounts = rows
                .filter(r => r[0])
                .map(r => balance_normalizeAccount({
                    id:      Number(r[0]) || Date.now(),
                    name:    r[1] || '',
                    balance: typeof r[2] === 'number' ? r[2] : parseSheetValue(r[2]),
                    type:    r[3] || 'bank',
                    hidden:  (r[4] || '').toString().toUpperCase() === 'TRUE',
                    creditLimit: typeof r[5] === 'number' ? r[5] : parseSheetValue(r[5]),
                    creditLimitVisible: (r[6] || '').toString().toUpperCase() === 'TRUE',
                    currency: (r[7] || 'MXN').toString().toUpperCase(),
                    investmentType: (r[8] || 'custom').toString().toLowerCase(),
                    customAnnualRate: typeof r[9] === 'number' ? r[9] : parseSheetValue(r[9]),
                    bitcoinInitialMxn: typeof r[10] === 'number' ? r[10] : parseSheetValue(r[10]),
                }));
        }
        debugUpdate({ load: `Sheets (${balanceAccounts.length})` });
        balance_refreshUsdMxnRate();
        balance_refreshBtcMxnRate();
        balance_refreshInvestmentRates();
        // Migrate to Firestore now that we have the data
        if (_fbUid) balance_saveToFirestore().catch(console.warn);
    } catch (err) {
        console.error('Error loading accounts from Sheets:', err);
        const raw = localStorage.getItem('finance_accounts_v1');
        balanceAccounts = raw ? JSON.parse(raw).map(balance_normalizeAccount) : DEFAULT_ACCOUNTS.map(a => balance_normalizeAccount(a));
        debugUpdate({ load: `localStorage fallback (${balanceAccounts.length})` });
    }
}

async function balance_writeToSheet(sheetId) {
    await sheetsClear(sheetId, 'A2:K');
    if (balanceAccounts.length) {
        await sheetsUpdate(sheetId, `A2:K${1 + balanceAccounts.length}`,
            balanceAccounts.map(a => [
                a.id,
                a.name,
                a.balance,
                a.type,
                a.hidden ? 'TRUE' : 'FALSE',
                Math.abs(a.creditLimit || 0),
                a.creditLimitVisible ? 'TRUE' : 'FALSE',
                a.currency || 'MXN',
                a.investmentType || 'custom',
                Number(a.customAnnualRate) || 0,
                Number(a.bitcoinInitialMxn) || 0,
            ]));
    }
}

async function balance_saveToFirestore() {
    if (!_fbUid) return;
    const ref = doc(_fbDb, 'users', _fbUid, 'balance', 'accounts');
    await setDoc(ref, {
        accounts: balanceAccounts.map(a => ({
            id:      a.id,
            name:    a.name,
            balance: a.balance,
            type:    a.type,
            hidden:  !!a.hidden,
            creditLimit: Math.abs(a.creditLimit || 0),
            creditLimitVisible: !!a.creditLimitVisible,
            currency: a.currency || 'MXN',
            investmentType: a.investmentType || 'custom',
            customAnnualRate: Number(a.customAnnualRate) || 0,
            bitcoinInitialMxn: Number(a.bitcoinInitialMxn) || 0,
        })),
        logNetAnchor: balanceLogNetAnchor === null ? null : Number(balanceLogNetAnchor),
        lastUpdated: serverTimestamp(),
    });
}

async function balance_saveAccounts(opts = {}) {
    const deferBackup = opts.deferBackup !== false;
    // 1. Update localStorage cache immediately (offline-first)
    localStorage.setItem('finance_accounts_v1', JSON.stringify(balanceAccounts));
    if (!accessToken) {
        debugUpdate({ save: `Solo localStorage (${balanceAccounts.length})`, token: 'No' });
        return;
    }
    if (!_fbUid) await firebase_signIn(accessToken, { allowPopupFallback: true });

    // 2. Firestore first (primary), then Sheets backup (deferred by default)
    if (_fbUid) {
        try {
            await balance_saveToFirestore();
            debugUpdate({ save: `Firestore:OK | Sheets:${deferBackup ? 'SYNCING' : 'PENDING'}`, token: 'Si' });
            const runSheetsBackup = () => balance_getOrCreateSheet().then(sid => balance_writeToSheet(sid));
            if (deferBackup) {
                balanceSheetSyncQueue = balanceSheetSyncQueue
                    .then(() => runSheetsBackup())
                    .then(() => debugUpdate({ save: 'Firestore:OK | Sheets:OK', token: 'Si' }))
                    .catch((err) => {
                        const code = err?.code || err?.status || 'ERR';
                        console.warn('[Sheets] deferred save failed:', debugShort(err?.message || err));
                        debugUpdate({ save: `Firestore:OK | Sheets:ERR(${code})`, token: 'Si' });
                    });
            } else {
                await runSheetsBackup();
                debugUpdate({ save: 'Firestore:OK | Sheets:OK', token: 'Si' });
            }
            return;
        } catch (err) {
            const code = err?.code || err?.status || 'ERR';
            console.warn('[Firestore] save failed:', debugShort(err?.message || err));
            // Fallback: if Firestore fails, force synchronous Sheets backup.
            try {
                const sid = await balance_getOrCreateSheet();
                await balance_writeToSheet(sid);
                debugUpdate({ save: `Firestore:ERR(${code}) | Sheets:OK`, token: 'Si' });
                return;
            } catch (sheetErr) {
                const sheetCode = sheetErr?.code || sheetErr?.status || 'ERR';
                debugUpdate({ save: `Firestore:ERR(${code}) | Sheets:ERR(${sheetCode})`, token: 'Si' });
                throw sheetErr;
            }
        }
    }

    // No Firebase UID: rely on Sheets only.
    const sid = await balance_getOrCreateSheet();
    await balance_writeToSheet(sid);
    debugUpdate({ save: 'Firestore:SKIP(no uid) | Sheets:OK', token: 'Si' });
}

// ── Compute helpers ──────────────────────────────────────
function balance_getTotal() {
    // Skip accounts marked as hidden (savings, reserves, etc.)
    const base = balanceAccounts
        .filter(a => !a.hidden)
        .reduce((sum, a) => {
            const balanceMxn = balance_convertToMxn(Math.abs(a.balance || 0), a.currency);
            if (a.type === 'credit') {
                const deuda = -balanceMxn;
                const limiteVisible = a.creditLimitVisible
                    ? balance_convertToMxn(Math.abs(a.creditLimit || 0), a.currency)
                    : 0;
                return sum + deuda + limiteVisible;
            }
            return sum + (a.balance < 0 ? -balanceMxn : balanceMxn);
        }, 0);
    const debtImpact = debtVisibleInBalance ? deudas_getTotalAmount() : 0;
    return base - balance_getPaidFixedDeduction() + balance_getLogNetAdjustment() - debtImpact;
}

function balance_getInvestmentSummary() {
    const items = balanceAccounts.filter(a => a.type === 'invest');
    const rows = items.map(acc => {
        const principalMxn = balance_convertToMxn(Math.abs(acc.balance || 0), acc.currency);
        if (acc.investmentType === 'bitcoin') {
            const currentMxn = principalMxn;
            const initialMxn = Math.max(0, Number(acc.bitcoinInitialMxn) || 0);
            const gainCurrent = currentMxn - initialMxn;
            return { acc, principalMxn, annualRate: 0, monthlyYield: 0, currentMxn, initialMxn, gainCurrent };
        }
        const annualRate = balance_getEffectiveAnnualRate(acc);
        const monthlyYield = principalMxn * (annualRate / 100) / 12;
        return { acc, principalMxn, annualRate, monthlyYield, currentMxn: principalMxn, initialMxn: principalMxn, gainCurrent: 0 };
    });
    const investedTotal = rows.reduce((s, r) => s + r.principalMxn, 0);
    const monthlyTotal = rows.reduce((s, r) => s + r.monthlyYield, 0);
    const bitcoinGainTotal = rows.reduce((s, r) => s + r.gainCurrent, 0);
    return { rows, investedTotal, monthlyTotal, bitcoinGainTotal };
}

function balance_updateKpi() {
    const total = balance_getTotal();
    const real  = total - balancePendingFixed;
    const paidDeduction = balance_getPaidFixedDeduction();
    const logAdjustment = balance_getLogNetAdjustment();
    const el  = document.getElementById('balance-total');
    const lbl = document.getElementById('balance-real-label');
    if (el) {
        const incomingText = balancePendingFixedIncome > 0 ? ` +${formatCurrency(balancePendingFixedIncome)} por cobrar` : '';
        el.innerHTML = `${formatCurrency(total)}<span id="balance-total-income-pending" class="kpi-inline-note">${incomingText}</span>`;
    }
    if (lbl) {
        if (balancePendingFixed > 0 || paidDeduction > 0 || logAdjustment !== 0) {
            const parts = [];
            if (paidDeduction > 0) parts.push(`pagados: ${formatCurrency(paidDeduction)}`);
            if (logAdjustment !== 0) parts.push(`movs: ${logAdjustment >= 0 ? '+' : ''}${formatCurrency(logAdjustment)}`);
            if (balancePendingFixed > 0) parts.push(`pendientes: ${formatCurrency(balancePendingFixed)}`);
            lbl.innerText = `Real: ${formatCurrency(real)} (${parts.join(' | ')})`;
        } else {
            lbl.innerText = 'Toca para ver cuentas';
        }
        lbl.className = 'diff-label ' + (real >= 0 ? 'text-success' : 'text-danger');
    }
    const investSummary = balance_getInvestmentSummary();
    const invAmountEl = document.getElementById('kpi-invest-amount');
    const invYieldEl = document.getElementById('kpi-invest-yield');
    if (invAmountEl) invAmountEl.innerText = formatCurrency(investSummary.investedTotal);
    if (invYieldEl) {
        invYieldEl.innerText = `+${formatCurrency(investSummary.monthlyTotal)}/mes`;
        invYieldEl.className = `diff-label ${investSummary.monthlyTotal >= 0 ? 'text-success' : 'text-danger'}`;
    }
    const investPanel = document.getElementById('invest-panel');
    if (investPanel && !investPanel.classList.contains('hidden')) {
        balance_renderInvestmentPanel();
    }
    // Update debt summary card on dashboard
    deudas_updateKpiCard();
    balance_updateFixedCoverageKpi();
}

function balance_updateFixedCoverageKpi() {
    const el = document.getElementById('gastos-fijos-coverage');
    if (!el) return;
    const coverage = (balance_getTotal() + balancePendingFixedIncome) - balancePendingFixed;
    const sign = coverage >= 0 ? '+' : '';
    el.innerText = `${coverage >= 0 ? 'te sobra' : 'te faltan'} ${sign}${formatCurrency(coverage)}`;
    el.className = `kpi-inline-note ${coverage >= 0 ? 'kpi-inline-note--positive' : 'kpi-inline-note--negative'}`;
}

function balance_setFixedTotalKpi(amount) {
    const totalEl = document.getElementById('gastos-fijos-total');
    if (!totalEl) return;
    totalEl.innerHTML = `${formatCurrency(amount)} <span id="gastos-fijos-coverage" class="kpi-inline-note"></span>`;
}

// ── Render ───────────────────────────────────────────────
function balance_renderPanel() {
    const total = balance_getTotal();
    const real  = total - balancePendingFixed;
    const paidDeduction = balance_getPaidFixedDeduction();
    const logAdjustment = balance_getLogNetAdjustment();
    document.getElementById('bs-total').innerText = formatCurrency(total);
    const bsReal = document.getElementById('bs-real');
    bsReal.innerText   = formatCurrency(real);
    bsReal.className   = 'bs-amount ' + (real >= 0 ? 'text-success' : 'text-danger');
    document.getElementById('bs-pending-label').innerText =
        (balancePendingFixed > 0 || paidDeduction > 0 || logAdjustment !== 0)
            ? `${paidDeduction > 0 ? `menos ${formatCurrency(paidDeduction)} pagados` : 'sin pagados'}${logAdjustment !== 0 ? ` · movs ${logAdjustment >= 0 ? '+' : ''}${formatCurrency(logAdjustment)}` : ''}${balancePendingFixed > 0 ? ` · menos ${formatCurrency(balancePendingFixed)} pendientes` : ''}`
            : 'sin fijos pendientes';

    const list = document.getElementById('accounts-list');
    list.innerHTML = balanceAccounts.map(acc => {
        const icon   = ACCOUNT_ICONS[acc.type]  || '🏦';
        const color  = acc.hidden ? '#475569' : (ACCOUNT_COLORS[acc.type] || '#3b82f6');
        const signed = acc.type === 'credit' ? -Math.abs(acc.balance) : +acc.balance;
        const signedMxn = balance_convertToMxn(Math.abs(signed), acc.currency) * (signed < 0 ? -1 : 1);
        const creditLimit = Math.abs(acc.creditLimit || 0);
        const creditLimitMxn = balance_convertToMxn(creditLimit, acc.currency);
        const fxHint = acc.currency === 'USD'
            ? ` · USD ${Math.abs(signed).toFixed(2)}`
            : (acc.currency === 'BTC' ? ` · BTC ${Math.abs(signed).toFixed(6)}` : '');
        const creditBadge = acc.type === 'credit'
            ? `<span class="account-type-label">Limite: ${acc.creditLimitVisible ? `+${formatCurrency(creditLimitMxn)}` : 'oculto'}${acc.currency === 'USD' ? ` (USD ${creditLimit.toFixed(2)})` : ''}</span>`
            : '';
        const investRate = balance_getEffectiveAnnualRate(acc);
        const investBadge = acc.type === 'invest'
            ? (acc.investmentType === 'bitcoin'
                ? `<span class="account-type-label">Inicial: ${formatCurrency(Math.abs(acc.bitcoinInitialMxn || 0))}</span>`
                : `<span class="account-type-label">Tasa anual: ${investRate.toFixed(2)}% (${(acc.investmentType || 'custom').toUpperCase()})</span>`)
            : '';
        const hiddenClass = acc.hidden ? 'account-card--hidden' : '';
        const eyeIcon = acc.hidden ? '👁️' : '👁';
        const eyeTitle = acc.hidden ? 'Incluir en balance' : 'Excluir del balance (ahorro)';
        const creditEyeIcon = acc.creditLimitVisible ? '👁️' : '🙈';
        const creditEyeTitle = acc.creditLimitVisible ? 'Ocultar limite en balance' : 'Incluir limite en balance';
        return `
        <div class="account-card glass-subtle ${hiddenClass}" data-id="${acc.id}">
          <div class="account-card-left">
            <span class="account-icon" style="background:${color}22;color:${color}">${icon}</span>
            <div class="account-info">
              <span class="account-name">${acc.name}${acc.hidden ? ' <span class="acc-hidden-badge">AHORRO</span>' : ''}</span>
              <span class="account-type-label">${ACCOUNT_TYPE_LABEL[acc.type] || 'Cuenta'} · ${acc.currency || 'MXN'}${fxHint}</span>
              ${creditBadge}
              ${investBadge}
            </div>
          </div>
          <div class="account-card-right">
            <span class="account-balance ${signedMxn < 0 ? 'text-danger' : ''} ${acc.hidden ? 'acc-balance-hidden' : ''}">${formatCurrency(signedMxn)}</span>
            <div class="account-actions">
              <button class="acc-toggle-btn icon-btn-sm" data-id="${acc.id}" title="${eyeTitle}">${eyeIcon}</button>
              ${acc.type === 'credit' ? `<button class="acc-credit-limit-btn icon-btn-sm" data-id="${acc.id}" title="${creditEyeTitle}">${creditEyeIcon}</button>` : ''}
              <button class="acc-edit-btn icon-btn-sm" data-id="${acc.id}" title="Editar">✏️</button>
              <button class="acc-del-btn icon-btn-sm" data-id="${acc.id}" title="Eliminar">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.acc-toggle-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_toggleHidden(parseInt(btn.dataset.id))));
    list.querySelectorAll('.acc-edit-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_openEdit(parseInt(btn.dataset.id))));
    list.querySelectorAll('.acc-del-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_deleteAccount(parseInt(btn.dataset.id))));
    list.querySelectorAll('.acc-credit-limit-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_toggleCreditLimitVisibility(parseInt(btn.dataset.id))));
}

// ── Panel open/close ─────────────────────────────────────
async function balance_openPanel() {
    const panel = document.getElementById('balance-panel');
    panel.classList.remove('hidden');
    document.getElementById('add-account-form').classList.add('hidden');
    document.getElementById('acc-add-btn').classList.remove('hidden');
    document.getElementById('accounts-list').innerHTML =
        '<p style="text-align:center;color:var(--text-muted);padding:1.5rem">Cargando...</p>';
    balanceEditingId = null;
    document.body.style.overflow = 'hidden';
    await balance_loadAccounts();
    await balance_refreshUsdMxnRate();
    await balance_refreshBtcMxnRate();
    await balance_refreshInvestmentRates();
    balance_updateKpi();
    balance_renderPanel();
}

function balance_closePanel() {
    document.getElementById('balance-panel').classList.add('hidden');
    document.body.style.overflow = '';
}

function balance_renderInvestmentPanel() {
    const summary = balance_getInvestmentSummary();
    const totalEl = document.getElementById('invest-total');
    const monthlyEl = document.getElementById('invest-monthly');
    const monthlyLabelEl = document.getElementById('invest-monthly-label');
    const listEl = document.getElementById('invest-list');
    if (!totalEl || !monthlyEl || !listEl) return;
    totalEl.innerText = formatCurrency(summary.investedTotal);
    monthlyEl.innerText = `+${formatCurrency(summary.monthlyTotal)}`;
    if (monthlyLabelEl) {
        monthlyLabelEl.innerText = 'Rendimiento mensual';
    }

    if (!summary.rows.length) {
        listEl.innerHTML = '<div class="empty-state">No hay cuentas de inversión</div>';
        return;
    }

    listEl.innerHTML = summary.rows.map(({ acc, principalMxn, annualRate, monthlyYield, initialMxn, gainCurrent }) => {
        const srcLabel = acc.investmentType === 'cetes'
            ? 'CETES'
            : (acc.investmentType === 'mifel'
                ? 'MIFEL'
                : (acc.investmentType === 'bitcoin' ? 'BITCOIN' : 'Personalizada'));
        const principalRaw = acc.currency === 'USD'
            ? `USD ${Math.abs(acc.balance || 0).toFixed(2)}`
            : (acc.currency === 'BTC'
                ? `BTC ${Math.abs(acc.balance || 0).toFixed(6)}`
                : formatCurrency(Math.abs(acc.balance || 0)));
        return `
          <div class="account-card glass-subtle">
            <div class="account-card-left">
              <span class="account-icon" style="background:#38bdf822;color:#38bdf8">📈</span>
              <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-type-label">${acc.investmentType === 'bitcoin' ? `${srcLabel} · Inversión inicial: ${formatCurrency(initialMxn)}` : `${srcLabel} · ${annualRate.toFixed(2)}% anual`}</span>
                <span class="account-type-label">Capital: ${principalRaw} (${formatCurrency(principalMxn)})</span>
              </div>
            </div>
            <div class="account-card-right">
              <span class="account-balance ${acc.investmentType === 'bitcoin' ? (gainCurrent >= 0 ? 'text-success' : 'text-danger') : 'text-success'}">${acc.investmentType === 'bitcoin' ? `${gainCurrent >= 0 ? '+' : ''}${formatCurrency(gainCurrent)}` : `+${formatCurrency(monthlyYield)}/mes`}</span>
            </div>
          </div>
        `;
    }).join('');
}

function balance_openInvestPanel() {
    const panel = document.getElementById('invest-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    balance_renderInvestmentPanel();
}

function balance_closeInvestPanel() {
    const panel = document.getElementById('invest-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    document.body.style.overflow = '';
}

// ── Edit / Add ───────────────────────────────────────────
function balance_showForm() {
    document.getElementById('add-account-form').classList.remove('hidden');
    document.getElementById('acc-add-btn').classList.add('hidden');
    // Scroll form into view so save button is visible
    setTimeout(() => {
        document.getElementById('add-account-form')
            .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
}

function balance_openEdit(id) {
    const acc = balanceAccounts.find(a => a.id === id);
    if (!acc) return;
    balanceEditingId = id;
    document.getElementById('acc-name').value    = acc.name;
    document.getElementById('acc-balance').value = Math.abs(acc.balance);
    document.getElementById('acc-type').value    = acc.type;
    document.getElementById('acc-currency').value = acc.currency || 'MXN';
    document.getElementById('acc-credit-limit').value = Math.abs(acc.creditLimit || 0);
    document.getElementById('acc-credit-visible').value = acc.creditLimitVisible ? '1' : '0';
    document.getElementById('acc-invest-type').value = acc.investmentType || 'custom';
    document.getElementById('acc-invest-rate').value = Number(acc.customAnnualRate || 0);
    document.getElementById('acc-bitcoin-initial').value = Number(acc.bitcoinInitialMxn || 0);
    balance_refreshCreditFields();
    balance_showForm();
}

function balance_openAdd() {
    balanceEditingId = null;
    document.getElementById('acc-name').value    = '';
    document.getElementById('acc-balance').value = '';
    document.getElementById('acc-type').value    = 'bank';
    document.getElementById('acc-currency').value = 'MXN';
    document.getElementById('acc-credit-limit').value = '';
    document.getElementById('acc-credit-visible').value = '0';
    document.getElementById('acc-invest-type').value = 'cetes';
    document.getElementById('acc-invest-rate').value = '';
    document.getElementById('acc-bitcoin-initial').value = '';
    balance_refreshCreditFields();
    balance_showForm();
}

async function balance_toggleHidden(id) {
    const acc = balanceAccounts.find(a => a.id === id);
    if (!acc) return;
    acc.hidden = !acc.hidden;
    await balance_saveAccounts();
    balance_renderPanel();
    balance_updateKpi();
}

async function balance_toggleCreditLimitVisibility(id) {
    const acc = balanceAccounts.find(a => a.id === id);
    if (!acc || acc.type !== 'credit') return;
    acc.creditLimitVisible = !acc.creditLimitVisible;
    await balance_saveAccounts();
    balance_renderPanel();
    balance_updateKpi();
}

async function balance_saveAccount() {
    const name    = document.getElementById('acc-name').value.trim();
    const balance = parseFloat(document.getElementById('acc-balance').value) || 0;
    const type    = document.getElementById('acc-type').value;
    let currency = document.getElementById('acc-currency').value;
    currency = ['MXN', 'USD', 'BTC'].includes(currency) ? currency : 'MXN';
    const creditLimit = Math.abs(parseFloat(document.getElementById('acc-credit-limit').value) || 0);
    const creditLimitVisible = document.getElementById('acc-credit-visible').value === '1';
    const investmentType = document.getElementById('acc-invest-type').value;
    const customAnnualRate = Math.max(0, parseFloat(document.getElementById('acc-invest-rate').value) || 0);
    const bitcoinInitialMxn = Math.max(0, parseFloat(document.getElementById('acc-bitcoin-initial').value) || 0);
    if (type === 'invest' && investmentType === 'bitcoin') {
        currency = 'BTC';
    }
    if (!name) return;
    const btn = document.getElementById('acc-save-btn');
    btn.disabled = true; btn.innerText = 'Guardando...';

    if (balanceEditingId !== null) {
        const acc = balanceAccounts.find(a => a.id === balanceEditingId);
        if (acc) {
            acc.name = name;
            acc.balance = balance;
            acc.type = type;
            acc.currency = currency;
            acc.creditLimit = type === 'credit' ? creditLimit : 0;
            acc.creditLimitVisible = type === 'credit' ? creditLimitVisible : false;
            acc.investmentType = type === 'invest' ? investmentType : 'custom';
            acc.customAnnualRate = type === 'invest' ? customAnnualRate : 0;
            acc.bitcoinInitialMxn = (type === 'invest' && investmentType === 'bitcoin') ? bitcoinInitialMxn : 0;
        }
    } else {
        balanceAccounts.push(balance_normalizeAccount({
            id: Date.now(),
            name,
            balance,
            type,
            currency,
            hidden: false,
            creditLimit: type === 'credit' ? creditLimit : 0,
            creditLimitVisible: type === 'credit' ? creditLimitVisible : false,
            investmentType: type === 'invest' ? investmentType : 'custom',
            customAnnualRate: type === 'invest' ? customAnnualRate : 0,
            bitcoinInitialMxn: (type === 'invest' && investmentType === 'bitcoin') ? bitcoinInitialMxn : 0,
        }));
    }
    balance_resetDynamicAnchors();
    await balance_saveAccounts({ deferBackup: true });
    balance_refreshUsdMxnRate();
    balance_refreshBtcMxnRate();
    balance_refreshInvestmentRates();
    balance_renderPanel();
    balance_updateKpi();
    document.getElementById('add-account-form').classList.add('hidden');
    document.getElementById('acc-add-btn').classList.remove('hidden');
    balanceEditingId = null;
    btn.disabled = false; btn.innerText = 'Guardar';
}

async function balance_deleteAccount(id) {
    if (!confirm('\u00bfEliminar esta cuenta?')) return;
    balanceAccounts = balanceAccounts.filter(a => a.id !== id);
    balance_resetDynamicAnchors();
    await balance_saveAccounts();
    balance_renderPanel();
    balance_updateKpi();
}

// ── Init ─────────────────────────────────────────────────
function balance_init() {
    // Load from localStorage cache immediately for instant KPI display
    try {
        const raw = localStorage.getItem('finance_accounts_v1');
        if (raw) { balanceAccounts = JSON.parse(raw).map(balance_normalizeAccount); balance_updateKpi(); }
    } catch {}
    balance_refreshUsdMxnRate();
    balance_refreshBtcMxnRate();
    balance_refreshInvestmentRates();

    document.getElementById('kpi-balance-card')
        .addEventListener('click', balance_openPanel);
    document.getElementById('kpi-deuda-card')
        ?.addEventListener('click', deudas_toggleVisibilityInBalance);
    document.getElementById('kpi-invest-card')
        ?.addEventListener('click', balance_openInvestPanel);
    document.getElementById('balance-panel-close')
        .addEventListener('click', balance_closePanel);
    document.getElementById('balance-panel-overlay')
        .addEventListener('click', balance_closePanel);
    document.getElementById('invest-panel-close')
        ?.addEventListener('click', balance_closeInvestPanel);
    document.getElementById('invest-panel-overlay')
        ?.addEventListener('click', balance_closeInvestPanel);
    document.getElementById('acc-add-btn')
        .addEventListener('click', balance_openAdd);
    document.getElementById('acc-save-btn')
        .addEventListener('click', balance_saveAccount);
    document.getElementById('acc-type')
        .addEventListener('change', balance_refreshCreditFields);
    document.getElementById('acc-currency')
        .addEventListener('change', () => {
            balance_refreshUsdMxnRate(true);
            balance_refreshBtcMxnRate(true);
        });
    document.getElementById('acc-invest-type')
        .addEventListener('change', () => {
            balance_refreshCreditFields();
            balance_refreshInvestmentRates(true);
            balance_refreshBtcMxnRate(true);
        });
    document.getElementById('acc-credit-visible-btn')
        .addEventListener('click', () => {
            const input = document.getElementById('acc-credit-visible');
            input.value = input.value === '1' ? '0' : '1';
            balance_refreshCreditFields();
        });
    document.getElementById('acc-cancel-btn')
        .addEventListener('click', () => {
            document.getElementById('add-account-form').classList.add('hidden');
            document.getElementById('acc-add-btn').classList.remove('hidden');
            balanceEditingId = null;
        });
    deudas_updateKpiCard();
    deudas_ensureLoaded();
    balance_refreshCreditFields();
}

function balance_refreshCreditFields() {
    const type = document.getElementById('acc-type').value;
    const creditWrap = document.getElementById('acc-credit-fields');
    const investWrap = document.getElementById('acc-invest-fields');
    const investType = document.getElementById('acc-invest-type').value;
    const investRate = document.getElementById('acc-invest-rate');
    const bitcoinInitial = document.getElementById('acc-bitcoin-initial');
    const currencySelect = document.getElementById('acc-currency');
    const btn = document.getElementById('acc-credit-visible-btn');
    const hiddenInput = document.getElementById('acc-credit-visible');
    const isCredit = type === 'credit';
    creditWrap.classList.toggle('hidden', !isCredit);
    investWrap.classList.toggle('hidden', type !== 'invest');
    investRate.classList.toggle('hidden', !(type === 'invest' && investType === 'custom'));
    bitcoinInitial.classList.toggle('hidden', !(type === 'invest' && investType === 'bitcoin'));
    if (type === 'invest' && investType === 'bitcoin') {
        currencySelect.value = 'BTC';
        currencySelect.disabled = true;
    } else {
        currencySelect.disabled = false;
    }
    if (!isCredit) return;
    const isVisible = hiddenInput.value === '1';
    btn.innerText = isVisible ? '👁️ Limite visible en balance' : '🙈 Limite oculto en balance';
}

// =============================================
// TAB NAVIGATION
// =============================================
function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${name}`);
    if (view) view.classList.add('active');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const btn = document.getElementById(`tab-${name}`);
    if (btn) btn.classList.add('active');
    if (accessToken && !tabInited[name]) {
        tabInited[name] = true;
        if (name === 'dashboard') fetchAndProcess();
        if (name === 'gastos')    gastos_cargarHistorial();
        if (name === 'fijos')     fijos_cargarDatos();
        if (name === 'deudas')    deudas_cargarDatos();
        if (name === 'plan')      planner_cargarVista();
        if (name === 'autos')     autos_cargarVista();
        if (name === 'propiedades') propiedades_cargarVista();
        if (name === 'estudio')   estudio_cargarVista();
    }
}

function refreshCurrentTab() {
    tabInited[currentTab] = false;
    showTab(currentTab);
}

// =============================================
// GOOGLE AUTH
// =============================================
function startGoogleLogin() {
    if (window.google?.accounts?.oauth2) { requestToken({ interactive: true }); return; }
    const btn = document.getElementById('login-google-btn');
    btn.innerText = 'Cargando...'; btn.disabled = true;
    const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(iv); btn.innerText = 'Iniciar Sesión con Google'; btn.disabled = false;
            requestToken({ interactive: true });
        }
    }, 200);
    setTimeout(() => { clearInterval(iv); btn.innerText = 'Error: reintenta'; btn.disabled = false; }, 10000);
}

async function requestToken(options = {}) {
    const interactive = options.interactive !== false;
    if (tokenRequestInFlight) {
        if (interactive && !tokenRequestInteractive) {
            tokenRequestInFlight = null;
            if (tokenRequestWatchdog) {
                clearTimeout(tokenRequestWatchdog);
                tokenRequestWatchdog = null;
            }
        } else {
            return tokenRequestInFlight;
        }
    }

    tokenRequestInFlight = new Promise((resolve) => {
        tokenRequestInteractive = interactive;
        tokenRequestWatchdog = setTimeout(() => {
            tokenRequestInFlight = null;
            tokenRequestWatchdog = null;
            resolve(false);
        }, 12000);
        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: (res) => {
                    if (tokenRequestWatchdog) {
                        clearTimeout(tokenRequestWatchdog);
                        tokenRequestWatchdog = null;
                    }
                    const ok = !!res?.access_token;
                    if (ok) {
                        accessToken = res.access_token;
                        const expiresInSec = Number(res.expires_in) || TOKEN_LIFETIME_FALLBACK_SEC;
                        localStorage.setItem(TOKEN_KEY, accessToken);
                        localStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresInSec * 1000));
                        scheduleTokenRefresh();
                        debugUpdate({ token: 'Si (cache)', auth: 'Google OAuth OK' });
                        hideLoginModal();
                        if (tokenRequestInteractive) {
                            // Recover redirect session if any; connect Firebase lazily on account save.
                            firebase_restoreRedirectResult().then(() => {
                                if (!_fbUid) debugUpdate({ auth: 'Google OK · Firebase pendiente' });
                                balance_loadAccounts().then(() => balance_updateKpi());
                            });
                            showTab('dashboard');
                        }
                    } else if (tokenRequestInteractive) {
                        showLoginModal();
                    }
                    resolve(ok);
                    tokenRequestInFlight = null;
                },
            });
        }
        try {
            tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
        } catch (_) {
            if (tokenRequestWatchdog) {
                clearTimeout(tokenRequestWatchdog);
                tokenRequestWatchdog = null;
            }
            tokenRequestInFlight = null;
            resolve(false);
        }
    });

    return tokenRequestInFlight;
}

function showLoginModal() {
    const m = document.getElementById('modal-api');
    if (m) { m.style.display = 'flex'; m.style.alignItems = 'center'; m.style.justifyContent = 'center'; }
    const b = document.getElementById('modal-backdrop');
    if (b) b.style.display = 'block';
}
function hideLoginModal() {
    const m = document.getElementById('modal-api'); if (m) m.style.display = 'none';
    const b = document.getElementById('modal-backdrop'); if (b) b.style.display = 'none';
}

// =============================================
// SHEETS API HELPERS
// =============================================

function logout() {
    const tokenToRevoke = accessToken;
    clearAccessTokenCache();
    firebase_signOut(); // clear Firebase auth state
    // Revoke Google token if possible
    if (window.google?.accounts?.oauth2 && tokenToRevoke) {
        google.accounts.oauth2.revoke(tokenToRevoke, () => { console.log('Token revoked') });
    }
    balance_stopRealtimeSync();
    debugUpdate({ auth: 'Sesion cerrada', uid: '-', token: 'No', load: '-', save: '-' });
    showLoginModal();
}

async function ensureValidAccessToken() {
    const expiryTs = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
    if (accessToken && Date.now() < (expiryTs - 20_000)) return true;
    if (window.google?.accounts?.oauth2) {
        const ok = await requestToken({ interactive: false });
        if (ok) return true;
    }
    clearAccessTokenCache();
    return false;
}

async function authFetch(url, options = {}, retry401 = true) {
    const valid = await ensureValidAccessToken();
    if (!valid) throw { status: 401, message: 'No auth token' };
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` };
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401 && retry401) {
        const refreshed = await requestToken({ interactive: false });
        if (!refreshed) {
            clearAccessTokenCache();
            throw { status: 401, message: await res.text() };
        }
        const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` };
        res = await fetch(url, { ...options, headers: retryHeaders });
    }
    return res;
}

async function sheetsGet(ssId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const r = await authFetch(url);
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return (await r.json()).values || [];
}

async function sheetsAppend(ssId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const r = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function sheetsUpdate(ssId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const r = await authFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function sheetsDeleteRow(ssId, sheetId, rowIndex0) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}:batchUpdate`;
    const r = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex0, endIndex: rowIndex0 + 1 } } }] }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function getSheetId(ssId, sheetName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=sheets.properties`;
    const r = await authFetch(url);
    if (!r.ok) throw { status: r.status, message: await r.text() };
    const data = await r.json();
    const s = data.sheets?.find(s => s.properties.title === sheetName);
    return s ? s.properties.sheetId : 0;
}

async function sheetsClear(ssId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}:clear`;
    const r = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

// ── Drive API helpers ─────────────────────────────────────
async function driveFindFolder(name) {
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
    const r = await authFetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data.files?.[0]?.id || null;
}

async function driveFindSpreadsheetByName(name, parentId = null) {
    const parentFilter = parentId ? ` and '${parentId}' in parents` : '';
    const q = encodeURIComponent(
        `name='${name}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${parentFilter}`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc`;
    const r = await authFetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data.files?.[0]?.id || null;
}

async function driveCreateSpreadsheet(name, parentId) {
    const body = { name, mimeType: 'application/vnd.google-apps.spreadsheet' };
    if (parentId) body.parents = [parentId];
    const url = 'https://www.googleapis.com/drive/v3/files';
    const r = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return (await r.json()).id;
}

// Upload a File object to a Drive folder and return the sharing URL
async function driveUploadFile(file, folderId) {
    // Drive API multipart upload requires Content-Type: multipart/related (NOT form-data).
    // Using Blob array lets us mix text boundaries with binary File data correctly.
    const meta = { name: file.name };
    if (folderId) meta.parents = [folderId];
    const metaJson = JSON.stringify(meta);
    const boundary = 'findb_' + Date.now();

    const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`,
        `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
        file,
        `\r\n--${boundary}--`
    ]);

    const r = await authFetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
        {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
        }
    );
    if (!r.ok) {
        const errText = await r.text();
        throw new Error(`Drive upload failed (${r.status}): ${errText}`);
    }
    const res = await r.json();
    // Make file publicly readable (anyone with link)
    await authFetch(`https://www.googleapis.com/drive/v3/files/${res.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return res.webViewLink;
}

async function driveDeleteFile(fileId) {
    if (!fileId) return;
    await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
    });
}

function handleApiError(err, el) {
    console.error('API Error:', err);
    if (err.status === 401) {
        clearAccessTokenCache();
        showLoginModal();
    } else if (el) {
        el.innerHTML = '<div class="empty-state text-danger">⚠️ Error al cargar. Intenta de nuevo.</div>';
    }
}

// =============================================
// DASHBOARD MODULE
// =============================================
async function fetchAndProcess() {
    const status = document.getElementById('sync-status');
    status.innerText = 'Sincronizando...'; status.style.color = 'var(--primary)';
    try {
        await ensureUsdMxnRateForTransactions();
        const [logData, fixedData] = await Promise.all([
            sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H'),
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:N')  // H=estado pagos, I=periodicidad, J=inicio, K=pagador, L=budget, M=moneda, N=waive
        ]);
        processAndRender(logData, fixedData);
        status.innerText = 'Sincronizado ✓'; status.style.color = 'var(--accent-green)';
    } catch (err) {
        if (err.status === 401) {
            status.innerText = 'Sesión expirada'; status.style.color = 'var(--accent-orange)';
            clearAccessTokenCache();
            showLoginModal();
        } else {
            status.innerText = 'Error al cargar'; status.style.color = 'var(--accent-orange)';
        }
    }
}

function processAndRender(logRows, fixedRows) {
    balance_updateLogNetFromRows(logRows);
    const hormigaKeywords = [
        'oxxo','coca','cigarros','snacks','gomitas','tiendita','starbucks','seven','7-eleven','extra',
        'dulces','chicles','golosinas','chocolate','tamarindos','cine','brincolines',
        'lerele','danny trova','dany trova'
    ];
    const imprevistoKeywords = [
        'restaurante','restaurant','comida fuera','comidas fuera','fuera de casa',
        'enfermedad','enfermo','medico','doctor','farmacia','medicina','medicinas','hospital',
        'clinica','consulta','laboratorio','analisis'
    ];
    let hormigaTotal = 0, hormigaChartData = [];
    let hormigaGastos = []; // Guardaremos detalle para el panel
    let hormigaPrevTotal = 0; // Previous month hormiga total
    let imprevistoTotal = 0;
    let imprevistoPrevTotal = 0;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    // Previous month (handles January → December of previous year)
    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const prevMonth     = prevMonthDate.getMonth();
    const prevYear      = prevMonthDate.getFullYear();
    const mNames = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const monthName     = mNames[currentMonth];
    const prevMonthName = mNames[prevMonth];

    // Update KPI titles to show the restriction visually
    const kpiLabel = document.querySelector('#kpi-hormiga-card .label');
    if (kpiLabel) kpiLabel.innerHTML = `Gasto Hormiga (${monthName}) <span class="kpi-tap-hint">↗</span>`;
    const panelTitle = document.getElementById('hormiga-panel-title');
    if (panelTitle) panelTitle.innerText = `🍔 Gasto Hormiga (${monthName})`;

    logRows.forEach(row => {
        const concepto = (row[2] || '').toLowerCase();
        const lugar    = (row[1] || '').toLowerCase();
        const moneda   = parseCurrencyCode(row[7]);
        const monto    = convertTransactionAmountToMxn(parseSheetValue(row[3]), moneda);
        const fecha    = row[0] || '';
        const tipo = (row[4] || '').toLowerCase();
        if (tipo !== 'gasto') return;

        const isAutoRepair = (row[5] || '').toString().toLowerCase().includes('auto - reparaciones') || concepto.includes('autolog#');
        const isImprevisto = isAutoRepair || imprevistoKeywords.some(k => concepto.includes(k) || lugar.includes(k));
        if (isImprevisto) {
            const parsedDate = parseSheetDate(fecha);
            if (parsedDate.getMonth() === currentMonth && parsedDate.getFullYear() === currentYear) {
                imprevistoTotal += monto;
            }
            if (parsedDate.getMonth() === prevMonth && parsedDate.getFullYear() === prevYear) {
                imprevistoPrevTotal += monto;
            }
            return;
        }

        // FIX: use toLowerCase() so 'Gasto'/'gasto'/'GASTO' all match
        if (hormigaKeywords.some(k => concepto.includes(k) || lugar.includes(k))) {
            const parsedDate = parseSheetDate(fecha);
            
            // SIEMPRE agregamos a la gráfica para tener historial completo
            const formattedDate = normalizeDateString(fecha);
            hormigaChartData.push({ x: formattedDate, y: monto });

            // Solo incluir gastos del mes corriente en los indicadores visuales y panel
            if (parsedDate.getMonth() === currentMonth && parsedDate.getFullYear() === currentYear) {
                hormigaTotal += monto;
                hormigaGastos.push({ lugar: row[1] || 'Oxxo', concepto: row[2] || '', monto });
            }
            // Acumulamos el mes anterior para comparación
            if (parsedDate.getMonth() === prevMonth && parsedDate.getFullYear() === prevYear) {
                hormigaPrevTotal += monto;
            }
        }
    });


    // F = pagado legacy, G = pagos por mes, H = estado pagos, I = periodicidad, J = inicio, K = pagador
    const fixedExpenses = fixedRows.map((row, i) => {
        const concepto = row[1] || '';
        const categoria = row[4] || 'General';
        const moneda = parseCurrencyCode(row[12]);
        const gRaw = parseSheetValue(row[2]);  // gasto column (raw currency)
        const nRaw = parseSheetValue(row[3]);  // ingreso column (raw currency)
        const g = convertTransactionAmountToMxn(gRaw, moneda);
        const n = convertTransactionAmountToMxn(nRaw, moneda);
        const tipo = g > 0 ? 'gasto' : 'ingreso';
        const monto = g || n;
        const montoOriginal = gRaw || nRaw;
        const legacyPaid = parseBool(row[5]);
        const pagosMes = parsePaymentsTotal(row[6]);
        const pagosEstado = parsePaymentStates(row[7], pagosMes, legacyPaid);
        const waivedEstado = parseWaiveStates(row[13], pagosMes, pagosEstado);
        const pagosHechos = pagosEstado.filter(Boolean).length;
        const isPaid   = pagosHechos >= pagosMes;
        const periodicidad = parseFixedPeriodicity(row[8]);
        const inicioMes = parseStartMonth(row[9], `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`);
        const isDueThisMonth = isFixedDueThisMonth(periodicidad, inicioMes, `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`);
        const partAmount = Math.abs(monto) / (pagosMes || 1);
        const paidAmount = partAmount * Math.max(0, pagosHechos);
        const pendingAmount = partAmount * Math.max(0, pagosMes - pagosHechos);
        return { rowNum: i + 2, concepto, categoria, monto, montoOriginal, moneda, tipo, isPaid, pagosMes, pagosEstado, waivedEstado, pagosHechos, paidAmount, pendingAmount, periodicidad, inicioMes, isDueThisMonth, pagador: parseFixedPayer(row[10]), budgetCategory: parseBudgetCategory(row[11]) };
    }).filter(e => e.concepto);

    // KPI: count partial progress for fixed expenses
    const fixedGastos   = fixedExpenses.filter(e => e.tipo === 'gasto' && e.isDueThisMonth);
    const fixedIngresos = fixedExpenses.filter(e => e.tipo === 'ingreso' && e.isDueThisMonth);
    const fixedTotal    = fixedGastos.reduce((s, e) => s + Math.max(0, e.pendingAmount), 0);
    const pendingIncome = fixedIngresos.reduce((s, e) => s + Math.max(0, e.pendingAmount), 0);
    const fixedPaidTotal = fixedGastos.reduce((s, e) => s + Math.max(0, e.paidAmount), 0);
    const paidParts     = fixedGastos.reduce((s, e) => s + (e.pagosHechos || 0), 0);
    const totalParts    = fixedGastos.reduce((s, e) => s + (e.pagosMes || 1), 0);
    const pendingFixed  = fixedTotal;   // already only unpaid gastos

    // Update balance module with current pending fixed expenses
    balancePendingFixed = pendingFixed;
    balancePendingFixedIncome = pendingIncome;
    balancePaidFixedTotal = fixedPaidTotal;
    balance_updateKpi();

    document.getElementById('gasto-hormiga-total').innerText = formatCurrency(hormigaTotal);
    const imprevEl = document.getElementById('gasto-imprevisto-diff');
    if (imprevEl) {
        const prevHint = imprevistoPrevTotal > 0 ? ` · mes ant ${formatCurrency(imprevistoPrevTotal)}` : '';
        imprevEl.innerText = `Imprevistos: ${formatCurrency(imprevistoTotal)}${prevHint}`;
        imprevEl.className = `diff-label ${imprevistoTotal > 0 ? 'text-danger' : ''}`;
    }
    balance_setFixedTotalKpi(fixedTotal);
    balance_updateFixedCoverageKpi();
    document.getElementById('pago-status').innerText =
        totalParts > 0 && paidParts >= totalParts
            ? `✅ \u00a1Todo pagado!`
            : `${paidParts}/${totalParts} Pagos`;

    dashboardFixedPayerStats.yo.pending = fixedGastos
        .filter(e => e.pagador === 'yo')
        .reduce((s, e) => s + Math.max(0, e.pendingAmount), 0);
    dashboardFixedPayerStats.yo.paid = fixedGastos
        .filter(e => e.pagador === 'yo')
        .reduce((s, e) => s + Math.max(0, e.paidAmount), 0);
    dashboardFixedPayerStats.esposa.pending = fixedGastos
        .filter(e => e.pagador === 'esposa')
        .reduce((s, e) => s + Math.max(0, e.pendingAmount), 0);
    dashboardFixedPayerStats.esposa.paid = fixedGastos
        .filter(e => e.pagador === 'esposa')
        .reduce((s, e) => s + Math.max(0, e.paidAmount), 0);
    dashboardFixedPayerStats.yo.total = dashboardFixedPayerStats.yo.pending + dashboardFixedPayerStats.yo.paid;
    dashboardFixedPayerStats.esposa.total = dashboardFixedPayerStats.esposa.pending + dashboardFixedPayerStats.esposa.paid;
    fixed_renderPanel();

    // Show only entries that still have pending parts
    renderFixedTable(fixedExpenses.filter(e => e.isDueThisMonth && !e.isPaid));
    renderChart(hormigaChartData);
    renderHormigaPanel(hormigaGastos, hormigaTotal, hormigaPrevTotal, monthName, prevMonthName);
}

function renderFixedTable(expenses) {
    if (Array.isArray(expenses)) dashboardFixedState.entries = expenses;
    const tbody = document.getElementById('fixed-expenses-body');
    if (!tbody) return;
    const base = dashboardFixedState.entries || [];
    const q = dashboardFixedState.query || '';
    const filtered = !q
        ? base
        : base.filter(e => `${e.concepto} ${(e.categoria || '')}`.toLowerCase().includes(q));
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin resultados</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(e => {
        const pagosMes = e.pagosMes || 1;
        const botonesPagos = pagosMes === 1
            ? (() => {
                const clsPart = e.isPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                const isWaived = !!(e.waivedEstado && e.waivedEstado[0]);
                const lbl = e.isPaid ? (isWaived ? '🟡 Waived' : '✅ Pagado') : '⏳ Pendiente';
                return `<button class="${clsPart}" ${fixedPartButtonAttrs(e.rowNum, 0, 'dashboard')}>${lbl}</button>`;
            })()
            : e.pagosEstado.map((isPartPaid, idx) => {
                const clsPart = isPartPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                const isWaived = !!(e.waivedEstado && e.waivedEstado[idx]);
                return `<button class="${clsPart} fixed-remote-btn" ${fixedPartButtonAttrs(e.rowNum, idx, 'dashboard')}>${isPartPaid && isWaived ? 'W' : (idx + 1)}</button>`;
            }).join('');
        const controlsClass = pagosMes === 1 ? 'fixed-remote-controls fixed-remote-controls--single' : 'fixed-remote-controls fixed-remote-controls--parts';
        const controlsStyle = pagosMes === 1 ? '' : `style="grid-template-columns:repeat(${pagosMes}, minmax(0, 1fr));"`;
        return `
        <tr>
          <td>${e.concepto}</td>
          <td class="${e.tipo === 'ingreso' ? 'text-success' : ''}" style="${e.tipo === 'ingreso' ? 'font-weight:700;' : ''}">${formatCurrency(Math.max(0, e.pendingAmount ?? Math.abs(e.monto || 0)))}</td>
          <td>
            <div class="${controlsClass}" ${controlsStyle}>${botonesPagos}</div>
          </td>
        </tr>`;
    }).join('');
}

function dashboard_openFixedSearch() {
    const modal = document.getElementById('fixed-search-modal');
    const input = document.getElementById('fixed-search-input');
    if (!modal || !input) return;
    modal.classList.remove('hidden');
    input.value = dashboardFixedState.query;
    setTimeout(() => input.focus(), 0);
}

function dashboard_closeFixedSearch() {
    const modal = document.getElementById('fixed-search-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function fixed_openPanel() {
    fixed_renderPanel();
    document.getElementById('fixed-panel')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function fixed_closePanel() {
    document.getElementById('fixed-panel')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function fixed_renderPanel() {
    const yoPendingEl = document.getElementById('fixed-yo-pending');
    const yoPaidEl = document.getElementById('fixed-yo-paid');
    const yoTotalEl = document.getElementById('fixed-yo-total');
    const esposaPendingEl = document.getElementById('fixed-esposa-pending');
    const esposaPaidEl = document.getElementById('fixed-esposa-paid');
    const esposaTotalEl = document.getElementById('fixed-esposa-total');
    if (!yoPendingEl || !yoPaidEl || !yoTotalEl || !esposaPendingEl || !esposaPaidEl || !esposaTotalEl) return;
    yoPendingEl.innerText = formatCurrency(dashboardFixedPayerStats.yo.pending);
    yoPaidEl.innerText = formatCurrency(dashboardFixedPayerStats.yo.paid);
    yoTotalEl.innerText = formatCurrency(dashboardFixedPayerStats.yo.total);
    esposaPendingEl.innerText = formatCurrency(dashboardFixedPayerStats.esposa.pending);
    esposaPaidEl.innerText = formatCurrency(dashboardFixedPayerStats.esposa.paid);
    esposaTotalEl.innerText = formatCurrency(dashboardFixedPayerStats.esposa.total);
}

window.dashboard_togglePagoPart = async function(id, partIndex, options = {}) {
    try {
        await fijos_cargarDatos();
        await window.fijos_togglePagoPart(id, partIndex, options);
        if (currentTab === 'dashboard') {
            await fetchAndProcess();
        }
    } catch (e) {
        console.error('Error toggling dashboard fixed payment:', e);
        showToast('⚠️ Error al actualizar pago');
    }
};

function fixedPartButtonAttrs(id, partIndex, source) {
    return `onpointerdown="fixed_partPointerDown(${id}, ${partIndex}, '${source}')" onpointerup="fixed_partPointerUp()" onpointerleave="fixed_partPointerUp()" onpointercancel="fixed_partPointerUp()" onclick="fixed_partClick(${id}, ${partIndex}, '${source}')"`;
}

window.fixed_partPointerDown = function(id, partIndex, source) {
    if (fixedPressState.timer) clearTimeout(fixedPressState.timer);
    const key = `${source}:${id}:${partIndex}`;
    fixedPressState.timer = setTimeout(async () => {
        fixedPressState.suppressKey = key;
        await fixed_confirmWaive(id, partIndex, source);
    }, 650);
};

window.fixed_partPointerUp = function() {
    if (fixedPressState.timer) {
        clearTimeout(fixedPressState.timer);
        fixedPressState.timer = null;
    }
};

window.fixed_partClick = function(id, partIndex, source) {
    const key = `${source}:${id}:${partIndex}`;
    if (fixedPressState.suppressKey === key) {
        fixedPressState.suppressKey = null;
        return;
    }
    if (source === 'dashboard') {
        window.dashboard_togglePagoPart(id, partIndex);
    } else {
        window.fijos_togglePagoPart(id, partIndex);
    }
};

async function fixed_confirmWaive(id, partIndex, source) {
    const item = fijosState.allItems.find(i => i.id === id);
    if (item && item.pagosEstado && item.pagosEstado[partIndex]) return;
    const partLabel = item && (item.pagosMes || 1) > 1 ? ` (${partIndex + 1}/${item.pagosMes})` : '';
    const concepto = item?.concepto || 'este pago';
    const ok = confirm(`¿Waive ${concepto}${partLabel}?\n\nSe marcará como hecho solo este mes y NO se agregará a Control de Gastos.`);
    if (!ok) return;
    if (source === 'dashboard') {
        await window.dashboard_togglePagoPart(id, partIndex, { skipControlLog: true, waive: true });
    } else {
        await window.fijos_togglePagoPart(id, partIndex, { skipControlLog: true, waive: true });
    }
}

// =============================================
// HORMIGA PANEL DETAIL
// =============================================
function hormiga_openPanel() {
    document.getElementById('hormiga-panel').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function hormiga_closePanel() {
    document.getElementById('hormiga-panel').classList.add('hidden');
    document.body.style.overflow = '';
}

function renderHormigaPanel(gastos, total, prevTotal = 0, monthName = '', prevMonthName = '') {
    const currLabel = document.getElementById('bs-hormiga-label');
    const prevLabel = document.getElementById('bs-hormiga-prev-label');
    if (currLabel) currLabel.innerText = monthName ? `${monthName} (Actual)` : 'Este Mes';
    if (prevLabel) prevLabel.innerText = prevMonthName ? `${prevMonthName} (Anterior)` : 'Mes Anterior';
    document.getElementById('bs-hormiga-total').innerText = formatCurrency(total);
    const prevEl = document.getElementById('bs-hormiga-prev');
    if (prevEl) {
        prevEl.innerText = formatCurrency(prevTotal);
        // Color hint: if current > previous month, spending is up (danger); equal or less = okay
        prevEl.style.color = prevTotal === 0 ? 'var(--text-muted)'
            : total > prevTotal ? 'var(--accent-orange)' : 'var(--accent-green)';
    }
    
    // Agrupar por lugar/concepto
    const agrupados = {};
    gastos.forEach(g => {
        // Normalizamos el nombre (ej. "Oxxo" vs "oxxo")
        const key = g.lugar ? g.lugar.charAt(0).toUpperCase() + g.lugar.slice(1).toLowerCase() : 'Varios';
        agrupados[key] = (agrupados[key] || 0) + g.monto;
    });

    const arr = Object.keys(agrupados).map(k => ({ nombre: k, monto: agrupados[k] }));
    arr.sort((a,b) => b.monto - a.monto); // Mayor gasto primero

    const container = document.getElementById('hormiga-bars-container');
    if (!arr.length) {
        container.innerHTML = '<p class="text-muted" style="text-align:center;font-size:0.85rem">No hay registros aún</p>';
        return;
    }
    const maxMonto = arr[0].monto;

    container.innerHTML = arr.map(item => {
        const pct = Math.max(5, (item.monto / maxMonto) * 100);
        return `
        <div class="progress-bar-container">
            <div class="pb-header">
                <span class="pb-name">${item.nombre}</span>
                <span class="pb-amount">${formatCurrency(item.monto)}</span>
            </div>
            <div class="pb-track">
                <div class="pb-fill" style="width: ${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

// Chart mode: 'daily' | 'monthly'
let chartMode = 'daily';
let chartRawData = [];   // stored so the toggle can re-render without re-fetching

const DAYS_ES   = ['Domingo','Lunes','Martes','Mi\u00e9rcoles','Jueves','Viernes','S\u00e1bado'];
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function formatDailyLabel(isoDate) {
    // isoDate: 'YYYY-MM-DD' or similar string from sheets
    const d = new Date(isoDate + 'T12:00:00'); // noon to avoid TZ shift
    if (isNaN(d)) return isoDate;
    return `${DAYS_ES[d.getDay()]} ${d.getDate()}`; // e.g. "Jueves 22"
}

function formatMonthlyLabel(yyyyMM) {
    const [y, m] = yyyyMM.split('-');
    return `${MONTHS_ES[parseInt(m, 10) - 1]} ${y}`; // e.g. "Mar 2025"
}

window.setChartMode = function(mode) {
    chartMode = mode;
    ['daily', 'monthly'].forEach(m => {
        const btn = document.getElementById(`chart-toggle-${m}`);
        if (btn) btn.classList.toggle('active', m === mode);
    });
    if (chartRawData.length) _renderChartWithMode(chartRawData, mode);
};

function renderChart(data) {
    chartRawData = data;
    _renderChartWithMode(data, chartMode);
}

function _renderChartWithMode(data, mode) {
    let categories, values;

    if (mode === 'monthly') {
        // Group by YYYY-MM
        const grouped = data.reduce((a, c) => {
            const month = (c.x || '').slice(0, 7); // 'YYYY-MM'
            a[month] = (a[month] || 0) + c.y;
            return a;
        }, {});
        const months = Object.keys(grouped).sort();
        categories = months.map(formatMonthlyLabel);
        values = months.map(m => grouped[m]);
    } else {
        // Daily: group by date, format label
        const grouped = data.reduce((a, c) => { a[c.x] = (a[c.x] || 0) + c.y; return a; }, {});
        const dates = Object.keys(grouped).sort();
        categories = dates.map(formatDailyLabel);
        values = dates.map(d => grouped[d]);
    }

    const opts = {
        series: [{ name: 'Gasto Hormiga', data: values }],
        chart: {
            type: 'area', height: 220,
            toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent'
        },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', colors: ['#fbbf24'] },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1, opacityFrom: .7, opacityTo: .05,
                colorStops: [
                    { offset: 0,   color: '#fbbf24', opacity: .35 },
                    { offset: 100, color: '#fbbf24', opacity: 0   }
                ]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px' },
                rotate: -35,
                hideOverlappingLabels: true,
            }
        },
        yaxis: { show: false },
        grid: { borderColor: '#334155', strokeDashArray: 4 },
        tooltip: {
            theme: 'dark',
            y: { formatter: v => `$${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` }
        }
    };

    const container = document.getElementById('chart-hormiga');
    container.innerHTML = '';
    new ApexCharts(container, opts).render();
}

// =============================================
// CONTROL DE GASTOS MODULE
// =============================================
const gastosState = { allRows: [], offset: 0, search: '', detailRow: null, logSheetId: null };

function gastos_bindEvents() {
    document.getElementById('g-btn-save').addEventListener('click', gastos_guardar);
    document.getElementById('g-btn-cancel').addEventListener('click', gastos_cancelar);
    document.getElementById('g-search').addEventListener('input', e => {
        gastosState.search = e.target.value; gastosState.offset = 0; gastos_renderLista(false);
    });
    document.getElementById('g-btn-mas').addEventListener('click', () => {
        gastosState.offset += 10; gastos_renderLista(true);
    });
    document.getElementById('g-modal-close').addEventListener('click', gastos_cerrarModal);
    document.getElementById('g-modal-backdrop').addEventListener('click', gastos_cerrarModal);
    document.getElementById('g-modal-btn-editar').addEventListener('click', gastos_editarDesdeModal);
    document.getElementById('g-modal-btn-borrar').addEventListener('click', gastos_borrarDesdeModal);
    // File input feedback
    document.getElementById('g-fotos-input')?.addEventListener('change', () => {
        const inp = document.getElementById('g-fotos-input');
        const fb  = document.getElementById('g-fotos-feedback');
        fb.innerText = inp.files.length ? `✅ ${inp.files.length} archivo(s) seleccionado(s)` : '';
    });
}

async function gastos_cargarHistorial() {
    const lista = document.getElementById('g-lista');
    lista.innerHTML = '<div class="loading-spinner">⏳ Cargando...</div>';
    try {
        await ensureUsdMxnRateForTransactions();
        const rows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
        balance_updateLogNetFromRows(rows);
        gastosState.allRows = rows.map((row, i) => ({
            rowNum:   i + 2,
            fecha:    row[0] || '',
            lugar:    row[1] || '',
            concepto: row[2] || '',
            montoOriginal: parseSheetValue(row[3]),
            moneda:   parseCurrencyCode(row[7]),
            monto:    convertTransactionAmountToMxn(parseSheetValue(row[3]), parseCurrencyCode(row[7])),
            tipo:     normalizeTipo(row[4] || 'Gasto'),
            formaPago:row[5] || '',
            fotos:    row[6] || '',
        })).reverse();
        gastosState.offset = 0;
        gastos_renderLista(false);
        balance_updateKpi();
        const panel = document.getElementById('balance-panel');
        if (panel && !panel.classList.contains('hidden')) {
            balance_renderPanel();
        }
    } catch(e) { handleApiError(e, lista); }
}

function gastos_filteredRows() {
    const q = gastosState.search.toLowerCase();
    return q ? gastosState.allRows.filter(r =>
        r.lugar.toLowerCase().includes(q) || r.concepto.toLowerCase().includes(q) || r.tipo.toLowerCase().includes(q)
    ) : gastosState.allRows;
}

function gastos_renderLista(append) {
    const lista  = document.getElementById('g-lista');
    const btnMas = document.getElementById('g-btn-mas');
    const all    = gastos_filteredRows();
    const page   = all.slice(gastosState.offset, gastosState.offset + 10);
    const hayMas = all.length > gastosState.offset + 10;

    if (!append) {
        if (!page.length) { lista.innerHTML = '<div class="empty-state">Sin movimientos registrados</div>'; btnMas.classList.add('hidden'); return; }
        lista.innerHTML = '';
    }
    page.forEach(row => {
        const card = document.createElement('div');
        card.className = 'movimiento-card';
        const isGasto = normalizeTipo(row.tipo) === 'Gasto';
        const fechaStr = row.fecha ? formatFecha(row.fecha) : '';
        const clipIcon = row.fotos && row.fotos.length > 5 ? '<span class="mc-clip">📎</span>' : '';
        card.innerHTML = `
          <div class="mc-left">
            <span class="mc-fecha">${fechaStr}${clipIcon}</span>
            <span class="mc-lugar">${row.lugar || '—'}</span>
            <span class="mc-concepto">${row.concepto || '—'}${row.moneda === 'USD' ? ` · USD ${Number(row.montoOriginal || 0).toFixed(2)}` : ''}</span>
          </div>
          <div class="mc-right">
            <span class="mc-monto ${isGasto ? 'text-danger' : 'text-success'}">${isGasto ? '-' : '+'}${formatCurrency(row.monto)}</span>
            <span class="mc-pago">${row.formaPago || ''}</span>
          </div>`;
        card.addEventListener('click', () => gastos_abrirModal(row));
        lista.appendChild(card);
    });
    btnMas.classList.toggle('hidden', !hayMas);
}

async function gastos_guardar() {
    const btn      = document.getElementById('g-btn-save');
    const status   = document.getElementById('g-status');
    const lugar    = document.getElementById('g-lugar').value.trim();
    const monto    = document.getElementById('g-monto').value;
    const idFila   = document.getElementById('g-id-fila').value;
    const moneda   = parseCurrencyCode(document.getElementById('g-currency').value);

    if (!lugar || !monto) {
        status.innerText = '⚠️ Falta Lugar o Monto'; status.style.color = 'var(--accent-orange)'; return;
    }
    btn.disabled = true; btn.innerText = idFila ? 'Actualizando...' : 'Guardando...';
    const fecha    = new Date().toLocaleDateString('en-CA');
    const concepto = document.getElementById('g-concepto').value.trim();
    const tipo     = normalizeTipo(document.getElementById('g-tipo').value);
    const forma    = document.getElementById('g-forma-pago').value;

    // ── Upload photos to Drive (non-blocking: failure just skips photos) ──
    const fileInput = document.getElementById('g-fotos-input');
    let nuevasUrls = [];
    if (fileInput.files.length > 0) {
        btn.innerText = `Subiendo ${fileInput.files.length} archivo(s)...`;
        try {
            const RECIBOS_FOLDER = 'Jay App Recibos';
            let folderId = await driveFindFolder(RECIBOS_FOLDER);
            if (!folderId) {
                const r = await fetch('https://www.googleapis.com/drive/v3/files', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: RECIBOS_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
                });
                if (!r.ok) throw new Error(`Folder create failed (${r.status})`);
                folderId = (await r.json()).id;
            }
            for (const file of fileInput.files) {
                const url = await driveUploadFile(file, folderId);
                if (url) nuevasUrls.push(url);
            }
        } catch (driveErr) {
            // Drive API not enabled or permission error — save transaction anyway, warn user
            console.warn('Drive upload skipped:', driveErr);
            const isDriveDisabled = driveErr?.message?.includes('403');
            showToast(isDriveDisabled
                ? '⚠️ Foto no subida: Drive API no habilitada. El gasto se guardará sin recibo.'
                : `⚠️ Foto no subida: ${driveErr.message?.substring(0,60)}. El gasto se guardará.`,
                4000
            );
        }
        btn.innerText = idFila ? 'Actualizando...' : 'Guardando...';
    }

    // ── Save to Sheets ──────────────────────────────────
    try {
        if (idFila) {
            const existing = gastosState.detailRow?.fotos || '';
            const allUrls  = [existing, ...nuevasUrls].filter(Boolean).join(',');
            await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!B${idFila}:H${idFila}`, [[lugar, concepto, parseSheetValue(monto), tipo, forma, allUrls, moneda]]);
        } else {
            await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:H', [[fecha, lugar, concepto, parseSheetValue(monto), tipo, forma, nuevasUrls.join(','), moneda]]);
        }
        status.innerText = nuevasUrls.length
            ? '✅ ' + (idFila ? 'Actualizado con recibo' : 'Guardado con recibo')
            : '✅ ' + (idFila ? 'Actualizado' : 'Guardado');
        status.style.color = 'var(--accent-green)';
        gastos_cancelar();
        gastos_cargarHistorial();
    } catch(e) {
        console.error('gastos_guardar error:', e);
        const msg = e?.message || e?.status || 'Sin detalle';
        status.innerText = `❌ Error al guardar: ${msg.substring(0, 70)}`; status.style.color = '#f87171';
        btn.disabled = false; btn.innerText = idFila ? 'ACTUALIZAR' : 'GUARDAR';
    }
}

function gastos_cancelar() {
    document.getElementById('g-id-fila').value = '';
    document.getElementById('g-lugar').value = '';
    document.getElementById('g-concepto').value = '';
    document.getElementById('g-monto').value = '';
    document.getElementById('g-currency').value = 'MXN';
    const fi = document.getElementById('g-fotos-input');
    if (fi) fi.value = '';
    const fb = document.getElementById('g-fotos-feedback');
    if (fb) fb.innerText = '';
    const btn = document.getElementById('g-btn-save');
    btn.innerText = 'GUARDAR'; btn.disabled = false; btn.classList.remove('btn-edit-mode');
    document.getElementById('g-btn-cancel').classList.add('hidden');
    setTimeout(() => { document.getElementById('g-status').innerText = ''; }, 2500);
}

function gastos_abrirModal(row) {
    gastosState.detailRow = row;
    const isGasto = normalizeTipo(row.tipo) === 'Gasto';
    document.getElementById('g-m-monto').innerText = (isGasto ? '-' : '+') + formatCurrency(row.monto);
    document.getElementById('g-m-monto').className = `modal-monto-big ${isGasto ? 'text-danger' : 'text-success'}`;
    document.getElementById('g-m-lugar').innerText = row.lugar || '—';
    document.getElementById('g-m-concepto').innerText = row.concepto || '—';
    document.getElementById('g-m-fecha').innerText = row.fecha ? new Date(row.fecha).toLocaleDateString('es-MX', { weekday:'short', day:'numeric', month:'long', year:'numeric' }) : '—';
    const tipo = document.getElementById('g-m-tipo');
    tipo.innerText = normalizeTipo(row.tipo); tipo.className = `modal-badge ${isGasto ? 'badge-gasto' : 'badge-ingreso'}`;
    document.getElementById('g-m-pago').innerText = row.formaPago || '—';
    if (row.moneda === 'USD') {
        document.getElementById('g-m-concepto').innerText = `${row.concepto || '—'} · USD ${Number(row.montoOriginal || 0).toFixed(2)}`;
    }
    // ── Receipts with individual delete buttons ──────────
    const recibos = document.getElementById('g-m-recibos');
    if (row.fotos && row.fotos.length > 5) {
        recibos.innerHTML = row.fotos.split(',').filter(u => u.trim()).map((u, i) => `
          <div class="recibo-item" id="recibo-item-${i}">
            <a href="${u.trim()}" target="_blank" class="recibo-link">📄 Ver Recibo ${i+1}</a>
            <button class="recibo-del-btn" onclick="gastos_borrarRecibo('${u.trim()}', ${i})" title="Eliminar recibo">🗑️</button>
          </div>`).join('');
    } else {
        recibos.innerHTML = '<span class="text-muted">Sin recibos adjuntos</span>';
    }
    document.getElementById('g-modal').classList.remove('hidden');
    document.getElementById('g-modal-backdrop').classList.remove('hidden');
}

function gastos_cerrarModal() {
    document.getElementById('g-modal').classList.add('hidden');
    document.getElementById('g-modal-backdrop').classList.add('hidden');
    gastosState.detailRow = null;
}

function gastos_editarDesdeModal() {
    const row = gastosState.detailRow; if (!row) return;
    document.getElementById('g-lugar').value     = row.lugar;
    document.getElementById('g-concepto').value  = row.concepto;
    document.getElementById('g-monto').value     = row.montoOriginal;
    document.getElementById('g-currency').value  = row.moneda || 'MXN';
    document.getElementById('g-tipo').value      = row.tipo;
    document.getElementById('g-forma-pago').value= row.formaPago;
    document.getElementById('g-id-fila').value   = row.rowNum;
    const btn = document.getElementById('g-btn-save');
    btn.innerText = 'ACTUALIZAR'; btn.classList.add('btn-edit-mode');
    document.getElementById('g-btn-cancel').classList.remove('hidden');
    gastos_cerrarModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function gastos_borrarDesdeModal() {
    const row = gastosState.detailRow; if (!row) return;
    if (!confirm('¿Eliminar este movimiento y sus recibos definitivamente?')) return;
    gastos_cerrarModal();
    const status = document.getElementById('g-status');
    status.innerText = '🗑️ Borrando...';
    try {
        // Delete Drive files first
        if (row.fotos && row.fotos.length > 5) {
            for (const url of row.fotos.split(',').filter(u => u.trim())) {
                const match = url.match(/[-\w]{25,}/);
                if (match) await driveDeleteFile(match[0]).catch(() => {});
            }
        }
        if (gastosState.logSheetId === null) gastosState.logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
        await sheetsDeleteRow(SPREADSHEET_LOG_ID, gastosState.logSheetId, row.rowNum - 1);
        status.innerText = '✅ Eliminado'; status.style.color = 'var(--accent-green)';
        gastos_cargarHistorial();
    } catch(e) {
        console.error(e); status.innerText = '❌ Error al borrar'; status.style.color = '#f87171';
    }
}

window.gastos_borrarRecibo = async function(url, idx) {
    if (!confirm('¿Eliminar este recibo?')) return;
    const row = gastosState.detailRow; if (!row) return;
    try {
        // Remove URL from the list
        const urls = row.fotos.split(',').map(u => u.trim()).filter(u => u && u !== url);
        row.fotos = urls.join(',');
        // Update the sheet
        if (gastosState.logSheetId === null) gastosState.logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
        await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!G${row.rowNum}`, [[row.fotos]]);
        // Delete from Drive
        const match = url.match(/[-\w]{25,}/);
        if (match) await driveDeleteFile(match[0]).catch(() => {});
        // Refresh receipts area in modal
        gastosState.allRows = gastosState.allRows.map(r => r.rowNum === row.rowNum ? { ...r, fotos: row.fotos } : r);
        showToast('🗑️ Recibo eliminado');
        gastos_abrirModal(row); // re-render modal with updated list
    } catch(e) {
        console.error(e); showToast('❌ Error al borrar recibo');
    }
};

// =============================================
// GASTOS FIJOS MODULE
// =============================================
const fijosState = {
    allItems: [],
    categorias: [],
    filtrosActivos: [],
    sheetId: null,
    lastResetMonth: null,  // tracks month of last reset check
};
const RESET_MONTH_KEY = 'fijos_last_reset_month';

function fijos_bindEvents() {
    const sortEl = document.getElementById('f-sort');
    if (sortEl) sortEl.value = 'fechaAsc';
    document.getElementById('f-btn-add').addEventListener('click', () => fijos_abrirSheet(null));
    document.getElementById('f-btn-guardar').addEventListener('click', fijos_guardar);
    document.getElementById('f-search').addEventListener('input', fijos_aplicarFiltros);
    document.getElementById('f-sort').addEventListener('change', fijos_aplicarFiltros);
    document.getElementById('f-btn-filtro').addEventListener('click', fijos_abrirFiltro);
    document.getElementById('f-filter-clear').addEventListener('click', () => { fijosState.filtrosActivos = []; fijos_cerrarFiltro(); fijos_aplicarFiltros(); });
    document.getElementById('f-filter-apply').addEventListener('click', () => {
        fijosState.filtrosActivos = [...document.querySelectorAll('.f-filter-chk:checked')].map(cb => cb.value);
        fijos_cerrarFiltro(); fijos_aplicarFiltros();
    });
    document.getElementById('f-sheet-overlay').addEventListener('click', fijos_cerrarSheet);
    document.getElementById('f-filter-overlay').addEventListener('click', fijos_cerrarFiltro);
    document.getElementById('f-periodicidad').addEventListener('change', fijos_togglePeriodicityFields);
}

function planner_refreshIfReady() {
    if (!tabInited.plan) return;
    if (currentTab === 'plan') {
        planner_cargarVista();
        return;
    }
    tabInited.plan = false;
}

async function fijos_cargarDatos() {
    document.getElementById('f-lista').innerHTML = '<div class="loading-spinner">⏳ Cargando...</div>';
    try {
        await ensureUsdMxnRateForTransactions();
        const [rows, catRows] = await Promise.all([
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:N').catch(() => []),  // I=periodicidad, J=inicio, K=pagador, L=budget, M=moneda, N=waive
            sheetsGet(SPREADSHEET_FIXED_ID, 'Categorias!A:A').catch(() => [])
        ]);
        fijosState.categorias = catRows.map(r => r[0]).filter(Boolean);
        if (!fijosState.categorias.length) fijosState.categorias = ['General'];

        // ── Monthly Reset ──────────────────────────────────────────────
        // If month changed since last reset, clear all 'Pagado' checkboxes
        const nowMonth = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
        const storedMonth = localStorage.getItem(RESET_MONTH_KEY);
        if (storedMonth && storedMonth !== nowMonth && rows.length > 0) {
            console.log('[fijos] Nuevo mes detectado — reseteando progreso de pagos');
            const lastRow = rows.length + 1;
            await sheetsUpdate(
                SPREADSHEET_FIXED_ID,
                `Hoja 1!F2:F${lastRow}`,
                rows.map(() => ['FALSE'])
            ).catch(e => console.warn('Reset mensual falló:', e));
            await sheetsUpdate(
                SPREADSHEET_FIXED_ID,
                `Hoja 1!H2:H${lastRow}`,
                rows.map(r => [serializePaymentStates(new Array(parsePaymentsTotal(r[6])).fill(false))])
            ).catch(e => console.warn('Reset mensual estado pagos falló:', e));
            await sheetsUpdate(
                SPREADSHEET_FIXED_ID,
                `Hoja 1!N2:N${lastRow}`,
                rows.map(r => [serializePaymentStates(new Array(parsePaymentsTotal(r[6])).fill(false))])
            ).catch(e => console.warn('Reset mensual waived falló:', e));
        }
        // Always store current month
        localStorage.setItem(RESET_MONTH_KEY, nowMonth);
        // ─────────────────────────────────────────────────────────────

        fijosState.allItems = rows.map((row, i) => {
            const dayOfMonth = parseDayOfMonth(row[0]);
            const moneda = parseCurrencyCode(row[12]);
            const gRaw   = parseSheetValue(row[2]);
            const nRaw   = parseSheetValue(row[3]);
            const g      = convertTransactionAmountToMxn(gRaw, moneda);
            const n      = convertTransactionAmountToMxn(nRaw, moneda);
            const pagosMes = parsePaymentsTotal(row[6]);
            const pagosEstado = parsePaymentStates(row[7], pagosMes, parseBool(row[5]));
            const waivedEstado = parseWaiveStates(row[13], pagosMes, pagosEstado);
            const pagosHechos = pagosEstado.filter(Boolean).length;
            const isPaid = pagosHechos >= pagosMes;
            const periodicidad = parseFixedPeriodicity(row[8]);
            const inicioMes = parseStartMonth(row[9], nowMonth);
            const isDueThisMonth = isFixedDueThisMonth(periodicidad, inicioMes, nowMonth);
            return {
                id: i + 2,
                fecha: `Día ${dayOfMonth}`,
                fechaValue: String(dayOfMonth).padStart(2, '0'),
                diaMes: dayOfMonth,
                concepto:   row[1] || '',
                monto:      g || n,
                montoOriginal: gRaw || nRaw,
                moneda,
                tipo:       g > 0 ? 'gasto' : 'ingreso',
                categoria:  row[4] || 'General',
                isPaid,
                pagosMes,
                pagosEstado,
                waivedEstado,
                pagosHechos,
                periodicidad,
                inicioMes,
                isDueThisMonth,
                pagador: parseFixedPayer(row[10]),
                budgetCategory: parseBudgetCategory(row[11]),
            };
        }).filter(i => i.concepto).sort((a, b) => a.diaMes - b.diaMes);

        fijos_generarPills();
        fijos_syncDashboardStats();
        fijos_aplicarFiltros();
        planner_refreshIfReady();
    } catch(e) { handleApiError(e, document.getElementById('f-lista')); }
}

function fijos_generarPills() {
    const pills = cat => {
        const typePills = [
            `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="__tipo_gasto" id="${cat}___tipo_gasto">🔴 Gastos</label>`,
            `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="__tipo_ingreso" id="${cat}___tipo_ingreso">🟢 Ingresos</label>`,
            `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="__payer_yo" id="${cat}___payer_yo">👤 Pago propio</label>`,
            `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="__payer_esposa" id="${cat}___payer_esposa">👩 Pago esposa</label>`,
        ].join('');
        const categoryPills = fijosState.categorias
            .map(c => `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="${c}" id="${cat}_${c}">${c}</label>`)
            .join('');
        return typePills + categoryPills;
    };
    document.getElementById('f-cat-checks').innerHTML = pills('f-cat-chk');
    document.getElementById('f-filter-checks').innerHTML = pills('f-filter-chk');
    fijosState.filtrosActivos.forEach(c => { const el = document.querySelector(`.f-filter-chk[value="${c}"]`); if (el) el.checked = true; });
}

function fijos_syncDashboardStats() {
    const fixedGastos = fijosState.allItems.filter(i => i.tipo === 'gasto' && i.isDueThisMonth);
    const fixedIngresos = fijosState.allItems.filter(i => i.tipo === 'ingreso' && i.isDueThisMonth);
    const pendingFixed = fixedGastos.reduce((s, i) => {
        const unpaidParts = Math.max(0, (i.pagosMes || 1) - (i.pagosHechos || 0));
        const partAmount = Math.abs(i.monto || 0) / (i.pagosMes || 1);
        return s + (unpaidParts * partAmount);
    }, 0);
    const paidFixed = fixedGastos.reduce((s, i) => {
        const paidParts = Math.max(0, i.pagosHechos || 0);
        const partAmount = Math.abs(i.monto || 0) / (i.pagosMes || 1);
        return s + (paidParts * partAmount);
    }, 0);
    const pendingIncome = fixedIngresos.reduce((s, i) => {
        const unpaidParts = Math.max(0, (i.pagosMes || 1) - (i.pagosHechos || 0));
        const partAmount = Math.abs(i.monto || 0) / (i.pagosMes || 1);
        return s + (unpaidParts * partAmount);
    }, 0);
    const paidParts = fixedGastos.reduce((s, i) => s + Math.max(0, i.pagosHechos || 0), 0);
    const totalParts = fixedGastos.reduce((s, i) => s + Math.max(1, i.pagosMes || 1), 0);

    const statusEl = document.getElementById('pago-status');
    balance_setFixedTotalKpi(pendingFixed);
    balance_updateFixedCoverageKpi();
    if (statusEl) {
        statusEl.innerText = totalParts > 0 && paidParts >= totalParts
            ? '✅ ¡Todo pagado!'
            : `${paidParts}/${totalParts} Pagos`;
    }

    balancePendingFixed = pendingFixed;
    balancePendingFixedIncome = pendingIncome;
    balancePaidFixedTotal = paidFixed;
}

function fijos_aplicarFiltros() {
    const q    = document.getElementById('f-search').value.toLowerCase();
    const sort = document.getElementById('f-sort').value;
    const fmt  = new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' });
    let lista  = fijosState.allItems.filter(item => {
        const t = item.concepto.toLowerCase().includes(q) || item.categoria.toLowerCase().includes(q);
        const tipoActivos = fijosState.filtrosActivos.filter(f => f === '__tipo_gasto' || f === '__tipo_ingreso');
        const payerActivos = fijosState.filtrosActivos.filter(f => f === '__payer_yo' || f === '__payer_esposa');
        const catActivos = fijosState.filtrosActivos.filter(f => !f.startsWith('__tipo_'));
        const tipoOk = !tipoActivos.length
            || (tipoActivos.includes('__tipo_gasto') && item.tipo === 'gasto')
            || (tipoActivos.includes('__tipo_ingreso') && item.tipo === 'ingreso');
        const payerOk = !payerActivos.length
            || (payerActivos.includes('__payer_yo') && item.pagador === 'yo')
            || (payerActivos.includes('__payer_esposa') && item.pagador === 'esposa');
        const catOk = !catActivos.filter(f => !f.startsWith('__payer_')).length
            || catActivos.filter(f => !f.startsWith('__payer_')).some(f => item.categoria.split(', ').includes(f));
        return t && tipoOk && payerOk && catOk && item.isDueThisMonth;
    });
    lista.sort((a,b) => {
        if (sort==='fechaDesc') return b.fechaValue.localeCompare(a.fechaValue);
        if (sort==='fechaAsc')  return a.fechaValue.localeCompare(b.fechaValue);
        return a.concepto.localeCompare(b.concepto);
    });
    let gastoT = 0, ingresoT = 0;
    lista.forEach(i => {
        const totalParts = i.pagosMes || 1;
        const unpaidParts = Math.max(0, totalParts - (i.pagosHechos || 0));
        const partAmount = Math.abs(i.monto || 0) / totalParts;
        const pendingAmount = unpaidParts * partAmount;
        if (i.tipo === 'gasto') gastoT += pendingAmount;
        else ingresoT += pendingAmount;
    });
    const fBalanceEl = document.getElementById('f-balance');
    const fixedNet = ingresoT - gastoT;
    const fixedWithAvailableBalance = fixedNet + balance_getTotal();
    if (fBalanceEl) {
        fBalanceEl.innerText = fmt.format(fixedWithAvailableBalance);
        fBalanceEl.classList.toggle('text-danger', fixedWithAvailableBalance < 0);
    }
    document.getElementById('f-ingresos').innerText     = fmt.format(ingresoT);
    document.getElementById('f-gastos-total').innerText = fmt.format(gastoT);
    const badge = document.getElementById('f-filtro-badge');
    badge.textContent = fijosState.filtrosActivos.length || '';
    badge.style.display = fijosState.filtrosActivos.length ? 'flex' : 'none';
    fijos_renderLista(lista);
}

function fijos_renderLista(lista) {
    const el  = document.getElementById('f-lista');
    const fmt = new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'});
    if (!lista.length) { el.innerHTML = '<div class="empty-state">Sin movimientos</div>'; return; }
    el.innerHTML = lista.map(item => {
        const sign     = item.tipo==='gasto' ? '-' : '+';
        const cls      = item.tipo==='gasto' ? 'text-danger' : 'text-success';
        const montoParcial = item.pagosMes > 0 ? (item.monto / item.pagosMes) : item.monto;
        const currencyHint = item.moneda === 'USD' ? ` · USD ${Number(item.montoOriginal || 0).toFixed(2)}` : '';
        const pendingParts = Math.max(0, (item.pagosMes || 1) - (item.pagosHechos || 0));
        const pendingAmount = (Math.abs(item.monto || 0) / (item.pagosMes || 1)) * pendingParts;
        const botonesPagos = item.pagosMes === 1
            ? (() => {
                const clsPart = item.isPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                const isWaived = !!(item.waivedEstado && item.waivedEstado[0]);
                const lbl = item.isPaid ? (isWaived ? '🟡 Waived' : '✅ Pagado') : '⏳ Pendiente';
                return `<button class="${clsPart}" ${fixedPartButtonAttrs(item.id, 0, 'fijos')}>${lbl}</button>`;
            })()
            : item.pagosEstado.map((isPartPaid, idx) => {
                const clsPart = isPartPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                const isWaived = !!(item.waivedEstado && item.waivedEstado[idx]);
                return `<button class="${clsPart}" style="min-width:44px;padding:.35rem .45rem;font-size:.72rem" ${fixedPartButtonAttrs(item.id, idx, 'fijos')}>${isPartPaid && isWaived ? 'W' : (idx + 1)}</button>`;
            }).join('');
        return `<div class="movimiento-card ${item.isPaid ? 'card-paid' : ''}">
          <div class="mc-left">
            <span class="mc-fecha">${item.fecha}</span>
            <span class="mc-lugar">${item.concepto}</span>
            <span class="mc-concepto">${item.categoria} · ${item.periodicidad === 'bimestral' ? 'Bimestral' : 'Mensual'} · ${item.pagador === 'esposa' ? 'Paga esposa' : 'Pago propio'}${item.pagosMes > 1 ? ` · ${item.pagosHechos}/${item.pagosMes} pagos · ${sign}${fmt.format(montoParcial)} c/u` : ''}${currencyHint}</span>
          </div>
          <div class="mc-right" style="align-items:flex-end;gap:.5rem">
            <span class="mc-monto ${cls}">${sign}${fmt.format(pendingAmount)}</span>
            <div style="display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end;max-width:220px">${botonesPagos}</div>
            <div style="display:flex;gap:.4rem;margin-top:.2rem">
              <button class="mini-btn" onclick="fijos_editar(${item.id})">✏️</button>
              <button class="mini-btn mini-btn-danger" onclick="fijos_borrar(${item.id})">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');
}

window.fijos_editar = function(id) {
    const item = fijosState.allItems.find(i => i.id === id);
    if (item) fijos_abrirSheet(item);
};

window.fijos_borrar = async function(id) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    const el = document.getElementById('f-lista');
    el.innerHTML = '<div class="loading-spinner">Actualizando...</div>';
    try {
        if (fijosState.sheetId === null) fijosState.sheetId = await getSheetId(SPREADSHEET_FIXED_ID, 'Hoja 1');
        await sheetsDeleteRow(SPREADSHEET_FIXED_ID, fijosState.sheetId, id - 1);
        fijos_cargarDatos();
        planner_refreshIfReady();
    } catch(e) { console.error(e); el.innerHTML = '<div class="empty-state text-danger">❌ Error al borrar</div>'; }
};

/** Toggle one partial payment state and sync to Control de Gastos */
window.fijos_togglePagoPart = async function(id, partIndex, options = {}) {
    const item = fijosState.allItems.find(i => i.id === id);
    if (!item) return;
    const wasPartPaid = !!item.pagosEstado[partIndex];
    const wasPartWaived = !!(item.waivedEstado && item.waivedEstado[partIndex]);
    const nowPartPaid = !wasPartPaid;
    const wasPaid = item.isPaid;
    const partAmount = Math.abs(item.monto / item.pagosMes);
    const partAmountOriginal = Math.abs((item.montoOriginal || item.monto) / item.pagosMes);
    const signedPartAmount = item.tipo === 'ingreso' ? partAmount : -partAmount;

    // Optimistic UI update
    item.pagosEstado[partIndex] = nowPartPaid;
    if (!item.waivedEstado) item.waivedEstado = new Array(item.pagosMes).fill(false);
    item.waivedEstado[partIndex] = nowPartPaid ? !!(options.skipControlLog || options.waive) : false;
    item.pagosHechos = item.pagosEstado.filter(Boolean).length;
    item.isPaid = item.pagosHechos >= item.pagosMes;
    balanceLogNetTotal += nowPartPaid ? signedPartAmount : -signedPartAmount;
    fijos_syncDashboardStats();
    balance_updateKpi();
    fijos_aplicarFiltros();

    try {
        // 1) Persist partial state (H) + legacy full-paid checkbox (F)
        await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!F${id}:H${id}`, [[item.isPaid ? 'TRUE' : 'FALSE', item.pagosMes, serializePaymentStates(item.pagosEstado)]]);
        await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!N${id}:N${id}`, [[serializePaymentStates(item.waivedEstado)]]);

        // 2) If marking one part as PAID -> append partial entry to Control de Gastos
        if (nowPartPaid && !options.skipControlLog) {
            const fecha    = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const lugar    = 'Gasto Fijo';
            const concepto = `${item.concepto} (${partIndex + 1}/${item.pagosMes})`;
            const monto    = partAmountOriginal;
            const tipo     = item.tipo === 'ingreso' ? 'Ingreso' : 'Gasto';
            const forma    = item.categoria || 'General';
            await sheetsAppend(
                SPREADSHEET_LOG_ID,
                'Hoja 1!A:H',
                [[fecha, lugar, concepto, monto, tipo, forma, '', item.moneda || 'MXN']]
            );
            tabInited.gastos = false;
            showToast('✅ Pago registrado en Control de Gastos');
        } else if (!nowPartPaid && !wasPartWaived) {
            // UN-SYNC: remove matching partial entry in Control de Gastos
            try {
                const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
                const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A:H');
                let foundRowIndex = -1;
                const targetConcepto = `${item.concepto} (${partIndex + 1}/${item.pagosMes})`;
                for (let i = logRows.length - 1; i >= 0; i--) {
                    const r = logRows[i];
                    if ((r[1] || '') === 'Gasto Fijo' && (r[2] || '') === targetConcepto) {
                        foundRowIndex = i;
                        break;
                    }
                }
                if (foundRowIndex !== -1) {
                    await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, foundRowIndex);
                    tabInited.gastos = false;
                    showToast('\uD83D\uDDD1\uFE0F Pago eliminado de Control de Gastos');
                } else {
                    showToast('\u2139\uFE0F Sin registro para eliminar en Control de Gastos');
                }
            } catch (err) {
                console.error('Error un-syncing payment:', err);
                showToast('\u26A0\uFE0F Error al eliminar pago');
            }
        }
        if (nowPartPaid && options.skipControlLog) {
            showToast('🟡 Pago waived (sin registro en Control de Gastos)');
        }
        planner_refreshIfReady();
    } catch(e) {
        console.error('Error toggling pago parcial:', e);
        // Revert optimistic update
        item.pagosEstado[partIndex] = wasPartPaid;
        if (!item.waivedEstado) item.waivedEstado = new Array(item.pagosMes).fill(false);
        item.waivedEstado[partIndex] = wasPartWaived;
        item.pagosHechos = item.pagosEstado.filter(Boolean).length;
        item.isPaid = wasPaid;
        balanceLogNetTotal += wasPartPaid ? signedPartAmount : -signedPartAmount;
        fijos_syncDashboardStats();
        balance_updateKpi();
        fijos_aplicarFiltros();
        planner_refreshIfReady();
        handleApiError(e, null);
    }
};

function fijos_abrirSheet(item) {
    const sheet = document.getElementById('f-sheet');
    const hoy = new Date();
    document.getElementById('f-edit-id').value = '';
    document.getElementById('f-sheet-title').innerText = 'Nuevo Movimiento';
    document.getElementById('f-concepto').value = '';
    document.getElementById('f-monto').value = '';
    document.getElementById('f-tipo').value = 'gasto';
    document.getElementById('f-pagos-mes').value = '1';
    document.getElementById('f-periodicidad').value = 'mensual';
    document.getElementById('f-inicio-mes').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('f-pagador').value = 'yo';
    document.getElementById('f-currency').value = 'MXN';
    document.getElementById('f-budget-cat').value = BUDGET_BUCKETS[0];
    document.getElementById('f-fecha').value = String(hoy.getDate());
    document.querySelectorAll('.f-cat-chk').forEach(cb => cb.checked = false);
    const def = document.querySelector('.f-cat-chk[value="General"]');
    if (def) def.checked = true;
    if (item) {
        document.getElementById('f-edit-id').value = item.id;
        document.getElementById('f-sheet-title').innerText = 'Editar Movimiento';
        document.getElementById('f-fecha').value = String(item.diaMes || parseDayOfMonth(item.fechaValue));
        document.getElementById('f-tipo').value = item.tipo;
        document.getElementById('f-concepto').value = item.concepto;
        document.getElementById('f-monto').value = item.montoOriginal;
        document.getElementById('f-pagos-mes').value = String(item.pagosMes || 1);
        document.getElementById('f-periodicidad').value = item.periodicidad || 'mensual';
        document.getElementById('f-inicio-mes').value = item.inicioMes || `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById('f-pagador').value = item.pagador || 'yo';
        document.getElementById('f-currency').value = item.moneda || 'MXN';
        document.getElementById('f-budget-cat').value = parseBudgetCategory(item.budgetCategory);
        item.categoria.split(', ').forEach(c => { const cb = document.querySelector(`.f-cat-chk[value="${c}"]`); if (cb) cb.checked = true; });
    }
    fijos_togglePeriodicityFields();
    sheet.classList.remove('hidden');
}

function fijos_togglePeriodicityFields() {
    const periodicidad = document.getElementById('f-periodicidad').value;
    const wrap = document.getElementById('f-inicio-mes-wrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', periodicidad !== 'bimestral');
}

function fijos_cerrarSheet() { document.getElementById('f-sheet').classList.add('hidden'); }
function fijos_abrirFiltro()  { fijos_generarPills(); document.getElementById('f-filter-sheet').classList.remove('hidden'); }
function fijos_cerrarFiltro() { document.getElementById('f-filter-sheet').classList.add('hidden'); }

async function fijos_guardar() {
    const btn     = document.getElementById('f-btn-guardar');
    const fecha   = String(parseDayOfMonth(document.getElementById('f-fecha').value));
    const tipo    = document.getElementById('f-tipo').value;
    const concepto= document.getElementById('f-concepto').value.trim();
    const monto   = parseSheetValue(document.getElementById('f-monto').value);
    const pagosMes = parsePaymentsTotal(document.getElementById('f-pagos-mes').value);
    const periodicidad = parseFixedPeriodicity(document.getElementById('f-periodicidad').value);
    const inicioMes = parseStartMonth(document.getElementById('f-inicio-mes').value);
    const pagador = parseFixedPayer(document.getElementById('f-pagador').value);
    const moneda = parseCurrencyCode(document.getElementById('f-currency').value);
    const budgetCategory = parseBudgetCategory(document.getElementById('f-budget-cat').value);
    const editId  = document.getElementById('f-edit-id').value;
    if (!concepto || !monto) return;
    const cats   = [...document.querySelectorAll('.f-cat-chk:checked')].map(cb => cb.value);
    const catStr = cats.length ? cats.join(', ') : 'General';
    const gasto  = tipo === 'gasto'   ? monto : '';
    const ingreso= tipo === 'ingreso' ? monto : '';
    btn.disabled = true; btn.innerText = 'Guardando...';
    try {
        if (editId) {
            const current = fijosState.allItems.find(i => i.id === Number(editId));
            const prevStates = current?.pagosEstado || [];
            const prevWaived = current?.waivedEstado || [];
            const nextStates = new Array(pagosMes).fill(false).map((_, idx) => !!prevStates[idx]);
            const nextWaived = new Array(pagosMes).fill(false).map((_, idx) => {
                if (!nextStates[idx]) return false;
                return !!prevWaived[idx];
            });
            const fullPaid = nextStates.every(Boolean);
            await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!A${editId}:N${editId}`, [[
                fecha,
                concepto,
                gasto,
                ingreso,
                catStr,
                fullPaid ? 'TRUE' : 'FALSE',
                pagosMes,
                serializePaymentStates(nextStates),
                periodicidad,
                inicioMes,
                pagador,
                budgetCategory,
                moneda,
                serializePaymentStates(nextWaived),
            ]]);
        } else {
            // new rows start with all partial payments pending
            await sheetsAppend(SPREADSHEET_FIXED_ID, 'Hoja 1!A:N', [[
                fecha,
                concepto,
                gasto,
                ingreso,
                catStr,
                'FALSE',
                pagosMes,
                serializePaymentStates(new Array(pagosMes).fill(false)),
                periodicidad,
                inicioMes,
                pagador,
                budgetCategory,
                moneda,
                serializePaymentStates(new Array(pagosMes).fill(false)),
            ]]);
        }
        fijos_cerrarSheet();
        fijos_cargarDatos();
    } catch(e) {
        console.error(e); alert('❌ Error al guardar');
    } finally {
        btn.disabled = false; btn.innerText = 'Guardar';
    }
}

// =============================================
// PLANIFICADOR MODULE
// =============================================
const PLANNER_OVERRIDES_KEY = 'planner_assignments_v1';
const PLANNER_DONE_INCOMES_KEY = 'planner_done_incomes_v1';
const PLANNER_RESET_MARKER_KEY = 'planner_reset_marker_v1';
const plannerState = {
    loading: false,
    monthKey: '',
    incomes: [],
    expenses: [],
    assignments: {},
    assignedByIncome: [],
    doneIncomeKeys: [],
    autoSortedThisMonth: false,
    totals: { income: 0, assigned: 0, diff: 0 },
};

function planner_getMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function planner_readOverrides(monthKey) {
    try {
        const raw = localStorage.getItem(PLANNER_OVERRIDES_KEY);
        const all = raw ? JSON.parse(raw) : {};
        if (!all || typeof all !== 'object') return {};
        const monthMap = all[monthKey];
        return monthMap && typeof monthMap === 'object' ? monthMap : {};
    } catch (_) {
        return {};
    }
}

function planner_writeOverrides(monthKey, assignments) {
    try {
        const raw = localStorage.getItem(PLANNER_OVERRIDES_KEY);
        const all = raw ? JSON.parse(raw) : {};
        all[monthKey] = assignments;
        localStorage.setItem(PLANNER_OVERRIDES_KEY, JSON.stringify(all));
    } catch (_) {}
}

function planner_readDoneIncomes(monthKey) {
    try {
        const raw = localStorage.getItem(PLANNER_DONE_INCOMES_KEY);
        const all = raw ? JSON.parse(raw) : {};
        if (!all || typeof all !== 'object') return [];
        const monthList = all[monthKey];
        return Array.isArray(monthList) ? monthList.map(x => `${x}`) : [];
    } catch (_) {
        return [];
    }
}

function planner_writeDoneIncomes(monthKey, doneIncomeKeys) {
    try {
        const raw = localStorage.getItem(PLANNER_DONE_INCOMES_KEY);
        const all = raw ? JSON.parse(raw) : {};
        all[monthKey] = Array.from(new Set((doneIncomeKeys || []).map(x => `${x}`)));
        localStorage.setItem(PLANNER_DONE_INCOMES_KEY, JSON.stringify(all));
    } catch (_) {}
}

function planner_forceResetCurrentMonthIfNeeded(monthKey) {
    const resetMarker = 'v7.0.24-plan-reset';
    try {
        if (localStorage.getItem(PLANNER_RESET_MARKER_KEY) === resetMarker) return;

        const rawOverrides = localStorage.getItem(PLANNER_OVERRIDES_KEY);
        const allOverrides = rawOverrides ? JSON.parse(rawOverrides) : {};
        if (allOverrides && typeof allOverrides === 'object' && allOverrides[monthKey]) {
            delete allOverrides[monthKey];
            localStorage.setItem(PLANNER_OVERRIDES_KEY, JSON.stringify(allOverrides));
        }

        const rawDone = localStorage.getItem(PLANNER_DONE_INCOMES_KEY);
        const allDone = rawDone ? JSON.parse(rawDone) : {};
        if (allDone && typeof allDone === 'object' && allDone[monthKey]) {
            delete allDone[monthKey];
            localStorage.setItem(PLANNER_DONE_INCOMES_KEY, JSON.stringify(allDone));
        }

        localStorage.setItem(PLANNER_RESET_MARKER_KEY, resetMarker);
    } catch (_) {}
}

function planner_findNextActiveIncomeIndex(fromIdx, direction, incomes, doneSet) {
    let idx = fromIdx + direction;
    while (idx >= 0 && idx < incomes.length) {
        const income = incomes[idx];
        const isDone = !income.isBalanceSource && doneSet.has(income.key);
        if (!isDone) return idx;
        idx += direction;
    }
    return fromIdx;
}

function planner_assignIndexByDay(day, incomes) {
    if (!incomes.length) return -1;
    const idx = incomes.findIndex(i => day <= i.day);
    return idx === -1 ? incomes.length - 1 : idx;
}

function planner_buildModel(items, monthKey) {
    const fixedIncomes = items
        .filter(i => i.tipo === 'ingreso' && i.pagador === 'yo' && i.isDueThisMonth)
        .map(i => {
            const monthlyAmount = Math.abs(i.monto || 0);
            const paidParts = Math.max(0, i.pagosHechos || 0);
            const totalParts = i.pagosMes || 1;
            const pendingParts = Math.max(0, totalParts - paidParts);
            return {
                id: i.id,
                key: `inc-${i.id}`,
                concept: i.concepto,
                day: parseDayOfMonth(i.diaMes),
                amount: monthlyAmount,
                paidParts,
                totalParts,
                pendingParts,
                isBalanceSource: false,
            };
        })
        .filter(i => i.amount > 0)
        .sort((a, b) => a.day - b.day || a.id - b.id);

    const balanceIncome = {
        id: 'balance',
        key: 'inc-balance',
        concept: 'Balance disponible',
        day: 0,
        amount: Number(balance_getTotal()) || 0,
        isBalanceSource: true,
    };
    const incomes = [balanceIncome, ...fixedIncomes];

    const expenses = [];
    items
        .filter(i => i.tipo === 'gasto' && i.pagador === 'yo' && i.isDueThisMonth)
        .forEach(i => {
            const totalParts = i.pagosMes || 1;
            const paidParts = Math.max(0, i.pagosHechos || 0);
            const partAmount = Math.abs(i.monto || 0) / totalParts;
            for (let partIdx = paidParts; partIdx < totalParts; partIdx++) {
                expenses.push({
                    key: `${i.id}:${partIdx + 1}`,
                    fixedId: i.id,
                    concept: i.concepto,
                    day: parseDayOfMonth(i.diaMes),
                    amount: partAmount,
                    partLabel: totalParts > 1 ? `${partIdx + 1}/${totalParts}` : null,
                    budgetCategory: parseBudgetCategory(i.budgetCategory),
                });
            }
        });

    expenses.sort((a, b) => a.day - b.day || a.fixedId - b.fixedId);

    const savedOverrides = planner_readOverrides(monthKey);
    const doneIncomeKeys = planner_readDoneIncomes(monthKey);
    const doneSet = new Set(doneIncomeKeys);
    const hasSavedOverrides = Object.keys(savedOverrides).length > 0;
    const assignments = {};
    let assignedByIncome = incomes.map(() => []);
    const autoIncomes = fixedIncomes.length ? fixedIncomes : incomes;
    expenses.forEach(exp => {
        let idx = planner_assignIndexByDay(exp.day, autoIncomes);
        if (fixedIncomes.length) idx += 1;
        const manualIdx = Number(savedOverrides[exp.key]);
        if (!Number.isNaN(manualIdx) && manualIdx >= 0 && manualIdx < incomes.length) {
            idx = manualIdx;
        }
        assignments[exp.key] = idx;
        if (idx >= 0) assignedByIncome[idx].push(exp);
    });

    let autoSortedThisMonth = false;
    const isFirstDayOfMonth = new Date().getDate() === 1;
    if (!hasSavedOverrides && isFirstDayOfMonth) {
        const balanceIdx = 0;
        for (let idx = 1; idx < incomes.length; idx++) {
            const income = incomes[idx];
            const currentExpenses = assignedByIncome[idx] || [];
            let overflow = currentExpenses.reduce((s, e) => s + e.amount, 0) - income.amount;
            if (overflow <= 0) continue;
            const movable = [...currentExpenses].sort((a, b) => b.day - a.day || b.amount - a.amount);
            for (const exp of movable) {
                if (overflow <= 0) break;
                assignments[exp.key] = balanceIdx;
                overflow -= exp.amount;
            }
        }
        autoSortedThisMonth = true;
    }

    assignedByIncome = incomes.map(() => []);
    expenses.forEach(exp => {
        const idx = assignments[exp.key];
        if (idx >= 0) assignedByIncome[idx].push(exp);
    });

    for (let idx = 1; idx < incomes.length; idx++) {
        const income = incomes[idx];
        if (!doneSet.has(income.key)) continue;
        const targetIdx = planner_findNextActiveIncomeIndex(idx, 1, incomes, doneSet);
        const fallbackIdx = targetIdx === idx ? 0 : targetIdx;
        const currentExpenses = assignedByIncome[idx] || [];
        currentExpenses.forEach(exp => {
            assignments[exp.key] = fallbackIdx;
        });
    }

    assignedByIncome = incomes.map(() => []);
    expenses.forEach(exp => {
        const idx = assignments[exp.key];
        if (idx >= 0) assignedByIncome[idx].push(exp);
    });

    const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
    const totalAssigned = expenses.reduce((s, e) => s + e.amount, 0);

    return {
        monthKey,
        incomes,
        expenses,
        assignments,
        assignedByIncome,
        doneIncomeKeys,
        autoSortedThisMonth,
        totals: {
            income: totalIncome,
            assigned: totalAssigned,
            diff: totalIncome - totalAssigned,
        },
    };
}

function planner_render() {
    const summaryEl = document.getElementById('plan-summary');
    const subEl = document.getElementById('plan-summary-sub');
    const groupsEl = document.getElementById('plan-income-groups');
    if (!summaryEl || !subEl || !groupsEl) return;

    const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    if (!plannerState.incomes.length) {
        summaryEl.innerText = fmt.format(0);
        summaryEl.classList.remove('text-danger');
        summaryEl.classList.remove('text-success');
        subEl.innerText = 'No hay ingresos propios de este mes en Gastos Fijos.';
        groupsEl.innerHTML = '<div class="empty-state">Agrega al menos un ingreso fijo pagado por ti para usar el planificador.</div>';
        return;
    }

    const doneSet = new Set(plannerState.doneIncomeKeys || []);
    const assignedTotalsByIncome = plannerState.incomes.map((_, idx) => {
        const expenses = plannerState.assignedByIncome[idx] || [];
        return expenses.reduce((s, e) => s + e.amount, 0);
    });
    const reservedForOtherIncomes = assignedTotalsByIncome
        .slice(1)
        .reduce((s, v) => s + v, 0);
    const balanceIncome = plannerState.incomes.find(i => i.isBalanceSource);
    const balanceCurrent = balanceIncome?.amount || 0;
    const balanceAvailableNet = Math.max(0, (balanceIncome?.amount || 0) - reservedForOtherIncomes);
    const projectedBalanceFinal = balanceCurrent - plannerState.totals.assigned;
    const activeIncomeTotal = plannerState.incomes.reduce((s, income) => {
        if (!income.isBalanceSource && doneSet.has(income.key)) return s;
        return s + income.amount;
    }, 0);

    const fixedIncomeCount = plannerState.incomes
        .filter(i => !i.isBalanceSource && !doneSet.has(i.key))
        .length;
    summaryEl.innerText = fmt.format(projectedBalanceFinal);
    summaryEl.classList.toggle('text-danger', projectedBalanceFinal < 0);
    summaryEl.classList.toggle('text-success', projectedBalanceFinal >= 0);
    subEl.innerText = `Balance proyectado final (balance actual - pagos pendientes) · ${fixedIncomeCount} ingresos fijos activos · Asignado ${fmt.format(plannerState.totals.assigned)} de ${fmt.format(activeIncomeTotal)}`;

    groupsEl.innerHTML = plannerState.incomes.map((income, idx) => {
        if (!income.isBalanceSource && doneSet.has(income.key)) return '';
        const expenses = plannerState.assignedByIncome[idx] || [];
        const assignedTotal = assignedTotalsByIncome[idx] || 0;
        const availableAmount = income.isBalanceSource
            ? Math.max(0, income.amount - reservedForOtherIncomes)
            : income.amount;
        const diff = availableAmount - assignedTotal;

        const bucketTotals = BUDGET_BUCKETS.reduce((acc, bucket) => {
            acc[bucket] = 0;
            return acc;
        }, {});
        expenses.forEach(e => {
            bucketTotals[e.budgetCategory] += e.amount;
        });

        const bucketHtml = BUDGET_BUCKETS.map(bucket => {
            const value = bucketTotals[bucket] || 0;
            return `<div class="plan-bucket-row"><span>${bucket}</span><strong>${fmt.format(value)}</strong></div>`;
        }).join('');

        const expenseRows = expenses.length
            ? expenses.map(e => {
                const currentIdx = plannerState.assignments[e.key];
                const prevIdx = planner_findNextActiveIncomeIndex(currentIdx, -1, plannerState.incomes, doneSet);
                const nextIdx = planner_findNextActiveIncomeIndex(currentIdx, 1, plannerState.incomes, doneSet);
                const canMovePrev = prevIdx !== currentIdx;
                const canMoveNext = nextIdx !== currentIdx;
                return `<div class="plan-expense-row">
                    <div>
                        <div class="plan-expense-title">${e.concept}${e.partLabel ? ` (${e.partLabel})` : ''}</div>
                        <div class="plan-expense-meta">Dia ${e.day} · ${e.budgetCategory}</div>
                    </div>
                    <div class="plan-expense-actions">
                        <button class="mini-btn" onclick="planner_moveExpense('${e.key}', -1)" ${canMovePrev ? '' : 'disabled'}>←</button>
                        <span class="plan-expense-amount">${fmt.format(e.amount)}</span>
                        <button class="mini-btn" onclick="planner_moveExpense('${e.key}', 1)" ${canMoveNext ? '' : 'disabled'}>→</button>
                    </div>
                </div>`;
            }).join('')
            : '<div class="empty-state" style="margin-top:.5rem;">Sin pagos asignados en esta ventana.</div>';

        const headTitle = income.isBalanceSource
            ? income.concept
            : `Dia ${income.day} · ${income.concept}`;
        const incomeSub = income.isBalanceSource
            ? `Disponible neto: ${fmt.format(availableAmount)} · apartados en otros ingresos: ${fmt.format(reservedForOtherIncomes)}`
            : `Ingreso del mes: ${fmt.format(income.amount)} · pagado ${income.paidParts || 0}/${income.totalParts || 1}`;

        return `<div class="glass-subtle plan-income-card">
            <div class="plan-income-head">
                <div>
                    <div class="plan-income-title">${headTitle}</div>
                    <div class="plan-income-sub">${incomeSub}</div>
                </div>
                <div class="plan-income-diff ${diff < 0 ? 'text-danger' : 'text-success'}">${fmt.format(diff)}</div>
            </div>
            <div class="plan-income-sub">Asignado: ${fmt.format(assignedTotal)}</div>
            ${income.isBalanceSource ? '' : `<div style="margin:.45rem 0 0;"><button class="mini-btn" onclick="planner_finishIncome('${income.key}')">✅ Terminado (mover al siguiente)</button></div>`}
            <div class="plan-buckets">${bucketHtml}</div>
            <div class="plan-expenses-list">${expenseRows}</div>
        </div>`;
    }).join('');
}

async function planner_cargarVista() {
    if (plannerState.loading) return;
    plannerState.loading = true;
    const groupsEl = document.getElementById('plan-income-groups');
    if (groupsEl) groupsEl.innerHTML = '<div class="loading-spinner">⏳ Armando plan...</div>';
    try {
        if (!fijosState.allItems.length) {
            await fijos_cargarDatos();
        }
        const monthKey = planner_getMonthKey();
        planner_forceResetCurrentMonthIfNeeded(monthKey);
        Object.assign(plannerState, planner_buildModel(fijosState.allItems, monthKey));
        if (plannerState.autoSortedThisMonth) {
            planner_writeOverrides(monthKey, plannerState.assignments);
            plannerState.autoSortedThisMonth = false;
        }
        planner_render();
    } finally {
        plannerState.loading = false;
    }
}

window.planner_moveExpense = function(expenseKey, direction) {
    const curr = plannerState.assignments[expenseKey];
    if (curr === undefined || curr < 0) return;
    const doneSet = new Set(plannerState.doneIncomeKeys || []);
    const next = planner_findNextActiveIncomeIndex(curr, direction, plannerState.incomes, doneSet);
    if (next === curr) return;
    plannerState.assignments[expenseKey] = next;
    planner_writeOverrides(plannerState.monthKey, plannerState.assignments);

    const byIncome = plannerState.incomes.map(() => []);
    plannerState.expenses.forEach(exp => {
        const idx = plannerState.assignments[exp.key];
        if (idx >= 0) byIncome[idx].push(exp);
    });

    const sourceIncome = plannerState.incomes[curr];
    if (sourceIncome && !sourceIncome.isBalanceSource && !doneSet.has(sourceIncome.key) && (byIncome[curr] || []).length === 0) {
        doneSet.add(sourceIncome.key);
        plannerState.doneIncomeKeys = Array.from(doneSet);
        planner_writeDoneIncomes(plannerState.monthKey, plannerState.doneIncomeKeys);
    }

    plannerState.assignedByIncome = byIncome;
    planner_render();
};

window.planner_finishIncome = function(incomeKey) {
    if (!plannerState.monthKey || !incomeKey) return;
    const idx = plannerState.incomes.findIndex(i => i.key === incomeKey && !i.isBalanceSource);
    if (idx < 0) return;

    const doneSet = new Set(plannerState.doneIncomeKeys || []);
    doneSet.add(incomeKey);
    const nextIdx = planner_findNextActiveIncomeIndex(idx, 1, plannerState.incomes, doneSet);
    const targetIdx = nextIdx === idx ? 0 : nextIdx;

    plannerState.expenses.forEach(exp => {
        if (plannerState.assignments[exp.key] === idx) {
            plannerState.assignments[exp.key] = targetIdx;
        }
    });

    plannerState.doneIncomeKeys = Array.from(doneSet);
    planner_writeOverrides(plannerState.monthKey, plannerState.assignments);
    planner_writeDoneIncomes(plannerState.monthKey, plannerState.doneIncomeKeys);

    const byIncome = plannerState.incomes.map(() => []);
    plannerState.expenses.forEach(exp => {
        const assignmentIdx = plannerState.assignments[exp.key];
        if (assignmentIdx >= 0) byIncome[assignmentIdx].push(exp);
    });
    plannerState.assignedByIncome = byIncome;
    planner_render();
    showToast('✅ Ingreso terminado; gastos movidos al siguiente');
};

window.planner_resetAssignments = function() {
    if (!plannerState.monthKey) return;
    const monthKey = plannerState.monthKey;
    const current = planner_readOverrides(monthKey);
    const currentDone = planner_readDoneIncomes(monthKey);
    if (!Object.keys(current).length && !currentDone.length) return;
    planner_writeOverrides(monthKey, {});
    planner_writeDoneIncomes(monthKey, []);
    Object.assign(plannerState, planner_buildModel(fijosState.allItems, monthKey));
    planner_render();
    showToast('↺ Asignaciones manuales reiniciadas');
};

// =============================================
// AUTOS MODULE
// =============================================
const autosState = {
    cars: [],
    repairs: [],
    autosSheetId: null,
    repairsSheetId: null,
    selectedCarId: '',
    repairSearch: '',
    repairDateFrom: '',
    repairDateTo: '',
    repairVisibleCount: 10,
    meta: {},
    licenseLongPressFired: false,
    licenseLongPressTimer: null,
    licenseCrop: null,
    licenseCropPointers: new Map(),
    licenseCropDragLast: null,
    licenseCropPinchBaseDist: 0,
    licenseCropPinchBaseZoom: 1,
    docCrop: null,
    docCropMode: 'carta',
    docCropPointers: new Map(),
    docCropDragLast: null,
    docCropPinchBaseDist: 0,
    docCropPinchBaseZoom: 1,
    valuationInFlight: new Set(),
    imageDebug: {},
    driveImageObjectUrls: {},
    autosHeaders: [],
    loaded: false,
};

const AUTOS_IMAGE_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 72'%3E%3Crect width='96' height='72' fill='%23111827'/%3E%3Cpath d='M8 58l18-18 10 10 16-20 36 28H8z' fill='%23334155'/%3E%3Ccircle cx='30' cy='24' r='8' fill='%23475569'/%3E%3C/svg%3E";

const AUTOS_HEADERS = [
    'id','marca','modelo','anio','valorFactura','kilometraje','propietario','tieneSeguro','placa','vin','fotoAuto',
    'contratoPrestamo','polizaSeguro','vencimientoPoliza','proximaRevisionKm','emergenciaInterior','emergenciaMetro','reporteSiniestros1','reporteSiniestros2',
    'tarjetaCirculacionFrente','tarjetaCirculacionAtras','pagoTenencia','vencimientoTenencia','tablaPagos','tablaPagosSeguro',
    'tipoLlantas','llantasFoto','certificadoPolarizado','facturaArchivo','polizaArchivo','extraDoc1Nombre','extraDoc1Url','extraDoc2Nombre','extraDoc2Url',
];

const REPAIRS_HEADERS = [
    'id','carId','reparacion','costo','moneda','lugar','fecha','foto','recibo','descripcion','logMarker',
];

const AUTOS_META_HEADERS = ['key', 'value'];

const AUTOS_SEED = [
    {
        id: `car-${Date.now()}-1`,
        marca: 'Renault', modelo: 'Koleos', anio: '2009', valorFactura: '', kilometraje: '184500', propietario: 'Mariel de la Rosa G',
        tieneSeguro: false, placa: 'Z33-AFR', vin: 'VF1VY1GZ89C288675',
        fotoAuto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/BM0BuLh3wmZGqAYW2fiv.heic',
        contratoPrestamo: '', polizaSeguro: '', vencimientoPoliza: '', proximaRevisionKm: '', emergenciaInterior: '', emergenciaMetro: '', reporteSiniestros1: '', reporteSiniestros2: '',
        tarjetaCirculacionFrente: 'https://drive.google.com/file/d/1BagSehQCUq-IwWs3goG4AkZMYNWY1_sM/view?usp=drivesdk',
        tarjetaCirculacionAtras: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/cCRD09DOS9SVxj93tNOS.heic',
        pagoTenencia: '', vencimientoTenencia: '', tablaPagos: '', tablaPagosSeguro: '', tipoLlantas: '', llantasFoto: '', certificadoPolarizado: '',
        facturaArchivo: '', polizaArchivo: '', extraDoc1Nombre: '', extraDoc1Url: '', extraDoc2Nombre: '', extraDoc2Url: '',
    },
    {
        id: `car-${Date.now()}-2`,
        marca: 'VW', modelo: 'Taos', anio: '2025', valorFactura: '640000', kilometraje: '18750', propietario: 'Juan G Mansur G',
        tieneSeguro: true, placa: 'XMP-337-D', vin: '3VVKP6B23SM081860',
        fotoAuto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/DTZUJ2R1fmI3vJJQAeqJ.png',
        contratoPrestamo: 'Pagado de Contado', polizaSeguro: '3200937564', vencimientoPoliza: '', proximaRevisionKm: '25000', emergenciaInterior: '800-253-0553', emergenciaMetro: '55-3300-4534',
        reporteSiniestros1: '800-288-6700', reporteSiniestros2: '800-800-2880',
        tarjetaCirculacionFrente: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/RqI5rPCYlp2LqJrNMG19.jpeg',
        tarjetaCirculacionAtras: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/ARR0KJJMwjxOVkCi0V5k.jpeg',
        pagoTenencia: '', vencimientoTenencia: '2024-08-21', tablaPagos: '', tablaPagosSeguro: '',
        tipoLlantas: '215/55R17', llantasFoto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/luR7swl89aB8lYMTQxLC.HEIC',
        certificadoPolarizado: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/3aPTU0nLybzPaXODiZEF.png',
        facturaArchivo: '', polizaArchivo: '', extraDoc1Nombre: '', extraDoc1Url: '', extraDoc2Nombre: '', extraDoc2Url: '',
    },
];

const AUTOS_CSV_PATCH_META_KEY = 'autos_csv_patch_version';
const AUTOS_CSV_PATCH_VERSION = 'v7.1.13';

const AUTOS_KOLEOS_DEFAULT = {
    marca: 'Renault',
    modelo: 'Koleos',
    anio: '2009',
    valorFactura: '',
    kilometraje: '184500',
    propietario: 'Mariel de la Rosa G',
    tieneSeguro: false,
    placa: 'Z33-AFR',
    vin: 'VF1VY1GZ89C288675',
    fotoAuto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/F9YQEIUejXrdhA3hNaWu.jpeg',
    contratoPrestamo: '',
    polizaSeguro: '',
    vencimientoPoliza: '',
    proximaRevisionKm: '',
    emergenciaInterior: '',
    emergenciaMetro: '',
    reporteSiniestros1: '',
    reporteSiniestros2: '',
    tarjetaCirculacionFrente: '',
    tarjetaCirculacionAtras: '',
    pagoTenencia: '',
    vencimientoTenencia: '',
    tablaPagos: '',
    tablaPagosSeguro: '',
    tipoLlantas: '',
    llantasFoto: '',
    certificadoPolarizado: '',
    facturaArchivo: '',
    polizaArchivo: '',
    extraDoc1Nombre: '',
    extraDoc1Url: '',
    extraDoc2Nombre: '',
    extraDoc2Url: '',
};

const AUTOS_CSV_REPAIRS = {
    koleos: [
        { reparacion: 'Mantenimiento General', costo: 11077, moneda: 'MXN', lugar: 'Clinica Automotriz', fecha: '2023-06-01', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/5dwETdURu7am5EzkjTmG.jpg', recibo: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/PZav1SE91pYI3iwt8kbA.jpg', descripcion: 'Varios' },
        { reparacion: 'Compra de llanta delantera derecha', costo: 2600, moneda: 'MXN', lugar: 'Llamtimax San Miguel', fecha: '2024-11-08', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/pZngCtrPH3Uo6BfQasJN.jpg', recibo: '', descripcion: '' },
        { reparacion: 'Cambio aceite y filtro', costo: 1200, moneda: 'MXN', lugar: 'Llantimax San Miguel', fecha: '2024-11-08', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/5F7jCRQQEgFrXEpkZ59N.jpg', recibo: '', descripcion: '' },
        { reparacion: 'Cotizacion para cambiar bujes', costo: 0, moneda: 'MXN', lugar: 'Llantimax', fecha: '2024-11-13', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/nxr0ypGXKlrG1GB6YTKn.jpeg', recibo: '', descripcion: 'Esta es una cotizacion y esta pendiente de hacerse. Cotizado en Nov 2024' },
        { reparacion: 'Foco y grapas', costo: 350, moneda: 'MXN', lugar: 'Llantimax', fecha: '2024-11-13', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/sUxGylvznY3dQvCOTZUQ.jpg', recibo: '', descripcion: '' },
    ],
    taos: [
        { reparacion: 'Servicio de los 15000 kilometros', costo: 3075.01, moneda: 'MXN', lugar: 'Agencia VW Valle Victoria', fecha: '2026-01-24', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/soFtdoc1n0sFXUFKuyTq.jpg', recibo: '', descripcion: '' },
    ],
};

function autos_bindEvents() {
    document.getElementById('autos-btn-add-car')?.addEventListener('click', () => autos_openCarSheet(null));
    document.getElementById('autos-btn-add-repair')?.addEventListener('click', () => autos_openRepairSheet(null));
    document.getElementById('autos-car-sheet-overlay')?.addEventListener('click', autos_closeCarSheet);
    document.getElementById('autos-repair-sheet-overlay')?.addEventListener('click', autos_closeRepairSheet);
    document.getElementById('autos-car-save')?.addEventListener('click', autos_saveCar);
    document.getElementById('autos-car-delete')?.addEventListener('click', autos_deleteCarFromSheet);
    document.getElementById('autos-repair-save')?.addEventListener('click', autos_saveRepair);
    document.getElementById('autos-repair-search')?.addEventListener('input', (e) => {
        autosState.repairSearch = (e.target.value || '').trim().toLowerCase();
        autosState.repairVisibleCount = 10;
        autos_renderSelectedCar();
    });
    const onDateFromChange = (e) => {
        autosState.repairDateFrom = (e.target.value || '').trim();
        autosState.repairVisibleCount = 10;
        autos_renderSelectedCar();
    };
    const onDateToChange = (e) => {
        autosState.repairDateTo = (e.target.value || '').trim();
        autosState.repairVisibleCount = 10;
        autos_renderSelectedCar();
    };
    document.getElementById('autos-repair-date-from')?.addEventListener('change', onDateFromChange);
    document.getElementById('autos-repair-date-to')?.addEventListener('change', onDateToChange);
    document.getElementById('autos-repair-load-more')?.addEventListener('click', () => {
        autosState.repairVisibleCount += 10;
        autos_renderSelectedCar();
    });
    document.getElementById('autos-detail-overlay')?.addEventListener('click', autos_closeCarDetail);
    document.getElementById('autos-detail-close')?.addEventListener('click', autos_closeCarDetail);
    document.getElementById('autos-license-overlay')?.addEventListener('click', autos_closeLicensePanel);
    document.getElementById('autos-license-close')?.addEventListener('click', autos_closeLicensePanel);
    document.getElementById('autos-meli-debug-overlay')?.addEventListener('click', autos_closeMeliDebug);
    document.getElementById('autos-meli-debug-close')?.addEventListener('click', autos_closeMeliDebug);
    document.getElementById('autos-license-upload-btn')?.addEventListener('click', () => document.getElementById('autos-license-file')?.click());
    document.getElementById('autos-license-crop-overlay')?.addEventListener('click', autos_closeLicenseCropPanel);
    document.getElementById('autos-license-crop-close')?.addEventListener('click', autos_closeLicenseCropPanel);
    document.getElementById('autos-license-crop-cancel')?.addEventListener('click', autos_closeLicenseCropPanel);
    document.getElementById('autos-license-crop-apply')?.addEventListener('click', autos_applyLicenseCrop);
    document.getElementById('autos-license-crop-zoom')?.addEventListener('input', autos_updateLicenseCropFromControls);
    document.getElementById('autos-license-crop-x')?.addEventListener('input', autos_updateLicenseCropFromControls);
    document.getElementById('autos-license-crop-y')?.addEventListener('input', autos_updateLicenseCropFromControls);
    const cropCanvas = document.getElementById('autos-license-crop-canvas');
    if (cropCanvas) {
        cropCanvas.addEventListener('pointerdown', autos_cropPointerDown);
        cropCanvas.addEventListener('pointermove', autos_cropPointerMove);
        cropCanvas.addEventListener('pointerup', autos_cropPointerUp);
        cropCanvas.addEventListener('pointercancel', autos_cropPointerUp);
        cropCanvas.addEventListener('pointerleave', autos_cropPointerUp);
    }
    document.getElementById('autos-doc-crop-overlay')?.addEventListener('click', autos_cancelDocCropPanel);
    document.getElementById('autos-doc-crop-close')?.addEventListener('click', autos_cancelDocCropPanel);
    document.getElementById('autos-doc-crop-cancel')?.addEventListener('click', autos_cancelDocCropPanel);
    document.getElementById('autos-doc-crop-apply')?.addEventListener('click', autos_applyDocCrop);
    document.getElementById('autos-doc-crop-zoom')?.addEventListener('input', autos_updateDocCropFromControls);
    document.getElementById('autos-doc-crop-x')?.addEventListener('input', autos_updateDocCropFromControls);
    document.getElementById('autos-doc-crop-y')?.addEventListener('input', autos_updateDocCropFromControls);
    document.getElementById('autos-doc-crop-size')?.addEventListener('change', autos_updateDocCropMode);
    const docCropCanvas = document.getElementById('autos-doc-crop-canvas');
    if (docCropCanvas) {
        docCropCanvas.addEventListener('pointerdown', autos_docCropPointerDown);
        docCropCanvas.addEventListener('pointermove', autos_docCropPointerMove);
        docCropCanvas.addEventListener('pointerup', autos_docCropPointerUp);
        docCropCanvas.addEventListener('pointercancel', autos_docCropPointerUp);
        docCropCanvas.addEventListener('pointerleave', autos_docCropPointerUp);
    }
    const licCard = document.getElementById('autos-license-card');
    if (licCard) {
        licCard.addEventListener('pointerdown', autos_licensePointerDown);
        licCard.addEventListener('pointerup', autos_licensePointerUp);
        licCard.addEventListener('pointerleave', autos_licensePointerUp);
        licCard.addEventListener('pointercancel', autos_licensePointerUp);
        licCard.addEventListener('click', autos_licenseClick);
    }
    document.getElementById('autos-license-file')?.addEventListener('change', autos_handleLicenseFile);
    document.getElementById('autos-car-foto-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-foto-feedback', e.target.files));
    document.getElementById('autos-car-tarjeta-frente-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-tarjeta-frente-feedback', e.target.files));
    document.getElementById('autos-car-tarjeta-atras-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-tarjeta-atras-feedback', e.target.files));
    document.getElementById('autos-car-factura-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-factura-feedback', e.target.files));
    document.getElementById('autos-car-poliza-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-poliza-feedback', e.target.files));
    document.getElementById('autos-car-extra1-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-extra1-feedback', e.target.files));
    document.getElementById('autos-car-extra2-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-car-extra2-feedback', e.target.files));
    document.getElementById('autos-repair-photo-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-repair-photo-feedback', e.target.files));
    document.getElementById('autos-repair-receipt-file')?.addEventListener('change', (e) => autos_updateFileFeedback('autos-repair-receipt-feedback', e.target.files));
}

async function autos_deleteCarFromSheet() {
    const carId = (document.getElementById('autos-car-edit-id')?.value || '').trim();
    if (!carId) return;
    await autos_deleteCarById(carId);
}

async function autos_deleteCarById(carId) {
    const car = autosState.cars.find(c => c.id === carId);
    if (!car) return;
    const linkedRepairs = autosState.repairs.filter(r => r.carId === carId);
    const warnRepairs = linkedRepairs.length ? `\n\nTambién se eliminarán ${linkedRepairs.length} reparación(es) asociadas.` : '';
    if (!confirm(`¿Eliminar el auto ${car.marca} ${car.modelo}?${warnRepairs}`)) return;

    autosState.cars = autosState.cars.filter(c => c.id !== carId);
    autosState.repairs = autosState.repairs.filter(r => r.carId !== carId);

    await autos_saveCarsSheet();
    await autos_saveRepairsSheet();

    if (linkedRepairs.length) {
        try {
            const markers = new Set(linkedRepairs.map(r => r.logMarker || autos_getLogMarker(r.id)).filter(Boolean));
            if (markers.size) {
                const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H').catch(() => []);
                const deleteRows = [];
                for (let i = 0; i < logRows.length; i++) {
                    const concepto = (logRows[i]?.[2] || '').toString();
                    for (const marker of markers) {
                        if (concepto.includes(marker)) {
                            deleteRows.push(i + 1);
                            break;
                        }
                    }
                }
                if (deleteRows.length) {
                    const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
                    for (const row0 of deleteRows.sort((a, b) => b - a)) {
                        await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, row0);
                    }
                    tabInited.gastos = false;
                }
            }
        } catch (e) {
            console.warn('No se pudo limpiar sincronizacion de reparaciones eliminadas:', e);
        }
    }

    if (autosState.selectedCarId === carId) {
        autosState.selectedCarId = autosState.cars[0]?.id || '';
    }
    autos_closeCarSheet();
    autos_render();
    showToast('🗑️ Auto eliminado');
}

function autos_updateFileFeedback(elId, files) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!files || !files.length) {
        el.innerText = '';
        return;
    }
    el.innerText = files.length === 1 ? `Archivo: ${files[0].name}` : `${files.length} archivos seleccionados`;
}

async function autos_ensureRecibosFolder() {
    const RECIBOS_FOLDER = 'Jay App Recibos';
    let folderId = await driveFindFolder(RECIBOS_FOLDER);
    if (folderId) return folderId;
    const r = await authFetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: RECIBOS_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!r.ok) throw new Error(`Folder create failed (${r.status})`);
    folderId = (await r.json()).id;
    return folderId;
}

async function autos_uploadFirstFile(inputId, options = {}) {
    const input = document.getElementById(inputId);
    if (!input || !input.files || !input.files.length) return '';
    const folderId = await autos_ensureRecibosFolder();
    let file = input.files[0];
    if (options.enableCrop && autos_fileLooksLikeImage(file)) {
        const cropped = await autos_openDocCropper(file, {
            title: options.cropTitle || 'Recortar documento',
            mode: options.cropMode || 'libre',
        });
        if (cropped) file = cropped;
    }
    return driveUploadFile(file, folderId);
}

async function autos_uploadFiles(inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.files || !input.files.length) return [];
    const folderId = await autos_ensureRecibosFolder();
    const urls = [];
    for (const file of input.files) {
        const url = await driveUploadFile(file, folderId);
        if (url) urls.push(url);
    }
    return urls;
}

function autos_parseUrlList(raw) {
    return (raw || '')
        .toString()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function autos_phoneLinkOrText(raw, fallbackLabel = 'Tel') {
    const value = (raw || '').toString().trim();
    if (!value) return '-';
    const tel = value.replace(/[^\d+]/g, '');
    if (!tel || tel.length < 8) return value || fallbackLabel;
    return `<a href="tel:${tel}" class="autos-phone-link" title="Llamar ${value}">${value}</a>`;
}

function autos_docPreview(url, label) {
    if (!url) return '<div class="empty-state">Sin archivo</div>';
    const isPdf = /\.pdf(\?|$)/i.test(url);
    if (isPdf) {
        return `<a class="mini-btn" href="${url}" target="_blank" rel="noopener">Abrir ${label} PDF</a>`;
    }
    const candidates = autos_imagePreviewCandidates(url);
    const previewUrl = candidates[0] || url;
    return `<a href="${url}" target="_blank" rel="noopener"><img src="${previewUrl}" data-raw="${url}" data-try-idx="0" alt="${label}" style="width:100%;height:140px;object-fit:cover;border-radius:.6rem;background:rgba(255,255,255,.05);" onload="autos_handleDocPreviewLoad(this)" onerror="autos_handleDocPreviewError(this)" /></a>`;
}

function autos_handleDocPreviewLoad(imgEl) {
    if (!imgEl) return;
    imgEl.style.display = 'block';
    imgEl.style.opacity = '1';
}

async function autos_handleDocPreviewError(imgEl) {
    if (!imgEl) return;
    const raw = (imgEl.dataset.raw || '').toString().trim();
    const candidates = autos_imagePreviewCandidates(raw);
    const currentTry = parseInt(imgEl.dataset.tryIdx || '0', 10) || 0;
    const nextTry = currentTry + 1;
    if (nextTry < candidates.length) {
        imgEl.dataset.tryIdx = String(nextTry);
        imgEl.src = candidates[nextTry];
        return;
    }
    const driveId = autos_extractDriveFileId(raw);
    const triedDriveAuth = imgEl.dataset.triedDriveAuth === '1';
    if (driveId && !triedDriveAuth) {
        imgEl.dataset.triedDriveAuth = '1';
        try {
            const authUrl = await autos_fetchDriveImageObjectUrl(raw);
            if (authUrl) {
                imgEl.src = authUrl;
                return;
            }
        } catch (_) {}
    }
    imgEl.src = AUTOS_IMAGE_PLACEHOLDER;
    imgEl.style.objectFit = 'contain';
    imgEl.style.opacity = '.72';
}

function autos_previewUrlForImage(url) {
    const raw = (url || '').toString().trim();
    if (!raw) return '';
    const driveId = autos_extractDriveFileId(raw);
    if (driveId) return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`;
    return raw;
}

function autos_imagePreviewCandidates(url) {
    const raw = (url || '').toString().trim();
    if (!raw) return [];
    const driveId = autos_extractDriveFileId(raw);
    const out = [];
    const add = (value) => {
        const item = (value || '').toString().trim();
        if (!item || out.includes(item)) return;
        out.push(item);
    };
    if (driveId) {
        add(`https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`);
        add(`https://drive.google.com/uc?export=view&id=${driveId}`);
    }
    if (/\.hei[cf](\?|$)/i.test(raw)) {
        const noProto = raw.replace(/^https?:\/\//i, '');
        add(`https://images.weserv.nl/?url=${encodeURIComponent(noProto)}`);
    }
    add(raw);
    return out;
}

function autos_getImageDebug(carId) {
    return autosState.imageDebug[carId] || {};
}

function autos_patchImageDebug(carId, patch) {
    if (!carId) return;
    autosState.imageDebug[carId] = {
        ...(autosState.imageDebug[carId] || {}),
        ...patch,
        updatedAt: new Date().toISOString(),
    };
}

async function autos_fetchDriveImageObjectUrl(rawUrl) {
    const driveId = autos_extractDriveFileId(rawUrl);
    if (!driveId) return '';
    const cached = autosState.driveImageObjectUrls[driveId] || '';
    if (cached) return cached;
    const res = await authFetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`);
    if (!res.ok) throw new Error(`drive_media_${res.status}`);
    const blob = await res.blob();
    const type = (blob?.type || '').toLowerCase();
    if (!type.startsWith('image/')) throw new Error('drive_media_not_image');
    const objectUrl = URL.createObjectURL(blob);
    autosState.driveImageObjectUrls[driveId] = objectUrl;
    return objectUrl;
}

function autos_handleCarImageLoad(imgEl, carId, slot) {
    if (!imgEl || !carId) return;
    autos_patchImageDebug(carId, {
        lastEvent: 'load',
        lastSlot: slot || '-',
        lastSrc: imgEl.currentSrc || imgEl.src || '-',
        rawUrl: imgEl.dataset.raw || '-',
        candidatesCount: autos_imagePreviewCandidates(imgEl.dataset.raw || '').length,
        currentTry: parseInt(imgEl.dataset.tryIdx || '0', 10) || 0,
    });
}

async function autos_handleCarImageError(imgEl, carId, slot) {
    if (!imgEl || !carId) return;
    const raw = (imgEl.dataset.raw || '').toString().trim();
    const candidates = autos_imagePreviewCandidates(raw);
    const currentTry = parseInt(imgEl.dataset.tryIdx || '0', 10) || 0;
    const nextTry = currentTry + 1;
    autos_patchImageDebug(carId, {
        lastEvent: 'error',
        lastSlot: slot || '-',
        lastErrorSrc: imgEl.currentSrc || imgEl.src || '-',
        rawUrl: raw || '-',
        candidatesCount: candidates.length,
        currentTry,
    });
    if (nextTry < candidates.length) {
        imgEl.dataset.tryIdx = String(nextTry);
        imgEl.src = candidates[nextTry];
        return;
    }

    const driveId = autos_extractDriveFileId(raw);
    const triedDriveAuth = imgEl.dataset.triedDriveAuth === '1';
    if (driveId && !triedDriveAuth) {
        imgEl.dataset.triedDriveAuth = '1';
        try {
            const authUrl = await autos_fetchDriveImageObjectUrl(raw);
            if (authUrl) {
                autos_patchImageDebug(carId, {
                    driveAuthAttempt: 'ok',
                    driveAuthSrc: authUrl,
                });
                imgEl.src = authUrl;
                return;
            }
        } catch (err) {
            autos_patchImageDebug(carId, {
                driveAuthAttempt: 'error',
                driveAuthError: String(err?.message || err || 'drive_auth_failed'),
            });
        }
    }

    imgEl.src = AUTOS_IMAGE_PLACEHOLDER;
    imgEl.style.objectFit = 'contain';
    imgEl.style.opacity = '.72';
    autos_patchImageDebug(carId, {
        fallbackApplied: 'placeholder',
        finalTriedSrc: imgEl.currentSrc || imgEl.src || '-',
    });
}

function autos_extractDriveFileId(url) {
    const raw = (url || '').toString();
    let m = raw.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (m) return m[1];
    m = raw.match(/[?&]id=([^&]+)/i);
    if (m) return m[1];
    m = raw.match(/\/d\/([^/=?#]+)/i);
    if (m) return m[1];
    return '';
}

function autos_licensePreviewCandidates(url) {
    const raw = (url || '').toString().trim();
    if (!raw) return [];
    const id = autos_extractDriveFileId(raw);
    if (!id) return [raw];
    return [
        `https://drive.google.com/thumbnail?id=${id}&sz=w2000`,
        `https://drive.google.com/uc?export=view&id=${id}`,
        `https://lh3.googleusercontent.com/d/${id}=w2000`,
        raw,
    ];
}

async function autos_saveMeta() {
    const entries = Object.entries(autosState.meta || {});
    await sheetsClear(SPREADSHEET_AUTOS_ID, 'AutosMeta!A2:B');
    if (!entries.length) return;
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `AutosMeta!A2:B${entries.length + 1}`, entries.map(([k, v]) => [k, v]));
}

function autos_valuationMetaKey(carId, suffix) {
    return `valuation_${carId}_${suffix}`;
}

function autos_getValuationInfo(carId) {
    const mxn = parseSheetValue(autosState.meta?.[autos_valuationMetaKey(carId, 'mxn')]);
    const low = parseSheetValue(autosState.meta?.[autos_valuationMetaKey(carId, 'low')]);
    const high = parseSheetValue(autosState.meta?.[autos_valuationMetaKey(carId, 'high')]);
    const date = (autosState.meta?.[autos_valuationMetaKey(carId, 'date')] || '').toString();
    const sample = parseInt(autosState.meta?.[autos_valuationMetaKey(carId, 'sample')] || '0', 10) || 0;
    const source = (autosState.meta?.[autos_valuationMetaKey(carId, 'source')] || '').toString();
    const statusRaw = (autosState.meta?.[autos_valuationMetaKey(carId, 'status')] || '').toString();
    const error = (autosState.meta?.[autos_valuationMetaKey(carId, 'error')] || '').toString();
    const kmAdjustmentPct = parseSheetValue(autosState.meta?.[autos_valuationMetaKey(carId, 'kmAdjPct')]);
    let status = statusRaw;
    if (!['ok', 'no_data', 'error', 'loading'].includes(status)) {
        if (autosState.valuationInFlight.has(carId)) status = 'loading';
        else if (mxn > 0) status = 'ok';
        else if (date) status = 'no_data';
        else status = '';
    }
    return { mxn, low, high, date, sample, source, status, error, kmAdjustmentPct };
}

function autos_getValuationLabel(carId) {
    const info = autos_getValuationInfo(carId);
    if (info.status === 'loading') return 'Calculando valor de mercado...';
    if (info.status === 'ok' && info.mxn > 0) {
        const dateTxt = info.date ? ` (${info.date})` : '';
        const sourceTxt = info.source === 'EstimadoLocal' ? ' (estimado)' : '';
        return `${formatCurrency(info.mxn)}${sourceTxt}${dateTxt}`;
    }
    if (info.status === 'no_data') {
        const dateTxt = info.date ? ` (${info.date})` : '';
        return `Sin datos de mercado${dateTxt}`;
    }
    if (info.status === 'error') {
        return 'Error al calcular (toca actualizar)';
    }
    if (meli_isAccessTokenValid() || !!meliAuthState.refreshToken) return 'Pendiente de calcular';
    return 'Conecta Mercado Libre para calcular';
}

function autos_getMeliConnectionLabel() {
    if (meli_isAccessTokenValid()) return 'Mercado Libre conectado';
    if (meliAuthState.refreshToken) return 'Mercado Libre conectado (renovando...)';
    if (meliAuthState.lastError) return 'Mercado Libre: error de conexion';
    return 'Mercado Libre por conectar';
}

function autos_renderMeliDebug() {
    const bodyEl = document.getElementById('autos-meli-debug-body');
    if (!bodyEl) return;
    const info = meliAuthState.debugInfo || {};
    const now = new Date();
    const expiresInSec = meliAuthState.expiresAt ? Math.floor((meliAuthState.expiresAt - now.getTime()) / 1000) : 0;
    const selectedCar = autosState.cars.find(c => c.id === autosState.selectedCarId) || null;
    const selectedValuation = selectedCar ? autos_getValuationInfo(selectedCar.id) : null;
    const selectedKm = selectedCar ? autos_parseMileage(selectedCar.kilometraje) : 0;
    const selectedQuery = selectedCar ? autos_buildValuationQuery(selectedCar) : '';
    const imageDbg = selectedCar ? autos_getImageDebug(selectedCar.id) : {};
    const rows = [
        ['appVersion', APP_VERSION],
        ['meliClientId', MELI_CLIENT_ID],
        ['brokerBaseUrl', MELI_BROKER_BASE_URL],
        ['redirectUri', meli_getRedirectUri()],
        ['meliConnected', meli_isAccessTokenValid() ? 'yes' : 'no'],
        ['hasAccessToken', meliAuthState.accessToken ? 'yes' : 'no'],
        ['hasRefreshToken', meliAuthState.refreshToken ? 'yes' : 'no'],
        ['expiresInSec', String(expiresInSec)],
        ['lastError', meliAuthState.lastError || '-'],
        ['debug.phase', info.phase || '-'],
        ['debug.updatedAt', info.updatedAt || '-'],
        ['debug.oauthError', info.oauthError || '-'],
        ['debug.oauthErrorDesc', info.oauthErrorDesc || '-'],
        ['debug.callbackState', info.callbackState || '-'],
        ['debug.expectedState', info.expectedState || '-'],
        ['debug.hasVerifier', String(info.hasVerifier ?? '-')],
        ['debug.tokenExchangeStatus', String(info.tokenExchangeStatus ?? '-')],
        ['debug.tokenExchangeDetail', info.tokenExchangeDetail || '-'],
        ['debug.tokenRefreshStatus', String(info.tokenRefreshStatus ?? '-')],
        ['valuation.carId', selectedCar?.id || '-'],
        ['valuation.carName', selectedCar ? `${selectedCar.marca || '-'} ${selectedCar.modelo || '-'}`.trim() : '-'],
        ['valuation.year', selectedCar?.anio || '-'],
        ['valuation.invoice', parseSheetValue(selectedCar?.valorFactura) > 0 ? String(Math.round(parseSheetValue(selectedCar?.valorFactura))) : '-'],
        ['valuation.km', selectedKm ? String(selectedKm) : '-'],
        ['valuation.query', selectedQuery || '-'],
        ['valuation.status', selectedValuation?.status || '-'],
        ['valuation.source', selectedValuation?.source || '-'],
        ['valuation.error', selectedValuation?.error || '-'],
        ['valuation.date', selectedValuation?.date || '-'],
        ['valuation.sample', selectedValuation ? String(selectedValuation.sample || 0) : '-'],
        ['valuation.lowMxn', selectedValuation ? String(Math.round(selectedValuation.low || 0)) : '-'],
        ['valuation.midMxn', selectedValuation ? String(Math.round(selectedValuation.mxn || 0)) : '-'],
        ['valuation.highMxn', selectedValuation ? String(Math.round(selectedValuation.high || 0)) : '-'],
        ['valuation.kmAdjPct', selectedValuation ? String(selectedValuation.kmAdjustmentPct || 0) : '-'],
        ['valuation.debug.phase', info.valuationPhase || '-'],
        ['valuation.debug.httpStatus', String(info.valuationHttpStatus ?? '-')],
        ['valuation.debug.url', info.valuationUrl || '-'],
        ['valuation.debug.results', String(info.valuationResultsCount ?? '-')],
        ['valuation.debug.prices', String(info.valuationPricesCount ?? '-')],
        ['valuation.debug.error', info.valuationError || '-'],
        ['valuation.debug.force', String(info.valuationForce ?? '-')],
        ['valuation.debug.interactiveAuth', String(info.valuationInteractiveAuth ?? '-')],
        ['image.rawUrl', imageDbg.rawUrl || '-'],
        ['image.candidatesCount', String(imageDbg.candidatesCount ?? '-')],
        ['image.lastEvent', imageDbg.lastEvent || '-'],
        ['image.lastSlot', imageDbg.lastSlot || '-'],
        ['image.lastSrc', imageDbg.lastSrc || '-'],
        ['image.lastErrorSrc', imageDbg.lastErrorSrc || '-'],
        ['image.currentTry', String(imageDbg.currentTry ?? '-')],
        ['image.fallbackApplied', imageDbg.fallbackApplied || '-'],
        ['image.updatedAt', imageDbg.updatedAt || '-'],
    ];
    bodyEl.innerHTML = rows.map(([k, v]) => `<div class="autos-debug-row"><span>${k}</span><strong>${String(v)}</strong></div>`).join('');
}

function autos_buildMeliDebugSnapshot() {
    const info = meliAuthState.debugInfo || {};
    const selectedCar = autosState.cars.find(c => c.id === autosState.selectedCarId) || null;
    const selectedValuation = selectedCar ? autos_getValuationInfo(selectedCar.id) : null;
    const selectedKm = selectedCar ? autos_parseMileage(selectedCar.kilometraje) : 0;
    const selectedQuery = selectedCar ? autos_buildValuationQuery(selectedCar) : '';
    const imageDbg = selectedCar ? autos_getImageDebug(selectedCar.id) : {};
    const nowIso = new Date().toISOString();
    const expiresInSec = meliAuthState.expiresAt ? Math.floor((meliAuthState.expiresAt - Date.now()) / 1000) : 0;
    const lines = [
        `debugCapturedAt=${nowIso}`,
        `appVersion=${APP_VERSION}`,
        `meliClientId=${MELI_CLIENT_ID}`,
        `brokerBaseUrl=${MELI_BROKER_BASE_URL}`,
        `redirectUri=${meli_getRedirectUri()}`,
        `meliConnected=${meli_isAccessTokenValid() ? 'yes' : 'no'}`,
        `hasAccessToken=${meliAuthState.accessToken ? 'yes' : 'no'}`,
        `hasRefreshToken=${meliAuthState.refreshToken ? 'yes' : 'no'}`,
        `expiresInSec=${expiresInSec}`,
        `lastError=${meliAuthState.lastError || '-'}`,
        `debug.phase=${info.phase || '-'}`,
        `debug.updatedAt=${info.updatedAt || '-'}`,
        `debug.tokenExchangeStatus=${String(info.tokenExchangeStatus ?? '-')}`,
        `debug.tokenExchangeDetail=${info.tokenExchangeDetail || '-'}`,
        `debug.tokenRefreshStatus=${String(info.tokenRefreshStatus ?? '-')}`,
        `valuation.carId=${selectedCar?.id || '-'}`,
        `valuation.carName=${selectedCar ? `${selectedCar.marca || '-'} ${selectedCar.modelo || '-'}`.trim() : '-'}`,
        `valuation.year=${selectedCar?.anio || '-'}`,
        `valuation.invoice=${parseSheetValue(selectedCar?.valorFactura) > 0 ? String(Math.round(parseSheetValue(selectedCar?.valorFactura))) : '-'}`,
        `valuation.km=${selectedKm ? String(selectedKm) : '-'}`,
        `valuation.query=${selectedQuery || '-'}`,
        `valuation.status=${selectedValuation?.status || '-'}`,
        `valuation.source=${selectedValuation?.source || '-'}`,
        `valuation.error=${selectedValuation?.error || '-'}`,
        `valuation.date=${selectedValuation?.date || '-'}`,
        `valuation.sample=${selectedValuation ? String(selectedValuation.sample || 0) : '-'}`,
        `valuation.lowMxn=${selectedValuation ? String(Math.round(selectedValuation.low || 0)) : '-'}`,
        `valuation.midMxn=${selectedValuation ? String(Math.round(selectedValuation.mxn || 0)) : '-'}`,
        `valuation.highMxn=${selectedValuation ? String(Math.round(selectedValuation.high || 0)) : '-'}`,
        `valuation.kmAdjPct=${selectedValuation ? String(selectedValuation.kmAdjustmentPct || 0) : '-'}`,
        `valuation.debug.phase=${info.valuationPhase || '-'}`,
        `valuation.debug.httpStatus=${String(info.valuationHttpStatus ?? '-')}`,
        `valuation.debug.url=${info.valuationUrl || '-'}`,
        `valuation.debug.results=${String(info.valuationResultsCount ?? '-')}`,
        `valuation.debug.prices=${String(info.valuationPricesCount ?? '-')}`,
        `valuation.debug.error=${info.valuationError || '-'}`,
        `valuation.debug.force=${String(info.valuationForce ?? '-')}`,
        `valuation.debug.interactiveAuth=${String(info.valuationInteractiveAuth ?? '-')}`,
        `image.rawUrl=${imageDbg.rawUrl || '-'}`,
        `image.candidatesCount=${String(imageDbg.candidatesCount ?? '-')}`,
        `image.lastEvent=${imageDbg.lastEvent || '-'}`,
        `image.lastSlot=${imageDbg.lastSlot || '-'}`,
        `image.lastSrc=${imageDbg.lastSrc || '-'}`,
        `image.lastErrorSrc=${imageDbg.lastErrorSrc || '-'}`,
        `image.currentTry=${String(imageDbg.currentTry ?? '-')}`,
        `image.fallbackApplied=${imageDbg.fallbackApplied || '-'}`,
        `image.updatedAt=${imageDbg.updatedAt || '-'}`,
    ];
    return lines.join('\n');
}

async function autos_copyMeliDebug() {
    const text = autos_buildMeliDebugSnapshot();
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        showToast('📋 Debug copiado, pegalo en el chat');
    } catch (err) {
        console.warn('No se pudo copiar debug:', err);
        showToast('⚠️ No se pudo copiar debug');
    }
}

function autos_openMeliDebug() {
    autos_renderMeliDebug();
    document.getElementById('autos-meli-debug-panel')?.classList.remove('hidden');
}

function autos_closeMeliDebug() {
    document.getElementById('autos-meli-debug-panel')?.classList.add('hidden');
}

function autos_buildValuationQuery(car) {
    const marca = (car?.marca || '').toString().trim();
    const modelo = (car?.modelo || '').toString().trim();
    const anio = (car?.anio || '').toString().trim();
    return [marca, modelo, anio].filter(Boolean).join(' ');
}

function autos_parseMileage(raw) {
    const normalized = (raw || '').toString().replace(/[^\d]/g, '');
    const km = parseInt(normalized, 10);
    return Number.isFinite(km) && km > 0 ? km : 0;
}

function autos_calculateMileageAdjustment(car) {
    const km = autos_parseMileage(car?.kilometraje);
    const year = parseInt((car?.anio || '').toString(), 10);
    const currentYear = new Date().getFullYear();
    if (!km || !Number.isFinite(year) || year < 1980 || year > currentYear + 1) {
        return { km, expectedKm: 0, factor: 1, adjustmentPct: 0 };
    }
    const age = Math.max(1, currentYear - year + 1);
    const expectedKm = age * 16000;
    const deltaRatio = (km - expectedKm) / Math.max(1, expectedKm);
    const rawFactor = 1 - (deltaRatio * 0.22);
    const factor = Math.max(0.72, Math.min(1.18, rawFactor));
    const adjustmentPct = Math.round((factor - 1) * 1000) / 10;
    return { km, expectedKm, factor, adjustmentPct };
}

function autos_estimateFallbackValuation(car) {
    const year = parseInt((car?.anio || '').toString(), 10);
    const currentYear = new Date().getFullYear();
    const age = Number.isFinite(year) ? Math.max(1, currentYear - year + 1) : 12;
    const invoiceValue = parseSheetValue(car?.valorFactura);
    const modelText = `${car?.marca || ''} ${car?.modelo || ''}`.toLowerCase();

    let segmentMultiplier = 1;
    if (/(koleos|taos|tiguan|rav4|xtrail|cx-5|suv)/i.test(modelText)) segmentMultiplier = 1.22;
    else if (/(jetta|sentra|corolla|civic|mazda\s*3|versa|rio|yaris)/i.test(modelText)) segmentMultiplier = 0.96;
    else if (/(pickup|hilux|l200|ranger|np300|frontier)/i.test(modelText)) segmentMultiplier = 1.28;

    const baseFromSegment = 430000 * segmentMultiplier;
    const baseNewMxn = invoiceValue > 0 ? invoiceValue : baseFromSegment;
    const depreciationFactor = Math.pow(0.937, Math.max(0, age - 1));
    let midBase = Math.max(65000, Math.min(1200000, baseNewMxn * depreciationFactor));
    if (invoiceValue > 0) midBase = Math.min(midBase, invoiceValue);
    const kmAdj = autos_calculateMileageAdjustment(car);
    const calibrationOffsetMxn = 10000;
    const mid = Math.max(55000, (midBase * kmAdj.factor) - calibrationOffsetMxn);
    const low = mid * 0.84;
    const high = mid * 1.16;

    return {
        low: Math.round(low),
        mid: Math.round(mid),
        high: Math.round(high),
        kmAdj,
    };
}

function autos_setValuationStatus(carId, status, error = '') {
    autosState.meta[autos_valuationMetaKey(carId, 'status')] = status;
    autosState.meta[autos_valuationMetaKey(carId, 'error')] = error;
}

function autos_percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
    return sorted[idx];
}

async function autos_refreshCarValuationIfNeeded(car, options = {}) {
    if (!car?.id) return;
    const force = options.force === true;
    const interactiveAuth = options.interactiveAuth === true;
    const providedToken = (options.accessToken || '').toString().trim();
    const today = new Date().toISOString().slice(0, 10);
    const dateKey = autos_valuationMetaKey(car.id, 'date');
    if (!force && (autosState.meta?.[dateKey] || '') === today) return;
    if (autosState.valuationInFlight.has(car.id)) return;

    const query = autos_buildValuationQuery(car);
    meli_updateDebugInfo({
        valuationPhase: 'valuation_start',
        valuationCarId: car.id,
        valuationQuery: query,
        valuationForce: force,
        valuationInteractiveAuth: interactiveAuth,
    });
    if (!query) {
        autosState.meta[dateKey] = today;
        autos_setValuationStatus(car.id, 'error', 'Faltan datos para consultar');
        meli_updateDebugInfo({ valuationPhase: 'valuation_missing_query' });
        if (autosState.selectedCarId === car.id) autos_renderSelectedCar();
        await autos_saveMeta();
        return;
    }

    autosState.valuationInFlight.add(car.id);
    autos_setValuationStatus(car.id, 'loading', '');
    if (autosState.selectedCarId === car.id) autos_renderSelectedCar();
    try {
        const meliToken = providedToken || await meli_ensureAccessToken(interactiveAuth);
        if (!meliToken) meli_updateDebugInfo({ valuationPhase: 'valuation_no_token' });
        await ensureUsdMxnRateForTransactions();
        const valuationUrls = [
            `https://api.mercadolibre.com/sites/MLM/search?limit=50&q=${encodeURIComponent(query)}`,
            `https://api.mercadolibre.com/sites/MLM/search?category=MLM1744&limit=50&q=${encodeURIComponent(query)}`,
        ];
        let data = null;
        let lastError = '';

        const tryFetchValuation = async (url, useAuth) => {
            const headers = useAuth && meliToken ? { Authorization: `Bearer ${meliToken}` } : undefined;
            const phase = useAuth ? 'valuation_fetch_auth' : 'valuation_fetch_public';
            const res = await fetch(url, headers ? { headers } : undefined);
            meli_updateDebugInfo({ valuationPhase: phase, valuationHttpStatus: res.status, valuationUrl: url });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                const detail = payload?.message || payload?.error || payload?.cause || `MLM valuation ${res.status}`;
                throw new Error(String(detail));
            }
            return res.json();
        };

        for (const url of valuationUrls) {
            if (data) break;
            if (meliToken) {
                try {
                    data = await tryFetchValuation(url, true);
                } catch (err) {
                    lastError = String(err?.message || err || 'Load failed');
                    meli_updateDebugInfo({ valuationPhase: 'valuation_fetch_auth_error', valuationError: lastError });
                }
            }
            if (data) break;
            try {
                data = await tryFetchValuation(url, false);
            } catch (err) {
                lastError = String(err?.message || err || 'Load failed');
                meli_updateDebugInfo({ valuationPhase: 'valuation_fetch_public_error', valuationError: lastError });
            }
        }

        if (!data) {
            throw new Error(lastError || 'MLM valuation failed');
        }

        const results = Array.isArray(data?.results) ? data.results : [];
        const prices = [];
        for (const row of results) {
            const amount = parseSheetValue(row?.price);
            if (amount <= 0) continue;
            const currency = parseCurrencyCode((row?.currency_id || 'MXN').toString().toUpperCase());
            const mxn = convertTransactionAmountToMxn(amount, currency);
            if (mxn > 0) prices.push(mxn);
        }
        prices.sort((a, b) => a - b);
        meli_updateDebugInfo({ valuationResultsCount: results.length, valuationPricesCount: prices.length });
        if (!prices.length) {
            autosState.meta[dateKey] = today;
            autosState.meta[autos_valuationMetaKey(car.id, 'mxn')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'low')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'high')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'sample')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'kmAdjPct')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'source')] = 'MercadoLibre';
            autos_setValuationStatus(car.id, 'no_data', '');
            meli_updateDebugInfo({ valuationPhase: 'valuation_no_data' });
            await autos_saveMeta();
            return;
        }
        const lowBase = autos_percentile(prices, 0.2);
        const midBase = autos_percentile(prices, 0.5);
        const highBase = autos_percentile(prices, 0.8);
        const kmAdj = autos_calculateMileageAdjustment(car);
        const low = lowBase * kmAdj.factor;
        const mid = midBase * kmAdj.factor;
        const high = highBase * kmAdj.factor;
        autosState.meta[dateKey] = today;
        autosState.meta[autos_valuationMetaKey(car.id, 'mxn')] = String(Math.round(mid));
        autosState.meta[autos_valuationMetaKey(car.id, 'low')] = String(Math.round(low));
        autosState.meta[autos_valuationMetaKey(car.id, 'high')] = String(Math.round(high));
        autosState.meta[autos_valuationMetaKey(car.id, 'sample')] = String(prices.length);
        autosState.meta[autos_valuationMetaKey(car.id, 'kmAdjPct')] = String(kmAdj.adjustmentPct);
        autosState.meta[autos_valuationMetaKey(car.id, 'source')] = 'MercadoLibre';
        autos_setValuationStatus(car.id, 'ok', '');
        meli_updateDebugInfo({ valuationPhase: 'valuation_ok' });
        await autos_saveMeta();
        if (autosState.selectedCarId === car.id) autos_renderSelectedCar();
    } catch (err) {
        console.warn('No se pudo actualizar valuacion del auto:', err);
        const errMsg = String(err?.message || 'Error inesperado');
        if (/forbidden|403/i.test(errMsg)) {
            const est = autos_estimateFallbackValuation(car);
            autosState.meta[dateKey] = today;
            autosState.meta[autos_valuationMetaKey(car.id, 'mxn')] = String(est.mid);
            autosState.meta[autos_valuationMetaKey(car.id, 'low')] = String(est.low);
            autosState.meta[autos_valuationMetaKey(car.id, 'high')] = String(est.high);
            autosState.meta[autos_valuationMetaKey(car.id, 'sample')] = '0';
            autosState.meta[autos_valuationMetaKey(car.id, 'kmAdjPct')] = String(est.kmAdj.adjustmentPct);
            autosState.meta[autos_valuationMetaKey(car.id, 'source')] = 'EstimadoLocal';
            autos_setValuationStatus(car.id, 'ok', '');
            meli_updateDebugInfo({ valuationPhase: 'valuation_fallback_estimate', valuationError: errMsg });
            await autos_saveMeta();
            return;
        }
        autosState.meta[dateKey] = today;
        autos_setValuationStatus(car.id, 'error', errMsg);
        meli_updateDebugInfo({ valuationPhase: 'valuation_error', valuationError: errMsg });
        await autos_saveMeta();
    } finally {
        autosState.valuationInFlight.delete(car.id);
        if (autosState.selectedCarId === car.id) autos_renderSelectedCar();
    }
}

function autos_refreshAllDailyValuations() {
    const list = [...autosState.cars];
    const run = async () => {
        const token = await meli_ensureAccessToken(false);
        if (!token) return;
        for (const car of list) {
            await autos_refreshCarValuationIfNeeded(car, { accessToken: token, interactiveAuth: false });
        }
    };
    run().catch(() => {});
}

function autos_openCarDetail() {
    const car = autosState.cars.find(c => c.id === autosState.selectedCarId);
    if (!car) return;
    const detailEl = document.getElementById('autos-detail-content');
    if (!detailEl) return;
    const photoRaw = (car.fotoAuto || '').toString().trim();
    const photoCandidates = autos_imagePreviewCandidates(photoRaw);
    const photoSrc = photoCandidates[0] || AUTOS_IMAGE_PLACEHOLDER;
    autos_patchImageDebug(car.id, {
        openDetailSrc: photoSrc,
        rawUrl: photoRaw || '-',
        candidatesCount: photoCandidates.length,
    });
    const extra1Name = (car.extraDoc1Nombre || '').toString().trim() || 'Documento extra 1';
    const extra2Name = (car.extraDoc2Nombre || '').toString().trim() || 'Documento extra 2';
    const detailRows = [];
    if (car.placa) detailRows.push(`<div class="autos-detail-row"><strong>Placa:</strong> <span>${car.placa}</span></div>`);
    if (car.vin) detailRows.push(`<div class="autos-detail-row"><strong>VIN:</strong> <span>${car.vin}</span></div>`);
    if (autos_parseMileage(car.kilometraje)) detailRows.push(`<div class="autos-detail-row"><strong>Kilometraje:</strong> <span>${autos_parseMileage(car.kilometraje).toLocaleString('es-MX')} km</span></div>`);
    if (autos_parseMileage(car.proximaRevisionKm)) detailRows.push(`<div class="autos-detail-row"><strong>Próxima revisión:</strong> <span>${autos_parseMileage(car.proximaRevisionKm).toLocaleString('es-MX')} km</span></div>`);
    if (parseSheetValue(car.valorFactura) > 0) detailRows.push(`<div class="autos-detail-row"><strong>Factura:</strong> <span>${formatCurrency(parseSheetValue(car.valorFactura))}</span></div>`);
    if (car.facturaArchivo) detailRows.push(`<div class="autos-detail-row"><strong>Archivo factura:</strong> <span><a href="${car.facturaArchivo}" target="_blank" rel="noopener">Abrir original</a></span></div>`);
    if (car.propietario) detailRows.push(`<div class="autos-detail-row"><strong>Propietario:</strong> <span>${car.propietario}</span></div>`);
    const seguroParts = [car.tieneSeguro ? 'Si' : 'No'];
    if (car.polizaSeguro) seguroParts.push(`Poliza ${car.polizaSeguro}`);
    if (car.vencimientoPoliza) seguroParts.push(`Vence ${car.vencimientoPoliza}`);
    detailRows.push(`<div class="autos-detail-row"><strong>Seguro:</strong> <span>${seguroParts.join(' · ')}</span></div>`);
    if (car.polizaArchivo) detailRows.push(`<div class="autos-detail-row"><strong>Archivo poliza:</strong> <span><a href="${car.polizaArchivo}" target="_blank" rel="noopener">Abrir original</a></span></div>`);
    if (car.extraDoc1Url) detailRows.push(`<div class="autos-detail-row"><strong>${extra1Name}:</strong> <span><a href="${car.extraDoc1Url}" target="_blank" rel="noopener">Abrir original</a></span></div>`);
    if (car.extraDoc2Url) detailRows.push(`<div class="autos-detail-row"><strong>${extra2Name}:</strong> <span><a href="${car.extraDoc2Url}" target="_blank" rel="noopener">Abrir original</a></span></div>`);
    detailRows.push(`<div class="autos-detail-row"><strong>Valor hoy:</strong> <span>${autos_getValuationLabel(car.id)}</span></div>`);
    const hasEmergency = !!((car.emergenciaInterior || '').trim() || (car.emergenciaMetro || '').trim());
    if (hasEmergency) detailRows.push(`<div class="autos-detail-row"><strong>Emergencia:</strong> <span>${autos_phoneLinkOrText(car.emergenciaInterior, 'Interior')} · ${autos_phoneLinkOrText(car.emergenciaMetro, 'Metro')}</span></div>`);
    const hasClaims = !!((car.reporteSiniestros1 || '').trim() || (car.reporteSiniestros2 || '').trim());
    if (hasClaims) detailRows.push(`<div class="autos-detail-row"><strong>Siniestros:</strong> <span>${autos_phoneLinkOrText(car.reporteSiniestros1, 'Siniestros 1')} · ${autos_phoneLinkOrText(car.reporteSiniestros2, 'Siniestros 2')}</span></div>`);
    if (car.tipoLlantas) detailRows.push(`<div class="autos-detail-row"><strong>Llantas:</strong> <span>${car.tipoLlantas}</span></div>`);
    detailEl.innerHTML = `
        <div class="glass-subtle autos-detail-card" style="padding:.85rem;display:grid;gap:.55rem;">
            <img src="${photoSrc}" data-raw="${photoRaw}" data-try-idx="0" alt="Auto" style="width:100%;max-height:220px;object-fit:cover;border-radius:.75rem;background:rgba(255,255,255,.05);" onload="autos_handleCarImageLoad(this,'${car.id}','detail')" onerror="autos_handleCarImageError(this,'${car.id}','detail')" />
            <div class="autos-detail-title">${car.marca} ${car.modelo} (${car.anio || '-'})</div>
            ${detailRows.join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-top:.75rem;">
            <div class="glass-subtle" style="padding:.55rem;">
                <div class="diff-label" style="margin-bottom:.4rem;">Tarjeta circulación frontal</div>
                ${autos_docPreview(car.tarjetaCirculacionFrente, 'Tarjeta frontal')}
            </div>
            <div class="glass-subtle" style="padding:.55rem;">
                <div class="diff-label" style="margin-bottom:.4rem;">Tarjeta circulación trasera</div>
                ${autos_docPreview(car.tarjetaCirculacionAtras, 'Tarjeta trasera')}
            </div>
        </div>`;
    document.getElementById('autos-detail-title').innerText = `${car.marca} ${car.modelo}`;
    document.getElementById('autos-detail-panel')?.classList.remove('hidden');
}

function autos_closeCarDetail() {
    document.getElementById('autos-detail-panel')?.classList.add('hidden');
}

function autos_openLicensePanel() {
    const img = document.getElementById('autos-license-image');
    const empty = document.getElementById('autos-license-empty');
    const link = document.getElementById('autos-license-open-link');
    const url = (autosState.meta?.licenciaUrl || '').trim();
    const isPdf = /\.pdf(\?|$)/i.test(url);
    if (img) {
        const candidates = autos_licensePreviewCandidates(url);
        let idx = 0;
        img.style.cursor = url && !isPdf ? 'zoom-in' : 'default';
        img.onclick = url && !isPdf ? () => window.open(url, '_blank', 'noopener') : null;
        img.onerror = () => {
            idx += 1;
            if (idx < candidates.length) {
                img.src = candidates[idx];
                return;
            }
            img.style.display = 'none';
            img.style.cursor = 'default';
            img.onclick = null;
            if (link) link.classList.remove('hidden');
        };
        img.onload = () => {
            if (link) link.classList.add('hidden');
        };
        img.src = candidates[0] || '';
        img.style.display = url && !isPdf ? 'block' : 'none';
    }
    if (link) {
        link.href = url || '#';
        link.classList.toggle('hidden', !url || !isPdf);
    }
    if (empty) empty.classList.toggle('hidden', !!url);
    document.getElementById('autos-license-panel')?.classList.remove('hidden');
}

function autos_closeLicensePanel() {
    document.getElementById('autos-license-panel')?.classList.add('hidden');
}

function autos_licensePointerDown() {
    if (autosState.licenseLongPressTimer) clearTimeout(autosState.licenseLongPressTimer);
    autosState.licenseLongPressFired = false;
    autosState.licenseLongPressTimer = setTimeout(() => {
        autosState.licenseLongPressFired = true;
        document.getElementById('autos-license-file')?.click();
    }, 650);
}

function autos_licensePointerUp() {
    if (autosState.licenseLongPressTimer) {
        clearTimeout(autosState.licenseLongPressTimer);
        autosState.licenseLongPressTimer = null;
    }
}

function autos_licenseClick() {
    if (autosState.licenseLongPressFired) {
        autosState.licenseLongPressFired = false;
        return;
    }
    autos_openLicensePanel();
}

function autos_fileLooksLikeImage(file) {
    if (!file) return false;
    if ((file.type || '').toLowerCase().startsWith('image/')) return true;
    return /\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(file.name || '');
}

function autos_fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function autos_loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function autos_uploadLicenseFile(file) {
    const folderId = await autos_ensureRecibosFolder();
    const url = await driveUploadFile(file, folderId);
    if (!url) return;
    autosState.meta.licenciaUrl = url;
    await autos_saveMeta();
    autos_openLicensePanel();
    showToast('✅ Licencia guardada');
}

async function autos_openLicenseCropper(file) {
    const dataUrl = await autos_fileToDataUrl(file);
    const image = await autos_loadImage(dataUrl);
    autosState.licenseCrop = {
        image,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
    };
    autosState.licenseCropPointers = new Map();
    autosState.licenseCropDragLast = null;
    autosState.licenseCropPinchBaseDist = 0;
    autosState.licenseCropPinchBaseZoom = 1;
    const zoomEl = document.getElementById('autos-license-crop-zoom');
    const xEl = document.getElementById('autos-license-crop-x');
    const yEl = document.getElementById('autos-license-crop-y');
    if (zoomEl) zoomEl.value = '1';
    if (xEl) xEl.value = '0';
    if (yEl) yEl.value = '0';
    document.getElementById('autos-license-crop-panel')?.classList.remove('hidden');
    autos_renderLicenseCrop();
}

function autos_closeLicenseCropPanel() {
    document.getElementById('autos-license-crop-panel')?.classList.add('hidden');
    autosState.licenseCrop = null;
    autosState.licenseCropPointers = new Map();
    autosState.licenseCropDragLast = null;
    autosState.licenseCropPinchBaseDist = 0;
    autosState.licenseCropPinchBaseZoom = 1;
}

function autos_updateLicenseCropFromControls() {
    const crop = autosState.licenseCrop;
    if (!crop) return;
    crop.zoom = autos_clamp(Number(document.getElementById('autos-license-crop-zoom')?.value || 1), 1, 3);
    crop.offsetX = autos_clamp(Number(document.getElementById('autos-license-crop-x')?.value || 0), -100, 100);
    crop.offsetY = autos_clamp(Number(document.getElementById('autos-license-crop-y')?.value || 0), -100, 100);
    autos_renderLicenseCrop();
}

function autos_syncLicenseCropControls() {
    const crop = autosState.licenseCrop;
    if (!crop) return;
    const zoomEl = document.getElementById('autos-license-crop-zoom');
    const xEl = document.getElementById('autos-license-crop-x');
    const yEl = document.getElementById('autos-license-crop-y');
    if (zoomEl) zoomEl.value = String(crop.zoom);
    if (xEl) xEl.value = String(crop.offsetX);
    if (yEl) yEl.value = String(crop.offsetY);
}

function autos_clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function autos_canvasPoint(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function autos_distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function autos_getLicenseCropDrawBox(crop, cw, ch) {
    const img = crop.image;
    const baseScale = Math.max(cw / img.width, ch / img.height);
    const scale = baseScale * (crop.zoom || 1);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const freeX = Math.max(0, (drawW - cw) / 2);
    const freeY = Math.max(0, (drawH - ch) / 2);
    const dx = (cw - drawW) / 2 + (crop.offsetX / 100) * freeX;
    const dy = (ch - drawH) / 2 + (crop.offsetY / 100) * freeY;
    return { dx, dy, drawW, drawH };
}

function autos_drawLicenseCropScene(ctx, crop, cw, ch, showFrame = true) {
    const { dx, dy, drawW, drawH } = autos_getLicenseCropDrawBox(crop, cw, ch);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(crop.image, dx, dy, drawW, drawH);
    if (showFrame) {
        ctx.strokeStyle = 'rgba(251,191,36,.9)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, cw - 4, ch - 4);
    }
}

function autos_cropPointerDown(e) {
    const crop = autosState.licenseCrop;
    const canvas = document.getElementById('autos-license-crop-canvas');
    if (!crop || !canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = autos_canvasPoint(e, canvas);
    autosState.licenseCropPointers.set(e.pointerId, p);

    if (autosState.licenseCropPointers.size === 1) {
        autosState.licenseCropDragLast = p;
    }
    if (autosState.licenseCropPointers.size >= 2) {
        const pts = [...autosState.licenseCropPointers.values()].slice(0, 2);
        autosState.licenseCropPinchBaseDist = autos_distance(pts[0], pts[1]) || 1;
        autosState.licenseCropPinchBaseZoom = crop.zoom;
    }
}

function autos_cropPointerMove(e) {
    const crop = autosState.licenseCrop;
    const canvas = document.getElementById('autos-license-crop-canvas');
    if (!crop || !canvas) return;
    if (!autosState.licenseCropPointers.has(e.pointerId)) return;
    const p = autos_canvasPoint(e, canvas);
    autosState.licenseCropPointers.set(e.pointerId, p);

    if (autosState.licenseCropPointers.size === 1 && autosState.licenseCropDragLast) {
        const prev = autosState.licenseCropDragLast;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const draw = autos_getLicenseCropDrawBox(crop, canvas.width, canvas.height);
        const freeX = Math.max(1, (draw.drawW - canvas.width) / 2);
        const freeY = Math.max(1, (draw.drawH - canvas.height) / 2);
        crop.offsetX = autos_clamp(crop.offsetX + (dx / freeX) * 100, -100, 100);
        crop.offsetY = autos_clamp(crop.offsetY + (dy / freeY) * 100, -100, 100);
        autosState.licenseCropDragLast = p;
        autos_syncLicenseCropControls();
        autos_renderLicenseCrop();
        return;
    }

    if (autosState.licenseCropPointers.size >= 2) {
        const pts = [...autosState.licenseCropPointers.values()].slice(0, 2);
        const dist = autos_distance(pts[0], pts[1]) || 1;
        const baseDist = autosState.licenseCropPinchBaseDist || dist;
        const baseZoom = autosState.licenseCropPinchBaseZoom || crop.zoom;
        crop.zoom = autos_clamp(baseZoom * (dist / baseDist), 1, 3);
        autos_syncLicenseCropControls();
        autos_renderLicenseCrop();
    }
}

function autos_cropPointerUp(e) {
    autosState.licenseCropPointers.delete(e.pointerId);
    if (autosState.licenseCropPointers.size === 1) {
        autosState.licenseCropDragLast = [...autosState.licenseCropPointers.values()][0];
    } else {
        autosState.licenseCropDragLast = null;
    }
    if (autosState.licenseCropPointers.size < 2) {
        autosState.licenseCropPinchBaseDist = 0;
    }
}

function autos_renderLicenseCrop() {
    const crop = autosState.licenseCrop;
    const canvas = document.getElementById('autos-license-crop-canvas');
    if (!crop || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    autos_drawLicenseCropScene(ctx, crop, cw, ch, true);
}

async function autos_applyLicenseCrop() {
    const crop = autosState.licenseCrop;
    if (!crop) return;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 1200;
    outCanvas.height = 756;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return;
    autos_drawLicenseCropScene(outCtx, crop, outCanvas.width, outCanvas.height, false);
    const blob = await new Promise(resolve => outCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
        showToast('⚠️ No se pudo crear recorte');
        return;
    }
    const file = new File([blob], `licencia-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
        await autos_uploadLicenseFile(file);
        autos_closeLicenseCropPanel();
    } catch (err) {
        console.warn('No se pudo guardar recorte:', err);
        showToast('⚠️ No se pudo guardar licencia');
    }
}

function autos_docCropPreset(mode) {
    const key = (mode || 'libre').toString();
    if (key === 'credencial') return { ratio: 1.586, width: 1600, height: 1009 };
    if (key === 'carta') return { ratio: 8.5 / 11, width: 1700, height: 2200 };
    if (key === 'oficio') return { ratio: 8.5 / 13, width: 1700, height: 2600 };
    return { ratio: null, width: 1800, height: 1800 };
}

function autos_getDocCropFrame(cw, ch, mode) {
    const preset = autos_docCropPreset(mode);
    const margin = 24;
    if (!preset.ratio) {
        return { x: margin, y: margin, w: Math.max(10, cw - margin * 2), h: Math.max(10, ch - margin * 2) };
    }
    const availW = Math.max(10, cw - margin * 2);
    const availH = Math.max(10, ch - margin * 2);
    let w = availW;
    let h = w / preset.ratio;
    if (h > availH) {
        h = availH;
        w = h * preset.ratio;
    }
    return {
        x: (cw - w) / 2,
        y: (ch - h) / 2,
        w,
        h,
    };
}

function autos_drawDocCropScene(ctx, crop, cw, ch) {
    const { dx, dy, drawW, drawH } = autos_getLicenseCropDrawBox(crop, cw, ch);
    const frame = autos_getDocCropFrame(cw, ch, autosState.docCropMode);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(crop.image, dx, dy, drawW, drawH);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = 'rgba(251,191,36,.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
}

function autos_closeDocCropPanelInternal() {
    document.getElementById('autos-doc-crop-panel')?.classList.add('hidden');
    autosState.docCrop = null;
    autosState.docCropPointers = new Map();
    autosState.docCropDragLast = null;
    autosState.docCropPinchBaseDist = 0;
    autosState.docCropPinchBaseZoom = 1;
    autosState.docCropMode = 'carta';
}

function autos_finishDocCrop(resultFile) {
    const crop = autosState.docCrop;
    const resolve = crop?.resolve;
    autos_closeDocCropPanelInternal();
    if (resolve) resolve(resultFile || null);
}

function autos_cancelDocCropPanel() {
    const original = autosState.docCrop?.originalFile || null;
    autos_finishDocCrop(original);
}

async function autos_openDocCropper(file, options = {}) {
    const dataUrl = await autos_fileToDataUrl(file);
    const image = await autos_loadImage(dataUrl);
    const mode = (options.mode || 'carta').toString();
    const title = (options.title || 'Recortar documento').toString();

    return new Promise((resolve) => {
        autosState.docCrop = {
            image,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            originalFile: file,
            resolve,
        };
        autosState.docCropMode = mode;
        autosState.docCropPointers = new Map();
        autosState.docCropDragLast = null;
        autosState.docCropPinchBaseDist = 0;
        autosState.docCropPinchBaseZoom = 1;

        const titleEl = document.getElementById('autos-doc-crop-title');
        if (titleEl) titleEl.innerText = title;
        const sizeEl = document.getElementById('autos-doc-crop-size');
        if (sizeEl) sizeEl.value = mode;
        const zoomEl = document.getElementById('autos-doc-crop-zoom');
        const xEl = document.getElementById('autos-doc-crop-x');
        const yEl = document.getElementById('autos-doc-crop-y');
        if (zoomEl) zoomEl.value = '1';
        if (xEl) xEl.value = '0';
        if (yEl) yEl.value = '0';
        document.getElementById('autos-doc-crop-panel')?.classList.remove('hidden');
        autos_renderDocCrop();
    });
}

function autos_updateDocCropFromControls() {
    const crop = autosState.docCrop;
    if (!crop) return;
    crop.zoom = autos_clamp(Number(document.getElementById('autos-doc-crop-zoom')?.value || 1), 1, 3);
    crop.offsetX = autos_clamp(Number(document.getElementById('autos-doc-crop-x')?.value || 0), -100, 100);
    crop.offsetY = autos_clamp(Number(document.getElementById('autos-doc-crop-y')?.value || 0), -100, 100);
    autos_renderDocCrop();
}

function autos_updateDocCropMode() {
    autosState.docCropMode = (document.getElementById('autos-doc-crop-size')?.value || 'carta').toString();
    autos_renderDocCrop();
}

function autos_syncDocCropControls() {
    const crop = autosState.docCrop;
    if (!crop) return;
    const zoomEl = document.getElementById('autos-doc-crop-zoom');
    const xEl = document.getElementById('autos-doc-crop-x');
    const yEl = document.getElementById('autos-doc-crop-y');
    if (zoomEl) zoomEl.value = String(crop.zoom);
    if (xEl) xEl.value = String(crop.offsetX);
    if (yEl) yEl.value = String(crop.offsetY);
}

function autos_docCropPointerDown(e) {
    const crop = autosState.docCrop;
    const canvas = document.getElementById('autos-doc-crop-canvas');
    if (!crop || !canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = autos_canvasPoint(e, canvas);
    autosState.docCropPointers.set(e.pointerId, p);
    if (autosState.docCropPointers.size === 1) autosState.docCropDragLast = p;
    if (autosState.docCropPointers.size >= 2) {
        const pts = [...autosState.docCropPointers.values()].slice(0, 2);
        autosState.docCropPinchBaseDist = autos_distance(pts[0], pts[1]) || 1;
        autosState.docCropPinchBaseZoom = crop.zoom;
    }
}

function autos_docCropPointerMove(e) {
    const crop = autosState.docCrop;
    const canvas = document.getElementById('autos-doc-crop-canvas');
    if (!crop || !canvas) return;
    if (!autosState.docCropPointers.has(e.pointerId)) return;
    const p = autos_canvasPoint(e, canvas);
    autosState.docCropPointers.set(e.pointerId, p);

    if (autosState.docCropPointers.size === 1 && autosState.docCropDragLast) {
        const prev = autosState.docCropDragLast;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const draw = autos_getLicenseCropDrawBox(crop, canvas.width, canvas.height);
        const freeX = Math.max(1, (draw.drawW - canvas.width) / 2);
        const freeY = Math.max(1, (draw.drawH - canvas.height) / 2);
        crop.offsetX = autos_clamp(crop.offsetX + (dx / freeX) * 100, -100, 100);
        crop.offsetY = autos_clamp(crop.offsetY + (dy / freeY) * 100, -100, 100);
        autosState.docCropDragLast = p;
        autos_syncDocCropControls();
        autos_renderDocCrop();
        return;
    }

    if (autosState.docCropPointers.size >= 2) {
        const pts = [...autosState.docCropPointers.values()].slice(0, 2);
        const dist = autos_distance(pts[0], pts[1]) || 1;
        const baseDist = autosState.docCropPinchBaseDist || dist;
        const baseZoom = autosState.docCropPinchBaseZoom || crop.zoom;
        crop.zoom = autos_clamp(baseZoom * (dist / baseDist), 1, 3);
        autos_syncDocCropControls();
        autos_renderDocCrop();
    }
}

function autos_docCropPointerUp(e) {
    autosState.docCropPointers.delete(e.pointerId);
    if (autosState.docCropPointers.size === 1) {
        autosState.docCropDragLast = [...autosState.docCropPointers.values()][0];
    } else {
        autosState.docCropDragLast = null;
    }
    if (autosState.docCropPointers.size < 2) autosState.docCropPinchBaseDist = 0;
}

function autos_renderDocCrop() {
    const crop = autosState.docCrop;
    const canvas = document.getElementById('autos-doc-crop-canvas');
    if (!crop || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    autos_drawDocCropScene(ctx, crop, canvas.width, canvas.height);
}

function autos_docCropOutputSize(mode, frame) {
    const preset = autos_docCropPreset(mode);
    if (preset.ratio) return { width: preset.width, height: preset.height };
    const ratio = Math.max(0.2, frame.w / Math.max(1, frame.h));
    const maxWidth = 1800;
    const width = maxWidth;
    const height = Math.max(400, Math.round(width / ratio));
    return { width, height };
}

async function autos_applyDocCrop() {
    const crop = autosState.docCrop;
    const canvas = document.getElementById('autos-doc-crop-canvas');
    if (!crop || !canvas) return;

    const mode = autosState.docCropMode || 'carta';
    const frame = autos_getDocCropFrame(canvas.width, canvas.height, mode);
    const draw = autos_getLicenseCropDrawBox(crop, canvas.width, canvas.height);
    const img = crop.image;

    const sx = autos_clamp(((frame.x - draw.dx) / draw.drawW) * img.width, 0, img.width);
    const sy = autos_clamp(((frame.y - draw.dy) / draw.drawH) * img.height, 0, img.height);
    const ex = autos_clamp((((frame.x + frame.w) - draw.dx) / draw.drawW) * img.width, 0, img.width);
    const ey = autos_clamp((((frame.y + frame.h) - draw.dy) / draw.drawH) * img.height, 0, img.height);
    const sw = Math.max(4, ex - sx);
    const sh = Math.max(4, ey - sy);

    const outSize = autos_docCropOutputSize(mode, frame);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize.width;
    outCanvas.height = outSize.height;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
        showToast('⚠️ No se pudo crear recorte');
        return;
    }

    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);

    const blob = await new Promise(resolve => outCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
        showToast('⚠️ No se pudo crear recorte');
        return;
    }

    const safeName = (crop.originalFile?.name || `doc-${Date.now()}`).replace(/\.[^.]+$/, '');
    const file = new File([blob], `${safeName}-crop.jpg`, { type: 'image/jpeg' });
    autos_finishDocCrop(file);
}

async function autos_handleLicenseFile(e) {
    const input = e?.target;
    if (!input || !input.files || !input.files.length) return;
    const file = input.files[0];
    try {
        if (autos_fileLooksLikeImage(file)) {
            await autos_openLicenseCropper(file);
        } else {
            await autos_uploadLicenseFile(file);
        }
    } catch (err) {
        console.warn('No se pudo guardar licencia:', err);
        showToast('⚠️ No se pudo guardar licencia');
    } finally {
        input.value = '';
    }
}

async function autos_cargarVista() {
    const listEl = document.getElementById('autos-car-list');
    if (listEl) listEl.innerHTML = '<div class="loading-spinner">⏳ Cargando autos...</div>';
    try {
        await autos_ensureSheets();
        await autos_loadData();
        await autos_applyCsvConsistencyPatch();
        autos_render();
        autos_refreshAllDailyValuations();
    } catch (e) {
        handleApiError(e, listEl);
    }
}

async function autos_ensureSheets() {
    await autos_ensureSheet('Autos', AUTOS_HEADERS);
    await autos_ensureSheet('Reparaciones', REPAIRS_HEADERS);
    await autos_ensureSheet('AutosMeta', AUTOS_META_HEADERS);
}

async function autos_ensureSheet(sheetName, headers) {
    try {
        await sheetsGet(SPREADSHEET_AUTOS_ID, `${sheetName}!A1:A1`);
    } catch (_) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_AUTOS_ID}:batchUpdate`;
        await authFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
        });
    }
    const head = await sheetsGet(SPREADSHEET_AUTOS_ID, `${sheetName}!A1:AZ1`).catch(() => []);
    const currentHeaders = (head[0] || []).map(x => (x || '').toString().trim());
    if (!head.length || !head[0]?.[0]) {
        const letter = autos_colLetter(headers.length);
        await sheetsUpdate(SPREADSHEET_AUTOS_ID, `${sheetName}!A1:${letter}1`, [headers]);
        return;
    }

    if (sheetName === 'Autos') {
        const merged = [...currentHeaders.filter(Boolean)];
        let changed = false;
        headers.forEach(h => {
            if (!merged.includes(h)) {
                merged.push(h);
                changed = true;
            }
        });
        if (changed) {
            const letter = autos_colLetter(merged.length);
            await sheetsUpdate(SPREADSHEET_AUTOS_ID, `${sheetName}!A1:${letter}1`, [merged]);
        }
        return;
    }

    const letter = autos_colLetter(headers.length);
    const needsHeaderUpdate = headers.some((h, i) => (currentHeaders[i] || '') !== h);
    if (needsHeaderUpdate) {
        await sheetsUpdate(SPREADSHEET_AUTOS_ID, `${sheetName}!A1:${letter}1`, [headers]);
    }
}

function autos_colLetter(n) {
    let s = '';
    let x = n;
    while (x > 0) {
        const m = (x - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        x = Math.floor((x - 1) / 26);
    }
    return s || 'A';
}

function autos_headersToMap(headers) {
    const map = {};
    (headers || []).forEach((h, i) => {
        const key = (h || '').toString().trim();
        if (!key) return;
        if (map[key] === undefined) map[key] = i;
    });
    return map;
}

function autos_getCell(row, map, key, fallback = '') {
    const idx = map[key];
    if (idx === undefined) return fallback;
    return row[idx] ?? fallback;
}

function autos_carToRowByHeaders(car, headers) {
    const fields = {
        id: car.id || '',
        marca: car.marca || '',
        modelo: car.modelo || '',
        anio: car.anio || '',
        valorFactura: car.valorFactura || '',
        kilometraje: car.kilometraje || '',
        propietario: car.propietario || '',
        tieneSeguro: car.tieneSeguro ? 'TRUE' : 'FALSE',
        placa: car.placa || '',
        vin: car.vin || '',
        fotoAuto: car.fotoAuto || '',
        contratoPrestamo: car.contratoPrestamo || '',
        polizaSeguro: car.polizaSeguro || '',
        vencimientoPoliza: car.vencimientoPoliza || '',
        proximaRevisionKm: car.proximaRevisionKm || '',
        emergenciaInterior: car.emergenciaInterior || '',
        emergenciaMetro: car.emergenciaMetro || '',
        reporteSiniestros1: car.reporteSiniestros1 || '',
        reporteSiniestros2: car.reporteSiniestros2 || '',
        tarjetaCirculacionFrente: car.tarjetaCirculacionFrente || '',
        tarjetaCirculacionAtras: car.tarjetaCirculacionAtras || '',
        pagoTenencia: car.pagoTenencia || '',
        vencimientoTenencia: car.vencimientoTenencia || '',
        tablaPagos: car.tablaPagos || '',
        tablaPagosSeguro: car.tablaPagosSeguro || '',
        tipoLlantas: car.tipoLlantas || '',
        llantasFoto: car.llantasFoto || '',
        certificadoPolarizado: car.certificadoPolarizado || '',
        facturaArchivo: car.facturaArchivo || '',
        polizaArchivo: car.polizaArchivo || '',
        extraDoc1Nombre: car.extraDoc1Nombre || '',
        extraDoc1Url: car.extraDoc1Url || '',
        extraDoc2Nombre: car.extraDoc2Nombre || '',
        extraDoc2Url: car.extraDoc2Url || '',
    };
    return (headers || AUTOS_HEADERS).map(h => fields[h] ?? '');
}

function autos_normalizeText(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function autos_matchRepairBySignature(repair, target) {
    const sameDate = (repair.fecha || '') === (target.fecha || '');
    const nameA = autos_normalizeText(repair.reparacion);
    const nameB = autos_normalizeText(target.reparacion);
    const nameMatch = nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA);
    return sameDate && nameMatch;
}

async function autos_applyCsvConsistencyPatch() {
    if (autosState.meta[AUTOS_CSV_PATCH_META_KEY] === AUTOS_CSV_PATCH_VERSION) return false;

    let changedCars = false;
    let changedRepairs = false;

    let koleos = autosState.cars.find(c => /koleos/i.test(`${c.marca} ${c.modelo}`))
        || autosState.cars.find(c => (c.placa || '').toString().trim().toUpperCase() === 'Z33-AFR');
    if (!koleos) {
        koleos = {
            id: `car-koleos-${Date.now()}`,
            ...AUTOS_KOLEOS_DEFAULT,
        };
        autosState.cars.push(koleos);
        changedCars = true;
    } else {
        if (!koleos.fotoAuto) { koleos.fotoAuto = AUTOS_KOLEOS_DEFAULT.fotoAuto; changedCars = true; }
        if (!koleos.placa) { koleos.placa = AUTOS_KOLEOS_DEFAULT.placa; changedCars = true; }
        if (!koleos.vin) { koleos.vin = AUTOS_KOLEOS_DEFAULT.vin; changedCars = true; }
    }

    const taos = autosState.cars.find(c => /taos/i.test(`${c.marca} ${c.modelo}`));

    const upsertRepairs = (carId, rows) => {
        if (!carId) return;
        rows.forEach(row => {
            const found = autosState.repairs.find(r => r.carId === carId && autos_matchRepairBySignature(r, row));
            if (!found) {
                autosState.repairs.push({
                    id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    carId,
                    reparacion: row.reparacion,
                    costo: row.costo,
                    moneda: row.moneda || 'MXN',
                    lugar: row.lugar || '',
                    fecha: row.fecha,
                    foto: row.foto || '',
                    recibo: row.recibo || '',
                    descripcion: row.descripcion || '',
                    logMarker: '',
                });
                changedRepairs = true;
                return;
            }
            let changed = false;
            if ((!found.lugar || !found.lugar.trim()) && row.lugar) { found.lugar = row.lugar; changed = true; }
            if ((!found.foto || !found.foto.trim()) && row.foto) { found.foto = row.foto; changed = true; }
            if ((!found.recibo || !found.recibo.trim()) && row.recibo) { found.recibo = row.recibo; changed = true; }
            if ((!found.descripcion || !found.descripcion.trim()) && row.descripcion) { found.descripcion = row.descripcion; changed = true; }
            if ((!Number(found.costo) || Number(found.costo) === 0) && Number(row.costo) > 0) { found.costo = row.costo; changed = true; }
            if ((!found.moneda || !found.moneda.trim()) && row.moneda) { found.moneda = row.moneda; changed = true; }
            if (changed) changedRepairs = true;
        });
    };

    upsertRepairs(koleos?.id || '', AUTOS_CSV_REPAIRS.koleos);
    upsertRepairs(taos?.id || '', AUTOS_CSV_REPAIRS.taos);

    if (changedCars) await autos_saveCarsSheet();
    if (changedRepairs) await autos_saveRepairsSheet();

    autosState.meta[AUTOS_CSV_PATCH_META_KEY] = AUTOS_CSV_PATCH_VERSION;
    await autos_saveMeta();
    return changedCars || changedRepairs;
}

async function autos_loadData() {
    const headerRow = await sheetsGet(SPREADSHEET_AUTOS_ID, 'Autos!A1:AZ1').catch(() => []);
    const autosHeaders = (headerRow[0] || []).map(x => (x || '').toString().trim()).filter(Boolean);
    const effectiveHeaders = autosHeaders.length ? autosHeaders : [...AUTOS_HEADERS];
    autosState.autosHeaders = effectiveHeaders;
    const carsLetter = autos_colLetter(effectiveHeaders.length);

    const [carsRows, repairsRows, metaRows] = await Promise.all([
        sheetsGet(SPREADSHEET_AUTOS_ID, `Autos!A2:${carsLetter}`).catch(() => []),
        sheetsGet(SPREADSHEET_AUTOS_ID, 'Reparaciones!A2:K').catch(() => []),
        sheetsGet(SPREADSHEET_AUTOS_ID, 'AutosMeta!A2:B').catch(() => []),
    ]);

    if (!carsRows.length) {
        await autos_seedInitialData();
        return autos_loadData();
    }

    const map = autos_headersToMap(effectiveHeaders);
    autosState.cars = carsRows.map(r => ({
        rowNum: null,
        id: (autos_getCell(r, map, 'id', '') || '').toString(),
        marca: autos_getCell(r, map, 'marca', ''),
        modelo: autos_getCell(r, map, 'modelo', ''),
        anio: autos_getCell(r, map, 'anio', ''),
        valorFactura: autos_getCell(r, map, 'valorFactura', ''),
        kilometraje: autos_getCell(r, map, 'kilometraje', ''),
        propietario: autos_getCell(r, map, 'propietario', ''),
        tieneSeguro: parseBool(autos_getCell(r, map, 'tieneSeguro', false)),
        placa: autos_getCell(r, map, 'placa', ''),
        vin: autos_getCell(r, map, 'vin', ''),
        fotoAuto: autos_getCell(r, map, 'fotoAuto', ''),
        contratoPrestamo: autos_getCell(r, map, 'contratoPrestamo', ''),
        polizaSeguro: autos_getCell(r, map, 'polizaSeguro', ''),
        vencimientoPoliza: autos_getCell(r, map, 'vencimientoPoliza', ''),
        proximaRevisionKm: autos_getCell(r, map, 'proximaRevisionKm', ''),
        emergenciaInterior: autos_getCell(r, map, 'emergenciaInterior', ''),
        emergenciaMetro: autos_getCell(r, map, 'emergenciaMetro', ''),
        reporteSiniestros1: autos_getCell(r, map, 'reporteSiniestros1', ''),
        reporteSiniestros2: autos_getCell(r, map, 'reporteSiniestros2', ''),
        tarjetaCirculacionFrente: autos_getCell(r, map, 'tarjetaCirculacionFrente', ''),
        tarjetaCirculacionAtras: autos_getCell(r, map, 'tarjetaCirculacionAtras', ''),
        pagoTenencia: autos_getCell(r, map, 'pagoTenencia', ''),
        vencimientoTenencia: autos_getCell(r, map, 'vencimientoTenencia', ''),
        tablaPagos: autos_getCell(r, map, 'tablaPagos', ''),
        tablaPagosSeguro: autos_getCell(r, map, 'tablaPagosSeguro', ''),
        tipoLlantas: autos_getCell(r, map, 'tipoLlantas', ''),
        llantasFoto: autos_getCell(r, map, 'llantasFoto', ''),
        certificadoPolarizado: autos_getCell(r, map, 'certificadoPolarizado', ''),
        facturaArchivo: autos_getCell(r, map, 'facturaArchivo', ''),
        polizaArchivo: autos_getCell(r, map, 'polizaArchivo', ''),
        extraDoc1Nombre: autos_getCell(r, map, 'extraDoc1Nombre', ''),
        extraDoc1Url: autos_getCell(r, map, 'extraDoc1Url', ''),
        extraDoc2Nombre: autos_getCell(r, map, 'extraDoc2Nombre', ''),
        extraDoc2Url: autos_getCell(r, map, 'extraDoc2Url', ''),
    })).filter(c => c.id && !/buik/i.test(`${c.marca} ${c.modelo}`));

    autosState.repairs = repairsRows.map(r => ({
        rowNum: null,
        id: (r[0] || '').toString(),
        carId: (r[1] || '').toString(),
        reparacion: r[2] || '',
        costo: parseSheetValue(r[3]),
        moneda: parseCurrencyCode(r[4]),
        lugar: r[5] || '',
        fecha: normalizeDateString(r[6] || new Date().toLocaleDateString('en-CA')),
        foto: r[7] || '',
        recibo: r[8] || '',
        descripcion: r[9] || '',
        logMarker: r[10] || '',
    })).filter(x => x.id && x.carId);

    autosState.meta = {};
    metaRows.forEach(r => {
        const key = (r[0] || '').toString().trim();
        if (!key) return;
        autosState.meta[key] = (r[1] || '').toString();
    });

    if (!autosState.selectedCarId || !autosState.cars.find(c => c.id === autosState.selectedCarId)) {
        autosState.selectedCarId = autosState.cars[0]?.id || '';
    }
    autosState.loaded = true;
}

async function autos_seedInitialData() {
    const cars = AUTOS_SEED;
    const koleos = cars.find(c => /koleos/i.test(c.modelo));
    const taos = cars.find(c => /taos/i.test(c.modelo));
    const repairs = [
        { id: `rep-${Date.now()}-1`, carId: koleos?.id || '', reparacion: 'Mantenimiento General', costo: 11077, moneda: 'MXN', lugar: 'Clinica Automotriz', fecha: '2023-06-01', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/5dwETdURu7am5EzkjTmG.jpg', recibo: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/PZav1SE91pYI3iwt8kbA.jpg', descripcion: 'Varios', logMarker: '' },
        { id: `rep-${Date.now()}-2`, carId: koleos?.id || '', reparacion: 'Compra de llanta delantera derecha', costo: 2600, moneda: 'MXN', lugar: 'Llamtimax San Miguel', fecha: '2024-11-08', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/pZngCtrPH3Uo6BfQasJN.jpg', recibo: '', descripcion: '', logMarker: '' },
        { id: `rep-${Date.now()}-3`, carId: koleos?.id || '', reparacion: 'Cambio aceite y filtro', costo: 1200, moneda: 'MXN', lugar: 'Llantimax San Miguel', fecha: '2024-11-08', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/5F7jCRQQEgFrXEpkZ59N.jpg', recibo: '', descripcion: '', logMarker: '' },
        { id: `rep-${Date.now()}-4`, carId: koleos?.id || '', reparacion: 'Cotizacion para cambiar bujes', costo: 0, moneda: 'MXN', lugar: 'Llantimax', fecha: '2024-11-13', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/nxr0ypGXKlrG1GB6YTKn.jpeg', recibo: '', descripcion: 'Esta es una cotizacion y esta pendiente de hacerse.', logMarker: '' },
        { id: `rep-${Date.now()}-5`, carId: koleos?.id || '', reparacion: 'Foco y grapas', costo: 350, moneda: 'MXN', lugar: 'Llantimax', fecha: '2024-11-13', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/sUxGylvznY3dQvCOTZUQ.jpg', recibo: '', descripcion: '', logMarker: '' },
        { id: `rep-${Date.now()}-6`, carId: taos?.id || '', reparacion: 'Servicio de los 15000 kilometros', costo: 3075.01, moneda: 'MXN', lugar: 'Agencia VW Valle Victoria', fecha: '2026-01-24', foto: 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/soFtdoc1n0sFXUFKuyTq.jpg', recibo: '', descripcion: '', logMarker: '' },
    ].filter(r => r.carId);

    const headers = autosState.autosHeaders?.length ? autosState.autosHeaders : AUTOS_HEADERS;
    const letter = autos_colLetter(headers.length);
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `Autos!A2:${letter}${1 + cars.length}`, cars.map(c => autos_carToRowByHeaders(c, headers)));
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `Reparaciones!A2:K${1 + repairs.length}`, repairs.map(r => [
        r.id, r.carId, r.reparacion, r.costo, r.moneda, r.lugar, r.fecha, r.foto, r.recibo, r.descripcion, r.logMarker,
    ]));
}

function autos_render() {
    const total = autosState.repairs.reduce((s, r) => s + convertTransactionAmountToMxn(r.costo, r.moneda), 0);
    const totalEl = document.getElementById('autos-total-spent');
    if (totalEl) totalEl.innerText = formatCurrency(total);

    const listEl = document.getElementById('autos-car-list');
    const searchEl = document.getElementById('autos-repair-search');
    const dateFromEl = document.getElementById('autos-repair-date-from');
    const dateToEl = document.getElementById('autos-repair-date-to');
    if (searchEl && searchEl.value !== autosState.repairSearch) searchEl.value = autosState.repairSearch;
    if (dateFromEl && dateFromEl.value !== autosState.repairDateFrom) dateFromEl.value = autosState.repairDateFrom;
    if (dateToEl && dateToEl.value !== autosState.repairDateTo) dateToEl.value = autosState.repairDateTo;
    if (listEl) {
        listEl.innerHTML = autosState.cars.map(car => {
            const spent = autos_getCarSpent(car.id);
            const active = autosState.selectedCarId === car.id ? ' account-card--active' : '';
            const insured = car.tieneSeguro ? 'Con seguro' : 'Sin seguro';
            return `<div class="account-card glass-subtle${active}" onclick="autos_selectCar('${car.id}')">
                <div class="account-card-left">
                    <span class="account-icon" style="background:rgba(34,197,94,.12);color:#22c55e">🚗</span>
                    <div class="account-info">
                        <span class="account-name">${car.marca} ${car.modelo} (${car.anio || '-'})</span>
                        <span class="account-type-label">${car.placa || 'Sin placa'} · ${insured}</span>
                    </div>
                </div>
                <div class="account-card-right">
                    <span class="account-balance text-danger">-${formatCurrency(spent)}</span>
                </div>
            </div>`;
        }).join('') || '<div class="empty-state">Sin autos registrados</div>';
    }

    autos_renderSelectedCar();
}

window.autos_selectCar = function(carId) {
    autosState.selectedCarId = carId;
    autosState.repairVisibleCount = 10;
    autos_render();
};

function autos_renderSelectedCar() {
    const car = autosState.cars.find(c => c.id === autosState.selectedCarId);
    const profileEl = document.getElementById('autos-car-profile');
    const repairsEl = document.getElementById('autos-repair-list');
    const selectedEl = document.getElementById('autos-selected-title');
    if (!profileEl || !repairsEl || !selectedEl) return;
    if (!car) {
        selectedEl.innerText = 'Selecciona un auto';
        profileEl.innerHTML = '<div class="empty-state">No hay datos de auto</div>';
        repairsEl.innerHTML = '<div class="empty-state">Sin reparaciones</div>';
        return;
    }
    selectedEl.innerText = `${car.marca} ${car.modelo}`;

    const extra1Name = (car.extraDoc1Nombre || '').toString().trim() || 'Documento extra 1';
    const extra2Name = (car.extraDoc2Nombre || '').toString().trim() || 'Documento extra 2';
    const links = [
        ['Factura original', car.facturaArchivo],
        ['Poliza original', car.polizaArchivo],
        [extra1Name, car.extraDoc1Url],
        [extra2Name, car.extraDoc2Url],
        ['Tarjeta Frontal', car.tarjetaCirculacionFrente],
        ['Tarjeta Trasera', car.tarjetaCirculacionAtras],
        ['Tabla Pagos', car.tablaPagos],
        ['Tabla Seguro', car.tablaPagosSeguro],
        ['Foto Llantas', car.llantasFoto],
        ['Certificado Polarizado', car.certificadoPolarizado],
    ].filter(([, url]) => !!url);

    const emergenciaInteriorHtml = autos_phoneLinkOrText(car.emergenciaInterior, 'Interior');
    const emergenciaMetroHtml = autos_phoneLinkOrText(car.emergenciaMetro, 'Metro');
    const siniestros1Html = autos_phoneLinkOrText(car.reporteSiniestros1, 'Siniestros 1');
    const siniestros2Html = autos_phoneLinkOrText(car.reporteSiniestros2, 'Siniestros 2');
    const valuationLabel = autos_getValuationLabel(car.id);
    const valuationInfo = autos_getValuationInfo(car.id);
    const meliStatus = autos_getMeliConnectionLabel();
    const meliConnected = meli_isAccessTokenValid() || !!meliAuthState.refreshToken;
    const mileageNumber = autos_parseMileage(car.kilometraje);
    const invoiceValue = parseSheetValue(car.valorFactura);
    const nextRevisionKm = autos_parseMileage(car.proximaRevisionKm);
    const mileageLabel = mileageNumber ? `${mileageNumber.toLocaleString('es-MX')} km` : 'Sin kilometraje';
    const nextRevisionLabel = nextRevisionKm ? `${nextRevisionKm.toLocaleString('es-MX')} km` : 'Sin definir';
    const invoiceLabel = invoiceValue > 0 ? formatCurrency(invoiceValue) : 'Sin factura';
    const kmAdjLabel = valuationInfo.status === 'ok' && valuationInfo.kmAdjustmentPct
        ? ` · ajuste KM ${valuationInfo.kmAdjustmentPct > 0 ? '+' : ''}${valuationInfo.kmAdjustmentPct}%`
        : '';
    const photoRaw = (car.fotoAuto || '').toString().trim();
    const photoCandidates = autos_imagePreviewCandidates(photoRaw);
    const photoSrc = photoCandidates[0] || AUTOS_IMAGE_PLACEHOLDER;
    autos_patchImageDebug(car.id, {
        renderProfileSrc: photoSrc,
        rawUrl: photoRaw || '-',
        candidatesCount: photoCandidates.length,
    });

    const seguroParts = [car.tieneSeguro ? 'Si' : 'No'];
    if (car.polizaSeguro) seguroParts.push(`Poliza ${car.polizaSeguro}`);
    if (car.vencimientoPoliza) seguroParts.push(`Vence ${car.vencimientoPoliza}`);
    const infoLines = [];
    if (car.placa || car.vin) infoLines.push(`<span class="account-type-label">${car.placa ? `Placa: ${car.placa}` : ''}${car.placa && car.vin ? ' · ' : ''}${car.vin ? `VIN: ${car.vin}` : ''}</span>`);
    if (mileageNumber) infoLines.push(`<span class="account-type-label">Kilometraje: ${mileageLabel}</span>`);
    if (nextRevisionKm) infoLines.push(`<span class="account-type-label">Próxima revisión: ${nextRevisionLabel}</span>`);
    if (invoiceValue > 0) infoLines.push(`<span class="account-type-label">Factura: ${invoiceLabel}</span>`);
    if (car.propietario) infoLines.push(`<span class="account-type-label">Propietario: ${car.propietario}</span>`);
    infoLines.push(`<span class="account-type-label">Seguro: ${seguroParts.join(' · ')}${car.tipoLlantas ? ` · Llantas: ${car.tipoLlantas}` : ''}</span>`);
    const docsParts = [];
    if (car.facturaArchivo) docsParts.push('Factura ✅');
    if (car.polizaArchivo) docsParts.push('Poliza ✅');
    if (car.extraDoc1Url) docsParts.push(`${extra1Name} ✅`);
    if (car.extraDoc2Url) docsParts.push(`${extra2Name} ✅`);
    if (docsParts.length) infoLines.push(`<span class="account-type-label">Archivos: ${docsParts.join(' · ')}</span>`);
    infoLines.push(`<span class="account-type-label">Valor hoy: ${valuationLabel}${kmAdjLabel}</span>`);
    infoLines.push(`<span class="account-type-label" style="color:${meliConnected ? '#34d399' : '#fbbf24'};">${meliStatus}</span>`);
    const hasEmergency = !!((car.emergenciaInterior || '').trim() || (car.emergenciaMetro || '').trim());
    if (hasEmergency) infoLines.push(`<span class="account-type-label">Emergencia: ${emergenciaInteriorHtml} · ${emergenciaMetroHtml}</span>`);
    const hasClaims = !!((car.reporteSiniestros1 || '').trim() || (car.reporteSiniestros2 || '').trim());
    if (hasClaims) infoLines.push(`<span class="account-type-label">Siniestros: ${siniestros1Html} · ${siniestros2Html}</span>`);

    profileEl.innerHTML = `<div class="glass-subtle autos-profile-card autos-profile-clickable" onclick="autos_openCarDetail()" style="padding:.8rem;display:grid;grid-template-columns:96px minmax(0,1fr);gap:.7rem;align-items:start;">
        <img src="${photoSrc}" data-raw="${photoRaw}" data-try-idx="0" alt="Auto" style="width:96px;height:72px;object-fit:cover;border-radius:.75rem;background:rgba(255,255,255,.06);" onload="autos_handleCarImageLoad(this,'${car.id}','card')" onerror="autos_handleCarImageError(this,'${car.id}','card')" />
        <div class="autos-profile-main" style="display:grid;gap:.2rem;min-width:0;">
            <span class="account-name">${car.marca} ${car.modelo} · ${car.anio || '-'}</span>
            ${infoLines.join('')}
            <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.3rem;">
                <button class="mini-btn" onclick="event.stopPropagation(); autos_openCarSheet('${car.id}')">✏️ Editar auto</button>
                <button class="mini-btn" onclick="event.stopPropagation(); autos_updateMileageAndRevalue('${car.id}')">🛣️ Actualizar KM + valuacion</button>
                ${car.facturaArchivo ? `<a class="mini-btn" href="${car.facturaArchivo}" target="_blank" rel="noopener" onclick="event.stopPropagation();">📄 Ver factura original</a>` : ''}
                ${car.polizaArchivo ? `<a class="mini-btn" href="${car.polizaArchivo}" target="_blank" rel="noopener" onclick="event.stopPropagation();">🛡️ Ver poliza original</a>` : ''}
                ${car.extraDoc1Url ? `<a class="mini-btn" href="${car.extraDoc1Url}" target="_blank" rel="noopener" onclick="event.stopPropagation();">📎 ${extra1Name}</a>` : ''}
                ${car.extraDoc2Url ? `<a class="mini-btn" href="${car.extraDoc2Url}" target="_blank" rel="noopener" onclick="event.stopPropagation();">📎 ${extra2Name}</a>` : ''}
                ${meliConnected ? '' : '<button class="mini-btn" onclick="event.stopPropagation(); autos_connectMercadoLibre()">🔐 Conectar ML</button>'}
                <button class="mini-btn" onclick="event.stopPropagation(); autos_openMeliDebug()">🐞 Debug ML</button>
            </div>
        </div>
    </div>
    <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.5rem;">${links.map(([label, url]) => `<a class="mini-btn" href="${url}" target="_blank" rel="noopener">${label}</a>`).join('')}</div>`;

    const allRepairs = autosState.repairs.filter(r => r.carId === car.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const dateFromEl = document.getElementById('autos-repair-date-from');
    const dateToEl = document.getElementById('autos-repair-date-to');
    const dateValues = allRepairs.map(r => (r.fecha || '').slice(0, 10)).filter(Boolean).sort();
    const minDate = dateValues[0] || '';
    const maxDate = dateValues[dateValues.length - 1] || '';
    if (dateFromEl) {
        if (minDate) dateFromEl.min = minDate;
        if (maxDate) dateFromEl.max = maxDate;
        dateFromEl.value = autosState.repairDateFrom;
    }
    if (dateToEl) {
        if (minDate) dateToEl.min = minDate;
        if (maxDate) dateToEl.max = maxDate;
        dateToEl.value = autosState.repairDateTo;
    }

    const q = autosState.repairSearch;
    const from = autosState.repairDateFrom;
    const to = autosState.repairDateTo;
    const filteredRepairs = !q
        ? allRepairs.filter(r => {
            const d = (r.fecha || '').slice(0, 10);
            if (!d) return false;
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        })
        : allRepairs.filter(r => {
            const dateA = (r.fecha || '').toLowerCase();
            const dateB = formatFecha(r.fecha).toLowerCase();
            const text = `${r.reparacion} ${r.lugar} ${r.descripcion}`.toLowerCase();
            const textMatch = dateA.includes(q) || dateB.includes(q) || text.includes(q);
            const d = (r.fecha || '').slice(0, 10);
            const dateMatch = (!from || d >= from) && (!to || d <= to);
            return textMatch && dateMatch;
        });
    const visibleRepairs = filteredRepairs.slice(0, autosState.repairVisibleCount);
    repairsEl.innerHTML = visibleRepairs.map(r => {
        const amount = convertTransactionAmountToMxn(r.costo, r.moneda);
        return `<div class="movimiento-card">
            <div class="mc-left">
                <span class="mc-fecha">${formatFecha(r.fecha)}</span>
                <span class="mc-lugar">${r.reparacion}</span>
                <span class="mc-concepto">${r.lugar || 'Sin taller'}${r.descripcion ? ` · ${r.descripcion}` : ''}</span>
                <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.25rem;">
                    ${autos_parseUrlList(r.foto).map((u, i) => `<a class="mini-btn" href="${u}" target="_blank" rel="noopener">Foto ${i + 1}</a>`).join('')}
                    ${autos_parseUrlList(r.recibo).map((u, i) => `<a class="mini-btn" href="${u}" target="_blank" rel="noopener">Recibo ${i + 1}</a>`).join('')}
                </div>
            </div>
            <div class="mc-right" style="align-items:flex-end;gap:.4rem;">
                <span class="mc-monto text-danger">-${formatCurrency(amount)}</span>
                <div style="display:flex;gap:.3rem;">
                    <button class="mini-btn" onclick="autos_openRepairSheet('${r.id}')">✏️</button>
                    <button class="mini-btn mini-btn-danger" onclick="autos_deleteRepair('${r.id}')">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('') || '<div class="empty-state">Sin reparaciones registradas</div>';

    const loadMoreBtn = document.getElementById('autos-repair-load-more');
    if (loadMoreBtn) {
        const hasMore = filteredRepairs.length > visibleRepairs.length;
        loadMoreBtn.classList.toggle('hidden', !hasMore);
        if (hasMore) {
            const remaining = filteredRepairs.length - visibleRepairs.length;
            loadMoreBtn.innerText = `Cargar más (${remaining})`;
        }
    }

    const selectedSpent = autos_getCarSpent(car.id);
    const selectedSpentEl = document.getElementById('autos-selected-spent');
    if (selectedSpentEl) selectedSpentEl.innerText = formatCurrency(selectedSpent);

    autos_refreshCarValuationIfNeeded(car, { interactiveAuth: false }).catch(() => {});
}

function autos_getCarSpent(carId) {
    return autosState.repairs
        .filter(r => r.carId === carId)
        .reduce((s, r) => s + convertTransactionAmountToMxn(r.costo, r.moneda), 0);
}

window.autos_updateMileageAndRevalue = async function(carId) {
    const car = autosState.cars.find(c => c.id === carId);
    if (!car) return;
    const current = autos_parseMileage(car.kilometraje);
    const raw = prompt(`Kilometraje actual para ${car.marca} ${car.modelo}:`, current ? String(current) : '');
    if (raw === null) return;
    const parsed = autos_parseMileage(raw);
    if (!parsed) {
        showToast('⚠️ Captura un kilometraje valido');
        return;
    }
    car.kilometraje = String(parsed);
    try {
        await autos_saveCarsSheet();
        autos_renderSelectedCar();
        await autos_refreshCarValuationIfNeeded(car, { force: true, interactiveAuth: true });
        autos_render();
        showToast('✅ KM y valuacion actualizados');
    } catch (err) {
        console.warn('No se pudo actualizar KM/valuacion:', err);
        showToast('⚠️ No se pudo actualizar valuacion');
    }
};

function autos_openCarSheet(carId) {
    const car = autosState.cars.find(c => c.id === carId) || null;
    const deleteBtn = document.getElementById('autos-car-delete');
    document.getElementById('autos-car-edit-id').value = car?.id || '';
    document.getElementById('autos-car-title').innerText = car ? 'Editar Auto' : 'Nuevo Auto';
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !car);
    document.getElementById('autos-car-marca').value = car?.marca || '';
    document.getElementById('autos-car-modelo').value = car?.modelo || '';
    document.getElementById('autos-car-anio').value = car?.anio || '';
    document.getElementById('autos-car-factura').value = car?.valorFactura || '';
    document.getElementById('autos-car-kilometraje').value = car?.kilometraje || '';
    document.getElementById('autos-car-propietario').value = car?.propietario || '';
    document.getElementById('autos-car-seguro').value = car?.tieneSeguro ? '1' : '0';
    document.getElementById('autos-car-placa').value = car?.placa || '';
    document.getElementById('autos-car-vin').value = car?.vin || '';
    document.getElementById('autos-car-foto').value = car?.fotoAuto || '';
    document.getElementById('autos-car-factura-archivo').value = car?.facturaArchivo || '';
    document.getElementById('autos-car-poliza').value = car?.polizaSeguro || '';
    document.getElementById('autos-car-vencimiento-poliza').value = car?.vencimientoPoliza || '';
    document.getElementById('autos-car-proxima-revision-km').value = car?.proximaRevisionKm || '';
    document.getElementById('autos-car-poliza-archivo').value = car?.polizaArchivo || '';
    document.getElementById('autos-car-extra1-name').value = car?.extraDoc1Nombre || '';
    document.getElementById('autos-car-extra1-url').value = car?.extraDoc1Url || '';
    document.getElementById('autos-car-extra2-name').value = car?.extraDoc2Nombre || '';
    document.getElementById('autos-car-extra2-url').value = car?.extraDoc2Url || '';
    document.getElementById('autos-car-emergencia').value = car?.emergenciaInterior || '';
    document.getElementById('autos-car-llantas').value = car?.tipoLlantas || '';
    document.getElementById('autos-car-tarjeta-frente').value = car?.tarjetaCirculacionFrente || '';
    document.getElementById('autos-car-tarjeta-atras').value = car?.tarjetaCirculacionAtras || '';
    const carFile = document.getElementById('autos-car-foto-file');
    const facturaFile = document.getElementById('autos-car-factura-file');
    const polizaFile = document.getElementById('autos-car-poliza-file');
    const extra1File = document.getElementById('autos-car-extra1-file');
    const extra2File = document.getElementById('autos-car-extra2-file');
    const tarjetaFrenteFile = document.getElementById('autos-car-tarjeta-frente-file');
    const tarjetaAtrasFile = document.getElementById('autos-car-tarjeta-atras-file');
    if (carFile) carFile.value = '';
    if (facturaFile) facturaFile.value = '';
    if (polizaFile) polizaFile.value = '';
    if (extra1File) extra1File.value = '';
    if (extra2File) extra2File.value = '';
    if (tarjetaFrenteFile) tarjetaFrenteFile.value = '';
    if (tarjetaAtrasFile) tarjetaAtrasFile.value = '';
    autos_updateFileFeedback('autos-car-foto-feedback', null);
    autos_updateFileFeedback('autos-car-factura-feedback', null);
    autos_updateFileFeedback('autos-car-poliza-feedback', null);
    autos_updateFileFeedback('autos-car-extra1-feedback', null);
    autos_updateFileFeedback('autos-car-extra2-feedback', null);
    autos_updateFileFeedback('autos-car-tarjeta-frente-feedback', null);
    autos_updateFileFeedback('autos-car-tarjeta-atras-feedback', null);
    document.getElementById('autos-car-sheet').classList.remove('hidden');
}

function autos_closeCarSheet() {
    document.getElementById('autos-car-sheet').classList.add('hidden');
}

async function autos_saveCar() {
    const id = document.getElementById('autos-car-edit-id').value || `car-${Date.now()}`;
    const marca = document.getElementById('autos-car-marca').value.trim();
    const modelo = document.getElementById('autos-car-modelo').value.trim();
    if (!marca || !modelo || /buik/i.test(`${marca} ${modelo}`)) {
        showToast('⚠️ Captura marca/modelo valido (Buik excluido)');
        return;
    }
    const prevCar = autosState.cars.find(c => c.id === id) || null;
    const car = {
        ...(prevCar || {}),
        id,
        marca,
        modelo,
        anio: document.getElementById('autos-car-anio').value.trim(),
        valorFactura: document.getElementById('autos-car-factura').value.trim(),
        kilometraje: document.getElementById('autos-car-kilometraje').value.trim(),
        propietario: document.getElementById('autos-car-propietario').value.trim(),
        tieneSeguro: document.getElementById('autos-car-seguro').value === '1',
        placa: document.getElementById('autos-car-placa').value.trim(),
        vin: document.getElementById('autos-car-vin').value.trim(),
        fotoAuto: document.getElementById('autos-car-foto').value.trim(),
        facturaArchivo: document.getElementById('autos-car-factura-archivo').value.trim(),
        polizaSeguro: document.getElementById('autos-car-poliza').value.trim(),
        vencimientoPoliza: document.getElementById('autos-car-vencimiento-poliza').value.trim(),
        proximaRevisionKm: document.getElementById('autos-car-proxima-revision-km').value.trim(),
        polizaArchivo: document.getElementById('autos-car-poliza-archivo').value.trim(),
        extraDoc1Nombre: document.getElementById('autos-car-extra1-name').value.trim(),
        extraDoc1Url: document.getElementById('autos-car-extra1-url').value.trim(),
        extraDoc2Nombre: document.getElementById('autos-car-extra2-name').value.trim(),
        extraDoc2Url: document.getElementById('autos-car-extra2-url').value.trim(),
        emergenciaInterior: document.getElementById('autos-car-emergencia').value.trim(),
        tarjetaCirculacionFrente: document.getElementById('autos-car-tarjeta-frente').value.trim(),
        tarjetaCirculacionAtras: document.getElementById('autos-car-tarjeta-atras').value.trim(),
        tipoLlantas: document.getElementById('autos-car-llantas').value.trim(),
    };
    try {
        const uploadedPhoto = await autos_uploadFirstFile('autos-car-foto-file');
        if (uploadedPhoto) car.fotoAuto = uploadedPhoto;
        const uploadedFactura = await autos_uploadFirstFile('autos-car-factura-file', { enableCrop: true, cropTitle: 'Recortar factura', cropMode: 'carta' });
        if (uploadedFactura) car.facturaArchivo = uploadedFactura;
        const uploadedPoliza = await autos_uploadFirstFile('autos-car-poliza-file', { enableCrop: true, cropTitle: 'Recortar póliza', cropMode: 'oficio' });
        if (uploadedPoliza) car.polizaArchivo = uploadedPoliza;
        const uploadedExtra1 = await autos_uploadFirstFile('autos-car-extra1-file', { enableCrop: true, cropTitle: 'Recortar documento extra 1', cropMode: 'libre' });
        if (uploadedExtra1) car.extraDoc1Url = uploadedExtra1;
        const uploadedExtra2 = await autos_uploadFirstFile('autos-car-extra2-file', { enableCrop: true, cropTitle: 'Recortar documento extra 2', cropMode: 'libre' });
        if (uploadedExtra2) car.extraDoc2Url = uploadedExtra2;
        const uploadedTarjetaFrente = await autos_uploadFirstFile('autos-car-tarjeta-frente-file', { enableCrop: true, cropTitle: 'Recortar tarjeta de circulación (frente)', cropMode: 'credencial' });
        if (uploadedTarjetaFrente) car.tarjetaCirculacionFrente = uploadedTarjetaFrente;
        const uploadedTarjetaAtras = await autos_uploadFirstFile('autos-car-tarjeta-atras-file', { enableCrop: true, cropTitle: 'Recortar tarjeta de circulación (atrás)', cropMode: 'credencial' });
        if (uploadedTarjetaAtras) car.tarjetaCirculacionAtras = uploadedTarjetaAtras;
    } catch (e) {
        console.warn('No se pudo subir foto del auto:', e);
        showToast('⚠️ No se pudo subir archivo del auto, se guarda con URLs actuales');
    }
    const prevKm = autos_parseMileage(prevCar?.kilometraje);
    const nextKm = autos_parseMileage(car.kilometraje);
    const prevFactura = parseSheetValue(prevCar?.valorFactura);
    const nextFactura = parseSheetValue(car.valorFactura);
    const shouldForceValuation = !prevCar
        ? (nextKm > 0 || nextFactura > 0)
        : (prevKm !== nextKm || Math.abs(prevFactura - nextFactura) > 0.5);

    const idx = autosState.cars.findIndex(c => c.id === id);
    if (idx >= 0) autosState.cars[idx] = car;
    else autosState.cars.push(car);
    autosState.selectedCarId = car.id;
    await autos_saveCarsSheet();
    autos_closeCarSheet();
    autos_render();
    await autos_refreshCarValuationIfNeeded(car, { force: shouldForceValuation, interactiveAuth: true });
    autos_render();
    showToast('✅ Auto guardado');
}

async function autos_saveCarsSheet() {
    const headers = autosState.autosHeaders?.length ? autosState.autosHeaders : AUTOS_HEADERS;
    const letter = autos_colLetter(headers.length);
    await sheetsClear(SPREADSHEET_AUTOS_ID, `Autos!A2:${letter}`);
    if (!autosState.cars.length) return;
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `Autos!A2:${letter}${1 + autosState.cars.length}`, autosState.cars.map(c => autos_carToRowByHeaders(c, headers)));
}

function autos_openRepairSheet(repairId) {
    const repair = autosState.repairs.find(r => r.id === repairId) || null;
    const carId = repair?.carId || autosState.selectedCarId || autosState.cars[0]?.id || '';
    document.getElementById('autos-repair-edit-id').value = repair?.id || '';
    document.getElementById('autos-repair-title').innerText = repair ? 'Editar Reparacion' : 'Nueva Reparacion';
    const carSelect = document.getElementById('autos-repair-car');
    carSelect.innerHTML = autosState.cars.map(c => `<option value="${c.id}">${c.marca} ${c.modelo} (${c.placa || 'sin placa'})</option>`).join('');
    carSelect.value = carId;
    document.getElementById('autos-repair-name').value = repair?.reparacion || '';
    document.getElementById('autos-repair-cost').value = repair?.costo || '';
    document.getElementById('autos-repair-currency').value = repair?.moneda || 'MXN';
    document.getElementById('autos-repair-place').value = repair?.lugar || '';
    document.getElementById('autos-repair-date').value = repair?.fecha || new Date().toLocaleDateString('en-CA');
    document.getElementById('autos-repair-photo').value = repair?.foto || '';
    document.getElementById('autos-repair-receipt').value = repair?.recibo || '';
    document.getElementById('autos-repair-desc').value = repair?.descripcion || '';
    const photoFile = document.getElementById('autos-repair-photo-file');
    const receiptFile = document.getElementById('autos-repair-receipt-file');
    if (photoFile) photoFile.value = '';
    if (receiptFile) receiptFile.value = '';
    autos_updateFileFeedback('autos-repair-photo-feedback', null);
    autos_updateFileFeedback('autos-repair-receipt-feedback', null);
    document.getElementById('autos-repair-sheet').classList.remove('hidden');
}

function autos_closeRepairSheet() {
    document.getElementById('autos-repair-sheet').classList.add('hidden');
}

async function autos_saveRepair() {
    const id = document.getElementById('autos-repair-edit-id').value || `rep-${Date.now()}`;
    const repair = {
        id,
        carId: document.getElementById('autos-repair-car').value,
        reparacion: document.getElementById('autos-repair-name').value.trim(),
        costo: parseSheetValue(document.getElementById('autos-repair-cost').value),
        moneda: parseCurrencyCode(document.getElementById('autos-repair-currency').value),
        lugar: document.getElementById('autos-repair-place').value.trim(),
        fecha: normalizeDateString(document.getElementById('autos-repair-date').value || new Date().toLocaleDateString('en-CA')),
        foto: document.getElementById('autos-repair-photo').value.trim(),
        recibo: document.getElementById('autos-repair-receipt').value.trim(),
        descripcion: document.getElementById('autos-repair-desc').value.trim(),
        logMarker: autos_getLogMarker(id),
    };
    if (!repair.carId || !repair.reparacion) {
        showToast('⚠️ Selecciona auto y reparacion');
        return;
    }
    try {
        const uploadedPhotos = await autos_uploadFiles('autos-repair-photo-file');
        const uploadedReceipts = await autos_uploadFiles('autos-repair-receipt-file');
        const nextPhotos = [...autos_parseUrlList(repair.foto), ...uploadedPhotos];
        const nextReceipts = [...autos_parseUrlList(repair.recibo), ...uploadedReceipts];
        repair.foto = nextPhotos.join(',');
        repair.recibo = nextReceipts.join(',');
    } catch (e) {
        console.warn('No se pudieron subir archivos de reparacion:', e);
        showToast('⚠️ No se pudo subir archivo, se guarda con URLs actuales');
    }

    const idx = autosState.repairs.findIndex(r => r.id === id);
    if (idx >= 0) autosState.repairs[idx] = repair;
    else autosState.repairs.push(repair);
    await autos_saveRepairsSheet();
    await autos_syncRepairToLog(repair);
    autos_closeRepairSheet();
    autos_render();
    tabInited.gastos = false;
    showToast('✅ Reparacion guardada');
}

async function autos_saveRepairsSheet() {
    await sheetsClear(SPREADSHEET_AUTOS_ID, 'Reparaciones!A2:K');
    if (!autosState.repairs.length) return;
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `Reparaciones!A2:K${1 + autosState.repairs.length}`, autosState.repairs.map(r => [
        r.id, r.carId, r.reparacion, r.costo, r.moneda, r.lugar, r.fecha, r.foto, r.recibo, r.descripcion, r.logMarker || autos_getLogMarker(r.id),
    ]));
}

function autos_getLogMarker(repairId) {
    return `AUTOLOG#${repairId}`;
}

async function autos_syncRepairToLog(repair) {
    const marker = repair.logMarker || autos_getLogMarker(repair.id);
    const car = autosState.cars.find(c => c.id === repair.carId);
    if (!car) return;
    const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
    let found = -1;
    for (let i = 0; i < logRows.length; i++) {
        if (((logRows[i][2] || '').toString()).includes(marker)) {
            found = i;
            break;
        }
    }
    const monto = parseSheetValue(repair.costo);
    if (monto <= 0) {
        if (found !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, found + 1);
        }
        return;
    }
    const lugar = repair.lugar || `Auto ${car.placa || `${car.marca} ${car.modelo}`}`;
    const concepto = `${repair.reparacion} · ${car.marca} ${car.modelo} (${car.placa || 'sin placa'}) [${marker}]`;
    const row = [
        repair.fecha,
        lugar,
        concepto,
        monto,
        'Gasto',
        'Auto - Reparaciones',
        repair.recibo || repair.foto || '',
        repair.moneda || 'MXN',
    ];
    if (found !== -1) {
        const rowNum = found + 2;
        await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!A${rowNum}:H${rowNum}`, [row]);
    } else {
        await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:H', [row]);
    }
}

window.autos_deleteRepair = async function(repairId) {
    const repair = autosState.repairs.find(r => r.id === repairId);
    if (!repair) return;
    if (!confirm('¿Eliminar esta reparacion?')) return;
    autosState.repairs = autosState.repairs.filter(r => r.id !== repairId);
    await autos_saveRepairsSheet();
    try {
        const marker = repair.logMarker || autos_getLogMarker(repair.id);
        const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
        let found = -1;
        for (let i = 0; i < logRows.length; i++) {
            if (((logRows[i][2] || '').toString()).includes(marker)) {
                found = i;
                break;
            }
        }
        if (found !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, found + 1);
            tabInited.gastos = false;
        }
    } catch (e) {
        console.warn('No se pudo borrar sincronizacion en Control de Gastos:', e);
    }
    autos_render();
    showToast('🗑️ Reparacion eliminada');
};

window.autos_openCarSheet = autos_openCarSheet;
window.autos_closeCarSheet = autos_closeCarSheet;
window.autos_openRepairSheet = autos_openRepairSheet;
window.autos_closeRepairSheet = autos_closeRepairSheet;
window.autos_openCarDetail = autos_openCarDetail;

// =============================================
// ESTUDIO MODULE
// =============================================
const estudioState = {
    inventario: [],
    plugins: [],
    activeSubtab: 'inventario',
    inventarioSearch: '',
    pluginsSearch: '',
    loaded: false,
};

const ESTUDIO_INVENTARIO_HEADERS = [
    'id', 'name', 'cantidad', 'precioUsd', 'categoria', 'anioCompra', 'foto', 'marca', 'modelo', 'site',
    'serial', 'account', 'notas', 'fechaCompra', 'logMarker',
];

const ESTUDIO_PLUGIN_HEADERS = [
    'id', 'name', 'marca', 'descripcion', 'precioUsd', 'site', 'licencia', 'serial', 'account', 'foto', 'fechaCompra', 'logMarker', 'currency', 'categoria',
];

const ESTUDIO_SEED_INVENTARIO = [
    ['SHURE SM57', 2, 198, 'Microfonos', '2003', '', '', '', '', '', '', '', ''],
    ['SENHEISER MD 421 II', 1, 379, 'Microfonos', '2003', '', '', '', '', '', '', '', ''],
    ['SHURE BETA 52A', 1, 189, 'Microfonos', '2003', '', '', '', '', '', '', '', ''],
    ['NEUMANN KM184', 1, 799, 'Microfonos', '2003', '', '', '', '', '', '', '', ''],
    ['AKG 414 C', 1, 974, 'Microfonos', '2003', '', '', '', '', '', '', '', ''],
    ['RODE NT5', 2, 698, 'Microfonos', '2013', '', '', '', '', '', '', '', ''],
    ['SSL ALPHA VHD PRE', 1, 1799, 'Preamps', '2009', '', '', '', '', '', '', '', ''],
    ['JOHN HARDY M 1', 1, 2600, 'Preamps', '2003', '', '', '', '', '', '', '', ''],
    ['GENELEC', 2, 6000, 'Monitores de Audio', '2003', 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/k8d7AaCz2wi18wHhtwRq.jpg', '', '', '', '', '', '', ''],
    ['YAMAHAS HS8 8', 2, 740, 'Monitores de Audio', '2009', 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/XPTVrDtAVII9D7xXSdib.jpg', '', '', '', '', '', '', ''],
    ['DANGEROUS 2 BUS LT', 1, 1499, 'Sumador de Audio', '2007', '', '', '', '', '', '', '', ''],
    ['FURMANN POWER CONDITIONER', 3, 357, 'Power Protection', '2003', '', '', '', '', '', '', '', ''],
    ['ELEVEN RACK', 1, 699, 'Guitar Processor', '2007', '', '', '', '', '', '', '', ''],
    ['SWITCHCRAFT STUDIO PATCH 9625', 1, 989, 'Patch Bay', '2003', '', '', '', '', '', '', '', ''],
    ['MESA ARGOSY PARA HARDWARE', 1, 2999, 'Mobiliario', '2009', '', '', '', '', '', '', '', ''],
    ['UAD APOLLO TWIN', 1, 999, 'Interface de Audio', '2018', 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/lA5Af7itU9nbpnq4CsFa.jpg', 'Universal Audio', 'Apollo Twin', 'https://www.uaudio.com', '', '', '', ''],
    ['UAD APOLLO x8p', 1, 3499, 'Interface de Audio', '2021', '', 'Universal Audio', 'Apollo x8p', 'https://www.uaudio.com', '', '', '', ''],
    ['MONITOR DE VIDEO SAMSUNG', 1, 200, 'Monitor de Video', '2018', '', '', '', '', '', '', '', ''],
    ['LINE 6 POD X3 PRO GUITAR MODULE', 1, 8000, 'Guitar Processor', '2004', '', '', '', '', '', '', '', ''],
    ['BAJO ELECTRICO', 1, 300, 'Instrumentos', '2004', '', 'Ibanez', '', '', '', '', '', ''],
    ['BATERIA TAMA', 1, 700, 'Instrumentos', '2009', '', '', '', '', '', '', '', ''],
    ['BABY TAYLOR GUITARRA ACUSTICA', 1, 500, 'Instrumentos', '2009', '', '', '', '', '', '', '', ''],
    ['YEMBE REMO', 1, 400, 'Instrumentos', '2008', '', '', '', '', '', '', '', ''],
    ['M-AUDIO AXIOM PRO 49 CONTROLADOR', 1, 300, 'Instrumentos', '2008', '', '', '', '', '', '', '', ''],
    ['UKULELE', 1, 120, 'Instrumentos', '2012', '', '', '', '', '', '', '', ''],
    ['TELECASTER', 1, 999, 'Instrumentos', '2005', '', '', '', '', '', '', '', ''],
    ['Macbook Pro', 1, 4500, 'Computadoras', '2019', 'https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/szp3mFYNwh3181ZkC2gi/pub/u9A68nb5NZVoaJyqT3wH.jpg', 'Apple', 'MacBook Pro Intel i9 2.3ghz 8core 32 GB memoria ram', '', '', '', '', ''],
    ['Lenovo Laptop', 1, 1200, 'Computadoras', '2024', '', 'Lenovo', '', '', '', '', '', ''],
    ['Sony ZV-1', 1, 1000, 'Camaras', '2022', '', 'Sony', 'ZV-1', '', '', '', '', ''],
    ['GoPro Hero 3+', 1, 350, 'Camaras', '', '', 'GoPro', 'Hero 3+', '', '', '', '', ''],
];

const ESTUDIO_SEED_PLUGINS = [
    ['Pro - L2', 'Fab Filter', 'Limitador', 169, 'https://www.fabfilter.com/shop/pro-l-2-limiter-plug-in', '', '', '', '', '', '', '', 'USD'],
    ['Rbass', 'Waves', 'EQ', 35, 'https://www.waves.com', '', '', '', '', '', '', '', 'USD'],
    ['Abbey Road RS56', 'Waves', 'EQ', 35, 'https://www.waves.com', '', '', '', '', '', '', '', 'USD'],
    ['CLA Vintage Compressors', 'Waves', 'Compresores', 77, 'https://www.waves.com', '', '', '', '', '', '', '', 'USD'],
    ['Auto-Tune', 'Antares / Universal Audio', 'Afinador', 300, 'https://www.uaudio.com', '', '', '', '', '', '', '', 'USD'],
    ['Puig Tech', 'Waves', 'EQ', 35, 'https://www.waves.com', '', '', '', '', '', '', '', 'USD'],
    ['H-Delay', '', '', 30, '', '', '', '', '', '', '', '', 'USD'],
    ['Kramer Tape', '', '', 30, '', '', '', '', '', '', '', '', 'USD'],
    ['Abbey Roads TG Mastering', '', '', 39, '', '', '', '', '', '', '', '', 'USD'],
    ['Waves VU Meter', '', '', 27, '', '', '', '', '', '', '', '', 'USD'],
    ['Waves API bundle', '', '', 90, '', '', '', '', '', '', '', '', 'USD'],
    ['The God Particle', '', 'Limitador', 150, '', 'Cuenta Online', '', '', '', '', '', '', 'USD'],
];

function estudio_bindEvents() {
    document.getElementById('estudio-subtab-inventario')?.addEventListener('click', () => {
        estudioState.activeSubtab = 'inventario';
        estudio_render();
    });
    document.getElementById('estudio-subtab-plugins')?.addEventListener('click', () => {
        estudioState.activeSubtab = 'plugins';
        estudio_render();
    });
    document.getElementById('estudio-btn-add-inventario')?.addEventListener('click', () => estudio_openInventarioSheet(null));
    document.getElementById('estudio-btn-add-plugin')?.addEventListener('click', () => estudio_openPluginSheet(null));
    document.getElementById('estudio-inventario-overlay')?.addEventListener('click', estudio_closeInventarioSheet);
    document.getElementById('estudio-plugin-overlay')?.addEventListener('click', estudio_closePluginSheet);
    document.getElementById('estudio-inventario-save')?.addEventListener('click', estudio_saveInventario);
    document.getElementById('estudio-plugin-save')?.addEventListener('click', estudio_savePlugin);
    document.getElementById('estudio-inventario-search')?.addEventListener('input', (e) => {
        estudioState.inventarioSearch = (e.target.value || '').toLowerCase().trim();
        estudio_render();
    });
    document.getElementById('estudio-plugins-search')?.addEventListener('input', (e) => {
        estudioState.pluginsSearch = (e.target.value || '').toLowerCase().trim();
        estudio_render();
    });
}

function estudio_setSubtab(name) {
    estudioState.activeSubtab = name === 'plugins' ? 'plugins' : 'inventario';
    const invBtn = document.getElementById('estudio-subtab-inventario');
    const plgBtn = document.getElementById('estudio-subtab-plugins');
    const invSection = document.getElementById('estudio-inventario-section');
    const plgSection = document.getElementById('estudio-plugins-section');
    invBtn?.classList.toggle('active', estudioState.activeSubtab === 'inventario');
    plgBtn?.classList.toggle('active', estudioState.activeSubtab === 'plugins');
    invSection?.classList.toggle('hidden', estudioState.activeSubtab !== 'inventario');
    plgSection?.classList.toggle('hidden', estudioState.activeSubtab !== 'plugins');
}

async function estudio_cargarVista() {
    const invList = document.getElementById('estudio-inventario-list');
    const plgList = document.getElementById('estudio-plugins-list');
    if (invList) invList.innerHTML = '<div class="loading-spinner">⏳ Cargando inventario...</div>';
    if (plgList) plgList.innerHTML = '<div class="loading-spinner">⏳ Cargando plugins...</div>';
    try {
        await estudio_ensureSheets();
        await estudio_loadData();
        estudio_render();
    } catch (e) {
        handleApiError(e, invList);
    }
}

async function estudio_ensureSheets() {
    await autos_ensureSheet('EstudioInventario', ESTUDIO_INVENTARIO_HEADERS);
    await autos_ensureSheet('EstudioPlugins', ESTUDIO_PLUGIN_HEADERS);
}

async function estudio_loadData() {
    const [inventarioRows, pluginRows] = await Promise.all([
        sheetsGet(SPREADSHEET_ESTUDIO_ID, 'EstudioInventario!A2:O').catch(() => []),
        sheetsGet(SPREADSHEET_ESTUDIO_ID, 'EstudioPlugins!A2:N').catch(() => []),
    ]);

    if (!inventarioRows.length && !pluginRows.length) {
        await estudio_seedInitialData();
        return estudio_loadData();
    }

    estudioState.inventario = inventarioRows.map((r) => ({
        id: (r[0] || '').toString(),
        name: (r[1] || '').toString(),
        cantidad: Math.max(1, parseInt(r[2], 10) || 1),
        precioUsd: parseSheetValue(r[3]),
        categoria: (r[4] || '').toString(),
        anioCompra: (r[5] || '').toString(),
        foto: (r[6] || '').toString(),
        marca: (r[7] || '').toString(),
        modelo: (r[8] || '').toString(),
        site: (r[9] || '').toString(),
        serial: (r[10] || '').toString(),
        account: (r[11] || '').toString(),
        notas: (r[12] || '').toString(),
        fechaCompra: normalizeDateString(r[13] || new Date().toLocaleDateString('en-CA')),
        logMarker: (r[14] || '').toString(),
    })).filter((x) => x.id && x.name);

    estudioState.plugins = pluginRows.map((r) => ({
        id: (r[0] || '').toString(),
        name: (r[1] || '').toString(),
        marca: (r[2] || '').toString(),
        descripcion: (r[3] || '').toString(),
        precioUsd: parseSheetValue(r[4]),
        site: (r[5] || '').toString(),
        licencia: (r[6] || '').toString(),
        serial: (r[7] || '').toString(),
        account: (r[8] || '').toString(),
        foto: (r[9] || '').toString(),
        fechaCompra: normalizeDateString(r[10] || new Date().toLocaleDateString('en-CA')),
        logMarker: (r[11] || '').toString(),
        currency: parseCurrencyCode((r[12] || 'USD').toString().toUpperCase() === 'MXN' ? 'MXN' : 'USD'),
        categoria: (r[13] || r[3] || '').toString(),
    })).filter((x) => x.id && x.name);

    estudioState.loaded = true;
}

async function estudio_seedInitialData() {
    const nowDate = normalizeDateString(new Date().toLocaleDateString('en-CA'));
    const inventario = ESTUDIO_SEED_INVENTARIO.map((r, i) => ({
        id: `inv-${Date.now()}-${i + 1}`,
        name: r[0],
        cantidad: r[1],
        precioUsd: r[2],
        categoria: r[3],
        anioCompra: r[4],
        foto: r[5],
        marca: r[6],
        modelo: r[7],
        site: r[8],
        serial: r[9],
        account: r[10],
        notas: r[11],
        fechaCompra: nowDate,
        logMarker: '',
    }));
    const plugins = ESTUDIO_SEED_PLUGINS.map((r, i) => ({
        id: `plg-${Date.now()}-${i + 1}`,
        name: r[0],
        marca: r[1],
        descripcion: r[2],
        precioUsd: r[3],
        site: r[4],
        licencia: r[5],
        serial: r[6],
        account: r[7],
        foto: r[8],
        fechaCompra: nowDate,
        logMarker: '',
        currency: 'USD',
        categoria: (r[13] || r[2] || '').toString(),
    }));
    await sheetsUpdate(SPREADSHEET_ESTUDIO_ID, `EstudioInventario!A2:O${1 + inventario.length}`, inventario.map((x) => [
        x.id, x.name, x.cantidad, x.precioUsd, x.categoria, x.anioCompra, x.foto, x.marca, x.modelo, x.site,
        x.serial, x.account, x.notas, x.fechaCompra, x.logMarker,
    ]));
    await sheetsUpdate(SPREADSHEET_ESTUDIO_ID, `EstudioPlugins!A2:N${1 + plugins.length}`, plugins.map((x) => [
        x.id, x.name, x.marca, x.descripcion, x.precioUsd, x.site, x.licencia, x.serial, x.account, x.foto, x.fechaCompra, x.logMarker, x.currency, x.categoria,
    ]));
}

function estudio_uniqueCategories(items, key) {
    return [...new Set(items.map((x) => (x?.[key] || '').toString().trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function estudio_renderCategorySelect(selectId, categories, selected = '') {
    const el = document.getElementById(selectId);
    if (!el) return;
    const safeSelected = (selected || '').toString().trim();
    const all = safeSelected && !categories.includes(safeSelected)
        ? [safeSelected, ...categories]
        : categories;
    el.innerHTML = [`<option value="">Sin categoria</option>`, ...all.map((c) => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`)].join('');
    el.value = safeSelected;
}

function estudio_detailCell(label, value) {
    const text = (value || '').toString().trim();
    if (!text) return '';
    return `<span class="estudio-entry-meta"><strong>${label}:</strong> ${text}</span>`;
}

function estudio_parseYear(value) {
    const text = (value || '').toString().trim();
    if (!text) return 0;
    const m = text.match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : 0;
}

function estudio_ageYears(item) {
    const now = new Date();
    let ageFromDate = 0;
    const purchaseDate = normalizeDateString(item?.fechaCompra || '');
    if (purchaseDate) {
        const d = new Date(purchaseDate);
        if (!Number.isNaN(d.getTime())) {
            const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
            ageFromDate = Math.max(0, months / 12);
        }
    }
    const y = estudio_parseYear(item?.anioCompra || '');
    const ageFromYear = y ? Math.max(0, now.getFullYear() - y + 0.5) : 0;
    return Math.max(ageFromDate, ageFromYear);
}

function estudio_depreciationProfile(item, kind = 'inventario') {
    const text = [item?.categoria, item?.name, item?.marca, item?.descripcion].map(x => (x || '').toString().toLowerCase()).join(' ');
    if (kind === 'plugin') return { annualRate: 0.2, floor: 0.2, label: 'plugin/software' };
    if (/(laptop|macbook|pc|computadora|imac|monitor|pantalla)/i.test(text)) return { annualRate: 0.3, floor: 0.15, label: 'computo' };
    if (/(interface|preamp|preamplificador|controlador|mixer|mezcladora|convertidor|rack|outboard)/i.test(text)) return { annualRate: 0.16, floor: 0.25, label: 'equipo grabacion' };
    if (/(microfono|mic|micrófono)/i.test(text)) return { annualRate: 0.12, floor: 0.3, label: 'microfonos' };
    if (/(guitarra|bajo|piano|teclado|sintetizador|synth|instrumento|drum|bateria|batería|cello|violin|viol[ií]n)/i.test(text)) return { annualRate: 0.1, floor: 0.35, label: 'instrumentos' };
    if (/(speaker|monitor audio|bocina|subwoofer|audifono|audífono|headphone)/i.test(text)) return { annualRate: 0.14, floor: 0.25, label: 'monitoreo' };
    return { annualRate: 0.15, floor: 0.25, label: 'general estudio' };
}

function estudio_depreciatedMxn(item, amountMxn, kind = 'inventario') {
    const profile = estudio_depreciationProfile(item, kind);
    const years = estudio_ageYears(item);
    const factor = Math.max(profile.floor, Math.pow(1 - profile.annualRate, years));
    return Math.max(0, amountMxn * factor);
}

function estudio_render() {
    estudio_setSubtab(estudioState.activeSubtab);
    const totalInventarioRawMxn = estudioState.inventario.reduce((sum, i) => {
        const usd = parseSheetValue(i.precioUsd) * Math.max(1, parseInt(i.cantidad, 10) || 1);
        return sum + convertTransactionAmountToMxn(usd, 'USD');
    }, 0);
    const totalPluginsRawMxn = estudioState.plugins.reduce((sum, p) => {
        const price = parseSheetValue(p.precioUsd);
        return sum + convertTransactionAmountToMxn(price, p.currency || 'USD');
    }, 0);
    const totalInventarioDepMxn = estudioState.inventario.reduce((sum, i) => {
        const usd = parseSheetValue(i.precioUsd) * Math.max(1, parseInt(i.cantidad, 10) || 1);
        const mxn = convertTransactionAmountToMxn(usd, 'USD');
        return sum + estudio_depreciatedMxn(i, mxn, 'inventario');
    }, 0);
    const totalPluginsDepMxn = estudioState.plugins.reduce((sum, p) => {
        const mxn = convertTransactionAmountToMxn(parseSheetValue(p.precioUsd), p.currency || 'USD');
        return sum + estudio_depreciatedMxn(p, mxn, 'plugin');
    }, 0);
    const totalRawMxn = totalInventarioRawMxn + totalPluginsRawMxn;
    const totalDepMxn = totalInventarioDepMxn + totalPluginsDepMxn;
    const totalEl = document.getElementById('estudio-total-spent');
    if (totalEl) totalEl.innerHTML = `${formatCurrency(totalDepMxn)}<span style="display:block;font-size:.65em;font-weight:600;opacity:.72;margin-top:.25rem;">sin depreciar ${formatCurrency(totalRawMxn)}</span>`;
    const breakdownEl = document.getElementById('estudio-breakdown-note');
    if (breakdownEl) {
        const isInv = estudioState.activeSubtab === 'inventario';
        const depreciatedValue = isInv ? totalInventarioDepMxn : totalPluginsDepMxn;
        const depreciationAmount = isInv
            ? Math.max(0, totalInventarioRawMxn - totalInventarioDepMxn)
            : Math.max(0, totalPluginsRawMxn - totalPluginsDepMxn);
        const scope = isInv ? 'inventario' : 'plugins';
        breakdownEl.innerText = `Valor depreciado ${scope}: ${formatCurrency(depreciatedValue)} · depreciación estimada ${formatCurrency(depreciationAmount)}`;
    }

    const inventarioCategories = estudio_uniqueCategories(estudioState.inventario, 'categoria');
    const pluginCategories = estudio_uniqueCategories(estudioState.plugins, 'categoria');
    estudio_renderCategorySelect('estudio-inventario-category-pick', inventarioCategories, document.getElementById('estudio-inventario-category-pick')?.value || '');
    estudio_renderCategorySelect('estudio-plugin-category-pick', pluginCategories, document.getElementById('estudio-plugin-category-pick')?.value || '');

    const invList = document.getElementById('estudio-inventario-list');
    const invSearchEl = document.getElementById('estudio-inventario-search');
    if (invSearchEl && invSearchEl.value !== estudioState.inventarioSearch) invSearchEl.value = estudioState.inventarioSearch;
    const invQuery = (estudioState.inventarioSearch || '').trim();
    const inventarioRows = !invQuery
        ? estudioState.inventario
        : estudioState.inventario.filter((item) => {
            const text = [
                item.name,
                item.categoria,
                item.marca,
                item.modelo,
                item.serial,
                item.account,
                item.notas,
                item.anioCompra,
            ].join(' ').toLowerCase();
            return text.includes(invQuery);
        });
    if (invList) {
        invList.innerHTML = inventarioRows.map((item) => {
            const qty = Math.max(1, parseInt(item.cantidad, 10) || 1);
            const totalUsd = parseSheetValue(item.precioUsd) * qty;
            const totalMxn = convertTransactionAmountToMxn(totalUsd, 'USD');
            const depMxn = estudio_depreciatedMxn(item, totalMxn, 'inventario');
            const depUnitMxn = depMxn / qty;
            const invMeta = [
                estudio_detailCell('Marca', item.marca),
                estudio_detailCell('Modelo', item.modelo),
                estudio_detailCell('Serial', item.serial),
                estudio_detailCell('Cuenta', item.account),
            ].filter(Boolean).join('');
            const topMeta = [item.categoria, `Cantidad ${item.cantidad || 1}`, item.anioCompra].filter(Boolean).join(' · ');
            return `<article class="glass-subtle estudio-entry-card">
                <div class="estudio-entry-top">
                    <div style="display:grid;gap:.25rem;min-width:0;">
                        <span class="estudio-entry-title">🎛️ ${item.name}</span>
                        ${topMeta ? `<span class="estudio-entry-meta">${topMeta}</span>` : ''}
                    </div>
                    <div class="estudio-card-right">
                        <span class="account-balance text-danger">${formatCurrency(totalMxn)}</span>
                        <span class="account-type-label">USD ${totalUsd.toFixed(2)}</span>
                        <span class="account-type-label" style="color:#34d399;">Venta sugerida: ${formatCurrency(depMxn)}</span>
                        ${qty > 1 ? `<span class="account-type-label" style="opacity:.8;">Por unidad: ${formatCurrency(depUnitMxn)}</span>` : ''}
                    </div>
                </div>

                ${invMeta ? `<div class="estudio-entry-grid">${invMeta}</div>` : ''}

                ${item.notas ? `<div class="estudio-entry-notes">${item.notas}</div>` : ''}

                <div class="estudio-entry-actions">
                    ${item.site ? `<a class="mini-btn" href="${item.site}" target="_blank" rel="noopener">Sitio</a>` : ''}
                    ${item.foto ? `<a class="mini-btn" href="${item.foto}" target="_blank" rel="noopener">Foto</a>` : ''}
                    <button class="mini-btn" onclick="estudio_openInventarioSheet('${item.id}')">✏️ Editar</button>
                    <button class="mini-btn mini-btn-danger" onclick="estudio_deleteInventario('${item.id}')">🗑️</button>
                </div>
            </article>`;
        }).join('') || (invQuery ? '<div class="empty-state">Sin coincidencias en inventario</div>' : '<div class="empty-state">Sin equipo registrado</div>');
    }

    const plgList = document.getElementById('estudio-plugins-list');
    const plgSearchEl = document.getElementById('estudio-plugins-search');
    if (plgSearchEl && plgSearchEl.value !== estudioState.pluginsSearch) plgSearchEl.value = estudioState.pluginsSearch;
    const plgQuery = (estudioState.pluginsSearch || '').trim();
    const pluginRows = !plgQuery
        ? estudioState.plugins
        : estudioState.plugins.filter((item) => {
            const text = [
                item.name,
                item.marca,
                item.categoria,
                item.descripcion,
                item.licencia,
                item.serial,
                item.account,
            ].join(' ').toLowerCase();
            return text.includes(plgQuery);
        });
    if (plgList) {
        plgList.innerHTML = pluginRows.map((item) => {
            const price = parseSheetValue(item.precioUsd);
            const plgMeta = [
                estudio_detailCell('Licencia', item.licencia),
                estudio_detailCell('Serial', item.serial),
                estudio_detailCell('Cuenta', item.account),
                estudio_detailCell('Tipo', item.descripcion),
            ].filter(Boolean).join('');
            const topMeta = [item.marca, item.categoria].filter(Boolean).join(' · ');
            return `<article class="glass-subtle estudio-entry-card">
                <div class="estudio-entry-top">
                    <div style="display:grid;gap:.25rem;min-width:0;">
                        <span class="estudio-entry-title">🧩 ${item.name}</span>
                        ${topMeta ? `<span class="estudio-entry-meta">${topMeta}</span>` : ''}
                    </div>
                    <div class="estudio-card-right">
                        <span class="account-balance text-danger">${formatCurrency(convertTransactionAmountToMxn(price, 'USD'))}</span>
                        <span class="account-type-label">USD ${price.toFixed(2)}</span>
                    </div>
                </div>

                ${plgMeta ? `<div class="estudio-entry-grid">${plgMeta}</div>` : ''}

                ${item.descripcion ? `<div class="estudio-entry-notes">${item.descripcion}</div>` : ''}

                <div class="estudio-entry-actions">
                    ${item.site ? `<a class="mini-btn" href="${item.site}" target="_blank" rel="noopener">Sitio</a>` : ''}
                    ${item.foto ? `<a class="mini-btn" href="${item.foto}" target="_blank" rel="noopener">Imagen</a>` : ''}
                    <button class="mini-btn" onclick="estudio_openPluginSheet('${item.id}')">✏️ Editar</button>
                    <button class="mini-btn mini-btn-danger" onclick="estudio_deletePlugin('${item.id}')">🗑️</button>
                </div>
            </article>`;
        }).join('') || (plgQuery ? '<div class="empty-state">Sin coincidencias en plugins</div>' : '<div class="empty-state">Sin plugins registrados</div>');
    }
}

function estudio_openInventarioSheet(id) {
    const item = estudioState.inventario.find((x) => x.id === id) || null;
    const categories = estudio_uniqueCategories(estudioState.inventario, 'categoria');
    estudio_renderCategorySelect('estudio-inventario-category-pick', categories, item?.categoria || '');
    document.getElementById('estudio-inventario-edit-id').value = item?.id || '';
    document.getElementById('estudio-inventario-title').innerText = item ? 'Editar Equipo' : 'Nuevo Equipo';
    document.getElementById('estudio-inventario-name').value = item?.name || '';
    document.getElementById('estudio-inventario-cantidad').value = item?.cantidad || 1;
    document.getElementById('estudio-inventario-price').value = item?.precioUsd || '';
    document.getElementById('estudio-inventario-category-new').value = '';
    document.getElementById('estudio-inventario-year').value = item?.anioCompra || '';
    document.getElementById('estudio-inventario-brand').value = item?.marca || '';
    document.getElementById('estudio-inventario-model').value = item?.modelo || '';
    document.getElementById('estudio-inventario-photo').value = item?.foto || '';
    document.getElementById('estudio-inventario-site').value = item?.site || '';
    document.getElementById('estudio-inventario-serial').value = item?.serial || '';
    document.getElementById('estudio-inventario-account').value = item?.account || '';
    document.getElementById('estudio-inventario-notes').value = item?.notas || '';
    document.getElementById('estudio-inventario-sheet').classList.remove('hidden');
}

function estudio_closeInventarioSheet() {
    document.getElementById('estudio-inventario-sheet').classList.add('hidden');
}

async function estudio_saveInventario() {
    const id = document.getElementById('estudio-inventario-edit-id').value || `inv-${Date.now()}`;
    const idx = estudioState.inventario.findIndex((x) => x.id === id);
    const existing = idx >= 0 ? estudioState.inventario[idx] : null;
    const isNew = idx === -1;
    const marker = isNew ? estudio_getInventarioMarker(id) : ((existing?.logMarker || '').toString().trim());
    const inventarioCategory = (document.getElementById('estudio-inventario-category-new')?.value || '').trim()
        || (document.getElementById('estudio-inventario-category-pick')?.value || '').trim();
    const item = {
        id,
        name: document.getElementById('estudio-inventario-name').value.trim(),
        cantidad: Math.max(1, parseInt(document.getElementById('estudio-inventario-cantidad').value, 10) || 1),
        precioUsd: parseSheetValue(document.getElementById('estudio-inventario-price').value),
        categoria: inventarioCategory,
        anioCompra: document.getElementById('estudio-inventario-year').value.trim(),
        foto: document.getElementById('estudio-inventario-photo').value.trim(),
        marca: document.getElementById('estudio-inventario-brand').value.trim(),
        modelo: document.getElementById('estudio-inventario-model').value.trim(),
        site: document.getElementById('estudio-inventario-site').value.trim(),
        serial: document.getElementById('estudio-inventario-serial').value.trim(),
        account: document.getElementById('estudio-inventario-account').value.trim(),
        notas: document.getElementById('estudio-inventario-notes').value.trim(),
        fechaCompra: normalizeDateString(new Date().toLocaleDateString('en-CA')),
        logMarker: marker,
    };
    if (!item.name) {
        showToast('⚠️ Captura nombre del equipo');
        return;
    }
    if (idx >= 0) estudioState.inventario[idx] = { ...estudioState.inventario[idx], ...item };
    else estudioState.inventario.push(item);
    await estudio_saveInventarioSheet();
    try {
        if (isNew) {
            await estudio_syncInventarioToLog(item, { allowCreate: true });
        } else if (item.logMarker) {
            await estudio_syncInventarioToLog(item, { allowCreate: false });
        }
    } catch (e) {
        console.warn('No se pudo sincronizar inventario a Control de Gastos:', e);
        showToast('⚠️ Se guardo el equipo, pero fallo la sincronizacion a gastos');
    }
    estudio_closeInventarioSheet();
    estudio_render();
    tabInited.gastos = false;
    showToast('✅ Equipo guardado');
}

async function estudio_saveInventarioSheet() {
    await sheetsClear(SPREADSHEET_ESTUDIO_ID, 'EstudioInventario!A2:O');
    if (!estudioState.inventario.length) return;
    await sheetsUpdate(SPREADSHEET_ESTUDIO_ID, `EstudioInventario!A2:O${1 + estudioState.inventario.length}`, estudioState.inventario.map((x) => [
        x.id, x.name, x.cantidad, x.precioUsd, x.categoria, x.anioCompra, x.foto, x.marca, x.modelo, x.site,
        x.serial, x.account, x.notas, x.fechaCompra, x.logMarker || '',
    ]));
}

function estudio_openPluginSheet(id) {
    const item = estudioState.plugins.find((x) => x.id === id) || null;
    const categories = estudio_uniqueCategories(estudioState.plugins, 'categoria');
    estudio_renderCategorySelect('estudio-plugin-category-pick', categories, item?.categoria || '');
    document.getElementById('estudio-plugin-edit-id').value = item?.id || '';
    document.getElementById('estudio-plugin-title').innerText = item ? 'Editar Plugin' : 'Nuevo Plugin';
    document.getElementById('estudio-plugin-name').value = item?.name || '';
    document.getElementById('estudio-plugin-brand').value = item?.marca || '';
    document.getElementById('estudio-plugin-category-new').value = '';
    document.getElementById('estudio-plugin-price').value = item?.precioUsd || '';
    document.getElementById('estudio-plugin-description').value = item?.descripcion || '';
    document.getElementById('estudio-plugin-site').value = item?.site || '';
    document.getElementById('estudio-plugin-license').value = item?.licencia || '';
    document.getElementById('estudio-plugin-serial').value = item?.serial || '';
    document.getElementById('estudio-plugin-account').value = item?.account || '';
    document.getElementById('estudio-plugin-photo').value = item?.foto || '';
    document.getElementById('estudio-plugin-sheet').classList.remove('hidden');
}

function estudio_closePluginSheet() {
    document.getElementById('estudio-plugin-sheet').classList.add('hidden');
}

async function estudio_savePlugin() {
    const id = document.getElementById('estudio-plugin-edit-id').value || `plg-${Date.now()}`;
    const idx = estudioState.plugins.findIndex((x) => x.id === id);
    const existing = idx >= 0 ? estudioState.plugins[idx] : null;
    const isNew = idx === -1;
    const marker = isNew ? estudio_getPluginMarker(id) : ((existing?.logMarker || '').toString().trim());
    const pluginCategory = (document.getElementById('estudio-plugin-category-new')?.value || '').trim()
        || (document.getElementById('estudio-plugin-category-pick')?.value || '').trim();
    const item = {
        id,
        name: document.getElementById('estudio-plugin-name').value.trim(),
        marca: document.getElementById('estudio-plugin-brand').value.trim(),
        categoria: pluginCategory,
        descripcion: document.getElementById('estudio-plugin-description').value.trim(),
        precioUsd: parseSheetValue(document.getElementById('estudio-plugin-price').value),
        site: document.getElementById('estudio-plugin-site').value.trim(),
        licencia: document.getElementById('estudio-plugin-license').value.trim(),
        serial: document.getElementById('estudio-plugin-serial').value.trim(),
        account: document.getElementById('estudio-plugin-account').value.trim(),
        foto: document.getElementById('estudio-plugin-photo').value.trim(),
        fechaCompra: normalizeDateString(new Date().toLocaleDateString('en-CA')),
        logMarker: marker,
        currency: 'USD',
    };
    if (!item.name) {
        showToast('⚠️ Captura nombre del plugin');
        return;
    }
    if (idx >= 0) estudioState.plugins[idx] = { ...estudioState.plugins[idx], ...item };
    else estudioState.plugins.push(item);
    await estudio_savePluginsSheet();
    try {
        if (isNew) {
            await estudio_syncPluginToLog(item, { allowCreate: true });
        } else if (item.logMarker) {
            await estudio_syncPluginToLog(item, { allowCreate: false });
        }
    } catch (e) {
        console.warn('No se pudo sincronizar plugin a Control de Gastos:', e);
        showToast('⚠️ Se guardo el plugin, pero fallo la sincronizacion a gastos');
    }
    estudio_closePluginSheet();
    estudio_render();
    tabInited.gastos = false;
    showToast('✅ Plugin guardado');
}

async function estudio_savePluginsSheet() {
    await sheetsClear(SPREADSHEET_ESTUDIO_ID, 'EstudioPlugins!A2:N');
    if (!estudioState.plugins.length) return;
    await sheetsUpdate(SPREADSHEET_ESTUDIO_ID, `EstudioPlugins!A2:N${1 + estudioState.plugins.length}`, estudioState.plugins.map((x) => [
        x.id, x.name, x.marca, x.descripcion, x.precioUsd, x.site, x.licencia, x.serial, x.account, x.foto, x.fechaCompra, x.logMarker || '', x.currency || 'USD', x.categoria || '',
    ]));
}

function estudio_getInventarioMarker(id) {
    return `ESTUDIOLOG#INV#${id}`;
}

function estudio_getPluginMarker(id) {
    return `ESTUDIOLOG#PLG#${id}`;
}

async function estudio_syncInventarioToLog(item, options = {}) {
    const allowCreate = options.allowCreate !== false;
    const marker = (item.logMarker || '').toString().trim();
    if (!marker) return;
    const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
    let found = -1;
    for (let i = 0; i < logRows.length; i++) {
        if (((logRows[i][2] || '').toString()).includes(marker)) {
            found = i;
            break;
        }
    }
    const monto = parseSheetValue(item.precioUsd) * Math.max(1, parseInt(item.cantidad, 10) || 1);
    if (found === -1 && !allowCreate) return;
    if (monto <= 0) {
        if (found !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, found + 1);
        }
        return;
    }
    const row = [
        item.fechaCompra || normalizeDateString(new Date().toLocaleDateString('en-CA')),
        'Estudio - Inventario',
        `${item.name} (${item.categoria || 'Equipo'}) [${marker}]`,
        monto,
        'Gasto',
        'Estudio',
        item.foto || item.site || '',
        'USD',
    ];
    if (found !== -1) {
        const rowNum = found + 2;
        await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!A${rowNum}:H${rowNum}`, [row]);
    } else {
        await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:H', [row]);
    }
}

async function estudio_syncPluginToLog(item, options = {}) {
    const allowCreate = options.allowCreate !== false;
    const marker = (item.logMarker || '').toString().trim();
    if (!marker) return;
    const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
    let found = -1;
    for (let i = 0; i < logRows.length; i++) {
        if (((logRows[i][2] || '').toString()).includes(marker)) {
            found = i;
            break;
        }
    }
    const monto = parseSheetValue(item.precioUsd);
    if (found === -1 && !allowCreate) return;
    if (monto <= 0) {
        if (found !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, found + 1);
        }
        return;
    }
    const row = [
        item.fechaCompra || normalizeDateString(new Date().toLocaleDateString('en-CA')),
        'Estudio - Plugins',
        `${item.name} (${item.marca || 'Plugin'}) [${marker}]`,
        monto,
        'Gasto',
        'Estudio',
        item.site || item.foto || '',
        item.currency || 'USD',
    ];
    if (found !== -1) {
        const rowNum = found + 2;
        await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!A${rowNum}:H${rowNum}`, [row]);
    } else {
        await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:H', [row]);
    }
}

window.estudio_deleteInventario = async function(id) {
    const item = estudioState.inventario.find((x) => x.id === id);
    if (!item) return;
    if (!confirm('¿Eliminar este equipo del inventario?')) return;
    estudioState.inventario = estudioState.inventario.filter((x) => x.id !== id);
    await estudio_saveInventarioSheet();
    try {
        const marker = (item.logMarker || '').toString().trim();
        if (!marker) {
            estudio_render();
            showToast('🗑️ Equipo eliminado');
            return;
        }
        const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
        const idx = logRows.findIndex((row) => ((row[2] || '').toString()).includes(marker));
        if (idx !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, idx + 1);
            tabInited.gastos = false;
        }
    } catch (e) {
        console.warn('No se pudo borrar gasto sincronizado de inventario:', e);
    }
    estudio_render();
    showToast('🗑️ Equipo eliminado');
};

window.estudio_deletePlugin = async function(id) {
    const item = estudioState.plugins.find((x) => x.id === id);
    if (!item) return;
    if (!confirm('¿Eliminar este plugin?')) return;
    estudioState.plugins = estudioState.plugins.filter((x) => x.id !== id);
    await estudio_savePluginsSheet();
    try {
        const marker = (item.logMarker || '').toString().trim();
        if (!marker) {
            estudio_render();
            showToast('🗑️ Plugin eliminado');
            return;
        }
        const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:H');
        const idx = logRows.findIndex((row) => ((row[2] || '').toString()).includes(marker));
        if (idx !== -1) {
            const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
            await sheetsDeleteRow(SPREADSHEET_LOG_ID, logSheetId, idx + 1);
            tabInited.gastos = false;
        }
    } catch (e) {
        console.warn('No se pudo borrar gasto sincronizado de plugin:', e);
    }
    estudio_render();
    showToast('🗑️ Plugin eliminado');
};

window.estudio_openInventarioSheet = estudio_openInventarioSheet;
window.estudio_closeInventarioSheet = estudio_closeInventarioSheet;
window.estudio_openPluginSheet = estudio_openPluginSheet;
window.estudio_closePluginSheet = estudio_closePluginSheet;

// =============================================
// PROPIEDADES MODULE
// =============================================
const PROPIEDADES_HEADERS = [
    'id', 'nombre', 'tipo', 'zona', 'metrosConstruccion', 'metrosTerreno',
    'valorCompra', 'valorCatastral', 'valorComercial', 'valorInvestigado', 'fuenteValoracion',
    'predialMensual', 'mantenimientoMensual', 'miPorcentaje',
    'fotoUrl', 'link1', 'link2',
    'escrituraNombre', 'escrituraUrl',
    'docExtra1Nombre', 'docExtra1Url',
    'docExtra2Nombre', 'docExtra2Url',
    'docExtra3Nombre', 'docExtra3Url',
    'ownersJson', 'deudasJson', 'ingresosJson',
    'updatedAt',
];

const PROPIEDADES_SEED_NAMES = [
    'Casa Galeria',
    'Casa Mexico',
    'Casa Victoria Mama',
    'Casa Laureles',
    'Casa Departamento Victoria',
    'Terreno Malanquin',
    'Terreno Teocaltiche',
];

const propiedadesState = {
    items: [],
    selectedId: '',
    loading: false,
    loaded: false,
    headers: PROPIEDADES_HEADERS.slice(),
    fixedSheetName: 'Hoja 1',
    deudasSheetName: 'Deudas',
    folderId: null,
};

function propiedades_bindEvents() {
    document.getElementById('prop-btn-add')?.addEventListener('click', () => propiedades_openSheet(null));
    document.getElementById('prop-sheet-overlay')?.addEventListener('click', propiedades_closeSheet);
    document.getElementById('prop-save')?.addEventListener('click', propiedades_save);
    document.getElementById('prop-delete')?.addEventListener('click', propiedades_deleteFromSheet);

    document.getElementById('prop-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-prop-id]');
        if (!btn) return;
        propiedadesState.selectedId = btn.dataset.propId || '';
        propiedades_render();
    });

    document.getElementById('prop-upload-foto')?.addEventListener('change', async () => {
        const url = await propiedades_uploadFirstFile('prop-upload-foto');
        if (url) document.getElementById('prop-foto-url').value = url;
    });
    document.getElementById('prop-upload-escritura')?.addEventListener('change', async () => {
        const url = await propiedades_uploadFirstFile('prop-upload-escritura');
        if (url) document.getElementById('prop-escritura-url').value = url;
    });
    document.getElementById('prop-upload-extra1')?.addEventListener('change', async () => {
        const url = await propiedades_uploadFirstFile('prop-upload-extra1');
        if (url) document.getElementById('prop-doc1-url').value = url;
    });
    document.getElementById('prop-upload-extra2')?.addEventListener('change', async () => {
        const url = await propiedades_uploadFirstFile('prop-upload-extra2');
        if (url) document.getElementById('prop-doc2-url').value = url;
    });
    document.getElementById('prop-upload-extra3')?.addEventListener('change', async () => {
        const url = await propiedades_uploadFirstFile('prop-upload-extra3');
        if (url) document.getElementById('prop-doc3-url').value = url;
    });

    document.getElementById('prop-open-sheet')?.addEventListener('click', () => {
        const selected = propiedades_getSelected();
        propiedades_openSheet(selected?.id || null);
    });
}

async function propiedades_cargarVista() {
    if (!accessToken || propiedadesState.loading) return;
    propiedadesState.loading = true;
    try {
        await autos_ensureSheet('Propiedades', PROPIEDADES_HEADERS);
        await propiedades_loadData();
        if (!propiedadesState.items.length) {
            await propiedades_seedInitialData();
            await propiedades_loadData();
        }
        if (!propiedadesState.selectedId && propiedadesState.items.length) {
            propiedadesState.selectedId = propiedadesState.items[0].id;
        }
        propiedades_render();
    } catch (e) {
        console.error('propiedades_cargarVista:', e);
        const detail = document.getElementById('prop-detail');
        if (detail) detail.innerHTML = '<div class="empty-state text-danger">❌ No se pudieron cargar propiedades</div>';
    } finally {
        propiedadesState.loading = false;
    }
}

async function propiedades_loadData() {
    const head = await sheetsGet(SPREADSHEET_AUTOS_ID, 'Propiedades!A1:AZ1').catch(() => []);
    const headers = (head[0] && head[0].length) ? head[0].map((x) => (x || '').toString().trim()) : PROPIEDADES_HEADERS.slice();
    propiedadesState.headers = headers;
    const rows = await sheetsGet(SPREADSHEET_AUTOS_ID, 'Propiedades!A2:AZ').catch(() => []);
    const map = autos_headersToMap(headers);
    propiedadesState.items = rows
        .map((row) => propiedades_rowToItem(row, map))
        .filter((x) => x.nombre);
    propiedadesState.loaded = true;
}

async function propiedades_seedInitialData() {
    const now = normalizeDateString(new Date().toLocaleDateString('en-CA'));
    const seeded = PROPIEDADES_SEED_NAMES.map((name, idx) => ({
        id: `prop-${Date.now()}-${idx + 1}`,
        nombre: name,
        tipo: name.toLowerCase().includes('terreno') ? 'Terreno' : 'Casa',
        zona: '',
        metrosConstruccion: '',
        metrosTerreno: '',
        valorCompra: '',
        valorCatastral: '',
        valorComercial: '',
        valorInvestigado: '',
        fuenteValoracion: 'Placeholder local (sin API)',
        predialMensual: '',
        mantenimientoMensual: '',
        miPorcentaje: '100',
        fotoUrl: '',
        link1: '',
        link2: '',
        escrituraNombre: 'Escrituras',
        escrituraUrl: '',
        docExtra1Nombre: 'Documento extra 1',
        docExtra1Url: '',
        docExtra2Nombre: 'Documento extra 2',
        docExtra2Url: '',
        docExtra3Nombre: 'Documento extra 3',
        docExtra3Url: '',
        ownersJson: JSON.stringify([{ name: 'Yo', percent: 100 }]),
        deudasJson: JSON.stringify([]),
        ingresosJson: JSON.stringify([]),
        updatedAt: now,
    }));
    const letter = autos_colLetter(PROPIEDADES_HEADERS.length);
    await sheetsUpdate(
        SPREADSHEET_AUTOS_ID,
        `Propiedades!A2:${letter}${1 + seeded.length}`,
        seeded.map((item) => propiedades_itemToRow(item, PROPIEDADES_HEADERS))
    );
}

function propiedades_getCell(row, map, key, fallback = '') {
    const idx = map[key];
    if (idx === undefined) return fallback;
    return row[idx] ?? fallback;
}

function propiedades_rowToItem(row, map) {
    const parseJson = (raw, fallback) => {
        try {
            const parsed = JSON.parse((raw || '').toString());
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    };
    return {
        id: (propiedades_getCell(row, map, 'id', '') || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).toString(),
        nombre: (propiedades_getCell(row, map, 'nombre', '') || '').toString(),
        tipo: (propiedades_getCell(row, map, 'tipo', 'Casa') || 'Casa').toString(),
        zona: (propiedades_getCell(row, map, 'zona', '') || '').toString(),
        metrosConstruccion: (propiedades_getCell(row, map, 'metrosConstruccion', '') || '').toString(),
        metrosTerreno: (propiedades_getCell(row, map, 'metrosTerreno', '') || '').toString(),
        valorCompra: (propiedades_getCell(row, map, 'valorCompra', '') || '').toString(),
        valorCatastral: (propiedades_getCell(row, map, 'valorCatastral', '') || '').toString(),
        valorComercial: (propiedades_getCell(row, map, 'valorComercial', '') || '').toString(),
        valorInvestigado: (propiedades_getCell(row, map, 'valorInvestigado', '') || '').toString(),
        fuenteValoracion: (propiedades_getCell(row, map, 'fuenteValoracion', 'Placeholder local (sin API)') || 'Placeholder local (sin API)').toString(),
        predialMensual: (propiedades_getCell(row, map, 'predialMensual', '') || '').toString(),
        mantenimientoMensual: (propiedades_getCell(row, map, 'mantenimientoMensual', '') || '').toString(),
        miPorcentaje: (propiedades_getCell(row, map, 'miPorcentaje', '100') || '100').toString(),
        fotoUrl: (propiedades_getCell(row, map, 'fotoUrl', '') || '').toString(),
        link1: (propiedades_getCell(row, map, 'link1', '') || '').toString(),
        link2: (propiedades_getCell(row, map, 'link2', '') || '').toString(),
        escrituraNombre: (propiedades_getCell(row, map, 'escrituraNombre', 'Escrituras') || 'Escrituras').toString(),
        escrituraUrl: (propiedades_getCell(row, map, 'escrituraUrl', '') || '').toString(),
        docExtra1Nombre: (propiedades_getCell(row, map, 'docExtra1Nombre', 'Documento extra 1') || 'Documento extra 1').toString(),
        docExtra1Url: (propiedades_getCell(row, map, 'docExtra1Url', '') || '').toString(),
        docExtra2Nombre: (propiedades_getCell(row, map, 'docExtra2Nombre', 'Documento extra 2') || 'Documento extra 2').toString(),
        docExtra2Url: (propiedades_getCell(row, map, 'docExtra2Url', '') || '').toString(),
        docExtra3Nombre: (propiedades_getCell(row, map, 'docExtra3Nombre', 'Documento extra 3') || 'Documento extra 3').toString(),
        docExtra3Url: (propiedades_getCell(row, map, 'docExtra3Url', '') || '').toString(),
        owners: parseJson(propiedades_getCell(row, map, 'ownersJson', '[]'), []),
        deudas: parseJson(propiedades_getCell(row, map, 'deudasJson', '[]'), []),
        ingresos: parseJson(propiedades_getCell(row, map, 'ingresosJson', '[]'), []),
        updatedAt: (propiedades_getCell(row, map, 'updatedAt', '') || '').toString(),
    };
}

function propiedades_itemToRow(item, headers) {
    const fields = {
        id: item.id || '',
        nombre: item.nombre || '',
        tipo: item.tipo || 'Casa',
        zona: item.zona || '',
        metrosConstruccion: item.metrosConstruccion || '',
        metrosTerreno: item.metrosTerreno || '',
        valorCompra: item.valorCompra || '',
        valorCatastral: item.valorCatastral || '',
        valorComercial: item.valorComercial || '',
        valorInvestigado: item.valorInvestigado || '',
        fuenteValoracion: item.fuenteValoracion || 'Placeholder local (sin API)',
        predialMensual: item.predialMensual || '',
        mantenimientoMensual: item.mantenimientoMensual || '',
        miPorcentaje: item.miPorcentaje || '100',
        fotoUrl: item.fotoUrl || '',
        link1: item.link1 || '',
        link2: item.link2 || '',
        escrituraNombre: item.escrituraNombre || 'Escrituras',
        escrituraUrl: item.escrituraUrl || '',
        docExtra1Nombre: item.docExtra1Nombre || 'Documento extra 1',
        docExtra1Url: item.docExtra1Url || '',
        docExtra2Nombre: item.docExtra2Nombre || 'Documento extra 2',
        docExtra2Url: item.docExtra2Url || '',
        docExtra3Nombre: item.docExtra3Nombre || 'Documento extra 3',
        docExtra3Url: item.docExtra3Url || '',
        ownersJson: JSON.stringify(Array.isArray(item.owners) ? item.owners : []),
        deudasJson: JSON.stringify(Array.isArray(item.deudas) ? item.deudas : []),
        ingresosJson: JSON.stringify(Array.isArray(item.ingresos) ? item.ingresos : []),
        updatedAt: item.updatedAt || normalizeDateString(new Date().toLocaleDateString('en-CA')),
    };
    return headers.map((h) => fields[h] ?? '');
}

function propiedades_getSelected() {
    return propiedadesState.items.find((x) => x.id === propiedadesState.selectedId) || propiedadesState.items[0] || null;
}

function propiedades_render() {
    const tabsEl = document.getElementById('prop-tabs');
    const detailEl = document.getElementById('prop-detail');
    const totalEl = document.getElementById('prop-total-valor');
    const deudaEl = document.getElementById('prop-total-deudas');
    const fijosEl = document.getElementById('prop-total-fijos');
    const ingresoEl = document.getElementById('prop-total-ingresos');
    if (!tabsEl || !detailEl) return;

    const totalValor = propiedadesState.items.reduce((sum, p) => sum + propiedades_valorComercialCalculado(p), 0);
    const totalDeuda = propiedadesState.items.reduce((sum, p) => sum + propiedades_totalDeuda(p), 0);
    const totalFijos = propiedadesState.items.reduce((sum, p) => sum + Math.max(0, parseSheetValue(p.predialMensual)) + Math.max(0, parseSheetValue(p.mantenimientoMensual)), 0);
    const totalIngresos = propiedadesState.items.reduce((sum, p) => sum + propiedades_ingresoMiParte(p), 0);
    if (totalEl) totalEl.innerText = formatCurrency(totalValor);
    if (deudaEl) deudaEl.innerText = totalDeuda > 0 ? `-${formatCurrency(totalDeuda)}` : formatCurrency(0);
    if (fijosEl) fijosEl.innerText = formatCurrency(totalFijos);
    if (ingresoEl) ingresoEl.innerText = `+${formatCurrency(totalIngresos)}`;

    tabsEl.innerHTML = propiedadesState.items.map((p) => {
        const active = p.id === propiedadesState.selectedId ? 'active' : '';
        return `<button class="estudio-subtab-btn ${active}" data-prop-id="${p.id}" type="button">${p.nombre}</button>`;
    }).join('');

    const selected = propiedades_getSelected();
    if (!selected) {
        detailEl.innerHTML = '<div class="empty-state">Sin propiedades registradas</div>';
        return;
    }
    const debtTotal = propiedades_totalDeuda(selected);
    const ingresoTotal = propiedades_totalIngreso(selected);
    const miIngreso = propiedades_ingresoMiParte(selected);
    const miPorcentaje = Math.max(0, Math.min(100, parseSheetValue(selected.miPorcentaje || '100')));
    const owners = Array.isArray(selected.owners) ? selected.owners : [];
    const ownerRows = owners.length
        ? owners.map((o) => {
            const percent = Math.max(0, parseSheetValue(o.percent));
            const debtPart = debtTotal * (percent / 100);
            const ingresoPart = ingresoTotal * (percent / 100);
            return `<div class="plan-bucket-row"><span>${o.name || 'Sin nombre'} (${percent.toFixed(2)}%)</span><strong>Deuda: ${formatCurrency(debtPart)} · Ingreso: ${formatCurrency(ingresoPart)}</strong></div>`;
        }).join('')
        : '<div class="empty-state" style="padding:.6rem 0;">Sin dueños capturados</div>';
    const debtsRows = (selected.deudas || []).length
        ? selected.deudas.map((d) => `<div class="plan-expense-row"><div><div class="plan-expense-title">${d.concepto || 'Deuda'}</div></div><div class="plan-expense-amount text-danger">-${formatCurrency(parseSheetValue(d.monto))}</div></div>`).join('')
        : '<div class="empty-state" style="padding:.6rem 0;">Sin deudas de propiedad</div>';
    const incomeRows = (selected.ingresos || []).length
        ? selected.ingresos.map((d) => `<div class="plan-expense-row"><div><div class="plan-expense-title">${d.concepto || 'Ingreso'}</div></div><div class="plan-expense-amount text-success">+${formatCurrency(parseSheetValue(d.monto))}</div></div>`).join('')
        : '<div class="empty-state" style="padding:.6rem 0;">Sin ingresos de propiedad</div>';

    const docs = [
        { name: selected.escrituraNombre || 'Escrituras', url: selected.escrituraUrl || '' },
        { name: selected.docExtra1Nombre || 'Documento extra 1', url: selected.docExtra1Url || '' },
        { name: selected.docExtra2Nombre || 'Documento extra 2', url: selected.docExtra2Url || '' },
        { name: selected.docExtra3Nombre || 'Documento extra 3', url: selected.docExtra3Url || '' },
    ];
    const docsRows = docs
        .map((d) => d.url ? `<a class="recibo-link" href="${d.url}" target="_blank" rel="noopener">📎 ${d.name}</a>` : '')
        .filter(Boolean)
        .join('') || '<div class="empty-state" style="padding:.6rem 0;">Sin documentos cargados</div>';

    detailEl.innerHTML = `
      <div class="estudio-entry-card propiedades-card">
        <div class="estudio-entry-top">
          <div>
            <div class="estudio-entry-title">${selected.nombre}</div>
            <div class="estudio-entry-meta">${selected.tipo || 'Propiedad'} · ${selected.zona || 'Zona pendiente'} · ${selected.metrosConstruccion || 0}m² construcción · ${selected.metrosTerreno || 0}m² terreno</div>
          </div>
          <button id="prop-edit-selected" class="mini-btn">✏️ Editar</button>
        </div>

        <div class="estudio-entry-grid">
          <div class="plan-bucket-row"><span>Valor compra</span><strong>${formatCurrency(parseSheetValue(selected.valorCompra))}</strong></div>
          <div class="plan-bucket-row"><span>Valor catastral</span><strong>${formatCurrency(parseSheetValue(selected.valorCatastral))}</strong></div>
          <div class="plan-bucket-row"><span>Valor comercial</span><strong>${formatCurrency(propiedades_valorComercialCalculado(selected))}</strong></div>
          <div class="plan-bucket-row"><span>Valor investigado</span><strong>${formatCurrency(parseSheetValue(selected.valorInvestigado))}</strong></div>
          <div class="plan-bucket-row"><span>Predial mensual</span><strong class="text-danger">-${formatCurrency(parseSheetValue(selected.predialMensual))}</strong></div>
          <div class="plan-bucket-row"><span>Mantenimiento mensual</span><strong class="text-danger">-${formatCurrency(parseSheetValue(selected.mantenimientoMensual))}</strong></div>
          <div class="plan-bucket-row"><span>Deuda total</span><strong class="text-danger">-${formatCurrency(debtTotal)}</strong></div>
          <div class="plan-bucket-row"><span>Ingreso total</span><strong class="text-success">+${formatCurrency(ingresoTotal)}</strong></div>
          <div class="plan-bucket-row"><span>Mi porcentaje</span><strong>${miPorcentaje.toFixed(2)}%</strong></div>
          <div class="plan-bucket-row"><span>Mi parte ingreso</span><strong class="text-success">+${formatCurrency(miIngreso)}</strong></div>
        </div>

        <div class="estudio-entry-notes">${selected.fuenteValoracion || 'Placeholder local (sin API externa). La valoración automática se basa en zona + m2 de construcción + m2 de terreno y puede variar.'}</div>

        ${selected.fotoUrl ? `<a href="${selected.fotoUrl}" target="_blank" rel="noopener">${propiedades_docPreview(selected.fotoUrl, selected.nombre)}</a>` : '<div class="empty-state" style="padding:.6rem 0;">Sin foto de propiedad</div>'}

        <div class="plan-buckets">
          <div class="bs-label" style="margin-bottom:.35rem;">Dueños y porcentaje</div>
          ${ownerRows}
        </div>

        <div class="plan-expenses-list">
          <div class="bs-label" style="margin-bottom:.35rem;">Deudas de la propiedad (sincronizadas en pestaña Deudas)</div>
          ${debtsRows}
        </div>

        <div class="plan-expenses-list">
          <div class="bs-label" style="margin-bottom:.35rem;">Ingresos de la propiedad</div>
          ${incomeRows}
        </div>

        <div class="plan-expenses-list">
          <div class="bs-label" style="margin-bottom:.35rem;">Enlaces y documentos</div>
          ${selected.link1 ? `<a class="recibo-link" href="${selected.link1}" target="_blank" rel="noopener">🔗 Link 1</a>` : ''}
          ${selected.link2 ? `<a class="recibo-link" href="${selected.link2}" target="_blank" rel="noopener">🔗 Link 2</a>` : ''}
          ${docsRows}
        </div>
      </div>
    `;

    document.getElementById('prop-edit-selected')?.addEventListener('click', () => propiedades_openSheet(selected.id));
}

function propiedades_docPreview(url, label) {
    const raw = (url || '').toString().trim();
    if (!raw) return '';
    const img = autos_previewUrlForImage(raw);
    return `<img src="${img}" alt="${label}" style="width:100%;max-height:220px;object-fit:cover;border-radius:.65rem;background:rgba(255,255,255,.05);" />`;
}

function propiedades_openSheet(id) {
    const item = id ? propiedadesState.items.find((x) => x.id === id) : null;
    const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('prop-edit-id').value = item?.id || '';
    document.getElementById('prop-sheet-title').innerText = item ? 'Editar propiedad' : 'Nueva propiedad';
    document.getElementById('prop-nombre').value = item?.nombre || '';
    document.getElementById('prop-tipo').value = item?.tipo || 'Casa';
    document.getElementById('prop-zona').value = item?.zona || '';
    document.getElementById('prop-m2-construccion').value = item?.metrosConstruccion || '';
    document.getElementById('prop-m2-terreno').value = item?.metrosTerreno || '';
    document.getElementById('prop-valor-compra').value = item?.valorCompra || '';
    document.getElementById('prop-valor-catastral').value = item?.valorCatastral || '';
    document.getElementById('prop-valor-comercial').value = item?.valorComercial || '';
    document.getElementById('prop-valor-investigado').value = item?.valorInvestigado || '';
    document.getElementById('prop-fuente').value = item?.fuenteValoracion || 'Placeholder local (sin API)';
    document.getElementById('prop-predial').value = item?.predialMensual || '';
    document.getElementById('prop-mantenimiento').value = item?.mantenimientoMensual || '';
    document.getElementById('prop-mi-porcentaje').value = item?.miPorcentaje || '100';
    document.getElementById('prop-foto-url').value = item?.fotoUrl || '';
    document.getElementById('prop-link1').value = item?.link1 || '';
    document.getElementById('prop-link2').value = item?.link2 || '';
    document.getElementById('prop-escritura-nombre').value = item?.escrituraNombre || 'Escrituras';
    document.getElementById('prop-escritura-url').value = item?.escrituraUrl || '';
    document.getElementById('prop-doc1-nombre').value = item?.docExtra1Nombre || 'Documento extra 1';
    document.getElementById('prop-doc1-url').value = item?.docExtra1Url || '';
    document.getElementById('prop-doc2-nombre').value = item?.docExtra2Nombre || 'Documento extra 2';
    document.getElementById('prop-doc2-url').value = item?.docExtra2Url || '';
    document.getElementById('prop-doc3-nombre').value = item?.docExtra3Nombre || 'Documento extra 3';
    document.getElementById('prop-doc3-url').value = item?.docExtra3Url || '';

    const ownerLines = (item?.owners || []).map((x) => `${x.name || ''}|${parseSheetValue(x.percent)}`).join('\n');
    const debtLines = (item?.deudas || []).map((x) => `${x.concepto || ''}|${parseSheetValue(x.monto)}`).join('\n');
    const incomeLines = (item?.ingresos || []).map((x) => `${x.concepto || ''}|${parseSheetValue(x.monto)}`).join('\n');
    document.getElementById('prop-owners').value = ownerLines;
    document.getElementById('prop-deudas').value = debtLines;
    document.getElementById('prop-ingresos').value = incomeLines;
    document.getElementById('prop-sync-month').value = nowMonth;

    document.getElementById('prop-delete')?.classList.toggle('hidden', !item);
    document.getElementById('prop-sheet').classList.remove('hidden');
}

function propiedades_closeSheet() {
    document.getElementById('prop-sheet').classList.add('hidden');
}

function propiedades_parseOwnerLines(raw) {
    const lines = (raw || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const owners = lines.map((line) => {
        const parts = line.split('|');
        return {
            name: (parts[0] || '').trim(),
            percent: Math.max(0, parseSheetValue(parts[1] || 0)),
        };
    }).filter((x) => x.name);
    if (!owners.length) return [{ name: 'Yo', percent: 100 }];
    return owners;
}

function propiedades_parseMoneyLines(raw) {
    return (raw || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((line) => {
            const parts = line.split('|');
            return {
                concepto: (parts[0] || '').trim(),
                monto: Math.max(0, parseSheetValue(parts[1] || 0)),
            };
        })
        .filter((x) => x.concepto && x.monto > 0);
}

function propiedades_estimarValorComercial(input) {
    const compra = Math.max(0, parseSheetValue(input.valorCompra));
    const m2c = Math.max(0, parseSheetValue(input.metrosConstruccion));
    const m2t = Math.max(0, parseSheetValue(input.metrosTerreno));
    const zona = (input.zona || '').toString().toLowerCase();
    let zoneFactor = 1;
    if (zona.includes('premium') || zona.includes('centro') || zona.includes('victoria')) zoneFactor = 1.15;
    if (zona.includes('terreno') || zona.includes('rural')) zoneFactor = 0.92;
    const base = compra + (m2c * 8200) + (m2t * 2900);
    return Math.round(base * zoneFactor);
}

function propiedades_valorComercialCalculado(item) {
    const manual = Math.max(0, parseSheetValue(item.valorComercial));
    if (manual > 0) return manual;
    return propiedades_estimarValorComercial(item);
}

function propiedades_totalDeuda(item) {
    return (item.deudas || []).reduce((sum, d) => sum + Math.max(0, parseSheetValue(d.monto)), 0);
}

function propiedades_totalIngreso(item) {
    return (item.ingresos || []).reduce((sum, d) => sum + Math.max(0, parseSheetValue(d.monto)), 0);
}

function propiedades_ingresoMiParte(item) {
    const pct = Math.max(0, Math.min(100, parseSheetValue(item.miPorcentaje || 100)));
    return propiedades_totalIngreso(item) * (pct / 100);
}

async function propiedades_save() {
    const btn = document.getElementById('prop-save');
    const editId = (document.getElementById('prop-edit-id').value || '').trim();
    const nombre = (document.getElementById('prop-nombre').value || '').trim();
    if (!nombre) {
        alert('Agrega el nombre de la propiedad');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'Guardando...';
    try {
        const owners = propiedades_parseOwnerLines(document.getElementById('prop-owners').value);
        const deudas = propiedades_parseMoneyLines(document.getElementById('prop-deudas').value);
        const ingresos = propiedades_parseMoneyLines(document.getElementById('prop-ingresos').value);
        const payload = {
            id: editId || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            nombre,
            tipo: document.getElementById('prop-tipo').value || 'Casa',
            zona: (document.getElementById('prop-zona').value || '').trim(),
            metrosConstruccion: (document.getElementById('prop-m2-construccion').value || '').trim(),
            metrosTerreno: (document.getElementById('prop-m2-terreno').value || '').trim(),
            valorCompra: (document.getElementById('prop-valor-compra').value || '').trim(),
            valorCatastral: (document.getElementById('prop-valor-catastral').value || '').trim(),
            valorComercial: (document.getElementById('prop-valor-comercial').value || '').trim(),
            valorInvestigado: (document.getElementById('prop-valor-investigado').value || '').trim(),
            fuenteValoracion: (document.getElementById('prop-fuente').value || '').trim() || 'Placeholder local (sin API)',
            predialMensual: (document.getElementById('prop-predial').value || '').trim(),
            mantenimientoMensual: (document.getElementById('prop-mantenimiento').value || '').trim(),
            miPorcentaje: (document.getElementById('prop-mi-porcentaje').value || '100').trim(),
            fotoUrl: (document.getElementById('prop-foto-url').value || '').trim(),
            link1: (document.getElementById('prop-link1').value || '').trim(),
            link2: (document.getElementById('prop-link2').value || '').trim(),
            escrituraNombre: (document.getElementById('prop-escritura-nombre').value || 'Escrituras').trim(),
            escrituraUrl: (document.getElementById('prop-escritura-url').value || '').trim(),
            docExtra1Nombre: (document.getElementById('prop-doc1-nombre').value || 'Documento extra 1').trim(),
            docExtra1Url: (document.getElementById('prop-doc1-url').value || '').trim(),
            docExtra2Nombre: (document.getElementById('prop-doc2-nombre').value || 'Documento extra 2').trim(),
            docExtra2Url: (document.getElementById('prop-doc2-url').value || '').trim(),
            docExtra3Nombre: (document.getElementById('prop-doc3-nombre').value || 'Documento extra 3').trim(),
            docExtra3Url: (document.getElementById('prop-doc3-url').value || '').trim(),
            owners,
            deudas,
            ingresos,
            updatedAt: normalizeDateString(new Date().toLocaleDateString('en-CA')),
        };

        const idx = propiedadesState.items.findIndex((x) => x.id === payload.id);
        if (idx === -1) propiedadesState.items.push(payload);
        else propiedadesState.items[idx] = payload;
        propiedadesState.selectedId = payload.id;

        await propiedades_saveSheet();
        await propiedades_syncPropertyRemotes(payload);
        tabInited.fijos = false;
        tabInited.deudas = false;
        deudasState.loaded = false;
        planner_refreshIfReady();
        if (currentTab === 'fijos') fijos_cargarDatos();
        if (currentTab === 'deudas') deudas_cargarDatos();
        propiedades_closeSheet();
        propiedades_render();
        showToast('✅ Propiedad guardada y sincronizada');
    } catch (e) {
        console.error('propiedades_save:', e);
        alert('❌ Error al guardar propiedad');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar propiedad';
    }
}

async function propiedades_saveSheet() {
    const headers = propiedadesState.headers?.length ? propiedadesState.headers : PROPIEDADES_HEADERS;
    const merged = [...headers.filter(Boolean)];
    PROPIEDADES_HEADERS.forEach((h) => {
        if (!merged.includes(h)) merged.push(h);
    });
    propiedadesState.headers = merged;
    const letter = autos_colLetter(merged.length);
    await sheetsUpdate(SPREADSHEET_AUTOS_ID, `Propiedades!A1:${letter}1`, [merged]);
    if (!propiedadesState.items.length) {
        await sheetsClear(SPREADSHEET_AUTOS_ID, 'Propiedades!A2:AZ');
        return;
    }
    await sheetsUpdate(
        SPREADSHEET_AUTOS_ID,
        `Propiedades!A2:${letter}${1 + propiedadesState.items.length}`,
        propiedadesState.items.map((item) => propiedades_itemToRow(item, merged))
    );
    await sheetsClear(SPREADSHEET_AUTOS_ID, `Propiedades!A${2 + propiedadesState.items.length}:AZ`);
}

async function propiedades_deleteFromSheet() {
    const id = (document.getElementById('prop-edit-id').value || '').trim();
    if (!id) return;
    const item = propiedadesState.items.find((x) => x.id === id);
    if (!item) return;
    if (!confirm('¿Eliminar esta propiedad y sus remotos?')) return;
    propiedadesState.items = propiedadesState.items.filter((x) => x.id !== id);
    if (propiedadesState.selectedId === id) propiedadesState.selectedId = propiedadesState.items[0]?.id || '';
    try {
        await propiedades_saveSheet();
        await propiedades_removePropertyRemotes(id);
        tabInited.fijos = false;
        tabInited.deudas = false;
        deudasState.loaded = false;
        planner_refreshIfReady();
        if (currentTab === 'fijos') fijos_cargarDatos();
        if (currentTab === 'deudas') deudas_cargarDatos();
        propiedades_closeSheet();
        propiedades_render();
        showToast('🗑️ Propiedad eliminada');
    } catch (e) {
        console.error('propiedades_deleteFromSheet:', e);
        alert('❌ Error al eliminar propiedad');
    }
}

async function propiedades_syncPropertyRemotes(item) {
    await propiedades_syncDeudas(item);
    const day = Math.max(1, Math.min(31, new Date().getDate()));
    const monthStart = parseStartMonth(document.getElementById('prop-sync-month')?.value || '');
    await propiedades_upsertFijoByMarker(item, 'predial', {
        monto: Math.max(0, parseSheetValue(item.predialMensual)),
        tipo: 'gasto',
        concepto: `Propiedad: ${item.nombre} - Predial`,
        categoria: 'Propiedades, Predial',
        budgetCategory: 'Mantenimiento y Pago de Servicios',
        day,
        monthStart,
    });
    await propiedades_upsertFijoByMarker(item, 'mantenimiento', {
        monto: Math.max(0, parseSheetValue(item.mantenimientoMensual)),
        tipo: 'gasto',
        concepto: `Propiedad: ${item.nombre} - Mantenimiento`,
        categoria: 'Propiedades, Mantenimiento',
        budgetCategory: 'Mantenimiento y Pago de Servicios',
        day,
        monthStart,
    });
    await propiedades_upsertFijoByMarker(item, 'ingreso', {
        monto: Math.max(0, propiedades_ingresoMiParte(item)),
        tipo: 'ingreso',
        concepto: `Propiedad: ${item.nombre} - Ingreso (mi parte)`,
        categoria: 'Propiedades, Ingreso',
        budgetCategory: 'Mantenimiento y Pago de Servicios',
        day,
        monthStart,
    });
}

async function propiedades_removePropertyRemotes(propertyId) {
    await propiedades_removeDeudasByPrefix(`[PROP-DEBT:${propertyId}:`);
    await propiedades_removeFijosByPrefix(`[PROP-FIX:${propertyId}:`);
}

async function propiedades_getDeudasSheetName() {
    try {
        await sheetsGet(SPREADSHEET_DEUDAS_ID, 'Deudas!A1:A1');
        propiedadesState.deudasSheetName = 'Deudas';
    } catch (_) {
        propiedadesState.deudasSheetName = 'Hoja 1';
    }
    return propiedadesState.deudasSheetName;
}

async function propiedades_syncDeudas(item) {
    await propiedades_removeDeudasByPrefix(`[PROP-DEBT:${item.id}:`);
    const sheetName = await propiedades_getDeudasSheetName();
    const deudas = (item.deudas || []).filter((d) => parseSheetValue(d.monto) > 0 && (d.concepto || '').trim());
    if (!deudas.length) return;
    const rows = deudas.map((d, idx) => [
        `${item.nombre} - ${d.concepto} [PROP-DEBT:${item.id}:${idx + 1}]`,
        Math.abs(parseSheetValue(d.monto)),
    ]);
    await sheetsAppend(SPREADSHEET_DEUDAS_ID, `${sheetName}!A:B`, rows);
}

async function propiedades_removeDeudasByPrefix(prefix) {
    const sheetName = await propiedades_getDeudasSheetName();
    const rows = await sheetsGet(SPREADSHEET_DEUDAS_ID, `${sheetName}!A2:B`).catch(() => []);
    if (!rows.length) return;
    const rowIndexes = [];
    for (let i = 0; i < rows.length; i++) {
        const concepto = (rows[i][0] || '').toString();
        if (concepto.includes(prefix)) rowIndexes.push(i + 1);
    }
    if (!rowIndexes.length) return;
    const sheetId = await getSheetId(SPREADSHEET_DEUDAS_ID, sheetName);
    for (let i = rowIndexes.length - 1; i >= 0; i--) {
        await sheetsDeleteRow(SPREADSHEET_DEUDAS_ID, sheetId, rowIndexes[i]);
    }
}

async function propiedades_upsertFijoByMarker(item, key, config) {
    const marker = `[PROP-FIX:${item.id}:${key}]`;
    const rows = await sheetsGet(SPREADSHEET_FIXED_ID, `${propiedadesState.fixedSheetName}!A2:N`).catch(() => []);
    const foundIdx = rows.findIndex((row) => ((row[1] || '').toString()).includes(marker));
    const monto = Math.max(0, parseSheetValue(config.monto));
    const rowData = [
        String(Math.max(1, Math.min(31, parseDayOfMonth(config.day)))),
        `${config.concepto} ${marker}`,
        config.tipo === 'gasto' ? monto : '',
        config.tipo === 'ingreso' ? monto : '',
        config.categoria || 'Propiedades',
        'FALSE',
        1,
        serializePaymentStates([false]),
        'mensual',
        config.monthStart || parseStartMonth(''),
        'yo',
        config.budgetCategory || 'Mantenimiento y Pago de Servicios',
        'MXN',
        serializePaymentStates([false]),
    ];
    if (monto <= 0) {
        if (foundIdx !== -1) {
            const sheetId = await getSheetId(SPREADSHEET_FIXED_ID, propiedadesState.fixedSheetName);
            await sheetsDeleteRow(SPREADSHEET_FIXED_ID, sheetId, foundIdx + 1);
        }
        return;
    }
    if (foundIdx === -1) {
        await sheetsAppend(SPREADSHEET_FIXED_ID, `${propiedadesState.fixedSheetName}!A:N`, [rowData]);
        return;
    }
    const rowNum = foundIdx + 2;
    await sheetsUpdate(SPREADSHEET_FIXED_ID, `${propiedadesState.fixedSheetName}!A${rowNum}:N${rowNum}`, [rowData]);
}

async function propiedades_removeFijosByPrefix(prefix) {
    const rows = await sheetsGet(SPREADSHEET_FIXED_ID, `${propiedadesState.fixedSheetName}!A2:N`).catch(() => []);
    if (!rows.length) return;
    const rowIndexes = [];
    for (let i = 0; i < rows.length; i++) {
        const concepto = (rows[i][1] || '').toString();
        if (concepto.includes(prefix)) rowIndexes.push(i + 1);
    }
    if (!rowIndexes.length) return;
    const sheetId = await getSheetId(SPREADSHEET_FIXED_ID, propiedadesState.fixedSheetName);
    for (let i = rowIndexes.length - 1; i >= 0; i--) {
        await sheetsDeleteRow(SPREADSHEET_FIXED_ID, sheetId, rowIndexes[i]);
    }
}

async function propiedades_ensureFolder() {
    if (propiedadesState.folderId) return propiedadesState.folderId;
    const found = await driveFindFolder('FinanceDashboard_PropiedadesDocs');
    if (found) {
        propiedadesState.folderId = found;
        return found;
    }
    const created = await driveCreateFolder('FinanceDashboard_PropiedadesDocs');
    propiedadesState.folderId = created;
    return created;
}

async function propiedades_uploadFirstFile(inputId) {
    const input = document.getElementById(inputId);
    const files = input?.files;
    if (!files || !files.length) return '';
    const first = files[0];
    const folderId = await propiedades_ensureFolder();
    const link = await driveUploadFile(first, folderId);
    const feedback = document.getElementById('prop-file-feedback');
    if (feedback) feedback.innerText = `✅ Archivo cargado: ${first.name}`;
    input.value = '';
    return link;
}

// =============================================
// UTILITIES
// =============================================
function formatCurrency(val) {
    return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(val || 0);
}
function formatFecha(str) {
    if (!str) return '';
    const d = new Date(str);
    return isNaN(d) ? str : d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
}

function parseSheetValue(val) {
    if (typeof val === 'number') return val;
    if (!val || typeof val !== 'string') return 0;
    // Remove currency symbols, commas and spaces. Keep digits, dot and minus sign.
    const clean = val.replace(/[^\d.-]/g, '');
    return parseFloat(clean) || 0;
}

/** Handle boolean values returned by UNFORMATTED_VALUE for checkboxes */
function parseBool(val) {
    if (typeof val === 'boolean') return val;
    return (val || '').toString().toUpperCase() === 'TRUE';
}

function normalizeTipo(val) {
    const v = (val || '').toString().trim().toLowerCase();
    return v === 'ingreso' ? 'Ingreso' : 'Gasto';
}

function parsePaymentsTotal(val) {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) return 1;
    return Math.min(5, Math.max(1, n));
}

function serializePaymentStates(states) {
    return (states || []).map(v => (v ? '1' : '0')).join('');
}

function parsePaymentStates(raw, total, legacyPaid = false) {
    const count = parsePaymentsTotal(total);
    if (!raw && legacyPaid) return new Array(count).fill(true);
    const chars = (raw || '').toString().replace(/[^01]/g, '').slice(0, count).split('');
    const states = new Array(count).fill(false);
    for (let i = 0; i < chars.length; i++) states[i] = chars[i] === '1';
    return states;
}

function parseWaiveStates(raw, total, paidStates = []) {
    const count = parsePaymentsTotal(total);
    const chars = (raw || '').toString().replace(/[^01]/g, '').slice(0, count).split('');
    const states = new Array(count).fill(false);
    for (let i = 0; i < chars.length; i++) states[i] = chars[i] === '1';
    for (let i = 0; i < count; i++) {
        if (!paidStates[i]) states[i] = false;
    }
    return states;
}

/** Parse a date that may be a Google Sheets serial number or an ISO/DD/MM/YYYY string AND RETURNS A JS DATE */
function parseSheetDate(val) {
    if (!val) return new Date();
    
    if (typeof val === 'number') {
        const utc = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
        return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    
    const str = String(val).trim();
    if (str.includes('/')) {
        const p = str.split('/');
        if (p.length === 3) {
            // Assume DD/MM/YYYY
            return new Date(p[2], parseInt(p[1],10)-1, p[0]);
        }
    }
    
    const d = new Date(str);
    return isNaN(d) ? new Date() : d;
}

function parseDayOfMonth(val) {
    if (val === null || val === undefined || val === '') return 1;
    if (typeof val === 'number') {
        if (val >= 1 && val <= 31) return Math.floor(val);
        const d = parseSheetDate(val);
        const day = d.getDate();
        return Math.min(31, Math.max(1, day || 1));
    }
    const str = String(val).trim();
    if (/^\d{1,2}$/.test(str)) {
        return Math.min(31, Math.max(1, parseInt(str, 10)));
    }
    const d = parseSheetDate(str);
    const day = d.getDate();
    return Math.min(31, Math.max(1, day || 1));
}

function parseFixedPeriodicity(val) {
    const raw = (val || '').toString().trim().toLowerCase();
    return raw === 'bimestral' ? 'bimestral' : 'mensual';
}

function parseStartMonth(val, fallback = null) {
    const raw = (val || '').toString().trim();
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    const ref = fallback || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    return ref;
}

function monthDiff(fromYm, toYm) {
    const [fy, fm] = fromYm.split('-').map(Number);
    const [ty, tm] = toYm.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm);
}

function isFixedDueThisMonth(periodicity, startMonth, nowMonth) {
    if (periodicity !== 'bimestral') return true;
    const diff = monthDiff(startMonth, nowMonth);
    if (diff < 0) return false;
    return diff % 2 === 0;
}

function parseFixedPayer(val) {
    const raw = (val || '').toString().trim().toLowerCase();
    return raw === 'esposa' ? 'esposa' : 'yo';
}

function parseBudgetCategory(val) {
    const raw = (val || '').toString().trim();
    return BUDGET_BUCKETS.includes(raw) ? raw : BUDGET_BUCKETS[0];
}

function parseCurrencyCode(val) {
    const raw = (val || '').toString().trim().toUpperCase();
    return raw === 'USD' ? 'USD' : 'MXN';
}

function convertTransactionAmountToMxn(amount, currency) {
    const abs = Math.abs(parseSheetValue(amount));
    return parseCurrencyCode(currency) === 'USD' ? balance_convertToMxn(abs, 'USD') : abs;
}

async function ensureUsdMxnRateForTransactions() {
    try {
        if (balanceUsdMxnRate && balanceUsdMxnRate > 0) return;
        const today = new Date().toISOString().slice(0, 10);
        const raw = localStorage.getItem(FX_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.date === today && Number(parsed?.rate) > 0) {
                balanceUsdMxnRate = Number(parsed.rate);
                return;
            }
        }
        if (balanceFxFetchInFlight) return;
        balanceFxFetchInFlight = true;
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) return;
        const data = await res.json();
        const rate = Number(data?.rates?.MXN);
        if (!rate || Number.isNaN(rate)) return;
        balanceUsdMxnRate = rate;
        localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ date: today, rate }));
    } catch (_) {
        // keep fallback behavior if exchange rate API fails
    } finally {
        balanceFxFetchInFlight = false;
    }
}

/** Format a parsed date string into YYYY-MM-DD */
function normalizeDateString(val) {
    const d = parseSheetDate(val);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function showToast(msg, duration = 3000) {
    const t = document.createElement('div');
    t.innerText = msg;
    t.className = 'toast-msg';
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 100);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, duration);
}

// =============================================
// DEUDAS MODULE
// =============================================
let deudasState = {
    allItems: [],
    sheetId: null,
    loaded: false,
    loading: false,
};

function deudas_getTotalAmount() {
    return deudasState.allItems.reduce((s, i) => s + (i.monto || 0), 0);
}

function deudas_updateKpiCard() {
    const deudaEl = document.getElementById('kpi-deuda-amount');
    const statusEl = document.getElementById('kpi-deuda-status');
    const cardEl = document.getElementById('kpi-deuda-card');
    if (!deudaEl) return;
    const deudaTotal = deudas_getTotalAmount();
    deudaEl.innerText = deudaTotal > 0 ? `-${formatCurrency(deudaTotal)}` : formatCurrency(0);
    deudaEl.classList.toggle('kpi-debt-muted', !debtVisibleInBalance);
    if (statusEl) {
        statusEl.innerText = debtVisibleInBalance ? '👁 Deudas visibles en balance' : '🙈 Deudas ocultas en balance';
        statusEl.className = `diff-label ${debtVisibleInBalance ? 'text-danger' : ''}`;
    }
    if (cardEl) cardEl.title = debtVisibleInBalance ? 'Click para ocultar de balance' : 'Click para incluir en balance';
}

async function deudas_ensureLoaded() {
    if (!accessToken || deudasState.loaded || deudasState.loading) return;
    deudasState.loading = true;
    try {
        await deudas_cargarDatos();
    } finally {
        deudasState.loading = false;
    }
}

async function deudas_toggleVisibilityInBalance() {
    debtVisibleInBalance = !debtVisibleInBalance;
    localStorage.setItem(DEBT_VISIBLE_KEY, debtVisibleInBalance ? '1' : '0');
    await deudas_ensureLoaded();
    deudas_updateKpiCard();
    balance_updateKpi();
}

function deudas_bindEvents() {
    document.getElementById('d-btn-add')?.addEventListener('click', () => deudas_abrirSheet(null));
    const overlay = document.getElementById('d-sheet-overlay');
    if (overlay) {
        overlay.addEventListener('click', deudas_cerrarSheet);
    } else {
        // Fallback for click outside
        window.addEventListener('click', (e) => {
            const sheet = document.getElementById('d-sheet');
            if (sheet && !sheet.classList.contains('hidden')) {
                 if (e.target.id === 'd-sheet') {
                     deudas_cerrarSheet();
                 }
            }
        });
    }
    
    // Check if we have a close button to add event listener to
    const closeBtn = document.getElementById('d-sheet-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', deudas_cerrarSheet);
    } else {
         // Create one or just let the overlay handle it. 
         // In index.html there is no d-sheet-close inside d-sheet based on grep
    }
    document.getElementById('d-btn-guardar')?.addEventListener('click', deudas_guardar);
}

async function deudas_cargarDatos() {
    const lista = document.getElementById('d-lista');
    lista.innerHTML = '<div class="loading-spinner" style="margin-top: 2rem;">Cargando deudas...</div>';
    try {
        let rows = [];
        try {
            rows = await sheetsGet(SPREADSHEET_DEUDAS_ID, 'Deudas!A2:B');
        } catch(e) {
            rows = await sheetsGet(SPREADSHEET_DEUDAS_ID, 'Hoja 1!A2:B');
        }
        
        deudasState.allItems = rows.map((row, i) => ({
            id: i + 2,
            concepto: row[0] || '',
            monto: parseSheetValue(row[1])
        })).filter(i => i.concepto);
        deudasState.loaded = true;
        
        deudas_renderLista();
    } catch(e) {
        handleApiError(e, lista);
    }
}

function deudas_renderLista() {
    const el = document.getElementById('d-lista');
    const totalEl = document.getElementById('d-total');
    let total = 0;
    
    if (!deudasState.allItems.length) {
        el.innerHTML = '<div class="empty-state">No tienes deudas registradas 🎉</div>';
        if (totalEl) totalEl.innerText = formatCurrency(0);
        return;
    }
    
    el.innerHTML = deudasState.allItems.map(item => {
        total += item.monto;
        return `
        <div class="movimiento-card">
          <div class="mc-left">
            <span class="mc-lugar" style="font-size:1.05rem; font-weight: 600;">${item.concepto}</span>
          </div>
          <div class="mc-right" style="align-items:flex-end;gap:.5rem">
            <span class="mc-monto text-danger" style="font-size:1.1rem;font-weight:700">-${formatCurrency(item.monto)}</span>
            <div style="display:flex;gap:.4rem;margin-top:.2rem">
              <button class="mini-btn icon-btn-sm" onclick="deudas_editar(${item.id})" style="font-size: 1.1rem; padding: 4px;">✏️</button>
              <button class="mini-btn mini-btn-danger icon-btn-sm" onclick="deudas_borrar(${item.id})" style="font-size: 1.1rem; padding: 4px;">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');
    
    if (totalEl) totalEl.innerText = total > 0 ? `-${formatCurrency(total)}` : formatCurrency(0);
    deudas_updateKpiCard();
    balance_updateKpi();
}

window.deudas_editar = function(id) {
    const item = deudasState.allItems.find(i => i.id === id);
    if (item) deudas_abrirSheet(item);
};

window.deudas_borrar = async function(id) {
    if (!confirm('¿Eliminar esta deuda?')) return;
    const el = document.getElementById('d-lista');
    el.innerHTML = '<div class="loading-spinner" style="margin-top: 2rem;">Actualizando...</div>';
    try {
        if (deudasState.sheetId === null) {
            try {
                deudasState.sheetId = await getSheetId(SPREADSHEET_DEUDAS_ID, 'Deudas');
            } catch(e) {
                deudasState.sheetId = await getSheetId(SPREADSHEET_DEUDAS_ID, 'Hoja 1');
            }
        }
        await sheetsDeleteRow(SPREADSHEET_DEUDAS_ID, deudasState.sheetId, id - 1);
        deudas_cargarDatos();
        showToast('🗑️ Deuda eliminada');
    } catch(e) { 
        console.error(e); 
        el.innerHTML = '<div class="empty-state text-danger">❌ Error al borrar</div>'; 
    }
};

function deudas_abrirSheet(item) {
    const sheet = document.getElementById('d-sheet');
    document.getElementById('d-edit-id').value = '';
    document.getElementById('d-sheet-title').innerText = 'Nueva Deuda';
    document.getElementById('d-concepto').value = '';
    document.getElementById('d-monto').value = '';
    
    if (item) {
        document.getElementById('d-edit-id').value = item.id;
        document.getElementById('d-sheet-title').innerText = 'Editar Deuda';
        document.getElementById('d-concepto').value = item.concepto;
        document.getElementById('d-monto').value = item.monto;
    }
    sheet.classList.remove('hidden');
}

function deudas_cerrarSheet() { 
    document.getElementById('d-sheet').classList.add('hidden'); 
}

async function deudas_guardar() {
    const btn = document.getElementById('d-btn-guardar');
    const concepto = document.getElementById('d-concepto').value.trim();
    const monto = parseSheetValue(document.getElementById('d-monto').value);
    const editId = document.getElementById('d-edit-id').value;
    
    if (!concepto || !monto) {
        alert('Por favor llena todos los campos.');
        return;
    }
    
    btn.disabled = true; btn.innerText = 'Guardando...';
    try {
        let sheetName = 'Deudas';
        try {
            await sheetsGet(SPREADSHEET_DEUDAS_ID, 'Deudas!A1:A1');
        } catch(e) {
            sheetName = 'Hoja 1';
        }
        
        if (editId) {
            await sheetsUpdate(SPREADSHEET_DEUDAS_ID, `${sheetName}!A${editId}:B${editId}`, [[concepto, monto]]);
            showToast('✅ Deuda actualizada');
        } else {
            await sheetsAppend(SPREADSHEET_DEUDAS_ID, `${sheetName}!A:B`, [[concepto, Math.abs(monto)]]);
            showToast('✅ Deuda agregada');
        }
        deudas_cerrarSheet();
        deudas_cargarDatos();
    } catch(e) {
        console.error(e); 
        alert('❌ Error al guardar deuda');
    } finally {
        btn.disabled = false; btn.innerText = 'Guardar';
    }
}
