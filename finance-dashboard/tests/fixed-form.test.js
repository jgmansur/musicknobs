import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMoneyInput, validateFixedForm } from '../fixed-form.js';

test('accepts common Mexican money formats', () => {
    assert.equal(parseMoneyInput('$15,000'), 15000);
    assert.equal(parseMoneyInput('15,000.50'), 15000.5);
    assert.equal(parseMoneyInput('15000,50'), 15000.5);
});

test('annual fixed expenses require an explicit starting month', () => {
    assert.deepEqual(validateFixedForm({ concept: 'Seguro', amount: 12000, periodicity: 'anual', startMonth: '' }), {
        ok: false, field: 'startMonth', message: 'Selecciona el mes en que comienza este gasto anual o periódico.',
    });
    assert.deepEqual(validateFixedForm({ concept: 'Seguro', amount: 12000, periodicity: 'anual', startMonth: '2026-09' }), { ok: true });
});

test('missing concept or amount returns an actionable validation message', () => {
    assert.equal(validateFixedForm({ concept: '', amount: 1, periodicity: 'mensual' }).field, 'concept');
    assert.equal(validateFixedForm({ concept: 'Seguro', amount: 0, periodicity: 'mensual' }).field, 'amount');
});

test('fixed expense save passes the parsed periodicity into validation', async () => {
    const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
    assert.match(
        mainSource,
        /validateFixedForm\(\{[\s\S]*?periodicity:\s*periodicidad,[\s\S]*?startMonth:\s*inicioMesRaw[\s\S]*?\}\)/,
    );
});
