import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOxxoTicket } from './tickets.js';

// Contenido real del ticket 02/08/2026, tal como llega en el text/plain.
const TICKET = `
Ve la version web
!Hola Juan!
Aqui está tu ticket digital:
Cadena Comercial OXXO, S.A de C.V. (CC0-860523-1N4)
EL ENCANTO QRF Edison Nte. Número 1235 Colonia Talleres Monterrey
Régimen de Opcional para Grupos de Sociedades
RISOEL8603120
2
02/08/2026
13:46:00
COCACOLA ZERO 3L NR
2
$74.00
TEREA BLUE
1
$85.00
IVA INCLUIDO
$ 21.93
TOTAL
$159.00
AHORRO
*** AHORRO: $9.00 ***
Pago Electrónico: 159.00
TARJETA ***********5315
`;

test('extrae los artículos del ticket de OXXO', () => {
    const t = parseOxxoTicket(TICKET);
    assert.ok(t, 'debió parsear el ticket');
    assert.equal(t.items.length, 2);

    assert.deepEqual(t.items[0], {
        producto: 'COCACOLA ZERO 3L NR', cantidad: 2, total: 74, unitario: 37,
    });
    assert.deepEqual(t.items[1], {
        producto: 'TEREA BLUE', cantidad: 1, total: 85, unitario: 85,
    });
});

test('lee total, IVA, tarjeta y fecha', () => {
    const t = parseOxxoTicket(TICKET);
    assert.equal(t.total, 159);
    assert.equal(t.iva, 21.93);
    assert.equal(t.cardLast4, '5315');
    assert.equal(t.fecha.toISOString(), '2026-08-02T19:46:00.000Z');
    assert.match(t.tienda, /EL ENCANTO/);
});

test('la suma de las partidas cuadra con el total', () => {
    const t = parseOxxoTicket(TICKET);
    const suma = t.items.reduce((s, i) => s + i.total, 0);
    assert.equal(suma, t.total);
});

test('no confunde el IVA ni el ahorro con productos', () => {
    const t = parseOxxoTicket(TICKET);
    const nombres = t.items.map((i) => i.producto);
    assert.ok(!nombres.some((n) => /IVA|AHORRO|TOTAL/i.test(n)));
});

test('un correo que no es ticket devuelve null', () => {
    assert.equal(parseOxxoTicket('Promoción especial en tu OXXO más cercano'), null);
});
