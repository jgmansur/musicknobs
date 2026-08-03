/**
 * Pruebas de punta a punta contra la base real. Todo se revierte al final.
 *
 * Caso A — aprobar un pendiente histórico (anterior al ancla del saldo):
 *   debe crear el movimiento y marcar el fijo, pero NO mover el saldo, porque
 *   ese gasto ya venía incluido en el saldo inicial.
 *
 * Caso B — marcar pagado un gasto fijo hoy:
 *   debe crear el movimiento y SÍ mover el saldo. Es el comportamiento que
 *   tenía el sistema viejo al palomear un fijo y que hay que conservar.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from '../worker/node_modules/postgres/src/index.js';
import { approve, payFixed } from '../worker/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lee una clave del .env. Ojo: el archivo tiene varias líneas, así que no
 *  sirve partir por el primer '=' y quedarse con el resto. */
function envValue(path, key) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i > 0 && t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
    }
    throw new Error(`Falta ${key} en ${path}`);
}

const dsn = envValue(join(HERE, '..', '.env'), 'SUPABASE_DB_URL');
const sql = postgres(dsn, { prepare: false, max: 3 });

const money = (n) => Number(n).toFixed(2);
const balanceOf = async (id) => {
    const [r] = await sql`select balance from account_balances where id = ${id}`;
    return Number(r.balance);
};

let allOk = true;
const check = (label, ok) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) allOk = false;
};

try {
    // ---------------------------------------------------------------- Caso A
    console.log('CASO A — aprobar pendiente histórico\n');
    const [target] = await sql`
        select p.id, p.amount, p.suggested_account_id, a.name as cuenta, f.concepto as fijo
        from pending_transactions p
        join accounts a on a.id = p.suggested_account_id
        join fixed_expenses f on f.id = p.suggested_fixed_expense_id
        where p.status = 'pending' and p.occurred_at < a.opening_balance_at
        order by p.occurred_at desc limit 1
    `;

    if (!target) {
        console.log('  (sin candidatos)');
    } else {
        const before = await balanceOf(target.suggested_account_id);
        console.log(`  ${target.fijo} — $${money(target.amount)} en ${target.cuenta}`);

        const res = await approve(sql, target.id);
        const after = await balanceOf(target.suggested_account_id);
        const [pay] = await sql`
            select paid from fixed_expense_payments where transaction_id = ${res.transactionId}
        `;
        const [pend] = await sql`select status from pending_transactions where id = ${target.id}`;
        const again = await approve(sql, target.id);

        check('se creó el movimiento', Boolean(res.transactionId));
        check('el saldo NO se movió (es histórico)', Math.abs(after - before) < 0.01);
        check('el gasto fijo quedó marcado', pay?.paid === true);
        check('el pendiente quedó aprobado', pend.status === 'approved');
        check('no se puede aprobar dos veces', Boolean(again.error));

        await sql`delete from fixed_expense_payments where transaction_id = ${res.transactionId}`;
        await sql`delete from transactions where id = ${res.transactionId}`;
        await sql`update pending_transactions set status='pending', transaction_id=null,
                  resolved_at=null where id = ${target.id}`;
    }

    // ---------------------------------------------------------------- Caso B
    console.log('\nCASO B — marcar pagado un fijo hoy\n');
    const [fijo] = await sql`
        select f.id, f.concepto, f.monto, f.pagos_mes
        from fixed_expenses f
        where f.active and f.tipo = 'gasto' and f.monto > 0
        order by f.monto limit 1
    `;
    const [cuenta] = await sql`select id, name from accounts where name = 'Santander'`;

    const before = await balanceOf(cuenta.id);
    console.log(`  ${fijo.concepto} — $${money(fijo.monto)} desde ${cuenta.name}`);
    console.log(`  saldo antes: ${money(before)}`);

    const res = await payFixed(sql, fijo.id, { accountId: cuenta.id });
    const after = await balanceOf(cuenta.id);
    const esperado = -Math.abs(Number(fijo.monto) / (fijo.pagos_mes || 1));

    console.log(`  saldo después: ${money(after)}  (movió ${money(after - before)})`);

    const repeat = await payFixed(sql, fijo.id, { accountId: cuenta.id });

    check('se creó el movimiento', Boolean(res.transactionId));
    check(`el saldo SÍ se movió ${money(esperado)}`, Math.abs(after - before - esperado) < 0.01);
    check('no se puede pagar dos veces la misma parte', Boolean(repeat.error));

    if (res.transactionId) {
        await sql`delete from fixed_expense_payments where transaction_id = ${res.transactionId}`;
        await sql`delete from transactions where id = ${res.transactionId}`;
    }

    const restored = await balanceOf(cuenta.id);
    check('la base quedó como estaba', Math.abs(restored - before) < 0.01);

    console.log(`\n${allOk ? 'TODO CORRECTO' : 'ALGO FALLÓ'}`);
    process.exitCode = allOk ? 0 : 1;
} finally {
    await sql.end();
}
