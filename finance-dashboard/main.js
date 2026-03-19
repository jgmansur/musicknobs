import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } from 'lucide';
import ApexCharts from 'apexcharts';

// --- CONFIGURACIÓN ---
const CLIENT_ID = '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SPREADSHEET_LOG_ID = '1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw';
const SPREADSHEET_FIXED_ID = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA';

const APP_VERSION = 'v2.0.5';
const TOKEN_KEY = 'google_access_token_v2';

let accessToken = localStorage.getItem(TOKEN_KEY);
if (!accessToken || accessToken === 'undefined' || accessToken === 'null') {
    accessToken = null;
    // Force-clear any stale keys from previous versions
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_access_token_v2');
}

let tokenClient = null;

// --- INICIALIZACIÓN INMEDIATA DEL DOM ---
document.addEventListener('DOMContentLoaded', () => {
    // Render icons
    createIcons({ icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } });

    // Show version
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.innerText = `Music Knobs | ${APP_VERSION}`;

    // Event: refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        if (accessToken) {
            fetchAndProcess();
        } else {
            showLoginModal();
        }
    });

    // Event: login button — inicia Google OAuth solo cuando el usuario hace click
    document.getElementById('login-google-btn').addEventListener('click', () => {
        startGoogleLogin();
    });

    // DECISIÓN PRINCIPAL: mostrar modal o datos
    if (accessToken) {
        hideLoginModal();
        fetchAndProcess();
    } else {
        showLoginModal();
    }

    console.log(`[${APP_VERSION}] App loaded. Token: ${accessToken ? 'present' : 'none'}`);
});

// --- GOOGLE OAUTH ---
function startGoogleLogin() {
    // Si Google GIS ya está cargado, usar directamente
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        requestToken();
    } else {
        // Esperar a que cargue el script de Google
        const btn = document.getElementById('login-google-btn');
        btn.innerText = 'Cargando...';
        btn.disabled = true;
        
        const checkInterval = setInterval(() => {
            if (window.google && window.google.accounts && window.google.accounts.oauth2) {
                clearInterval(checkInterval);
                btn.innerText = 'Iniciar Sesión con Google';
                btn.disabled = false;
                requestToken();
            }
        }, 200);

        // Timeout después de 10 segundos
        setTimeout(() => {
            clearInterval(checkInterval);
            btn.innerText = 'Error: reintenta';
            btn.disabled = false;
            console.error('Google GIS script did not load in time.');
        }, 10000);
    }
}

function requestToken() {
    if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                    accessToken = tokenResponse.access_token;
                    localStorage.setItem(TOKEN_KEY, accessToken);
                    hideLoginModal();
                    fetchAndProcess();
                } else {
                    console.error('Token error:', tokenResponse);
                    showLoginModal();
                }
            },
        });
    }
    tokenClient.requestAccessToken();
}

// --- MODAL ---
function showLoginModal() {
    const modal = document.getElementById('modal-api');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
    }
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.style.display = 'block';
}

function hideLoginModal() {
    const modal = document.getElementById('modal-api');
    if (modal) modal.style.display = 'none';
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
}

// --- LÓGICA DE DATOS ---
async function fetchAndProcess() {
    const statusLabel = document.getElementById('sync-status');
    statusLabel.innerText = 'Sincronizando...';
    statusLabel.style.color = 'var(--primary)';

    try {
        const [logData, fixedData] = await Promise.all([
            fetchSheetData(SPREADSHEET_LOG_ID, 'Hoja 1!A2:F'),
            fetchSheetData(SPREADSHEET_FIXED_ID, 'Hoja 1!A2:E')
        ]);

        processAndRender(logData, fixedData);
        statusLabel.innerText = 'Sincronizado ✓';
        statusLabel.style.color = 'var(--accent-green)';
    } catch (error) {
        console.error('Fetch Error:', error);
        
        // Only force re-login on authentication errors (401, 403)
        if (error.status === 401 || error.status === 403) {
            statusLabel.innerText = 'Sesión expirada — inicia sesión de nuevo';
            statusLabel.style.color = 'var(--accent-orange)';
            localStorage.removeItem(TOKEN_KEY);
            accessToken = null;
            showLoginModal();
        } else {
            // For other errors (network, API not enabled, etc), show error without kicking user out
            const msg = error.message ? JSON.parse(error.message)?.error?.message : null;
            statusLabel.innerText = `Error: ${msg || 'No se pudo cargar. Intenta de nuevo.'}`;
            statusLabel.style.color = 'var(--accent-orange)';
            console.error('Non-auth error details:', error.message);
        }
    }
}

async function fetchSheetData(spreadsheetId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw { status: response.status, message: errText };
    }

    const data = await response.json();
    return data.values || [];
}

function processAndRender(logRows, fixedRows) {
    const hormigaKeywords = [
        'oxxo', 'coca', 'cigarros', 'snacks', 'gomitas', 
        'vuse', 'tiendita', 'starbucks', 'seven', 
        '7-eleven', 'extra', 'dulces', 'chicles'
    ];

    let hormigaTotal = 0;
    let hormoneChartData = [];

    logRows.forEach(row => {
        const concepto = (row[2] || '').toLowerCase();
        const categoria = (row[1] || '').toLowerCase();
        const monto = parseFloat(row[3]) || 0;
        const fecha = row[0] || '';

        const isHormiga = hormigaKeywords.some(kw => concepto.includes(kw) || categoria.includes(kw));
        
        if (isHormiga && row[4] === 'Gasto') {
            hormigaTotal += monto;
            hormoneChartData.push({ x: fecha, y: monto });
        }
    });

    const fixedExpenses = fixedRows.map(row => {
        const concepto = row[1] || '';
        const monto = parseFloat(row[2]) || 0;
        
        const isPaid = logRows.some(logRow => 
            (logRow[2] || '').toLowerCase().includes(concepto.toLowerCase()) && 
            parseFloat(logRow[3]) > 0
        );

        return { concepto, monto, isPaid };
    });

    const fixedTotal = fixedExpenses.reduce((sum, item) => sum + item.monto, 0);
    const paidCount = fixedExpenses.filter(e => e.isPaid).length;

    // Actualizar UI
    document.getElementById('gasto-hormiga-total').innerText = formatCurrency(hormigaTotal);
    document.getElementById('gastos-fijos-total').innerText = formatCurrency(fixedTotal);
    document.getElementById('pago-status').innerText = `${paidCount}/${fixedExpenses.length} Pagados`;

    renderFixedTable(fixedExpenses);
    renderChart(hormoneChartData);
}

function renderFixedTable(expenses) {
    const tbody = document.getElementById('fixed-expenses-body');
    if (!expenses.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin datos</td></tr>';
        return;
    }
    tbody.innerHTML = expenses.map(e => `
        <tr>
            <td>${e.concepto}</td>
            <td>${formatCurrency(e.monto)}</td>
            <td>
                <span class="badge ${e.isPaid ? 'paid' : 'pending'}">
                    ${e.isPaid ? 'PAGADO' : 'PENDIENTE'}
                </span>
            </td>
        </tr>
    `).join('');
}

function renderChart(data) {
    const grouped = data.reduce((acc, curr) => {
        acc[curr.x] = (acc[curr.x] || 0) + curr.y;
        return acc;
    }, {});

    const sortedDates = Object.keys(grouped).sort();
    const values = sortedDates.map(d => grouped[d]);

    const options = {
        series: [{ name: 'Gasto Hormiga', data: values }],
        chart: {
            type: 'area',
            height: 250,
            toolbar: { show: false },
            zoom: { enabled: false },
            background: 'transparent'
        },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', colors: ['#fbbf24'] },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.7,
                opacityTo: 0.3,
                stops: [0, 90, 100],
                colorStops: [
                    { offset: 0, color: "#fbbf24", opacity: 0.4 },
                    { offset: 100, color: "#fbbf24", opacity: 0 }
                ]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: sortedDates,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { style: { colors: '#94a3b8' } }
        },
        yaxis: { show: false },
        grid: { borderColor: '#334155', strokeDashArray: 4 },
        tooltip: { theme: 'dark' }
    };

    const chartContainer = document.getElementById('chart-hormiga');
    chartContainer.innerHTML = '';
    const chart = new ApexCharts(chartContainer, options);
    chart.render();
}

function formatCurrency(val) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(val);
}
