import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldShowFixedItem } from '../fixed-list.js';

test('the default fixed-expense list stays scoped to the current month', () => {
    assert.equal(shouldShowFixedItem({ concepto: 'Internet', categoria: 'Casa', isDueThisMonth: true }), true);
    assert.equal(shouldShowFixedItem({ concepto: 'Seguro Taos', categoria: 'Seguros', isDueThisMonth: false }), false);
});

test('text search finds catalog items that are not due this month', () => {
    const annualExpense = { concepto: 'Seguro Taos', categoria: 'Seguros', isDueThisMonth: false };

    assert.equal(shouldShowFixedItem(annualExpense, 'Seguro Taos'), true);
    assert.equal(shouldShowFixedItem(annualExpense, 'seguros'), true);
    assert.equal(shouldShowFixedItem(annualExpense, 'Colegiatura'), false);
});

test('the fixed-expense page uses catalog-aware search without adding out-of-month items to totals', async () => {
    const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');

    assert.match(mainSource, /shouldShowFixedItem\(item, q\)/);
    assert.match(mainSource, /lista\.filter\(\(item\) => item\.isDueThisMonth\)\.forEach/);
    assert.match(mainSource, /No corresponde a este mes/);
});
