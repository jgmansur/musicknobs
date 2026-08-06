import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reglaDesdeCorreccion } from '../../shared/categorias.js';

/**
 * Por qué existe este archivo.
 *
 * Aprobar en la bandeja no dejaba ninguna huella: `aprobarPendiente` creaba el
 * movimiento, marcaba el fijo y cerraba el pendiente. Punto. Jay podía
 * categorizar el mismo comercio cincuenta veces y a la cincuentaiuna la app
 * seguía sin saber qué era. Cada clic era trabajo que no se capitalizaba.
 *
 * Una corrección explícita es la señal más fuerte que existe: no es una
 * inferencia sobre el histórico, es una persona diciendo "esto es esto". Por eso
 * basta UNA para crear la regla, mientras que el aprendizaje pasivo necesita
 * varias repeticiones sin contradicción.
 *
 * Estas pruebas fijan cuándo una corrección se convierte en regla y con qué
 * patrón — que es la parte delicada: un patrón demasiado corto o demasiado
 * específico arruina todo lo que venga después.
 */

test('una corrección explícita alcanza para crear la regla', () => {
    const r = reglaDesdeCorreccion({ merchant: 'OXXOGRAND PVA', categoria: 'Despensa' });
    assert.equal(r.categoria, 'Despensa');
    assert.equal(r.origen, 'correccion');
});

/**
 * El banco manda ruido de sucursal: "OXXOGRAND PVA", "OXXO ZAVALA QRF",
 * "OXXO EL ENCANTO". Si el patrón se guardara completo, la regla solo
 * serviría para ESA sucursal y habría que corregir una por una.
 */
test('el patrón recorta el ruido de sucursal del comercio', () => {
    const r = reglaDesdeCorreccion({ merchant: 'OXXOGRAND PVA', categoria: 'Despensa' });
    assert.ok(r.patron.length <= 'OXXOGRAND PVA'.length);
    assert.ok(r.patron.length >= 3, `patrón demasiado corto: "${r.patron}"`);
});

/**
 * El reverso del mismo riesgo. Un patrón de 2 letras casa con medio mundo:
 * "GA" estaría dentro de GASOLINERA, GARCIA, MEGAGAS y OXXOGRAND.
 */
test('no genera regla si el comercio es demasiado corto para ser específico', () => {
    assert.equal(reglaDesdeCorreccion({ merchant: 'AB', categoria: 'Despensa' }), null);
    assert.equal(reglaDesdeCorreccion({ merchant: '', categoria: 'Despensa' }), null);
    assert.equal(reglaDesdeCorreccion({ merchant: null, categoria: 'Despensa' }), null);
});

test('no genera regla sin categoría: no hay nada que aprender', () => {
    assert.equal(reglaDesdeCorreccion({ merchant: 'OXXO ZAVALA', categoria: '' }), null);
    assert.equal(reglaDesdeCorreccion({ merchant: 'OXXO ZAVALA', categoria: null }), null);
});

/**
 * Un traspaso entre cuentas propias no tiene categoría de gasto: mover dinero
 * de Santander a Hey no es un concepto de consumo. Aprender de ahí metería
 * basura en las reglas.
 */
test('no aprende de traspasos', () => {
    assert.equal(
        reglaDesdeCorreccion({ merchant: 'Hey Banco', categoria: 'Traspaso', kind: 'transfer' }),
        null,
    );
});

/**
 * La corrección tiene que GANARLE a las reglas generales que ya existan.
 * Si Jay dice que "UBER EATS" es Comida y hay una regla vieja "UBER" → Transporte,
 * la específica debe ganar sin depender del orden de inserción.
 */
test('la regla corregida gana a una regla general previa', () => {
    const r = reglaDesdeCorreccion({ merchant: 'DLO*UBER EATS', categoria: 'Comida' });
    assert.ok(r.prioridad < 100, 'debe tener prioridad más alta que la default (100)');
});

test('distingue gasto de ingreso: "Mariel" no es lo mismo en cada sentido', () => {
    const gasto = reglaDesdeCorreccion({ merchant: 'MARIEL', categoria: 'Familia', kind: 'gasto' });
    const ingreso = reglaDesdeCorreccion({ merchant: 'MARIEL', categoria: 'Aportación', kind: 'ingreso' });
    assert.equal(gasto.aplica_a, 'gasto');
    assert.equal(ingreso.aplica_a, 'ingreso');
});

test('el patrón se normaliza para que no dependa de acentos ni mayúsculas', () => {
    const a = reglaDesdeCorreccion({ merchant: 'Farmacia Guadalajara', categoria: 'Salud' });
    const b = reglaDesdeCorreccion({ merchant: 'FARMACIA GUADALAJARA', categoria: 'Salud' });
    assert.equal(a.patron, b.patron);
});

/**
 * Las procesadoras de pago se meten adelante del comercio real: "DLO*UBER EATS"
 * (dLocal), "PAYPAL*UBRPAGOSMEX", "STR*TELCEL" (Stripe), "EBANX CANVA".
 *
 * Si el patrón se queda con la procesadora, aprende lo contrario de lo que
 * debe: agruparía Uber Eats con Telcel solo porque ambos pasan por el mismo
 * intermediario, y no reconocería a Uber Eats cuando cobre por otra vía.
 */
test('descarta la procesadora de pago y se queda con el comercio real', () => {
    assert.equal(reglaDesdeCorreccion({ merchant: 'DLO*UBER EATS', categoria: 'Comida' }).patron, 'uber eats');
    assert.equal(reglaDesdeCorreccion({ merchant: 'STR*TELCEL', categoria: 'Servicios' }).patron, 'telcel');
    assert.equal(reglaDesdeCorreccion({ merchant: 'PAYPAL*UBRPAGOSMEX', categoria: 'Transporte' }).patron, 'ubrpagosmex');
    assert.equal(reglaDesdeCorreccion({ merchant: 'EBANX CANVA MIGUEL HIDALGDF', categoria: 'Suscripción' }).patron, 'canva miguel');
});

/**
 * Pero si al quitar la procesadora no queda nada útil, hay que conservarla:
 * vale más un patrón mediocre que ninguno.
 */
test('conserva la procesadora si es lo único que hay', () => {
    const r = reglaDesdeCorreccion({ merchant: 'PAYPAL', categoria: 'Otros' });
    assert.ok(r && r.patron.includes('paypal'));
});
