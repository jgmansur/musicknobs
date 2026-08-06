import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esIdDeWorker } from '../../shared/ids.js';

/**
 * Por qué existe este archivo.
 *
 * Editar un gasto fallaba SIEMPRE con "Unable to parse range" de la API de
 * Sheets. La causa: `gastos_editarDesdeModal` guardaba el id en el formulario y
 * después llamaba a `gastos_cerrarModal()`, que pone `detailRow = null`. Al
 * guardar, el guard preguntaba por `gastosState.detailRow?.id` — ya nulo — así
 * que TODO caía en la rama vieja de Sheets, que armaba el rango
 * `Hoja 1!B<uuid>:I<uuid>`. Un rango con un UUID adentro no existe.
 *
 * La lección: decidir el destino con una variable distinta de la que se usa
 * para construir la petición. Si el id ES un UUID, va a finance-core; punto. No
 * hace falta preguntarle a un estado que alguien más pudo limpiar.
 */

test('un UUID de finance-core se reconoce como id de worker', () => {
    assert.equal(esIdDeWorker('c6e381f3-7e4d-479f-87ec-6fbfa78ccf8f'), true);
    assert.equal(esIdDeWorker('0a5fb661-6106-4993-abc2-4a6336a27bfc'), true);
});

test('un número de fila de la hoja NO es id de worker', () => {
    assert.equal(esIdDeWorker('248'), false);
    assert.equal(esIdDeWorker(248), false);
    assert.equal(esIdDeWorker('2'), false);
});

test('vacío o ausente no es id de worker: eso es un alta, no una edición', () => {
    assert.equal(esIdDeWorker(''), false);
    assert.equal(esIdDeWorker(null), false);
    assert.equal(esIdDeWorker(undefined), false);
});

/**
 * No basta con buscar un guion suelto. Un texto cualquiera con guion no es un
 * UUID, y tratarlo como tal mandaría la petición a un endpoint que responderá
 * 404 en vez de escribir donde debe.
 */
test('no confunde cualquier texto con guion con un UUID', () => {
    assert.equal(esIdDeWorker('fila-3'), false);
    assert.equal(esIdDeWorker('2026-08-06'), false);
    assert.equal(esIdDeWorker('-'), false);
    assert.equal(esIdDeWorker('abc-def'), false);
});

test('tolera espacios y mayúsculas alrededor del UUID', () => {
    assert.equal(esIdDeWorker('  c6e381f3-7e4d-479f-87ec-6fbfa78ccf8f  '), true);
    assert.equal(esIdDeWorker('C6E381F3-7E4D-479F-87EC-6FBFA78CCF8F'), true);
});
