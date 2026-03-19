import './style.css'
import ApexCharts from 'apexcharts'
import { createIcons, RefreshCw, AlertTriangle, CalendarCheck, TrendingUp } from 'lucide';

// --- CONFIGURATION ---
const SPREADSHEET_ID_CONTROL = '1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw';
const SPREADSHEET_ID_FIXED = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA';

// --- STATE MANAGEMENT ---
let apiKey = localStorage.getItem('google_sheets_api_key');
let chartInstance = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    checkApiKey();
    setupEventListeners();
    if (apiKey) refreshData();
});

function initIcons() {
    createIcons({
        icons: { RefreshCw, AlertTriangle, CalendarCheck, TrendingUp }
    });
}

function setupEventListeners() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', refreshData);

    const saveApiKeyBtn = document.getElementById('save-api-key');
    saveApiKeyBtn.addEventListener('click', () => {
        const input = document.getElementById('api-key-input').value;
        if (input) {
            apiKey = input;
            localStorage.setItem('google_sheets_api_key', apiKey);
            document.getElementById('modal-api').style.display = 'none';
            refreshData();
        }
    });
}

function checkApiKey() {
    if (!apiKey) {
        document.getElementById('modal-api').style.display = 'block';
    }
}

// --- DATA FETCHING ---
async function refreshData() {
    const statusBadge = document.getElementById('sync-status');
    statusBadge.innerText = 'Sincronizando...';
    statusBadge.style.color = 'var(--primary)';

    try {
        const [controlData, fixedData] = await Promise.all([
            fetchSheetData(SPREADSHEET_ID_CONTROL, 'Hoja 1!A2:F'),
            fetchSheetData(SPREADSHEET_ID_FIXED, 'Hoja 1!A2:E')
        ]);

        processAndRender(controlData, fixedData);
        
        statusBadge.innerText = 'Sincronizado';
        statusBadge.style.color = 'var(--accent-green)';
    } catch (error) {
        console.error('Fetch Error:', error);
        statusBadge.innerText = 'Error de Conexión';
        statusBadge.style.color = 'var(--accent-orange)';
        if (error.status === 403 || error.status === 401) {
            localStorage.removeItem('google_sheets_api_key');
            checkApiKey();
        }
    }
}

async function fetchSheetData(spreadsheetId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw { status: response.status, message: await response.text() };
    const data = await response.json();
    return data.values || [];
}

// --- DATA PROCESSING ---
function processAndRender(controlRows, fixedRows) {
    // 1. Gasto Hormiga (Logic: Specific keywords from Jay's spending patterns)
    const hormigaKeywords = [
        'oxxo', 'coca', 'cigarros', 'snacks', 'gomitas', 'vuse', 'tiendita', 
        'starbucks', 'seven', '7-eleven', 'extra', 'dulces', 'chicles'
    ];
    let hormigaTotal = 0;
    const hormigaHistory = [];

    // Map daily log to calculate Hormiga
    controlRows.forEach(row => {
        const concepto = (row[2] || '').toLowerCase();
        const lugar = (row[1] || '').toLowerCase();
        const monto = parseFloat(row[3]) || 0;
        const fechaStr = row[0] || '';

        const isHormiga = hormigaKeywords.some(kw => concepto.includes(kw) || lugar.includes(kw));
        
        if (isHormiga && row[4] === 'Gasto') {
            hormigaTotal += monto;
            hormigaHistory.push({ x: fechaStr, y: monto });
        }
    });

    // 2. Fixed Expenses & Payment Status
    const currentMonthFixedRows = fixedRows.map(row => {
        const concepto = row[1];
        const monto = parseFloat(row[2]) || 0;
        
        // Find if paid in Control Sheet (Concept match)
        const isPaid = controlRows.some(cRow => 
            cRow[2].toLowerCase().includes(concepto.toLowerCase()) && parseFloat(cRow[3]) > 0
        );

        return { concepto, monto, isPaid };
    });

    const fixedTotal = currentMonthFixedRows.reduce((acc, curr) => acc + curr.monto, 0);
    const totalPaidCount = currentMonthFixedRows.filter(r => r.isPaid).length;

    // 3. Update UI Scorecards
    document.getElementById('gasto-hormiga-total').innerText = formatCurrency(hormigaTotal);
    document.getElementById('gastos-fijos-total').innerText = formatCurrency(fixedTotal);
    document.getElementById('pago-status').innerText = `${totalPaidCount}/${currentMonthFixedRows.length} Pagados`;
    
    // 4. Render Table
    renderFixedTable(currentMonthFixedRows);

    // 5. Render Chart
    renderChart(hormigaHistory);
}

function renderFixedTable(rows) {
    const tbody = document.getElementById('fixed-expenses-body');
    tbody.innerHTML = rows.map(row => `
        <tr>
            <td>${row.concepto}</td>
            <td style="font-weight: 600;">${formatCurrency(row.monto)}</td>
            <td>
                <span class="badge ${row.isPaid ? 'success' : 'warning'}">
                    ${row.isPaid ? 'PAGADO' : 'PENDIENTE'}
                </span>
            </td>
        </tr>
    `).join('');
}

function renderChart(history) {
    // Group history by date
    const grouped = history.reduce((acc, curr) => {
        const date = curr.x.split(' ')[0]; // YYYY-MM-DD
        acc[date] = (acc[date] || 0) + curr.y;
        return acc;
    }, {});

    const seriesData = Object.entries(grouped).map(([x, y]) => ({ x: new Date(x).getTime(), y }));
    seriesData.sort((a, b) => a.x - b.x);

    const options = {
        series: [{ name: 'Gasto Hormiga', data: seriesData }],
        chart: {
            type: 'area',
            height: 350,
            foreColor: '#94a3b8',
            toolbar: { show: false },
            zoom: { enabled: false }
        },
        colors: ['#fbbf24'],
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.2, stops: [0, 90, 100] }
        },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { type: 'datetime' },
        tooltip: { theme: 'dark' },
        grid: { borderColor: 'rgba(255,255,255,0.05)' }
    };

    if (chartInstance) {
        chartInstance.updateSeries([{ data: seriesData }]);
    } else {
        chartInstance = new ApexCharts(document.querySelector("#chart-hormiga"), options);
        chartInstance.render();
    }
}

function formatCurrency(val) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
}
