import { test } from 'node:test';
import assert from 'node:assert/strict';

import { debeAutoMarcar, debeAutoAprobar } from './ingest.js';

/**
 * Contexto de por qué existe este archivo.
 *
 * El ingest dejaba TODO en la bandeja, incluso un cargo con confianza 0.95, la
 * cuenta correcta, el monto exacto y el gasto fijo ya identificado. Como el fijo
 * seguía viéndose "pendiente", Jay le picaba al botón de marcarlo pagado — y ESE
 * botón creaba un movimiento propio, en la cuenta por defecto, mientras el cargo
 * real entraba aparte por su cuenta verdadera.
 *
 * Resultado: Canva contado dos veces en mayo y en junio, $149 cada vez, en dos
 * cuentas distintas. El botón manual no era una molestia, era la causa del bug.
 *
 * Auto-marcar desde el ingest elimina el paso manual, y con él la clase entera
 * de duplicados. Estas pruebas fijan cuándo SÍ y cuándo NO.
 */

const fijoCanva = { id: 'f-canva', monto: '149.00', pagos_mes: 1 };

/** Caso feliz: el cargo real de Canva, tal como llegó el 2026-08-05. */
const base = {
    status: 'pending',
    kind: 'gasto',
    accountId: 'a-hey',
    fixedExpenseId: 'f-canva',
    confidence: 0.95,
    amount: -149,
    fijo: fijoCanva,
    duplicado: null,
};

test('auto-marca el cargo que empareja exacto con su gasto fijo', () => {
    assert.equal(debeAutoMarcar(base), true);
});

test('el signo del monto no importa: gasto puede venir negativo o positivo', () => {
    assert.equal(debeAutoMarcar({ ...base, amount: 149 }), true);
});

test('respeta los fijos partidos: compara contra el monto POR PARTE', () => {
    // Muchachas: $2,550 al mes en 4 pagos. El cargo real es de una parte.
    const fijoPartido = { id: 'f-much', monto: '2550.00', pagos_mes: 4 };
    assert.equal(
        debeAutoMarcar({ ...base, fixedExpenseId: 'f-much', fijo: fijoPartido, amount: -637.5 }),
        true,
    );
    // El total mensual NO es una parte: eso merece revisión humana.
    assert.equal(
        debeAutoMarcar({ ...base, fixedExpenseId: 'f-much', fijo: fijoPartido, amount: -2550 }),
        false,
    );
});

/**
 * El límite que pidió Jay explícitamente.
 *
 * Starlink pasó de $1,305 a $1,405 y nadie se enteró hasta que se auditó. Un
 * aumento de precio es una decisión suya, no un trámite: tiene que verlo en la
 * bandeja y decidir si actualiza el fijo.
 */
test('NO auto-marca si el monto difiere del fijo, aunque sea por poco', () => {
    assert.equal(debeAutoMarcar({ ...base, amount: -1405, fijo: { ...fijoCanva, monto: '1305.00' } }), false);
    assert.equal(debeAutoMarcar({ ...base, amount: -150 }), false);
    assert.equal(debeAutoMarcar({ ...base, amount: -148.99 }), false);
});

test('tolera el ruido de coma flotante, no un centavo real', () => {
    // Dividir un fijo en partes deja colas binarias; eso no puede mandar el
    // cargo a la bandeja.
    assert.equal(debeAutoMarcar({ ...base, amount: -149.004 }), true);
    // Un centavo de diferencia YA es otro precio: a la bandeja.
    assert.equal(debeAutoMarcar({ ...base, amount: -149.01 }), false);
    assert.equal(debeAutoMarcar({ ...base, amount: -149.05 }), false);
});

test('NO auto-marca sin gasto fijo emparejado', () => {
    assert.equal(debeAutoMarcar({ ...base, fixedExpenseId: null, fijo: null }), false);
});

test('NO auto-marca con confianza baja', () => {
    assert.equal(debeAutoMarcar({ ...base, confidence: 0.85 }), false);
});

test('NO auto-marca lo que ya se sospecha duplicado', () => {
    assert.equal(debeAutoMarcar({ ...base, duplicado: 'trx-existente' }), false);
});

test('NO auto-marca sin cuenta resuelta: no hay de dónde sacar el dinero', () => {
    assert.equal(debeAutoMarcar({ ...base, accountId: null }), false);
});

test('NO auto-marca ingresos ni traspasos, solo gastos', () => {
    assert.equal(debeAutoMarcar({ ...base, kind: 'ingreso' }), false);
    assert.equal(debeAutoMarcar({ ...base, kind: 'transfer' }), false);
});

test('NO auto-marca lo que no entró como pendiente', () => {
    assert.equal(debeAutoMarcar({ ...base, status: 'rejected' }), false);
    assert.equal(debeAutoMarcar({ ...base, status: 'ignored' }), false);
});

test('NO auto-marca un monto ausente (los SPEI de Hey llegan sin cifra)', () => {
    assert.equal(debeAutoMarcar({ ...base, amount: null }), false);
    assert.equal(debeAutoMarcar({ ...base, amount: NaN }), false);
});

test('NO auto-marca si el fijo viene en cero o sin monto', () => {
    assert.equal(debeAutoMarcar({ ...base, fijo: { ...fijoCanva, monto: '0' }, amount: 0 }), false);
    assert.equal(debeAutoMarcar({ ...base, fijo: { ...fijoCanva, monto: null } }), false);
});

/* ═══════════════════════════════════════════════════════════════════════
   GRUPO VERDE — gastos corrientes que no necesitan criterio humano

   Calibrado contra el histórico real de Jay, no de escritorio. De los
   pendientes ya resueltos:

     gasto + confianza >= 0.90 + cuenta resuelta →  150 aprobados, 0 rechazados
     transfer  confianza 0.95                    →    0 aprobados, 1 rechazado
     ingreso   confianza 0.40                    →    0 aprobados, 38 rechazados

   Por eso el grupo verde son SOLO gastos. Los ingresos de Hey llegan sin
   monto y los traspasos se confunden con gastos: ahí sí hace falta Jay.
   ═══════════════════════════════════════════════════════════════════════ */

/** Un Oxxo cualquiera: cuenta conocida, monto claro, nada raro. */
const gastoCorriente = {
    status: 'pending',
    kind: 'gasto',
    accountId: 'a-santander',
    fixedExpenseId: null,
    confidence: 0.9,
    amount: -159,
    duplicado: null,
};

test('verde: auto-aprueba un gasto corriente con cuenta y confianza altas', () => {
    assert.equal(debeAutoAprobar(gastoCorriente), true);
});

test('verde: no exige categoría — el dinero es cierto aunque falte clasificar', () => {
    // 91 de los 150 gastos aprobados entraron sin categoría. Registrar el
    // movimiento es lo urgente; categorizar tiene su propio flujo aparte.
    assert.equal(debeAutoAprobar({ ...gastoCorriente, category: null }), true);
});

test('verde: NO toca ingresos ni traspasos', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, kind: 'ingreso' }), false);
    assert.equal(debeAutoAprobar({ ...gastoCorriente, kind: 'transfer' }), false);
});

test('verde: NO auto-aprueba con confianza por debajo de 0.90', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, confidence: 0.85 }), false);
    assert.equal(debeAutoAprobar({ ...gastoCorriente, confidence: 0.7 }), false);
});

/**
 * Acabamos de arreglar un doble conteo. Auto-aprobar algo ya marcado como
 * posible duplicado sería reabrir esa herida por otra puerta.
 */
test('verde: NO auto-aprueba lo que huele a duplicado', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, duplicado: 'trx-previa' }), false);
});

test('verde: NO auto-aprueba sin cuenta ni sin monto', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, accountId: null }), false);
    assert.equal(debeAutoAprobar({ ...gastoCorriente, amount: null }), false);
    assert.equal(debeAutoAprobar({ ...gastoCorriente, amount: 0 }), false);
});

test('verde: NO auto-aprueba lo que ya no está pendiente', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, status: 'rejected' }), false);
});

/**
 * El cruce entre los dos caminos, y el que protege el límite que puso Jay.
 *
 * Si el cargo empareja con un gasto fijo, quien manda es `debeAutoMarcar`. Y
 * ese dice que NO cuando el monto cambió — Starlink subiendo de $1,305 a
 * $1,405 tiene que verse en la bandeja.
 *
 * Sin esta regla, el grupo verde lo aprobaría por la puerta de atrás: es un
 * gasto, con cuenta, con confianza alta y sin sospecha de duplicado. El
 * aumento de precio pasaría en silencio, que es justo lo que no queremos.
 */
test('verde: NO auto-aprueba un cargo que pertenece a un gasto fijo', () => {
    assert.equal(debeAutoAprobar({ ...gastoCorriente, fixedExpenseId: 'f-starlink' }), false);
});
