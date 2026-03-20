import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } from 'lucide';
import ApexCharts from 'apexcharts';

// =============================================
// CONFIG
// =============================================
const CLIENT_ID = '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com';
// OAuth: add drive scope for creating the accounts spreadsheet in Drive
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
const SPREADSHEET_LOG_ID   = '1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw'; // Control de Gastos
const SPREADSHEET_FIXED_ID = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA'; // Gastos Fijos
const APP_VERSION  = 'v2.4.1';
// Bump token keys to force re-auth with the new drive scope
const TOKEN_KEY    = 'google_access_token_v4';
const EXPIRY_KEY   = 'google_token_expiry_v4';
const ACCOUNTS_SHEET_KEY = 'finance_accounts_sheet_v1'; // localStorage key for the accounts spreadsheet ID

// =============================================
// STATE
// =============================================
let accessToken = null;
let tokenClient = null;
let currentTab  = 'dashboard';
let tabInited   = { dashboard: false, gastos: false, fijos: false };

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
    createIcons({ icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } });
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

    // Login
    document.getElementById('login-google-btn').addEventListener('click', startGoogleLogin);

    // Bind module events
    gastos_bindEvents();
    fijos_bindEvents();

    // Balance panel
    balance_init();

    // Boot
    if (accessToken) {
        hideLoginModal();
        showTab('dashboard');
    } else {
        showLoginModal();
    }
});

// =============================================
// BALANCE MODULE
// =============================================
const DEFAULT_ACCOUNTS = [
    { id: 1, name: 'Santander',          balance: 0, type: 'bank'   },
    { id: 2, name: 'BBVA',               balance: 0, type: 'bank'   },
    { id: 3, name: 'Bank of America',    balance: 0, type: 'other'  },
    { id: 4, name: 'Tarjeta de Cr\u00e9dito', balance: 0, type: 'credit' },
];

const ACCOUNT_ICONS  = { bank:'🏦', credit:'💳', cash:'💵', invest:'📈', other:'🌎' };
const ACCOUNT_COLORS = { bank:'#3b82f6', credit:'#ef4444', cash:'#22c55e', invest:'#a855f7', other:'#f59e0b' };
const ACCOUNT_TYPE_LABEL = { bank:'Cuenta bancaria', credit:'Tarjeta de crédito', cash:'Efectivo', invest:'Inversión', other:'Otro' };

let balanceAccounts   = [];
let balanceEditingId  = null;
let balancePendingFixed = 0; // Set by dashboard when fixed expenses load

// ── Sheet-backed persistence ─────────────────────────────
async function balance_getOrCreateSheet() {
    let sheetId = localStorage.getItem(ACCOUNTS_SHEET_KEY);
    if (sheetId) {
        try { await sheetsGet(sheetId, 'A1:A1'); return sheetId; }
        catch { localStorage.removeItem(ACCOUNTS_SHEET_KEY); }
    }
    // Find 'Jay App' folder in Drive
    const folderId = await driveFindFolder('Jay App');
    // Create the spreadsheet (in Jay App folder if found, else root Drive)
    sheetId = await driveCreateSpreadsheet('Finance Dashboard - Cuentas', folderId);
    // Initialize header row
    await sheetsUpdate(sheetId, 'A1:D1', [['ID', 'Nombre', 'Saldo', 'Tipo']]);
    localStorage.setItem(ACCOUNTS_SHEET_KEY, sheetId);
    return sheetId;
}

async function balance_loadAccounts() {
    if (!accessToken) {
        // Not logged in yet — use localStorage fallback
        try {
            const raw = localStorage.getItem('finance_accounts_v1');
            balanceAccounts = raw ? JSON.parse(raw) : DEFAULT_ACCOUNTS.map(a => ({ ...a }));
        } catch { balanceAccounts = DEFAULT_ACCOUNTS.map(a => ({ ...a })); }
        return;
    }
    try {
        const sid  = await balance_getOrCreateSheet();
        const rows = await sheetsGet(sid, 'A2:D');
        if (!rows.length) {
            balanceAccounts = DEFAULT_ACCOUNTS.map(a => ({ ...a }));
            await balance_writeToSheet(sid); // seed defaults
        } else {
            balanceAccounts = rows
                .filter(r => r[0])
                .map(r => ({
                    id:      Number(r[0]) || Date.now(),
                    name:    r[1] || '',
                    balance: typeof r[2] === 'number' ? r[2] : parseSheetValue(r[2]),
                    type:    r[3] || 'bank',
                }));
        }
    } catch (err) {
        console.error('Error loading accounts from Sheets:', err);
        const raw = localStorage.getItem('finance_accounts_v1');
        balanceAccounts = raw ? JSON.parse(raw) : DEFAULT_ACCOUNTS.map(a => ({ ...a }));
    }
}

async function balance_writeToSheet(sheetId) {
    await sheetsClear(sheetId, 'A2:D');
    if (balanceAccounts.length) {
        await sheetsUpdate(sheetId, `A2:D${1 + balanceAccounts.length}`,
            balanceAccounts.map(a => [a.id, a.name, a.balance, a.type]));
    }
}

async function balance_saveAccounts() {
    // Mirror to localStorage as offline cache
    localStorage.setItem('finance_accounts_v1', JSON.stringify(balanceAccounts));
    if (!accessToken) return;
    try {
        const sid = await balance_getOrCreateSheet();
        await balance_writeToSheet(sid);
    } catch (err) {
        console.error('Error saving accounts to Sheets:', err);
    }
}

// ── Compute helpers ──────────────────────────────────────
function balance_getTotal() {
    return balanceAccounts.reduce((sum, a) =>
        sum + (a.type === 'credit' ? -Math.abs(a.balance) : +a.balance), 0);
}

function balance_updateKpi() {
    const total = balance_getTotal();
    const real  = total - balancePendingFixed;
    const el  = document.getElementById('balance-total');
    const lbl = document.getElementById('balance-real-label');
    if (el)  el.innerText = formatCurrency(total);
    if (lbl) {
        lbl.innerText = balancePendingFixed > 0
            ? `Real: ${formatCurrency(real)} (pendientes: ${formatCurrency(balancePendingFixed)})`
            : 'Toca para ver cuentas';
        lbl.className = 'diff-label ' + (real >= 0 ? 'text-success' : 'text-danger');
    }
}

// ── Render ───────────────────────────────────────────────
function balance_renderPanel() {
    const total = balance_getTotal();
    const real  = total - balancePendingFixed;
    document.getElementById('bs-total').innerText = formatCurrency(total);
    const bsReal = document.getElementById('bs-real');
    bsReal.innerText   = formatCurrency(real);
    bsReal.className   = 'bs-amount ' + (real >= 0 ? 'text-success' : 'text-danger');
    document.getElementById('bs-pending-label').innerText =
        balancePendingFixed > 0
            ? `menos ${formatCurrency(balancePendingFixed)} pendientes`
            : 'sin fijos pendientes';

    const list = document.getElementById('accounts-list');
    list.innerHTML = balanceAccounts.map(acc => {
        const icon   = ACCOUNT_ICONS[acc.type]  || '🏦';
        const color  = ACCOUNT_COLORS[acc.type] || '#3b82f6';
        const signed = acc.type === 'credit' ? -Math.abs(acc.balance) : +acc.balance;
        return `
        <div class="account-card glass-subtle" data-id="${acc.id}">
          <div class="account-card-left">
            <span class="account-icon" style="background:${color}22;color:${color}">${icon}</span>
            <div class="account-info">
              <span class="account-name">${acc.name}</span>
              <span class="account-type-label">${ACCOUNT_TYPE_LABEL[acc.type] || 'Cuenta'}</span>
            </div>
          </div>
          <div class="account-card-right">
            <span class="account-balance ${signed < 0 ? 'text-danger' : ''}">${formatCurrency(signed)}</span>
            <div class="account-actions">
              <button class="acc-edit-btn icon-btn-sm" data-id="${acc.id}" title="Editar">✏️</button>
              <button class="acc-del-btn icon-btn-sm" data-id="${acc.id}" title="Eliminar">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.acc-edit-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_openEdit(parseInt(btn.dataset.id))));
    list.querySelectorAll('.acc-del-btn').forEach(btn =>
        btn.addEventListener('click', () => balance_deleteAccount(parseInt(btn.dataset.id))));
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
    balance_updateKpi();
    balance_renderPanel();
}

function balance_closePanel() {
    document.getElementById('balance-panel').classList.add('hidden');
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
    balance_showForm();
}

function balance_openAdd() {
    balanceEditingId = null;
    document.getElementById('acc-name').value    = '';
    document.getElementById('acc-balance').value = '';
    document.getElementById('acc-type').value    = 'bank';
    balance_showForm();
}

async function balance_saveAccount() {
    const name    = document.getElementById('acc-name').value.trim();
    const balance = parseFloat(document.getElementById('acc-balance').value) || 0;
    const type    = document.getElementById('acc-type').value;
    if (!name) return;
    const btn = document.getElementById('acc-save-btn');
    btn.disabled = true; btn.innerText = 'Guardando...';

    if (balanceEditingId !== null) {
        const acc = balanceAccounts.find(a => a.id === balanceEditingId);
        if (acc) { acc.name = name; acc.balance = balance; acc.type = type; }
    } else {
        balanceAccounts.push({ id: Date.now(), name, balance, type });
    }
    await balance_saveAccounts();
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
    await balance_saveAccounts();
    balance_renderPanel();
    balance_updateKpi();
}

// ── Init ─────────────────────────────────────────────────
function balance_init() {
    // Load from localStorage cache immediately for instant KPI display
    try {
        const raw = localStorage.getItem('finance_accounts_v1');
        if (raw) { balanceAccounts = JSON.parse(raw); balance_updateKpi(); }
    } catch {}

    document.getElementById('kpi-balance-card')
        .addEventListener('click', balance_openPanel);
    document.getElementById('balance-panel-close')
        .addEventListener('click', balance_closePanel);
    document.getElementById('balance-panel-overlay')
        .addEventListener('click', balance_closePanel);
    document.getElementById('acc-add-btn')
        .addEventListener('click', balance_openAdd);
    document.getElementById('acc-save-btn')
        .addEventListener('click', balance_saveAccount);
    document.getElementById('acc-cancel-btn')
        .addEventListener('click', () => {
            document.getElementById('add-account-form').classList.add('hidden');
            document.getElementById('acc-add-btn').classList.remove('hidden');
            balanceEditingId = null;
        });
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
                    // store expiry: now + 3500s (tokens expire at 3600s)
                    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 3500 * 1000));
                    hideLoginModal();
                    showTab('dashboard');
                    // Sync accounts from Sheets now that we have auth
                    balance_loadAccounts().then(() => balance_updateKpi());
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

function handleApiError(err, el) {
    console.error('API Error:', err);
    if (err.status === 401 || err.status === 403) {
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
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:F')  // col F = Pagado checkbox
        ]);
        processAndRender(logData, fixedData);
        status.innerText = 'Sincronizado ✓'; status.style.color = 'var(--accent-green)';
    } catch (err) {
        if (err.status === 401 || err.status === 403) {
            status.innerText = 'Sesión expirada'; status.style.color = 'var(--accent-orange)';
            localStorage.removeItem(TOKEN_KEY); accessToken = null; showLoginModal();
        } else {
            status.innerText = 'Error al cargar'; status.style.color = 'var(--accent-orange)';
        }
    }
}

function processAndRender(logRows, fixedRows) {
    const hormigaKeywords = ['oxxo','coca','cigarros','snacks','gomitas','vuse','tiendita','starbucks','seven','7-eleven','extra','dulces','chicles'];
    let hormigaTotal = 0, hormigaChartData = [];

    logRows.forEach(row => {
        const concepto = (row[2] || '').toLowerCase();
        const lugar    = (row[1] || '').toLowerCase();
        const monto    = parseSheetValue(row[3]);
        const fecha    = row[0] || '';
        // FIX: use toLowerCase() so 'Gasto'/'gasto'/'GASTO' all match
        if (hormigaKeywords.some(k => concepto.includes(k) || lugar.includes(k)) && (row[4] || '').toLowerCase() === 'gasto') {
            hormigaTotal += monto;
            hormigaChartData.push({ x: fecha, y: monto });
        }
    });

    // Col F (index 5) = Pagado checkbox value (boolean true/false OR string 'TRUE'/'FALSE')
    const fixedExpenses = fixedRows.map((row, i) => {
        const concepto = row[1] || '';
        const g = parseSheetValue(row[2]);  // gasto column
        const n = parseSheetValue(row[3]);  // ingreso column
        const tipo = g > 0 ? 'gasto' : 'ingreso';
        const monto = g || n;
        const isPaid   = parseBool(row[5]);
        return { rowNum: i + 2, concepto, monto, tipo, isPaid };
    }).filter(e => e.concepto);

    // KPI: only count GASTO-type, only unpaid (so the number goes down as you pay)
    const fixedGastos   = fixedExpenses.filter(e => e.tipo === 'gasto');
    const fixedTotal    = fixedGastos.filter(e => !e.isPaid).reduce((s, e) => s + Math.abs(e.monto), 0);
    const paidCount     = fixedGastos.filter(e => e.isPaid).length;
    const pendingFixed  = fixedTotal;   // already only unpaid gastos

    // Update balance module with current pending fixed expenses
    balancePendingFixed = pendingFixed;
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

function renderChart(data) {
    const grouped = data.reduce((a, c) => { a[c.x] = (a[c.x] || 0) + c.y; return a; }, {});
    const dates = Object.keys(grouped).sort();
    const values = dates.map(d => grouped[d]);
    const opts = {
        series: [{ name: 'Gasto Hormiga', data: values }],
        chart: { type: 'area', height: 220, toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent' },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', colors: ['#fbbf24'] },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: .7, opacityTo: .05, colorStops: [{ offset: 0, color: '#fbbf24', opacity: .35 }, { offset: 100, color: '#fbbf24', opacity: 0 }] } },
        dataLabels: { enabled: false },
        xaxis: { categories: dates, axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: '#94a3b8' }, rotate: -30 } },
        yaxis: { show: false },
        grid: { borderColor: '#334155', strokeDashArray: 4 },
        tooltip: { theme: 'dark' }
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
}

async function gastos_cargarHistorial() {
    const lista = document.getElementById('g-lista');
    lista.innerHTML = '<div class="loading-spinner">⏳ Cargando...</div>';
    try {
        const rows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A2:G');
        gastosState.allRows = rows.map((row, i) => ({
            rowNum:   i + 2,
            fecha:    row[0] || '',
            lugar:    row[1] || '',
            concepto: row[2] || '',
            monto:    parseSheetValue(row[3]),
            tipo:     row[4] || 'Gasto',
            formaPago:row[5] || '',
            fotos:    row[6] || '',
        })).reverse();
        gastosState.offset = 0;
        gastos_renderLista(false);
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
        const isGasto = row.tipo === 'Gasto';
        const fechaStr = row.fecha ? formatFecha(row.fecha) : '';
        card.innerHTML = `
          <div class="mc-left">
            <span class="mc-fecha">${fechaStr}</span>
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
    const fecha    = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const concepto = document.getElementById('g-concepto').value.trim();
    const tipo     = document.getElementById('g-tipo').value;
    const forma    = document.getElementById('g-forma-pago').value;
    try {
        if (idFila) {
            await sheetsUpdate(SPREADSHEET_LOG_ID, `Hoja 1!B${idFila}:F${idFila}`, [[lugar, concepto, parseSheetValue(monto), tipo, forma]]);
        } else {
            await sheetsAppend(SPREADSHEET_LOG_ID, 'Hoja 1!A:G', [[fecha, lugar, concepto, parseSheetValue(monto), tipo, forma, '']]);
        }
        status.innerText = '✅ ' + (idFila ? 'Actualizado' : 'Guardado');
        status.style.color = 'var(--accent-green)';
        gastos_cancelar();
        gastos_cargarHistorial();
    } catch(e) {
        console.error(e);
        status.innerText = '❌ Error al guardar'; status.style.color = '#f87171';
        btn.disabled = false; btn.innerText = idFila ? 'ACTUALIZAR' : 'GUARDAR';
    }
}

function gastos_cancelar() {
    document.getElementById('g-id-fila').value = '';
    document.getElementById('g-lugar').value = '';
    document.getElementById('g-concepto').value = '';
    document.getElementById('g-monto').value = '';
    const btn = document.getElementById('g-btn-save');
    btn.innerText = 'GUARDAR'; btn.disabled = false; btn.classList.remove('btn-edit-mode');
    document.getElementById('g-btn-cancel').classList.add('hidden');
    setTimeout(() => { document.getElementById('g-status').innerText = ''; }, 2500);
}

function gastos_abrirModal(row) {
    gastosState.detailRow = row;
    const isGasto = row.tipo === 'Gasto';
    document.getElementById('g-m-monto').innerText = (isGasto ? '-' : '+') + formatCurrency(row.monto);
    document.getElementById('g-m-monto').className = `modal-monto-big ${isGasto ? 'text-danger' : 'text-success'}`;
    document.getElementById('g-m-lugar').innerText = row.lugar || '—';
    document.getElementById('g-m-concepto').innerText = row.concepto || '—';
    document.getElementById('g-m-fecha').innerText = row.fecha ? new Date(row.fecha).toLocaleDateString('es-MX', { weekday:'short', day:'numeric', month:'long', year:'numeric' }) : '—';
    const tipo = document.getElementById('g-m-tipo');
    tipo.innerText = row.tipo; tipo.className = `modal-badge ${isGasto ? 'badge-gasto' : 'badge-ingreso'}`;
    document.getElementById('g-m-pago').innerText = row.formaPago || '—';
    const recibos = document.getElementById('g-m-recibos');
    recibos.innerHTML = (row.fotos && row.fotos.length > 5)
        ? row.fotos.split(',').filter(u => u.trim()).map(u => `<a href="${u.trim()}" target="_blank" class="recibo-link">📄 Ver Recibo</a>`).join('')
        : '<span class="text-muted">Sin recibos adjuntos</span>';
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
    if (!confirm('¿Eliminar este movimiento definitivamente?')) return;
    gastos_cerrarModal();
    const status = document.getElementById('g-status');
    status.innerText = '🗑️ Borrando...';
    try {
        if (gastosState.logSheetId === null) gastosState.logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
        await sheetsDeleteRow(SPREADSHEET_LOG_ID, gastosState.logSheetId, row.rowNum - 1);
        status.innerText = '✅ Eliminado'; status.style.color = 'var(--accent-green)';
        gastos_cargarHistorial();
    } catch(e) {
        console.error(e); status.innerText = '❌ Error al borrar'; status.style.color = '#f87171';
    }
}

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
            sheetsGet(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:F').catch(() => []),  // col F = Pagado
            sheetsGet(SPREADSHEET_FIXED_ID, 'Categorias!A:A').catch(() => [])
        ]);
        fijosState.categorias = catRows.map(r => r[0]).filter(Boolean);
        if (!fijosState.categorias.length) fijosState.categorias = ['General'];

        // ── Monthly Reset ──────────────────────────────────────────────
        // If month changed since last reset, clear all 'Pagado' checkboxes
        const nowMonth = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
        const storedMonth = localStorage.getItem(RESET_MONTH_KEY);
        if (storedMonth && storedMonth !== nowMonth && rows.length > 0) {
            console.log('[fijos] Nuevo mes detectado — reseteando columna Pagado');
            // Build batch: set F2:F(n) all to FALSE
            const lastRow = rows.length + 1;
            await sheetsUpdate(
                SPREADSHEET_FIXED_ID,
                `Hoja 1!F2:F${lastRow}`,
                rows.map(() => ['FALSE'])
            ).catch(e => console.warn('Reset mensual falló:', e));
        }
        // Always store current month
        localStorage.setItem(RESET_MONTH_KEY, nowMonth);
        // ─────────────────────────────────────────────────────────────

        fijosState.allItems = rows.map((row, i) => {
            // Dates come as serial numbers (UNFORMATTED_VALUE) or ISO strings
            const d      = parseSheetDate(row[0]);
            const g      = parseSheetValue(row[2]);
            const n      = parseSheetValue(row[3]);
            // Checkboxes come as boolean true/false (UNFORMATTED_VALUE)
            const isPaid = parseBool(row[5]);
            return {
                id: i + 2,
                fecha: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
                fechaValue: d.toISOString().split('T')[0],
                concepto:   row[1] || '',
                monto:      g || n,
                tipo:       g > 0 ? 'gasto' : 'ingreso',
                categoria:  row[4] || 'General',
                isPaid,
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
        const paidCls  = item.isPaid ? 'pagado-btn pagado-btn--paid' : 'pagado-btn pagado-btn--pending';
        const paidLbl  = item.isPaid ? '✅ Pagado' : '⏳ Pendiente';
        return `<div class="movimiento-card ${item.isPaid ? 'card-paid' : ''}">
          <div class="mc-left">
            <span class="mc-fecha">${item.fecha}</span>
            <span class="mc-lugar">${item.concepto}</span>
            <span class="mc-concepto">${item.categoria}</span>
          </div>
          <div class="mc-right" style="align-items:flex-end;gap:.5rem">
            <span class="mc-monto ${cls}">${sign}${fmt.format(item.monto)}</span>
            <button class="${paidCls}" onclick="fijos_togglePagado(${item.id}, ${item.isPaid})">${paidLbl}</button>
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

/**
 * Toggle Pagado status in Sheets + auto-post to Control de Gastos when paid.
 * @param {number} id   - The row number in the spreadsheet (1-based)
 * @param {boolean} wasPaid - Current state before toggle
 */
window.fijos_togglePagado = async function(id, wasPaid) {
    const item = fijosState.allItems.find(i => i.id === id);
    if (!item) return;
    const nowPaid = !wasPaid;

    // Optimistic UI update
    item.isPaid = nowPaid;
    fijos_aplicarFiltros();

    try {
        // 1) Write TRUE/FALSE to the Pagado column (F) in Gastos Fijos
        await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!F${id}:F${id}`, [[nowPaid ? 'TRUE' : 'FALSE']]);

        // 2) If marking as PAID → auto-append entry in Control de Gastos
        if (nowPaid) {
            const fecha    = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const lugar    = 'Gasto Fijo';
            const concepto = item.concepto;
            // Always use positive amount; these are always expenses
            const monto    = Math.abs(item.monto);
            const tipo     = 'Gasto';
            const forma    = item.categoria || 'General';
            await sheetsAppend(
                SPREADSHEET_LOG_ID,
                'Hoja 1!A:G',
                [[fecha, lugar, concepto, monto, tipo, forma, '']]
            );
            tabInited.gastos = false;
            showToast('✅ Pago registrado en Control de Gastos');
        } else {
            // UN-SYNC: Find and delete the most recent matching entry in Control de Gastos
            try {
                const logSheetId = await getSheetId(SPREADSHEET_LOG_ID, 'Hoja 1');
                const logRows = await sheetsGet(SPREADSHEET_LOG_ID, 'Hoja 1!A:G');
                let foundRowIndex = -1;
                // Search from bottom-to-top by lugar+concepto (not by monto, since stored value may differ)
                for (let i = logRows.length - 1; i >= 0; i--) {
                    const r = logRows[i];
                    if ((r[1] || '') === 'Gasto Fijo' && (r[2] || '') === item.concepto) {
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
        console.error('Error toggling Pagado:', e);
        // Revert optimistic update
        item.isPaid = wasPaid;
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
    const editId  = document.getElementById('f-edit-id').value;
    if (!concepto || !monto) return;
    const cats   = [...document.querySelectorAll('.f-cat-chk:checked')].map(cb => cb.value);
    const catStr = cats.length ? cats.join(', ') : 'General';
    const gasto  = tipo === 'gasto'   ? monto : '';
    const ingreso= tipo === 'ingreso' ? monto : '';
    btn.disabled = true; btn.innerText = 'Guardando...';
    try {
        if (editId) {
            // preserve col F (Pagado) when editing — only update A:E
            await sheetsUpdate(SPREADSHEET_FIXED_ID, `Hoja 1!A${editId}:E${editId}`, [[fecha, concepto, gasto, ingreso, catStr]]);
        } else {
            // new rows start as not paid (FALSE in col F)
            await sheetsAppend(SPREADSHEET_FIXED_ID, 'Hoja 1!A:F', [[fecha, concepto, gasto, ingreso, catStr, 'FALSE']]);
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

/** Parse a date that may be a Google Sheets serial number or an ISO string */
function parseSheetDate(val) {
    if (!val) return new Date();
    if (typeof val === 'number') {
        // Google Sheets serial: days since Dec 30, 1899
        return new Date(Date.UTC(1899, 11, 30) + val * 86400000);
    }
    const d = new Date(val);
    return isNaN(d) ? new Date() : d;
}

function showToast(msg) {
    const t = document.createElement('div');
    t.innerText = msg;
    t.className = 'toast-msg';
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 100);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}
