import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBankEmail, htmlToText, parseAmount, parseMxDateTime } from './parsers.js';

// Fragmento textual del correo real 19faf44a66a1bc6f (Santander, 29/07/2026),
// conservando los <br> y la entidad &eacute; tal como los manda el banco.
const SANTANDER_COMPRA_HTML = `
<p><span>
  Estimado Cliente:<br><br>
  Te informamos que se ha realizado<br>
  una compra en el comercio MERCADOPAGO *BIRRIA<br>
  con tu tarjeta de d&eacute;bito <br>
  terminación **6137, por<br>
  un monto de $483.00 MXN.<br><br>
  El 29/07/2026<br>
  a las 13:05:19 hrs.<br><br>
  Atentamente<br>Santander M&eacute;xico
</span></p>`;

const SANTANDER_TDC_HTML = `
  Te informamos que se ha realizado una compra en el comercio STRIPE *GRAMOFONO
  con tu tarjeta de TDC terminación **0774, por un monto de $1,250.50 MXN.
  El 21/07/2026 a las 15:23:36 hrs.`;

const SANTANDER_SPEI_HTML = `
  ABONO vía SPEI estimado cliente, recibiste vía SPEI un abono por $2500.00 MXN
  a tu cuenta terminación 3482 Datos de la operación Fecha: 02/08/2026`;

const BBVA_APARTADO_HTML = `
  Notificación BBVA Hola, JUAN GUILLERMO: El retiro de dinero de tu apartado en la
  cuenta terminación ******6240 fue exitoso, te compartimos el comprobante`;

const BBVA_RETIRO_HTML = `
  Realizaste un retiro de efectivo, te compartimos el comprobante digital:
  Detalles de operación Cuenta de retiro: **6240 Importe: $1,500.00`;

const RECEIVED = new Date('2026-07-29T19:05:39Z');

const santander = (html) => ({
    from: 'santander@envio.santander.com.mx',
    subject: 'Pago/Compra con Tarjeta Santander',
    html,
    receivedAt: RECEIVED,
});
const bbva = (html, subject = 'Notificación BBVA') => ({
    from: 'clientes@bbva.mx',
    subject,
    html,
    receivedAt: RECEIVED,
});

test('htmlToText decodifica entidades y colapsa espacios', () => {
    const text = htmlToText(SANTANDER_COMPRA_HTML);
    assert.match(text, /tarjeta de débito terminación \*\*6137/);
    assert.ok(!text.includes('<br>'));
});

test('parseAmount usa formato bancario (punto decimal)', () => {
    assert.equal(parseAmount('$483.00'), 483);
    assert.equal(parseAmount('$1,250.50'), 1250.5);
    assert.equal(parseAmount('$ 500.00'), 500);
    assert.equal(parseAmount('nada'), null);
});

test('parseMxDateTime interpreta hora de México', () => {
    const d = parseMxDateTime('29/07/2026', '13:05:19');
    assert.equal(d.toISOString(), '2026-07-29T19:05:19.000Z');
});

test('compra con tarjeta de débito Santander', () => {
    const r = parseBankEmail(santander(SANTANDER_COMPRA_HTML));
    assert.equal(r.matched, true);
    assert.equal(r.template, 'santander_compra');
    assert.equal(r.merchant, 'MERCADOPAGO *BIRRIA');
    assert.equal(r.instrument, 'debito');
    assert.equal(r.cardLast4, '6137');
    assert.equal(r.amount, 483);
    assert.equal(r.currency, 'MXN');
    assert.equal(r.kind, 'gasto');
    assert.equal(r.occurredAt.toISOString(), '2026-07-29T19:05:19.000Z');
});

test('compra con TDC se marca como crédito y maneja miles', () => {
    const r = parseBankEmail(santander(SANTANDER_TDC_HTML));
    assert.equal(r.matched, true);
    assert.equal(r.instrument, 'credito');
    assert.equal(r.cardLast4, '0774');
    assert.equal(r.amount, 1250.5);
    assert.equal(r.merchant, 'STRIPE *GRAMOFONO');
});

test('abono SPEI es ingreso', () => {
    const r = parseBankEmail({ ...santander(SANTANDER_SPEI_HTML), subject: 'Has recibido un depósito' });
    assert.equal(r.matched, true);
    assert.equal(r.kind, 'ingreso');
    assert.equal(r.amount, 2500);
    assert.equal(r.cardLast4, '3482');
});

test('retiro de apartado BBVA es interno, no gasto', () => {
    const r = parseBankEmail(bbva(BBVA_APARTADO_HTML, 'Retiraste dinero de tus apartados'));
    assert.equal(r.matched, true);
    assert.equal(r.kind, 'internal');
    assert.equal(r.cardLast4, '6240');
});

test('retiro de efectivo BBVA es gasto', () => {
    const r = parseBankEmail(bbva(BBVA_RETIRO_HTML, 'Información sobre tu retiro de efectivo'));
    assert.equal(r.matched, true);
    assert.equal(r.kind, 'gasto');
    assert.equal(r.amount, 1500);
    assert.equal(r.merchant, 'Retiro de efectivo');
});

test('publicidad se descarta por remitente', () => {
    const r = parseBankEmail({
        from: 'clientes@envios.santander.com.mx',
        subject: 'Este fin de semana, aprovecha 3MSI en tu súper',
        html: '<p>compra en el comercio X con tu tarjeta de débito terminación **6137, por un monto de $1.00 MXN</p>',
        receivedAt: RECEIVED,
    });
    assert.equal(r.matched, false);
    assert.equal(r.reason, 'marketing');
});

test('rechazo por fondos insuficientes no es movimiento', () => {
    const r = parseBankEmail({
        from: 'santander@envio.santander.com.mx',
        subject: 'Rechazo en Tarjeta de Débito por fondos insuficientes',
        html: '<p>se identificó un rechazo en tu Tarjeta de Débito terminación 6137</p>',
        receivedAt: RECEIVED,
    });
    assert.equal(r.matched, false);
    assert.equal(r.reason, 'declined');
});
