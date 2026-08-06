import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizarPeriodicidad, tocaEsteMes, diferenciaEnMeses, PERIODICIDADES,
} from '../../shared/periodicidad.js';

/**
 * Por qué existe este archivo.
 *
 * La periodicidad vivía SOLO en el dashboard y el backend la ignoraba: la lista
 * de fijos pendientes devolvía todos los activos, tocaran o no ese mes. Con un
 * único fijo bimestral (Luz Casa Galería, inicio 2026-03) eso ya inflaba el
 * total de agosto con $3,000 que no tocaban.
 *
 * Al agregar semestral y anual el error escalaría: un gasto anual aparecería
 * pendiente once meses de cada doce.
 */

test('el catálogo declara los pasos de mes esperados', () => {
    assert.equal(PERIODICIDADES.mensual, 1);
    assert.equal(PERIODICIDADES.bimestral, 2);
    assert.equal(PERIODICIDADES.semestral, 6);
    assert.equal(PERIODICIDADES.anual, 12);
});

test('mensual toca siempre, haya o no mes de inicio', () => {
    assert.equal(tocaEsteMes('mensual', '2026-01', '2026-08'), true);
    assert.equal(tocaEsteMes('mensual', null, '2026-08'), true);
});

/** El caso real que estaba mal contado. */
test('bimestral: Luz Casa Galería (inicio 2026-03) NO toca en agosto', () => {
    assert.equal(tocaEsteMes('bimestral', '2026-03', '2026-08'), false); // diff 5
    assert.equal(tocaEsteMes('bimestral', '2026-03', '2026-07'), true);  // diff 4
    assert.equal(tocaEsteMes('bimestral', '2026-03', '2026-09'), true);  // diff 6
});

test('semestral toca cada seis meses desde el inicio', () => {
    assert.equal(tocaEsteMes('semestral', '2026-02', '2026-02'), true);
    assert.equal(tocaEsteMes('semestral', '2026-02', '2026-08'), true);
    assert.equal(tocaEsteMes('semestral', '2027-02', '2027-02'), true);
    for (const mes of ['2026-03', '2026-05', '2026-07', '2026-09', '2027-01']) {
        assert.equal(tocaEsteMes('semestral', '2026-02', mes), false, `falló en ${mes}`);
    }
});

test('anual toca una vez al año, el mismo mes', () => {
    assert.equal(tocaEsteMes('anual', '2026-04', '2026-04'), true);
    assert.equal(tocaEsteMes('anual', '2026-04', '2027-04'), true);
    assert.equal(tocaEsteMes('anual', '2026-04', '2028-04'), true);
    for (const mes of ['2026-05', '2026-10', '2027-03', '2027-05']) {
        assert.equal(tocaEsteMes('anual', '2026-04', mes), false, `falló en ${mes}`);
    }
});

test('cruza el cambio de año sin perder la cuenta', () => {
    assert.equal(diferenciaEnMeses('2026-11', '2027-01'), 2);
    assert.equal(tocaEsteMes('bimestral', '2026-11', '2027-01'), true);
    assert.equal(tocaEsteMes('semestral', '2026-11', '2027-05'), true);
    assert.equal(tocaEsteMes('anual', '2026-11', '2027-11'), true);
});

test('antes del mes de inicio todavía no toca', () => {
    assert.equal(tocaEsteMes('semestral', '2026-08', '2026-02'), false);
    assert.equal(tocaEsteMes('anual', '2027-01', '2026-12'), false);
});

/**
 * Una cuota de deuda no sigue el calendario: se paga todos los meses hasta
 * liquidarla, así que solo importa que ya haya empezado.
 */
test('la cuota de deuda toca todos los meses desde que arranca', () => {
    assert.equal(tocaEsteMes('Cuota de Deuda', '2026-03', '2026-08'), true);
    assert.equal(tocaEsteMes('Cuota de Deuda', '2026-03', '2026-04'), true);
    assert.equal(tocaEsteMes('Cuota de Deuda', '2026-09', '2026-08'), false);
});

/**
 * El error tiene que doler del lado seguro: mostrar de más un fijo es molesto,
 * pero esconderlo hace que no se pague.
 */
test('ante lo desconocido o lo incompleto, asume que toca', () => {
    assert.equal(normalizarPeriodicidad('quincenal'), 'mensual');
    assert.equal(normalizarPeriodicidad(null), 'mensual');
    assert.equal(normalizarPeriodicidad(''), 'mensual');
    assert.equal(tocaEsteMes('semestral', null, '2026-08'), true);
    assert.equal(tocaEsteMes('anual', 'basura', '2026-08'), true);
});

test('no depende de mayúsculas ni de espacios sobrantes', () => {
    assert.equal(normalizarPeriodicidad('  SEMESTRAL '), 'semestral');
    assert.equal(normalizarPeriodicidad('Anual'), 'anual');
    assert.equal(normalizarPeriodicidad('cuota de deuda'), 'Cuota de Deuda');
});
