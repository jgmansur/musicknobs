import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fijoParaAprobar } from '../../shared/movimientos.js';

/**
 * Por qué existe este archivo.
 *
 * `aprobarPendiente` resolvía el gasto fijo con
 * `overrides.fixedExpenseId ?? p.suggested_fixed_expense_id`.
 *
 * Ese `??` hace imposible QUITAR el fijo: si Jay abre el editor y elige
 * "— ninguno —", el override llega como `null`, y `??` lo trata igual que "no
 * dijiste nada" y vuelve a caer en el que sugirió el parser. O sea, justo en el
 * fijo equivocado que estaba corrigiendo.
 *
 * Es la diferencia entre "no opiné" (la clave no viene) y "opiné que ninguno"
 * (la clave viene en null). `??` no las distingue; la presencia de la clave sí.
 */

const pendiente = { suggested_fixed_expense_id: 'protools' };

test('sin opinión, se respeta lo que sugirió el parser', () => {
    assert.equal(fijoParaAprobar({}, pendiente), 'protools');
});

test('con una corrección, gana la corrección', () => {
    assert.equal(fijoParaAprobar({ fixedExpenseId: 'telcel-jay' }, pendiente), 'telcel-jay');
});

/** El caso que el `??` rompía. */
test('elegir "ninguno" deja el movimiento SIN fijo, no vuelve al sugerido', () => {
    assert.equal(fijoParaAprobar({ fixedExpenseId: null }, pendiente), null);
    assert.equal(fijoParaAprobar({ fixedExpenseId: '' }, pendiente), null);
});

test('si el parser no sugirió nada y nadie corrige, no hay fijo', () => {
    assert.equal(fijoParaAprobar({}, { suggested_fixed_expense_id: null }), null);
});

test('se puede asignar un fijo a algo que el parser no emparejó', () => {
    assert.equal(
        fijoParaAprobar({ fixedExpenseId: 'telcel-jay' }, { suggested_fixed_expense_id: null }),
        'telcel-jay',
    );
});
