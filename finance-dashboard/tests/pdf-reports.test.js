import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFixedReportModel,
    buildMonthlyExpensesReportModel,
    createFixedExpensesPdf,
    createMonthlyExpensesPdf,
} from '../pdf-reports.js';

const reportDate = new Date(2026, 8, 25);

test('fixed report lists the full catalog but totals only entries due this month', () => {
    const items = [
        { concepto: 'Nómina', categoria: 'Trabajo', tipo: 'ingreso', monto: 10000, pagosMes: 1, pagosHechos: 1, isPaid: true, isDueThisMonth: true },
        { concepto: 'Colegiatura', categoria: 'Educación', tipo: 'gasto', monto: 3000, pagosMes: 1, pagosHechos: 0, isPaid: false, isDueThisMonth: true },
        { concepto: 'Seguro anual', categoria: 'Seguros', tipo: 'gasto', monto: 12000, pagosMes: 1, pagosHechos: 0, isPaid: false, isDueThisMonth: false },
    ];
    const model = buildFixedReportModel(items, reportDate);
    assert.equal(model.ingresos.length, 1);
    assert.equal(model.gastos.length, 2);
    assert.deepEqual(model.summary, { incomeTotal: 10000, expenseTotal: 3000, pendingTotal: 3000, net: 7000 });
});

test('monthly expenses report excludes ingresos and other months', () => {
    const rows = [
        { fecha: '2026-09-01', tipo: 'Gasto', monto: 100, lugar: 'Oxxo' },
        { fecha: '2026-09-02', tipo: 'Ingreso', monto: 900 },
        { fecha: '2026-08-31', tipo: 'Gasto', monto: 250 },
        { fecha: '2026-09-15', tipo: 'Gasto', monto: 50, lugar: 'Café' },
    ];
    const model = buildMonthlyExpensesReportModel(
        rows,
        [{ lugar: 'Oxxo', concepto: 'Refresco', monto: 35 }],
        [{ fecha: '2026-09-01', comercio: 'Oxxo', productNormalized: 'Refresco', totalItem: 35 }],
        reportDate,
    );
    assert.equal(model.expenses.length, 2);
    assert.equal(model.summary.total, 150);
    assert.equal(model.summary.hormigaTotal, 35);
    assert.equal(model.summary.itemizedHormigaTotal, 35);
});

test('both report generators create valid PDF bytes', () => {
    const fixed = createFixedExpensesPdf({
        items: [{ concepto: 'Internet', categoria: 'Casa', tipo: 'gasto', monto: 800, pagosMes: 1, pagosHechos: 0, isPaid: false, isDueThisMonth: true }],
        reportDate,
    });
    const monthly = createMonthlyExpensesPdf({
        rows: [{ fecha: '2026-09-10', tipo: 'Gasto', monto: 125, lugar: 'Café', concepto: 'Desayuno', formaPago: 'Santander' }],
        hormigaEntries: [{ lugar: 'Café', concepto: 'Desayuno', monto: 125 }],
        reportDate,
    });
    assert.ok(fixed.output('arraybuffer').byteLength > 1000);
    assert.ok(monthly.output('arraybuffer').byteLength > 1000);
});
