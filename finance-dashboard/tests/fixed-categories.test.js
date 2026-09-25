import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SIN_CATEGORIA, categoriaPrincipalFijo, resumenGastosFijosPorCategoria,
} from '../fixed-categories.js';

test('ignora etiquetas internas y trata General como Sin categoría', () => {
    assert.equal(categoriaPrincipalFijo('__tipo_gasto, Suscripción'), 'Suscripción');
    assert.equal(categoriaPrincipalFijo('General'), SIN_CATEGORIA);
    assert.equal(categoriaPrincipalFijo(''), SIN_CATEGORIA);
});

test('cada fijo aporta una sola vez aunque tenga varias etiquetas', () => {
    assert.equal(categoriaPrincipalFijo('Educación, Familia'), 'Educación');
});

test('suma el gasto completo del mes sin importar pagador ni estado de pago', () => {
    const resumen = resumenGastosFijosPorCategoria([
        { tipo: 'gasto', isDueThisMonth: true, categoria: 'Educación', monto: 100, pagador: 'yo', isPaid: true },
        { tipo: 'gasto', isDueThisMonth: true, categoria: 'Educación', monto: 50, pagador: 'esposa', isPaid: false },
        { tipo: 'gasto', isDueThisMonth: false, categoria: 'Educación', monto: 999 },
        { tipo: 'ingreso', isDueThisMonth: true, categoria: 'Educación', monto: 500 },
        { tipo: 'gasto', isDueThisMonth: true, categoria: 'General', monto: 25 },
    ]);
    assert.deepEqual(resumen, [
        { categoria: 'Educación', monto: 150, cantidad: 2 },
        { categoria: SIN_CATEGORIA, monto: 25, cantidad: 1 },
    ]);
});
