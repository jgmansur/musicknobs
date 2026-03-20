import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp, LogOut } from 'lucide';
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
const APP_VERSION  = 'v3.5.3';
// Bump token keys to force re-auth with the new drive scope
const TOKEN_KEY    = 'google_access_token_v4';
const EXPIRY_KEY   = 'google_token_expiry_v4';
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
let currentTab  = 'dashboard';
let tabInited   = { dashboard: false, gastos: false, fijos: false, deudas: false };

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

// =============================================
// DOM READY
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    debugInitPanel();
    debugUpdate({ token: accessToken ? 'Si (cache)' : 'No' });
    createIcons({ icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp, LogOut } });
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

    // Hormiga Panel events
    document.getElementById('kpi-hormiga-card')?.addEventListener('click', hormiga_openPanel);
    document.getElementById('hormiga-panel-close')?.addEventListener('click', hormiga_closePanel);
    document.getElementById('hormiga-panel-overlay')?.addEventListener('click', hormiga_closePanel);

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
let balancePaidFixedTotal = 0;
let balancePaidFixedAnchor = parseFloat(localStorage.getItem('balance_paid_anchor_v1') || '0') || 0;
let balanceLogNetTotal = 0;
let balanceLogNetAnchor = (() => {
    const raw = localStorage.getItem('balance_log_anchor_v1');
    if (raw === null) return null;
    return parseFloat(raw) || 0;
})();
let balanceRealtimeUnsub = null;
let balanceRealtimeUid = null;

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
        const monto = Math.abs(parseSheetValue(row[3]));
        if (tipo === 'ingreso') return sum + monto;
        if (tipo === 'gasto') return sum - monto;
        return sum;
    }, 0);
    if (balanceLogNetAnchor === null) {
        balanceLogNetAnchor = balanceLogNetTotal;
        localStorage.setItem('balance_log_anchor_v1', String(balanceLogNetAnchor));
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
        lastUpdated: serverTimestamp(),
    });
}

async function balance_saveAccounts() {
    // 1. Update localStorage cache immediately (offline-first)
    localStorage.setItem('finance_accounts_v1', JSON.stringify(balanceAccounts));
    if (!accessToken) {
        debugUpdate({ save: `Solo localStorage (${balanceAccounts.length})`, token: 'No' });
        return;
    }
    if (!_fbUid) await firebase_signIn(accessToken, { allowPopupFallback: true });
    // 2. Write to Firestore (primary) and Sheets (backup) in parallel
    const ops = [];
    if (_fbUid) {
        ops.push({ name: 'Firestore', promise: balance_saveToFirestore() });
    }
    ops.push({
        name: 'Sheets',
        promise: balance_getOrCreateSheet().then(sid => balance_writeToSheet(sid)),
    });
    const results = await Promise.allSettled(ops.map(op => op.promise));
    const labels = results.map((result, i) => {
        if (result.status === 'rejected') {
            const code = result.reason?.code || result.reason?.status || 'ERR';
            const msg = debugShort(result.reason?.message || result.reason || 'error');
            console.warn(`[${ops[i].name}] save failed:`, msg);
            return `${ops[i].name}:ERR(${code})`;
        }
        return `${ops[i].name}:OK`;
    });
    if (!_fbUid) labels.unshift('Firestore:SKIP(no uid)');
    debugUpdate({ save: labels.join(' | '), token: 'Si' });
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
    return base - balance_getPaidFixedDeduction() + balance_getLogNetAdjustment();
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
    return { rows, investedTotal, monthlyTotal, bitcoinGainTotal, secondaryTotal: monthlyTotal + bitcoinGainTotal };
}

function balance_updateKpi() {
    const total = balance_getTotal();
    const real  = total - balancePendingFixed;
    const paidDeduction = balance_getPaidFixedDeduction();
    const logAdjustment = balance_getLogNetAdjustment();
    const el  = document.getElementById('balance-total');
    const lbl = document.getElementById('balance-real-label');
    if (el)  el.innerText = formatCurrency(total);
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
        invYieldEl.innerText = `${investSummary.secondaryTotal >= 0 ? '+' : ''}${formatCurrency(investSummary.secondaryTotal)}${investSummary.bitcoinGainTotal !== 0 ? ' (incl BTC)' : '/mes'}`;
        invYieldEl.className = `diff-label ${investSummary.secondaryTotal >= 0 ? 'text-success' : 'text-danger'}`;
    }
    const investPanel = document.getElementById('invest-panel');
    if (investPanel && !investPanel.classList.contains('hidden')) {
        balance_renderInvestmentPanel();
    }
    // Update debt summary card on dashboard
    const deudaEl = document.getElementById('kpi-deuda-amount');
    if (deudaEl) {
        const deudaTotal = deudasState.allItems.reduce((s, i) => s + (i.monto || 0), 0);
        deudaEl.innerText = deudaTotal > 0 ? `-${formatCurrency(deudaTotal)}` : formatCurrency(0);
    }
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
    monthlyEl.innerText = `${summary.secondaryTotal >= 0 ? '+' : ''}${formatCurrency(summary.secondaryTotal)}`;
    if (monthlyLabelEl) {
        monthlyLabelEl.innerText = summary.bitcoinGainTotal !== 0 ? 'Rendimiento + Ganancia actual' : 'Rendimiento mensual';
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
    await balance_saveAccounts();
    await balance_refreshUsdMxnRate(true);
    await balance_refreshBtcMxnRate(true);
    await balance_refreshInvestmentRates(true);
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
        ?.addEventListener('click', () => showTab('deudas'));
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
    if (window.google?.accounts?.oauth2) { requestToken(); return; }
    const btn = document.getElementById('login-google-btn');
    btn.innerText = 'Cargando...'; btn.disabled = true;
    const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(iv); btn.innerText = 'Iniciar Sesión con Google'; btn.disabled = false;
            requestToken();
        }
    }, 200);
    setTimeout(() => { clearInterval(iv); btn.innerText = 'Error: reintenta'; btn.disabled = false; }, 10000);
}

function requestToken() {
    if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (res) => {
                if (res?.access_token) {
                    accessToken = res.access_token;
                    localStorage.setItem(TOKEN_KEY, accessToken);
                    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 3500 * 1000));
                    debugUpdate({ token: 'Si (cache)', auth: 'Google OAuth OK' });
                    hideLoginModal();
                    // Recover redirect session if any; connect Firebase lazily on account save.
                    firebase_restoreRedirectResult().then(() => {
                        if (!_fbUid) debugUpdate({ auth: 'Google OK · Firebase pendiente' });
                        balance_loadAccounts().then(() => balance_updateKpi());
                    });
                    showTab('dashboard');
                } else {
                    showLoginModal();
                }
            },
        });
    }
    tokenClient.requestAccessToken();
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
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    firebase_signOut(); // clear Firebase auth state
    // Revoke Google token if possible
    if (window.google?.accounts?.oauth2) {
        google.accounts.oauth2.revoke(accessToken, () => { console.log('Token revoked') });
    }
    balance_stopRealtimeSync();
    debugUpdate({ auth: 'Sesion cerrada', uid: '-', token: 'No', load: '-', save: '-' });
    showLoginModal();
}

async function sheetsGet(ssId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return (await r.json()).values || [];
}

async function sheetsAppend(ssId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function sheetsUpdate(ssId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const r = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function sheetsDeleteRow(ssId, sheetId, rowIndex0) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}:batchUpdate`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex0, endIndex: rowIndex0 + 1 } } }] }),
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

async function getSheetId(ssId, sheetName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=sheets.properties`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    const data = await r.json();
    const s = data.sheets?.find(s => s.properties.title === sheetName);
    return s ? s.properties.sheetId : 0;
}

async function sheetsClear(ssId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}:clear`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw { status: r.status, message: await r.text() };
    return r.json();
}

// ── Drive API helpers ─────────────────────────────────────
async function driveFindFolder(name) {
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
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
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return null;
    const data = await r.json();
    return data.files?.[0]?.id || null;
}

async function driveCreateSpreadsheet(name, parentId) {
    const body = { name, mimeType: 'application/vnd.google-apps.spreadsheet' };
    if (parentId) body.parents = [parentId];
    const url = 'https://www.googleapis.com/drive/v3/files';
    const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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

    const r = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
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
    await fetch(`https://www.googleapis.com/drive/v3/files/${res.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return res.webViewLink;
}

async function driveDeleteFile(fileId) {
    if (!fileId) return;
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
}

function handleApiError(err, el) {
    console.error('API Error:', err);
    if (err.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EXPIRY_KEY);
        accessToken = null;
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
        const [logData, fixedData] = await Promise.all([
            sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:G'),
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:H')  // G=pagosMes, H=estado pagos
        ]);
        processAndRender(logData, fixedData);
        status.innerText = 'Sincronizado ✓'; status.style.color = 'var(--accent-green)';
    } catch (err) {
        if (err.status === 401) {
            status.innerText = 'Sesión expirada'; status.style.color = 'var(--accent-orange)';
            localStorage.removeItem(TOKEN_KEY); accessToken = null; showLoginModal();
        } else {
            status.innerText = 'Error al cargar'; status.style.color = 'var(--accent-orange)';
        }
    }
}

function processAndRender(logRows, fixedRows) {
    balance_updateLogNetFromRows(logRows);
    const hormigaKeywords = ['oxxo','coca','cigarros','snacks','gomitas','vuse','tiendita','starbucks','seven','7-eleven','extra','dulces','chicles'];
    let hormigaTotal = 0, hormigaChartData = [];
    let hormigaGastos = []; // Guardaremos detalle para el panel
    let hormigaPrevTotal = 0; // Previous month hormiga total

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
        const monto    = parseSheetValue(row[3]);
        const fecha    = row[0] || '';
        // FIX: use toLowerCase() so 'Gasto'/'gasto'/'GASTO' all match
        if (hormigaKeywords.some(k => concepto.includes(k) || lugar.includes(k)) && (row[4] || '').toLowerCase() === 'gasto') {
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


    // F = pagado legacy, G = pagos por mes, H = estado de pagos parciales (ej. 1010)
    const fixedExpenses = fixedRows.map((row, i) => {
        const concepto = row[1] || '';
        const g = parseSheetValue(row[2]);  // gasto column
        const n = parseSheetValue(row[3]);  // ingreso column
        const tipo = g > 0 ? 'gasto' : 'ingreso';
        const monto = g || n;
        const legacyPaid = parseBool(row[5]);
        const pagosMes = parsePaymentsTotal(row[6]);
        const pagosEstado = parsePaymentStates(row[7], pagosMes, legacyPaid);
        const pagosHechos = pagosEstado.filter(Boolean).length;
        const isPaid   = pagosHechos >= pagosMes;
        const paidRatio = pagosMes > 0 ? (pagosHechos / pagosMes) : 0;
        const paidAmount = Math.abs(monto) * paidRatio;
        const pendingAmount = Math.abs(monto) - paidAmount;
        return { rowNum: i + 2, concepto, monto, tipo, isPaid, pagosMes, pagosEstado, pagosHechos, paidAmount, pendingAmount };
    }).filter(e => e.concepto);

    // KPI: count partial progress for fixed expenses
    const fixedGastos   = fixedExpenses.filter(e => e.tipo === 'gasto');
    const fixedTotal    = fixedGastos.reduce((s, e) => s + Math.max(0, e.pendingAmount), 0);
    const fixedPaidTotal = fixedGastos.reduce((s, e) => s + Math.max(0, e.paidAmount), 0);
    const paidCount     = fixedGastos.filter(e => e.isPaid).length;
    const pendingFixed  = fixedTotal;   // already only unpaid gastos

    // Update balance module with current pending fixed expenses
    balancePendingFixed = pendingFixed;
    balancePaidFixedTotal = fixedPaidTotal;
    balance_updateKpi();

    document.getElementById('gasto-hormiga-total').innerText = formatCurrency(hormigaTotal);
    document.getElementById('gastos-fijos-total').innerText  = formatCurrency(fixedTotal);
    document.getElementById('pago-status').innerText =
        fixedTotal === 0
            ? `✅ \u00a1Todo pagado!`
            : `${paidCount}/${fixedGastos.length} Pagados`;

    // Dashboard only shows PENDING (unpaid) fixed expenses
    renderFixedTable(fixedExpenses.filter(e => !e.isPaid));
    renderChart(hormigaChartData);
    renderHormigaPanel(hormigaGastos, hormigaTotal, hormigaPrevTotal, monthName, prevMonthName);
}

function renderFixedTable(expenses) {
    const tbody = document.getElementById('fixed-expenses-body');
    if (!expenses.length) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin datos</td></tr>'; return; }
    tbody.innerHTML = expenses.map(e => `
        <tr>
          <td>${e.concepto}</td>
          <td>${formatCurrency(e.monto)}</td>
          <td><span class="badge ${e.isPaid ? 'paid' : 'pending'}">${e.isPaid ? 'PAGADO' : 'PENDIENTE'}</span></td>
        </tr>`).join('');
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
        const rows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:G');
        balance_updateLogNetFromRows(rows);
        gastosState.allRows = rows.map((row, i) => ({
            rowNum:   i + 2,
            fecha:    row[0] || '',
            lugar:    row[1] || '',
            concepto: row[2] || '',
            monto:    parseSheetValue(row[3]),
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
            <span class="mc-concepto">${row.concepto || '—'}</span>
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
            await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!B${idFila}:G${idFila}`, [[lugar, concepto, parseSheetValue(monto), tipo, forma, allUrls]]);
        } else {
            await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:G', [[fecha, lugar, concepto, parseSheetValue(monto), tipo, forma, nuevasUrls.join(',')]]);
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
    document.getElementById('g-monto').value     = row.monto;
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
}

async function fijos_cargarDatos() {
    document.getElementById('f-lista').innerHTML = '<div class="loading-spinner">⏳ Cargando...</div>';
    try {
        const [rows, catRows] = await Promise.all([
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:H').catch(() => []),  // G=pagosMes, H=estado pagos
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
        }
        // Always store current month
        localStorage.setItem(RESET_MONTH_KEY, nowMonth);
        // ─────────────────────────────────────────────────────────────

        fijosState.allItems = rows.map((row, i) => {
            // Dates come as serial numbers (UNFORMATTED_VALUE) or ISO strings
            const d      = parseSheetDate(row[0]);
            const g      = parseSheetValue(row[2]);
            const n      = parseSheetValue(row[3]);
            const pagosMes = parsePaymentsTotal(row[6]);
            const pagosEstado = parsePaymentStates(row[7], pagosMes, parseBool(row[5]));
            const pagosHechos = pagosEstado.filter(Boolean).length;
            const isPaid = pagosHechos >= pagosMes;
            return {
                id: i + 2,
                fecha: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
                fechaValue: d.toISOString().split('T')[0],
                concepto:   row[1] || '',
                monto:      g || n,
                tipo:       g > 0 ? 'gasto' : 'ingreso',
                categoria:  row[4] || 'General',
                isPaid,
                pagosMes,
                pagosEstado,
                pagosHechos,
            };
        }).filter(i => i.concepto).reverse();

        fijos_generarPills();
        fijos_aplicarFiltros();
    } catch(e) { handleApiError(e, document.getElementById('f-lista')); }
}

function fijos_generarPills() {
    const pills = cat => fijosState.categorias.map(c => `<label class="cat-check-label"><input type="checkbox" class="${cat}" value="${c}" id="${cat}_${c}">${c}</label>`).join('');
    document.getElementById('f-cat-checks').innerHTML = pills('f-cat-chk');
    document.getElementById('f-filter-checks').innerHTML = pills('f-filter-chk');
    fijosState.filtrosActivos.forEach(c => { const el = document.querySelector(`.f-filter-chk[value="${c}"]`); if (el) el.checked = true; });
}

function fijos_aplicarFiltros() {
    const q    = document.getElementById('f-search').value.toLowerCase();
    const sort = document.getElementById('f-sort').value;
    const fmt  = new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' });
    let lista  = fijosState.allItems.filter(item => {
        const t = item.concepto.toLowerCase().includes(q) || item.categoria.toLowerCase().includes(q);
        const c = !fijosState.filtrosActivos.length || fijosState.filtrosActivos.some(f => item.categoria.split(', ').includes(f));
        return t && c;
    });
    lista.sort((a,b) => {
        if (sort==='fechaDesc') return b.fechaValue.localeCompare(a.fechaValue);
        if (sort==='fechaAsc')  return a.fechaValue.localeCompare(b.fechaValue);
        return a.concepto.localeCompare(b.concepto);
    });
    let gastoT = 0, ingresoT = 0;
    lista.forEach(i => { if (i.tipo==='gasto') gastoT += i.monto; else ingresoT += i.monto; });
    document.getElementById('f-balance').innerText      = fmt.format(ingresoT - gastoT);
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
        const botonesPagos = item.pagosMes === 1
            ? (() => {
                const clsPart = item.isPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                const lbl = item.isPaid ? '✅ Pagado' : '⏳ Pendiente';
                return `<button class="${clsPart}" onclick="fijos_togglePagoPart(${item.id}, 0)">${lbl}</button>`;
            })()
            : item.pagosEstado.map((isPartPaid, idx) => {
                const clsPart = isPartPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
                return `<button class="${clsPart}" style="min-width:44px;padding:.35rem .45rem;font-size:.72rem" onclick="fijos_togglePagoPart(${item.id}, ${idx})">${idx + 1}</button>`;
            }).join('');
        return `<div class="movimiento-card ${item.isPaid ? 'card-paid' : ''}">
          <div class="mc-left">
            <span class="mc-fecha">${item.fecha}</span>
            <span class="mc-lugar">${item.concepto}</span>
            <span class="mc-concepto">${item.categoria}${item.pagosMes > 1 ? ` · ${item.pagosHechos}/${item.pagosMes} pagos · ${sign}${fmt.format(montoParcial)} c/u` : ''}</span>
          </div>
          <div class="mc-right" style="align-items:flex-end;gap:.5rem">
            <span class="mc-monto ${cls}">${sign}${fmt.format(item.monto)}</span>
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
    } catch(e) { console.error(e); el.innerHTML = '<div class="empty-state text-danger">❌ Error al borrar</div>'; }
};

/** Toggle one partial payment state and sync to Control de Gastos */
window.fijos_togglePagoPart = async function(id, partIndex) {
    const item = fijosState.allItems.find(i => i.id === id);
    if (!item) return;
    const wasPartPaid = !!item.pagosEstado[partIndex];
    const nowPartPaid = !wasPartPaid;
    const wasPaid = item.isPaid;
    const partAmount = Math.abs(item.monto / item.pagosMes);
    const signedPartAmount = item.tipo === 'ingreso' ? partAmount : -partAmount;

    // Optimistic UI update
    item.pagosEstado[partIndex] = nowPartPaid;
    item.pagosHechos = item.pagosEstado.filter(Boolean).length;
    item.isPaid = item.pagosHechos >= item.pagosMes;
    balanceLogNetTotal += nowPartPaid ? signedPartAmount : -signedPartAmount;
    balance_updateKpi();
    fijos_aplicarFiltros();

    try {
        // 1) Persist partial state (H) + legacy full-paid checkbox (F)
        await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!F${id}:H${id}`, [[item.isPaid ? 'TRUE' : 'FALSE', item.pagosMes, serializePaymentStates(item.pagosEstado)]]);

        // 2) If marking one part as PAID -> append partial entry to Control de Gastos
        if (nowPartPaid) {
            const fecha    = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const lugar    = 'Gasto Fijo';
            const concepto = `${item.concepto} (${partIndex + 1}/${item.pagosMes})`;
            const monto    = partAmount;
            const tipo     = item.tipo === 'ingreso' ? 'Ingreso' : 'Gasto';
            const forma    = item.categoria || 'General';
            await sheetsAppend(
                SPREADSHEET_LOG_ID,
                'Hoja 1!A:G',
                [[fecha, lugar, concepto, monto, tipo, forma, '']]
            );
            tabInited.gastos = false;
            showToast('✅ Pago registrado en Control de Gastos');
        } else {
            // UN-SYNC: remove matching partial entry in Control de Gastos
            try {
                const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
                const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A:G');
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
    } catch(e) {
        console.error('Error toggling pago parcial:', e);
        // Revert optimistic update
        item.pagosEstado[partIndex] = wasPartPaid;
        item.pagosHechos = item.pagosEstado.filter(Boolean).length;
        item.isPaid = wasPaid;
        balanceLogNetTotal += wasPartPaid ? signedPartAmount : -signedPartAmount;
        balance_updateKpi();
        fijos_aplicarFiltros();
        handleApiError(e, null);
    }
};

function fijos_abrirSheet(item) {
    const sheet = document.getElementById('f-sheet');
    document.getElementById('f-edit-id').value = '';
    document.getElementById('f-sheet-title').innerText = 'Nuevo Movimiento';
    document.getElementById('f-concepto').value = '';
    document.getElementById('f-monto').value = '';
    document.getElementById('f-tipo').value = 'gasto';
    document.getElementById('f-pagos-mes').value = '1';
    const hoy = new Date();
    document.getElementById('f-fecha').value = new Date(hoy.getTime() - hoy.getTimezoneOffset()*60000).toISOString().split('T')[0];
    document.querySelectorAll('.f-cat-chk').forEach(cb => cb.checked = false);
    const def = document.querySelector('.f-cat-chk[value="General"]');
    if (def) def.checked = true;
    if (item) {
        document.getElementById('f-edit-id').value = item.id;
        document.getElementById('f-sheet-title').innerText = 'Editar Movimiento';
        document.getElementById('f-fecha').value = item.fechaValue;
        document.getElementById('f-tipo').value = item.tipo;
        document.getElementById('f-concepto').value = item.concepto;
        document.getElementById('f-monto').value = item.monto;
        document.getElementById('f-pagos-mes').value = String(item.pagosMes || 1);
        item.categoria.split(', ').forEach(c => { const cb = document.querySelector(`.f-cat-chk[value="${c}"]`); if (cb) cb.checked = true; });
    }
    sheet.classList.remove('hidden');
}

function fijos_cerrarSheet() { document.getElementById('f-sheet').classList.add('hidden'); }
function fijos_abrirFiltro()  { fijos_generarPills(); document.getElementById('f-filter-sheet').classList.remove('hidden'); }
function fijos_cerrarFiltro() { document.getElementById('f-filter-sheet').classList.add('hidden'); }

async function fijos_guardar() {
    const btn     = document.getElementById('f-btn-guardar');
    const fecha   = document.getElementById('f-fecha').value;
    const tipo    = document.getElementById('f-tipo').value;
    const concepto= document.getElementById('f-concepto').value.trim();
    const monto   = parseSheetValue(document.getElementById('f-monto').value);
    const pagosMes = parsePaymentsTotal(document.getElementById('f-pagos-mes').value);
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
            const paidCount = prevStates.filter(Boolean).length;
            const nextStates = new Array(pagosMes).fill(false).map((_, idx) => idx < Math.min(paidCount, pagosMes));
            const fullPaid = nextStates.every(Boolean);
            await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!A${editId}:H${editId}`, [[
                fecha,
                concepto,
                gasto,
                ingreso,
                catStr,
                fullPaid ? 'TRUE' : 'FALSE',
                pagosMes,
                serializePaymentStates(nextStates),
            ]]);
        } else {
            // new rows start with all partial payments pending
            await sheetsAppend(SPREADSHEET_FIXED_ID, 'Hoja 1!A:H', [[
                fecha,
                concepto,
                gasto,
                ingreso,
                catStr,
                'FALSE',
                pagosMes,
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
    sheetId: null
};

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
    // Refresh dashboard deuda card whenever deudas list updates
    const deudaEl = document.getElementById('kpi-deuda-amount');
    if (deudaEl) deudaEl.innerText = total > 0 ? `-${formatCurrency(total)}` : formatCurrency(0);
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
