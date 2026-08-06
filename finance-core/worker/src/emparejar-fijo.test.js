import { test } from 'node:test';
import assert from 'node:assert/strict';

import { elegirFijoPorMonto } from './ingest.js';

/**
 * Por qué existe este archivo.
 *
 * Un cargo de Telcel por $703.27 se emparejó con el gasto fijo "Protools"
 * ($700). Existía "Telcel Jay" por **exactamente** $703.27, al centavo, y
 * perdió por dos motivos, los dos malos:
 *
 *  1. El emparejamiento usaba `.find()`, que devuelve el PRIMERO que cae dentro
 *     de la tolerancia. Y la consulta de fijos no tiene ORDER BY, así que quién
 *     ganaba dependía del orden en que Postgres devolviera las filas. Protools
 *     ($3.27 de diferencia) le ganó a una coincidencia exacta por puro azar.
 *
 *  2. "Telcel Jay" se cobra el día 25 y el cargo llegó el 6, así que la ventana
 *     de ±3 días lo descartaba antes de comparar montos.
 *
 * El daño no era solo cosmético: Protools estaba marcado como "waived" (saltado)
 * ese mes, y aprobar lo habría revivido como pagado.
 *
 * Un monto exacto y nada redondo como $703.27 es evidencia MÁS fuerte que la
 * cercanía de fechas. Un cobro puede adelantarse o retrasarse; que dos importes
 * coincidan al centavo no suele ser casualidad.
 */

const fijos = [
    { id: 'protools', concepto: 'Protools', monto: '700.00', pagos_mes: 1, fechas_pago: [5] },
    { id: 'telcel-mariel', concepto: 'Telcel Mariel', monto: '700.00', pagos_mes: 1, fechas_pago: [10] },
    { id: 'gimnasio', concepto: 'Gimnasio Mariel', monto: '700.00', pagos_mes: 1, fechas_pago: [18] },
    { id: 'telcel-jay', concepto: 'Telcel Jay', monto: '703.27', pagos_mes: 1, fechas_pago: [25] },
];

/** El caso real que salió mal. El cargo llegó el día 6. */
test('un monto exacto gana aunque su día de pago quede lejos', () => {
    assert.equal(elegirFijoPorMonto(fijos, 703.27, 6)?.id, 'telcel-jay');
});

test('entre varios aproximados gana el más cercano, no el primero de la lista', () => {
    // 701 no coincide exacto con nadie; el más cercano es 700 (diff 1) contra
    // 703.27 (diff 2.27). Deben ganar los de 700 que estén en fecha.
    const elegido = elegirFijoPorMonto(fijos, 701, 5);
    assert.equal(Number(elegido.monto), 700);
});

/**
 * El orden de la consulta no debe decidir nada: antes sí lo hacía, y por eso
 * el bug era invisible en revisión de código.
 */
test('el resultado no depende del orden de la lista', () => {
    const alReves = [...fijos].reverse();
    assert.equal(elegirFijoPorMonto(alReves, 703.27, 6)?.id, 'telcel-jay');
    assert.equal(elegirFijoPorMonto(fijos, 703.27, 6)?.id, 'telcel-jay');
});

test('sin coincidencia exacta, respeta la ventana de fechas', () => {
    // 700 aproximado: en el día 5 solo Protools está en ventana (±3).
    assert.equal(elegirFijoPorMonto(fijos, 700.5, 5)?.id, 'protools');
    // En el día 18, el que está en ventana es Gimnasio Mariel.
    assert.equal(elegirFijoPorMonto(fijos, 700.5, 18)?.id, 'gimnasio');
});

test('no inventa emparejamiento si el monto no se parece a nada', () => {
    assert.equal(elegirFijoPorMonto(fijos, 12345, 6), null);
});

test('ignora fijos desactivados o en cero', () => {
    const conCeros = [...fijos, { id: 'muerto', concepto: 'Viejo', monto: '0', pagos_mes: 1, fechas_pago: [] }];
    assert.equal(elegirFijoPorMonto(conCeros, 0.5, 6), null);
});

test('compara contra el monto POR PARTE en los fijos partidos', () => {
    const partido = [{ id: 'much', concepto: 'Muchachas', monto: '2550.00', pagos_mes: 4, fechas_pago: [] }];
    assert.equal(elegirFijoPorMonto(partido, 637.5, 15)?.id, 'much');
    assert.equal(elegirFijoPorMonto(partido, 2550, 15), null);
});

test('un fijo sin fechas de pago no queda excluido por la ventana', () => {
    const sinFechas = [{ id: 'agua', concepto: 'Agua', monto: '1200.00', pagos_mes: 1, fechas_pago: [] }];
    assert.equal(elegirFijoPorMonto(sinFechas, 1200, 28)?.id, 'agua');
});
