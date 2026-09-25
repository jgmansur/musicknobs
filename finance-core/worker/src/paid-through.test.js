import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    estaPagadoHasta, normalizarFecha, ultimoDiaDelMes,
} from '../../shared/paid-through.js';

test('pagado hasta incluye la fecha límite y vence al día siguiente', () => {
    assert.equal(estaPagadoHasta('2027-06-15', '2027-06-14'), true);
    assert.equal(estaPagadoHasta('2027-06-15', '2027-06-15'), true);
    assert.equal(estaPagadoHasta('2027-06-15', '2027-06-16'), false);
});

test('acepta una fecha ISO de Postgres y rechaza fechas inválidas', () => {
    assert.equal(normalizarFecha('2027-06-15T00:00:00.000Z'), '2027-06-15');
    assert.equal(normalizarFecha('2027-02-29'), null);
    assert.equal(estaPagadoHasta('', '2027-06-15'), false);
});

test('calcula el último día del mes para consultas de pendientes', () => {
    assert.equal(ultimoDiaDelMes('2027-02'), '2027-02-28');
    assert.equal(ultimoDiaDelMes('2028-02'), '2028-02-29');
    assert.equal(ultimoDiaDelMes('2027-13'), null);
});
