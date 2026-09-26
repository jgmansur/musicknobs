import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const COLORS = {
    ink: [30, 41, 59],
    muted: [100, 116, 139],
    line: [226, 232, 240],
    green: [22, 163, 74],
    red: [220, 38, 38],
    orange: [234, 88, 12],
    softGreen: [240, 253, 244],
    softRed: [254, 242, 242],
    softOrange: [255, 247, 237],
};

const money = (value) => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
}).format(Number(value) || 0);

const monthLabel = (date) => new Intl.DateTimeFormat('es-MX', {
    month: 'long', year: 'numeric',
}).format(date);

const shortDate = (value) => {
    const date = dateFromValue(value);
    return date ? new Intl.DateTimeFormat('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(date) : '-';
};

function dateFromValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const raw = (value ?? '').toString().trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
        const d = new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

const sameMonth = (value, target) => {
    const d = dateFromValue(value);
    return !!d && d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
};

const paymentLabel = (item) => item.pagador === 'esposa' ? 'Esposa' : 'Propio';

const pendingAmount = (item) => {
    const parts = Math.max(1, Number(item.pagosMes) || 1);
    const paid = Math.max(0, Number(item.pagosHechos) || 0);
    return Math.abs(Number(item.monto) || 0) / parts * Math.max(0, parts - paid);
};

const fixedCategory = (value) => String(value || '').split(',')
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('__') && part.toLowerCase() !== 'general') || 'Sin categoría';

const fixedStatus = (item) => {
    if (!item.isDueThisMonth) {
        return item.paidThrough ? `Pagado hasta ${shortDate(item.paidThrough)}` : 'No aplica este mes';
    }
    if (item.isPaid) return 'Pagado';
    const parts = Math.max(1, Number(item.pagosMes) || 1);
    const paid = Math.max(0, Number(item.pagosHechos) || 0);
    return parts > 1 ? `${paid}/${parts} pagados` : 'Pendiente';
};

export function buildFixedReportModel(items = [], reportDate = new Date()) {
    const active = items.filter((item) => item && item.concepto);
    const sorted = (type) => active
        .filter((item) => item.tipo === type)
        .sort((a, b) => `${a.categoria}|${a.concepto}`.localeCompare(`${b.categoria}|${b.concepto}`, 'es'));
    const ingresos = sorted('ingreso');
    const gastos = sorted('gasto');
    const dueIncome = ingresos.filter((item) => item.isDueThisMonth);
    const dueExpenses = gastos.filter((item) => item.isDueThisMonth);
    const incomeTotal = dueIncome.reduce((sum, item) => sum + Math.abs(Number(item.monto) || 0), 0);
    const expenseTotal = dueExpenses.reduce((sum, item) => sum + Math.abs(Number(item.monto) || 0), 0);
    const pendingTotal = dueExpenses.reduce((sum, item) => sum + pendingAmount(item), 0);
    const categoryTotals = Object.values(dueExpenses.reduce((groups, item) => {
        const category = fixedCategory(item.categoria);
        groups[category] ||= { category, amount: 0, count: 0 };
        groups[category].amount += Math.abs(Number(item.monto) || 0);
        groups[category].count += 1;
        return groups;
    }, {})).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'es'));
    return {
        title: 'Ingresos y gastos fijos',
        period: monthLabel(reportDate),
        ingresos,
        gastos,
        categoryTotals,
        summary: { incomeTotal, expenseTotal, pendingTotal, net: incomeTotal - expenseTotal },
    };
}

export function buildMonthlyExpensesReportModel(rows = [], hormigaEntries = [], hormigaItems = [], reportDate = new Date()) {
    const expenses = rows
        .filter((row) => (row?.tipo || '').toString().toLowerCase() === 'gasto')
        .filter((row) => sameMonth(row.fecha || row.fechaCreacion, reportDate))
        .sort((a, b) => (dateFromValue(a.fecha || a.fechaCreacion)?.getTime() || 0)
            - (dateFromValue(b.fecha || b.fechaCreacion)?.getTime() || 0));
    const total = expenses.reduce((sum, row) => sum + Math.abs(Number(row.monto) || 0), 0);
    const hormigaTotal = hormigaEntries.reduce((sum, row) => sum + Math.abs(Number(row.monto) || 0), 0);
    const itemizedHormigaTotal = hormigaItems.reduce((sum, row) => sum + Math.abs(Number(row.totalItem) || 0), 0);
    return {
        title: 'Gastos registrados del mes',
        period: monthLabel(reportDate),
        expenses,
        hormigaEntries: [...hormigaEntries].sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0)),
        hormigaItems: [...hormigaItems].sort((a, b) => Number(b.totalItem || 0) - Number(a.totalItem || 0)),
        summary: {
            total,
            count: expenses.length,
            hormigaTotal,
            itemizedHormigaTotal,
            hormigaShare: total > 0 ? hormigaTotal / total : 0,
        },
    };
}

function addHeader(doc, title, period) {
    doc.setTextColor(...COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text(title, 14, 18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(10);
    doc.text(`Finance Dashboard | ${period}`, 14, 25);
    doc.setDrawColor(...COLORS.line);
    doc.line(14, 30, 196, 30);
}

function addSummaryCards(doc, cards, y = 36) {
    const gap = 3;
    const width = (182 - gap * (cards.length - 1)) / cards.length;
    cards.forEach((card, index) => {
        const x = 14 + index * (width + gap);
        doc.setFillColor(...card.fill);
        doc.roundedRect(x, y, width, 21, 2, 2, 'F');
        doc.setTextColor(...COLORS.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(card.label.toUpperCase(), x + 3, y + 6);
        doc.setTextColor(...card.color);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(card.value, x + 3, y + 15, { maxWidth: width - 6 });
    });
    return y + 27;
}

function addSectionTitle(doc, title, subtitle, y) {
    doc.setTextColor(...COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(title, 14, y);
    if (subtitle) {
        doc.setTextColor(...COLORS.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(subtitle, 196, y, { align: 'right' });
    }
    return y + 3;
}

function addFooter(doc) {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(...COLORS.line);
        doc.line(14, 285, 196, 285);
        doc.setTextColor(...COLORS.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(`Generado ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`, 14, 290);
        doc.text(`Página ${page} de ${pages}`, 196, 290, { align: 'right' });
    }
}

const tableStyles = {
    theme: 'grid',
    margin: { left: 14, right: 14, bottom: 17 },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.15 },
    headStyles: { fillColor: COLORS.ink, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
};

function fixedRows(items) {
    return items.map((item) => [
        item.categoria || 'Sin categoría',
        item.concepto || '-',
        item.periodicidad || 'Mensual',
        paymentLabel(item),
        fixedStatus(item),
        money(item.monto),
        item.isDueThisMonth ? money(pendingAmount(item)) : '-',
    ]);
}

export function createFixedExpensesPdf({ items = [], reportDate = new Date() } = {}) {
    const model = buildFixedReportModel(items, reportDate);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    addHeader(doc, model.title, model.period);
    let y = addSummaryCards(doc, [
        { label: 'Ingresos del mes', value: money(model.summary.incomeTotal), color: COLORS.green, fill: COLORS.softGreen },
        { label: 'Gastos del mes', value: money(model.summary.expenseTotal), color: COLORS.red, fill: COLORS.softRed },
        { label: 'Pendiente', value: money(model.summary.pendingTotal), color: COLORS.orange, fill: COLORS.softOrange },
        { label: 'Balance fijo', value: money(model.summary.net), color: model.summary.net >= 0 ? COLORS.green : COLORS.red, fill: model.summary.net >= 0 ? COLORS.softGreen : COLORS.softRed },
    ]);

    y = addSectionTitle(doc, 'Gastos por categoría', `${model.categoryTotals.length} categorías`, y);
    autoTable(doc, {
        ...tableStyles,
        startY: y,
        head: [['Categoría', 'Gastos fijos', 'Total mensual']],
        body: model.categoryTotals.map((row) => [row.category, String(row.count), money(row.amount)]),
        columnStyles: { 0: { cellWidth: 102 }, 1: { cellWidth: 35, halign: 'center' }, 2: { cellWidth: 45, halign: 'right' } },
    });
    y = (doc.lastAutoTable?.finalY || y) + 9;
    if (y > 253) { doc.addPage(); y = 18; }
    y = addSectionTitle(doc, 'Ingresos fijos', `${model.ingresos.length} registros`, y);
    autoTable(doc, {
        ...tableStyles,
        startY: y,
        head: [['Categoría', 'Concepto', 'Periodicidad', 'Pagador', 'Estado', 'Monto', 'Pendiente']],
        body: fixedRows(model.ingresos),
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 39 }, 2: { cellWidth: 23 }, 3: { cellWidth: 18 }, 4: { cellWidth: 31 }, 5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 23, halign: 'right' } },
    });
    y = (doc.lastAutoTable?.finalY || y) + 9;
    if (y > 253) { doc.addPage(); y = 18; }
    y = addSectionTitle(doc, 'Gastos fijos', `${model.gastos.length} registros`, y);
    autoTable(doc, {
        ...tableStyles,
        startY: y,
        head: [['Categoría', 'Concepto', 'Periodicidad', 'Pagador', 'Estado', 'Monto', 'Pendiente']],
        body: fixedRows(model.gastos),
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 39 }, 2: { cellWidth: 23 }, 3: { cellWidth: 18 }, 4: { cellWidth: 31 }, 5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 23, halign: 'right' } },
    });
    addFooter(doc);
    return doc;
}

export function createMonthlyExpensesPdf({ rows = [], hormigaEntries = [], hormigaItems = [], reportDate = new Date() } = {}) {
    const model = buildMonthlyExpensesReportModel(rows, hormigaEntries, hormigaItems, reportDate);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    addHeader(doc, model.title, model.period);
    let y = addSummaryCards(doc, [
        { label: 'Gasto total', value: money(model.summary.total), color: COLORS.red, fill: COLORS.softRed },
        { label: 'Movimientos', value: String(model.summary.count), color: COLORS.ink, fill: [248, 250, 252] },
        { label: 'Gasto hormiga', value: money(model.summary.hormigaTotal), color: COLORS.orange, fill: COLORS.softOrange },
        { label: '% hormiga', value: `${(model.summary.hormigaShare * 100).toFixed(1)}%`, color: COLORS.orange, fill: COLORS.softOrange },
    ]);

    y = addSectionTitle(doc, 'Todos los gastos', `${model.expenses.length} movimientos`, y);
    autoTable(doc, {
        ...tableStyles,
        startY: y,
        head: [['Fecha', 'Lugar', 'Concepto', 'Forma de pago', 'Monto']],
        body: model.expenses.map((row) => [
            shortDate(row.fecha || row.fechaCreacion), row.lugar || '-', row.concepto || '-', row.formaPago || '-', money(row.monto),
        ]),
        columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 35 }, 2: { cellWidth: 65 }, 3: { cellWidth: 35 }, 4: { cellWidth: 26, halign: 'right' } },
    });

    y = (doc.lastAutoTable?.finalY || y) + 9;
    if (y > 245) { doc.addPage(); y = 18; }
    y = addSectionTitle(doc, 'Gasto hormiga detectado', `${model.hormigaEntries.length} registros | ${money(model.summary.hormigaTotal)}`, y);
    autoTable(doc, {
        ...tableStyles,
        startY: y,
        head: [['Lugar', 'Concepto', 'Monto hormiga']],
        body: model.hormigaEntries.map((row) => [row.lugar || '-', row.concepto || '-', money(row.monto)]),
        columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 101 }, 2: { cellWidth: 36, halign: 'right' } },
    });

    if (model.hormigaItems.length) {
        y = (doc.lastAutoTable?.finalY || y) + 9;
        if (y > 245) { doc.addPage(); y = 18; }
        y = addSectionTitle(doc, 'Productos hormiga itemizados', `${model.hormigaItems.length} productos | ${money(model.summary.itemizedHormigaTotal)}`, y);
        autoTable(doc, {
            ...tableStyles,
            startY: y,
            head: [['Fecha', 'Comercio', 'Producto', 'Grupo', 'Total']],
            body: model.hormigaItems.map((item) => [
                shortDate(item.fecha), item.comercio || '-', item.productNormalized || item.productRaw || '-', item.grupoProducto || '-', money(item.totalItem),
            ]),
            columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 37 }, 2: { cellWidth: 55 }, 3: { cellWidth: 43 }, 4: { cellWidth: 26, halign: 'right' } },
        });
    }
    addFooter(doc);
    return doc;
}

export function downloadFixedExpensesPdf(options = {}) {
    const date = options.reportDate || new Date();
    createFixedExpensesPdf(options).save(`fijos-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.pdf`);
}

export function downloadMonthlyExpensesPdf(options = {}) {
    const date = options.reportDate || new Date();
    createMonthlyExpensesPdf(options).save(`gastos-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.pdf`);
}
