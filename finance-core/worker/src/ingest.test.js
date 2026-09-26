import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, guardarTicket } from './ingest.js';

test('Gmail query overlaps fifteen minutes instead of downloading a full day again', () => {
    const since = new Date('2026-09-26T16:00:00.000Z');
    const query = buildQuery(since);

    assert.match(query, /from:info@oxxoticket\.com/);
    assert.match(query, new RegExp(`after:${Math.floor(since.getTime() / 1000) - 900}$`));
});

test('an orphaned ticket is linked after its card becomes mapped without duplicating items', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
        const statement = strings.join('?').replace(/\s+/g, ' ').trim();
        calls.push({ statement, values });

        if (statement.startsWith('select id, transaction_id from receipt_items')) {
            return [
                { id: 'item-1', transaction_id: null },
                { id: 'item-2', transaction_id: null },
            ];
        }
        if (statement.startsWith('select id from transactions')) return [];
        if (statement.startsWith('insert into transactions')) return [{ id: 'tx-new' }];
        if (statement.startsWith('update receipt_items')) {
            return [{ id: 'item-1' }, { id: 'item-2' }];
        }
        throw new Error(`Unexpected SQL: ${statement}`);
    };

    const result = await guardarTicket(
        sql,
        { id: 'gmail-1', receivedAt: new Date('2026-09-26T15:42:00.000Z') },
        {
            total: 170,
            fecha: new Date('2026-09-26T13:42:00.000Z'),
            cardLast4: '3677',
            tienda: 'LA ESTACION QRF',
            items: [
                { producto: 'TEREA BLUE', cantidad: 2, unitario: 85, total: 170 },
            ],
        },
        new Map([['3677', { id: 'account-santander' }]]),
    );

    assert.deepEqual(result, { creados: 0, ligados: 2, movimientoCreado: true });
    assert.equal(calls.filter(({ statement }) =>
        statement.startsWith('insert into receipt_items')).length, 0);
    assert.equal(calls.filter(({ statement }) =>
        statement.startsWith('update receipt_items')).length, 1);
});
