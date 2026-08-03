/**
 * Ingesta: lee alertas del banco en Gmail y las deja en `pending_transactions`.
 *
 * Nunca escribe en `transactions`. Todo movimiento requiere que Jay lo apruebe;
 * lo único que hace este módulo es proponer cuenta, tipo y posible gasto fijo,
 * con un nivel de confianza.
 *
 * Es idempotente por partida doble: la query de Gmail se acota al último correo
 * ya visto, y `gmail_message_id` es único en la tabla.
 */

import { parseBankEmail, TRANSACTIONAL_SENDERS } from './parsers.js';
import { getAccessToken, listMessageIds, getMessage } from './gmail.js';

const DEFAULT_LOOKBACK_DAYS = 7;

/** Tolerancia al comparar el monto de un movimiento contra un gasto fijo. */
const AMOUNT_TOLERANCE = 0.02;
const DAY_WINDOW = 3;

export function buildQuery(sinceDate) {
    const senders = [...TRANSACTIONAL_SENDERS].map((s) => `from:${s}`).join(' OR ');
    // Gmail solo filtra por día, así que se resta uno para no perder correos
    // por la diferencia de zona horaria. Los repetidos los frena el índice único.
    const epochDay = Math.floor(sinceDate.getTime() / 1000) - 86400;
    return `(${senders}) after:${epochDay}`;
}

/**
 * Propone cuenta, tipo y gasto fijo para un movimiento parseado.
 * La confianza es deliberadamente conservadora: sin tarjeta mapeada nunca
 * pasa de 0.35, para que salte a la vista en la bandeja.
 */
export function classify(parsed, { cardMap, fixedExpenses, bankDefaults = new Map() }) {
    // Algunos avisos no mencionan tarjeta (el SPEI recibido de Hey solo dice
    // "a tu tarjeta Hey"), pero el banco basta para saber la cuenta.
    const account =
        (parsed.cardLast4 ? cardMap.get(parsed.cardLast4) : null) ??
        bankDefaults.get(parsed.bank) ??
        null;

    let confidence = 0.35;
    if (account) confidence = parsed.merchant ? 0.9 : 0.7;
    // Sin monto no se puede aprobar a ciegas: Jay tiene que teclearlo.
    if (!Number.isFinite(parsed.amount) && parsed.kind !== 'internal') confidence = 0.4;

    // Si el destino también es una cuenta de Jay, esto no es un gasto: es mover
    // dinero de un bolsillo suyo a otro. Pasa seguido — transfiere de Santander a
    // Hey para que caigan ahí los pagos de suscripciones. Contarlo como gasto lo
    // duplicaría, porque el cargo real llega después en la tarjeta Hey.
    const destino = parsed.counterpartyLast4 ? cardMap.get(parsed.counterpartyLast4) : null;
    if (destino && account && destino.id !== account.id) {
        return {
            accountId: account.id,
            kind: 'transfer',
            status: 'pending',
            transferAccountId: destino.id,
            fixedExpenseId: null,
            category: null,
            confidence: 0.95,
        };
    }

    let fixedMatch = null;
    if (account && parsed.kind === 'gasto' && Number.isFinite(parsed.amount)) {
        const when = parsed.occurredAt ?? new Date();
        const day = when.getDate();

        fixedMatch = fixedExpenses.find((f) => {
            // Un fijo en 0 está desactivado; si se dejara pasar, la tolerancia
            // mínima de $1 lo emparejaría con cualquier gasto de un peso.
            if (!(Number(f.monto) > 0)) return false;

            const perPart = Number(f.monto) / (f.pagos_mes || 1);
            const near =
                Math.abs(perPart - parsed.amount) <= Math.max(1, perPart * AMOUNT_TOLERANCE);
            if (!near) return false;
            if (!f.fechas_pago?.length) return true;
            return f.fechas_pago.some((d) => Math.abs(d - day) <= DAY_WINDOW);
        }) ?? null;

        if (fixedMatch) confidence = Math.min(0.95, confidence + 0.05);
    }

    return {
        accountId: account?.id ?? null,
        // Un movimiento interno (apartado BBVA) no es gasto ni ingreso.
        kind: parsed.kind === 'internal' ? null : parsed.kind,
        status: parsed.kind === 'internal' ? 'ignored' : 'pending',
        fixedExpenseId: fixedMatch?.id ?? null,
        category: fixedMatch?.categoria ?? null,
        confidence,
    };
}

/** Fecha del correo más reciente ya procesado, o el lookback por defecto. */
async function resolveSince(sql, lookbackDays) {
    const [row] = await sql`
        select max(received_at) as last from pending_transactions
    `;
    if (row?.last) return new Date(row.last);
    const d = new Date();
    d.setDate(d.getDate() - lookbackDays);
    return d;
}

export async function runIngest({ sql, credentials, lookbackDays = DEFAULT_LOOKBACK_DAYS, maxMessages = 200 }) {
    const [run] = await sql`
        insert into ingest_runs default values returning id
    `;

    const stats = { seen: 0, created: 0, skipped: 0, unmatched: 0 };

    try {
        const [cards, fixed, accounts] = await Promise.all([
            sql`select last4, account_id from card_map`,
            sql`select id, concepto, categoria, monto, pagos_mes, fechas_pago
                from fixed_expenses where active`,
            sql`select id, name from accounts`,
        ]);
        const cardMap = new Map(cards.map((c) => [c.last4, { id: c.account_id }]));

        // Cuenta por defecto de cada banco, para los avisos que no traen tarjeta.
        const byName = new Map(accounts.map((a) => [a.name, { id: a.id }]));
        const bankDefaults = new Map(
            [['santander', 'Santander'], ['bbva', 'BBVA'], ['hey', 'Hey Banco']]
                .map(([bank, name]) => [bank, byName.get(name)])
                .filter(([, acc]) => acc),
        );

        const token = await getAccessToken(credentials);
        const since = await resolveSince(sql, lookbackDays);
        const ids = await listMessageIds(token, buildQuery(since), maxMessages);
        stats.seen = ids.length;

        for (const id of ids) {
            const msg = await getMessage(token, id);
            const parsed = parseBankEmail(msg);

            if (!parsed.matched) {
                // Los rechazos y las consultas no son movimientos: se ignoran en
                // silencio. Lo que sí interesa es un correo de banco cuya forma
                // no reconocemos, porque delata una plantilla nueva.
                if (['no_template', 'amount_missing'].includes(parsed.reason)) {
                    stats.unmatched += 1;
                }
                stats.skipped += 1;
                continue;
            }

            const s = classify(parsed, { cardMap, fixedExpenses: fixed, bankDefaults });

            const inserted = await sql`
                insert into pending_transactions (
                    gmail_message_id, gmail_thread_id, received_at,
                    bank, template, raw_subject, raw_text,
                    occurred_at, amount, currency, merchant, card_last4, counterparty,
                    suggested_account_id, suggested_kind, suggested_category,
                    suggested_fixed_expense_id, match_confidence, status
                ) values (
                    ${msg.id}, ${msg.threadId}, ${msg.receivedAt},
                    ${parsed.bank}, ${parsed.template}, ${msg.subject},
                    ${(parsed.text ?? '').slice(0, 4000)},
                    ${parsed.occurredAt ?? msg.receivedAt},
                    ${parsed.amount ?? null}, ${parsed.currency ?? 'MXN'},
                    ${parsed.merchant ?? null}, ${parsed.cardLast4 ?? null},
                    ${parsed.counterparty ?? null},
                    ${s.accountId}, ${s.kind}, ${s.category},
                    ${s.fixedExpenseId}, ${s.confidence}, ${s.status}
                )
                on conflict (gmail_message_id) do nothing
                returning id
            `;

            if (inserted.length) stats.created += 1;
            else stats.skipped += 1;
        }

        await sql`
            update ingest_runs set
                finished_at = now(), messages_seen = ${stats.seen},
                created = ${stats.created}, skipped = ${stats.skipped},
                unmatched = ${stats.unmatched}
            where id = ${run.id}
        `;
        return stats;
    } catch (err) {
        await sql`
            update ingest_runs
            set finished_at = now(), error = ${String(err.message ?? err).slice(0, 500)}
            where id = ${run.id}
        `;
        throw err;
    }
}
