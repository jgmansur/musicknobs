/**
 * Corre la ingesta desde Node, con las mismas piezas que usará el Worker.
 * Sirve para probar el pipeline completo antes de desplegar nada.
 *
 *   node scripts/ingest_local.js --seed-cards   siembra el mapeo de tarjetas
 *   node scripts/ingest_local.js --days 30      ingesta los últimos 30 días
 *   node scripts/ingest_local.js --report       muestra la bandeja
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from '../worker/node_modules/postgres/src/index.js';
import { runIngest } from '../worker/src/ingest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function envFile(path) {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const [k, ...rest] = t.split('=');
        out[k.trim()] = rest.join('=').trim();
    }
    return out;
}

const dsn = envFile(join(ROOT, '.env')).SUPABASE_DB_URL;
const secrets = envFile(join(HERE, 'gmail_secrets.env'));
const credentials = {
    clientId: secrets.GMAIL_CLIENT_ID,
    clientSecret: secrets.GMAIL_CLIENT_SECRET,
    refreshToken: secrets.GMAIL_REFRESH_TOKEN,
};

const sql = postgres(dsn, { prepare: false, max: 3 });

// Solo las terminaciones confirmadas por Jay. Las demás quedan sin mapear a
// propósito: sin cuenta, la bandeja las marca de baja confianza y él elige.
// Es preferible a adivinar y ensuciar una cuenta.
const CARDS = [
    { last4: '6137', account: 'Santander', instrument: 'debito', label: 'Débito Santander' },
    { last4: '3482', account: 'Santander', instrument: 'cuenta', label: 'Cuenta Santander (SPEI)' },
    { last4: '6240', account: 'BBVA', instrument: 'cuenta', label: 'Cuenta BBVA' },
    // TDC Santander. Es la LikeU, confirmado por Jay. Al ser cuenta de crédito,
    // una compra entra negativa (crece la deuda) y la vista la muestra positiva.
    { last4: '0774', account: 'Tarjeta de Crédito LikeU', instrument: 'credito', label: 'TDC LikeU' },
];

async function seedCards() {
    const accounts = await sql`select id, name from accounts`;
    const byName = new Map(accounts.map((a) => [a.name, a.id]));
    for (const c of CARDS) {
        const id = byName.get(c.account);
        if (!id) {
            console.log(`  saltada ${c.last4}: no existe la cuenta "${c.account}"`);
            continue;
        }
        await sql`
            insert into card_map (last4, account_id, instrument, label)
            values (${c.last4}, ${id}, ${c.instrument}, ${c.label})
            on conflict (last4) do update set account_id = excluded.account_id
        `;
        console.log(`  ${c.last4} → ${c.account} (${c.instrument})`);
    }

    // Los pendientes que se ingirieron antes de existir el mapeo quedaron sin
    // cuenta. Se rellenan aquí y se les sube la confianza, que era baja
    // justamente por no tener cuenta asignada.
    const fixed = await sql`
        update pending_transactions p
        set suggested_account_id = cm.account_id,
            match_confidence = case when p.merchant is not null then 0.9 else 0.7 end
        from card_map cm
        where cm.last4 = p.card_last4
          and p.suggested_account_id is null
          and p.status = 'pending'
        returning p.id
    `;
    if (fixed.length) console.log(`  ${fixed.length} pendientes reclasificados`);
}

async function report() {
    const rows = await sql`
        select status, count(*) as n, round(avg(match_confidence), 2) as conf
        from pending_transactions group by status order by n desc
    `;
    console.log('\nBandeja por estado:');
    for (const r of rows) console.log(`  ${String(r.n).padStart(4)}  ${r.status}  (confianza ${r.conf ?? '—'})`);

    const top = await sql`
        select to_char(p.occurred_at, 'YYYY-MM-DD') as fecha,
               p.merchant, p.amount, p.card_last4,
               p.suggested_kind, a.name as cuenta, p.match_confidence as conf,
               f.concepto as fijo
        from pending_transactions p
        left join accounts a on a.id = p.suggested_account_id
        left join fixed_expenses f on f.id = p.suggested_fixed_expense_id
        where p.status = 'pending'
        order by p.occurred_at desc limit 12
    `;
    console.log('\nÚltimos pendientes:');
    for (const r of top) {
        const m = (r.merchant ?? '—').slice(0, 26).padEnd(26);
        const amt = `$${Number(r.amount).toFixed(2)}`.padStart(11);
        const acc = (r.cuenta ?? 'SIN CUENTA').padEnd(11);
        const fijo = r.fijo ? ` → fijo: ${r.fijo}` : '';
        console.log(`  ${r.fecha} ${m} ${amt}  ${acc} conf ${r.conf}${fijo}`);
    }

    const unmapped = await sql`
        select card_last4, count(*) as n from pending_transactions
        where suggested_account_id is null and card_last4 is not null
        group by card_last4 order by n desc
    `;
    if (unmapped.length) {
        console.log('\nTarjetas sin mapear:');
        for (const u of unmapped) console.log(`  ****${u.card_last4}: ${u.n} movimientos`);
    }
}

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 7;

try {
    if (args.includes('--seed-cards')) {
        console.log('Sembrando mapeo de tarjetas:');
        await seedCards();
    }
    if (!args.includes('--report-only')) {
        console.log(`\nIngestando (lookback ${days} días)...`);
        const stats = await runIngest({ sql, credentials, lookbackDays: days, maxMessages: 300 });
        console.log(
            `  vistos ${stats.seen} | creados ${stats.created} | ` +
            `omitidos ${stats.skipped} | plantilla desconocida ${stats.unmatched}`,
        );
    }
    await report();
} finally {
    await sql.end();
}
