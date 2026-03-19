import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } from 'lucide';
import ApexCharts from 'apexcharts';

// --- CONFIGURACIÓN ---
const CLIENT_ID = '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SPREADSHEET_LOG_ID = '1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw';
const SPREADSHEET_FIXED_ID = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA';

const APP_VERSION = 'v2.0.4';
const TOKEN_KEY = 'google_access_token_v2';
let accessToken = localStorage.getItem(TOKEN_KEY);
if (accessToken === 'undefined' || accessToken === 'null') accessToken = null;
let tokenClient;

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    initAuth();
    setupEventListeners();
    
    // UI Version Tag
    document.querySelector('.subtitle').innerText += ` | ${APP_VERSION}`;
    
    console.log('Auth initialized. Token present:', !!accessToken);
    
    if (accessToken) {
        fetchAndProcess();
    } else {
        console.log('No token found, showing login modal');
        showLoginModal();
    }
});

function initIcons() {
    createIcons({
        icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp }
    });
}

function initAuth() {
    // Inicializar el cliente de Identity Services
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                localStorage.setItem('google_access_token', accessToken);
                hideLoginModal();
                fetchAndProcess();
            }
        },
    });
}

function setupEventListeners() {
    document.getElementById('refresh-btn').addEventListener('click', fetchAndProcess);
    document.getElementById('login-google-btn').addEventListener('click', () => {
        tokenClient.requestAccessToken();
    });
}

function showLoginModal() {
    document.getElementById('modal-api').style.display = 'block';
}

function hideLoginModal() {
    document.getElementById('modal-api').style.display = 'none';
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
        statusLabel.innerText = 'Sincronizado';
        statusLabel.style.color = 'var(--accent-green)';
    } catch (error) {
        console.error('Fetch Error:', error);
        statusLabel.innerText = 'Sesión Expirada';
        statusLabel.style.color = 'var(--accent-orange)';
        
        if (error.status === 401 || error.status === 403) {
            localStorage.removeItem(TOKEN_KEY);
            accessToken = null;
            showLoginModal();
        }
    }
}

async function fetchSheetData(spreadsheetId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw { status: response.status, message: await response.text() };
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

    // Procesar Gasto Hormiga (Sheets LOG)
    // Asumimos: A=Fecha, B=Firma, C=Concepto, D=Monto, E=Tipo, F=Categoría
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

    // Procesar Gastos Fijos (Sheets FIXED)
    // Asumimos: A=Certeza, B=Concepto, C=Monto, D=Descripción, E=Día
    const fixedExpenses = fixedRows.map(row => {
        const concepto = row[1];
        const monto = parseFloat(row[2]) || 0;
        
        // Verificar si existe un pago en el Log para este concepto este mes
        const isPaid = logRows.some(logRow => 
            logRow[2].toLowerCase().includes(concepto.toLowerCase()) && 
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
    // Agrupar por fecha
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
