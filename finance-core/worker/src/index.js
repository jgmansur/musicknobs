/**
 * Worker de Finance Core.
 *
 *   scheduled()  cron cada 15 min: lee Gmail y llena la bandeja de pendientes.
 *   fetch()      API mínima para que el dashboard lea y apruebe pendientes.
 *
 * Toda la API exige el header `x-finance-token`. Sin él, 401: la base tiene
 * movimientos reales y esto vive en internet abierto.
 */

import postgres from 'postgres';
import { runIngest } from './ingest.js';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-finance-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    });

/**
 * Respuesta al preflight. Un 204 NO puede llevar cuerpo: mandarle uno hace que
 * el runtime tire 500, el navegador aborta el fetch y el error que ve el usuario
 * es un genérico "Load failed" que no dice nada de la causa real.
 */
const preflight = () => new Response(null, { status: 204, headers: CORS });

const connect = (env) =>
    postgres(env.SUPABASE_DB_URL, {
        prepare: false,        // el pooler de Supabase no soporta prepared statements
        max: 2,
        idle_timeout: 10,
        connect_timeout: 20,
    });

const credentialsOf = (env) => ({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
});

/**
 * Convierte un pendiente en movimiento real.
 *
 * Todo ocurre en una transacción: o queda el movimiento y el pendiente marcado
 * como aprobado, o no queda nada. Nunca un pendiente aprobado sin su movimiento.
 */
export async function approve(sql, id, overrides = {}) {
    return sql.begin(async (tx) => {
        const [p] = await tx`
            select * from pending_transactions where id = ${id} and status = 'pending'
        `;
        if (!p) return { error: 'pendiente no encontrado o ya resuelto' };

        const accountId = overrides.accountId ?? p.suggested_account_id;
        if (!accountId) return { error: 'falta la cuenta: mapea la tarjeta o elígela' };

        const kind = overrides.kind ?? p.suggested_kind ?? 'gasto';
        const magnitude = Math.abs(Number(overrides.amount ?? p.amount));
        const amount = kind === 'ingreso' ? magnitude : -magnitude;

        const [trx] = await tx`
            insert into transactions (
                occurred_at, account_id, amount, kind, merchant, description,
                category, source, source_ref, fixed_expense_id
            ) values (
                ${p.occurred_at}, ${accountId}, ${amount}, ${kind},
                ${overrides.merchant ?? p.merchant},
                ${overrides.description ?? p.counterparty ?? p.raw_subject},
                ${overrides.category ?? p.suggested_category},
                'email', ${p.gmail_message_id},
                ${overrides.fixedExpenseId ?? p.suggested_fixed_expense_id}
            )
            on conflict (source, source_ref) where source_ref is not null
            do nothing
            returning id
        `;
        if (!trx) return { error: 'ese correo ya había generado un movimiento' };

        // Si el movimiento salda una parte de un gasto fijo, se marca aquí mismo:
        // es justo el palomeo manual que se quería eliminar.
        const fixedId = overrides.fixedExpenseId ?? p.suggested_fixed_expense_id;
        if (fixedId) {
            const period = new Date(p.occurred_at);
            period.setDate(1);
            await tx`
                insert into fixed_expense_payments (
                    fixed_expense_id, period, part_index, paid, paid_at, transaction_id
                ) values (
                    ${fixedId}, ${period.toISOString().slice(0, 10)},
                    ${overrides.partIndex ?? 0}, true, now(), ${trx.id}
                )
                on conflict (fixed_expense_id, period, part_index)
                do update set paid = true, paid_at = now(), transaction_id = excluded.transaction_id
            `;
        }

        await tx`
            update pending_transactions
            set status = 'approved', transaction_id = ${trx.id}, resolved_at = now()
            where id = ${id}
        `;
        return { ok: true, transactionId: trx.id };
    });
}

/**
 * Marca pagada una parte de un gasto fijo y crea su movimiento.
 *
 * En el sistema viejo, palomear un fijo escribía una fila en Control de Gastos y
 * por eso movía el saldo. Aquí hay que conservar ese efecto: como el saldo se
 * deriva de `transactions`, un fijo marcado sin movimiento no movería nada. Es
 * la vía para los fijos que no generan correo (efectivo, cuenta de Mariel).
 *
 * El constraint único de (fixed_expense_id, period, part_index) impide que se
 * pague dos veces la misma parte, venga del correo o de aquí.
 */
export async function payFixed(sql, fixedId, opts = {}) {
    return sql.begin(async (tx) => {
        const [f] = await tx`select * from fixed_expenses where id = ${fixedId}`;
        if (!f) return { error: 'gasto fijo no encontrado' };

        const partIndex = opts.partIndex ?? 0;
        if (partIndex >= (f.pagos_mes || 1)) {
            return { error: `ese fijo solo tiene ${f.pagos_mes} parte(s)` };
        }

        const when = opts.occurredAt ? new Date(opts.occurredAt) : new Date();
        const period = new Date(when.getFullYear(), when.getMonth(), 1);
        const periodStr = period.toISOString().slice(0, 10);

        const [already] = await tx`
            select paid, waived from fixed_expense_payments
            where fixed_expense_id = ${fixedId} and period = ${periodStr}
              and part_index = ${partIndex}
        `;
        if (already?.paid) return { error: 'esa parte ya estaba pagada este mes' };

        // Condonada: se marca sin crear movimiento, porque no salió dinero.
        if (opts.waive) {
            await tx`
                insert into fixed_expense_payments (fixed_expense_id, period, part_index, waived)
                values (${fixedId}, ${periodStr}, ${partIndex}, true)
                on conflict (fixed_expense_id, period, part_index)
                do update set waived = true, paid = false
            `;
            return { ok: true, waived: true };
        }

        const accountId = opts.accountId;
        if (!accountId) return { error: 'falta la cuenta de donde salió el pago' };

        const perPart = Number(opts.amount ?? Number(f.monto) / (f.pagos_mes || 1));
        const signed = f.tipo === 'ingreso' ? Math.abs(perPart) : -Math.abs(perPart);
        const etiqueta = `${f.concepto} (${partIndex + 1}/${f.pagos_mes || 1})`;

        const [trx] = await tx`
            insert into transactions (
                occurred_at, account_id, amount, kind, merchant, description,
                category, source, source_ref, fixed_expense_id
            ) values (
                ${when}, ${accountId}, ${signed},
                ${f.tipo === 'ingreso' ? 'ingreso' : 'gasto'},
                'Gasto Fijo', ${etiqueta}, ${f.categoria},
                'fijo', ${`fijo:${fixedId}:${periodStr}:${partIndex}`}, ${fixedId}
            )
            on conflict (source, source_ref) where source_ref is not null
            do nothing
            returning id
        `;
        if (!trx) return { error: 'esa parte ya tenía movimiento registrado' };

        await tx`
            insert into fixed_expense_payments (
                fixed_expense_id, period, part_index, paid, paid_at, transaction_id
            ) values (${fixedId}, ${periodStr}, ${partIndex}, true, now(), ${trx.id})
            on conflict (fixed_expense_id, period, part_index)
            do update set paid = true, waived = false, paid_at = now(),
                          transaction_id = excluded.transaction_id
        `;
        return { ok: true, transactionId: trx.id, amount: signed };
    });
}

export default {
    async scheduled(event, env, ctx) {
        const sql = connect(env);
        try {
            const stats = await runIngest({ sql, credentials: credentialsOf(env) });
            console.log('ingesta', JSON.stringify(stats));
        } finally {
            ctx.waitUntil(sql.end());
        }
    },

    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') return preflight();

        const url = new URL(request.url);
        if (url.pathname === '/health') return json({ ok: true });

        if (request.headers.get('x-finance-token') !== env.API_TOKEN) {
            return json({ error: 'no autorizado' }, 401);
        }

        const sql = connect(env);
        try {
            if (url.pathname === '/api/pending' && request.method === 'GET') {
                const rows = await sql`
                    select p.id, p.occurred_at, p.amount, p.currency, p.merchant,
                           p.counterparty, p.card_last4, p.bank, p.template,
                           p.suggested_kind, p.match_confidence, p.raw_subject,
                           a.name as suggested_account, f.concepto as suggested_fixed,
                           -- Anterior al ancla del saldo: aprobarlo llena el
                           -- historial pero no mueve el saldo, porque ese gasto
                           -- ya está incluido en el saldo inicial.
                           (p.occurred_at < a.opening_balance_at) as historico
                    from pending_transactions p
                    left join accounts a on a.id = p.suggested_account_id
                    left join fixed_expenses f on f.id = p.suggested_fixed_expense_id
                    where p.status = 'pending'
                    order by p.occurred_at desc
                    limit 200
                `;
                return json({ pending: rows });
            }

            if (url.pathname === '/api/balances' && request.method === 'GET') {
                // Se devuelven TODOS los campos que el dashboard necesita para
                // pintar sus tarjetas, no solo el saldo: así puede dejar de leer
                // la hoja por completo.
                const rows = await sql`
                    select a.id, a.legacy_id, a.name, a.type, a.currency, a.hidden,
                           a.credit_limit, a.credit_limit_visible, a.investment_type,
                           a.custom_annual_rate, a.bitcoin_initial_mxn,
                           b.balance, b.display_balance, b.movements, b.last_movement_at
                    from accounts a
                    join account_balances b on b.id = a.id
                    order by a.name
                `;
                return json({ balances: rows });
            }

            const reconcileMatch = url.pathname.match(/^\/api\/accounts\/([\w-]+)\/reconcile$/);
            if (reconcileMatch && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const real = Number(body.balance);
                if (!Number.isFinite(real)) return json({ error: 'saldo inválido' }, 400);

                const [acc] = await sql`
                    select id, name, type from accounts where id = ${reconcileMatch[1]}
                `;
                if (!acc) return json({ error: 'cuenta no encontrada' }, 404);

                // En crédito el usuario dicta la deuda como positiva; el signo
                // interno es negativo.
                const guardado = acc.type === 'credit' ? -Math.abs(real) : real;
                await sql`
                    update accounts
                    set opening_balance = ${guardado}, opening_balance_at = now()
                    where id = ${acc.id}
                `;
                const [b] = await sql`
                    select display_balance from account_balances where id = ${acc.id}
                `;
                return json({ ok: true, name: acc.name, balance: b.display_balance });
            }

            if (url.pathname === '/api/movimientos' && request.method === 'GET') {
                const limite = Math.min(Number(url.searchParams.get('limite')) || 1000, 5000);
                const rows = await sql`
                    select t.id, to_char(t.occurred_at, 'YYYY-MM-DD') as fecha,
                           t.occurred_at, t.amount, t.kind, t.merchant, t.description,
                           t.category, t.receipt_url, t.transfer_group_id, t.source,
                           t.fixed_expense_id, t.created_at,
                           a.name as cuenta, a.currency
                    from transactions t join accounts a on a.id = t.account_id
                    order by t.occurred_at desc, t.created_at desc
                    limit ${limite}
                `;
                return json({ movimientos: rows });
            }

            const movMatch = url.pathname.match(/^\/api\/movimientos\/([\w-]+)$/);
            if (movMatch && request.method === 'DELETE') {
                // Si el movimiento saldaba un gasto fijo, la parte vuelve a
                // quedar pendiente: el borrado no puede dejarla marcada.
                const borrado = await sql.begin(async (tx) => {
                    await tx`
                        delete from fixed_expense_payments where transaction_id = ${movMatch[1]}
                    `;
                    await tx`
                        update pending_transactions
                        set status = 'pending', transaction_id = null, resolved_at = null
                        where transaction_id = ${movMatch[1]}
                    `;
                    const [t] = await tx`
                        delete from transactions where id = ${movMatch[1]} returning id, transfer_group_id
                    `;
                    // Una transferencia son dos filas ligadas: borrar solo una
                    // dejaría dinero apareciendo o desapareciendo de la nada.
                    if (t?.transfer_group_id) {
                        await tx`
                            delete from transactions where transfer_group_id = ${t.transfer_group_id}
                        `;
                    }
                    return t;
                });
                return json(borrado ? { ok: true } : { error: 'no encontrado' }, borrado ? 200 : 404);
            }

            if (movMatch && request.method === 'PATCH') {
                const b = await request.json().catch(() => ({}));
                const [t] = await sql`
                    update transactions set
                        occurred_at = coalesce(${b.occurredAt ?? null}, occurred_at),
                        account_id  = coalesce(${b.accountId ?? null}, account_id),
                        amount      = case when ${b.amount ?? null}::numeric is null then amount
                                           when kind = 'ingreso' then abs(${b.amount ?? null}::numeric)
                                           else -abs(${b.amount ?? null}::numeric) end,
                        merchant    = coalesce(${b.merchant ?? null}, merchant),
                        description = coalesce(${b.description ?? null}, description),
                        receipt_url = coalesce(${b.receiptUrl ?? null}, receipt_url)
                    where id = ${movMatch[1]}
                    returning id
                `;
                return json(t ? { ok: true } : { error: 'no encontrado' }, t ? 200 : 404);
            }

            if (url.pathname === '/api/movimientos' && request.method === 'POST') {
                const b = await request.json().catch(() => ({}));
                const magnitude = Math.abs(Number(b.amount));
                if (!b.accountId || !Number.isFinite(magnitude) || magnitude === 0) {
                    return json({ error: 'falta cuenta o monto' }, 400);
                }
                const kind = b.kind === 'ingreso' ? 'ingreso' : 'gasto';
                const [t] = await sql`
                    insert into transactions (
                        occurred_at, account_id, amount, kind, merchant, description,
                        category, receipt_url, source, source_ref
                    ) values (
                        ${b.occurredAt ?? new Date()}, ${b.accountId},
                        ${kind === 'ingreso' ? magnitude : -magnitude}, ${kind},
                        ${b.merchant ?? null}, ${b.description ?? null},
                        ${b.category ?? null}, ${b.receiptUrl ?? null},
                        ${b.source ?? 'manual'}, ${b.sourceRef ?? null}
                    )
                    on conflict (source, source_ref) where source_ref is not null
                    do nothing
                    returning id
                `;
                if (!t) return json({ error: 'ese movimiento ya estaba registrado' }, 409);
                const [bal] = await sql`
                    select display_balance from account_balances where id = ${b.accountId}
                `;
                return json({ ok: true, id: t.id, balance: bal?.display_balance });
            }

            const approveMatch = url.pathname.match(/^\/api\/pending\/([\w-]+)\/approve$/);
            if (approveMatch && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const result = await approve(sql, approveMatch[1], body);
                return json(result, result.error ? 400 : 200);
            }

            if (url.pathname === '/api/fijos' && request.method === 'GET') {
                const periodo = (url.searchParams.get('period') ?? new Date().toISOString().slice(0, 7)) + '-01';
                // El estado de pago vive por periodo, así que no hace falta el
                // "reset mensual" que la app hacía reescribiendo la hoja: cada
                // mes simplemente no tiene filas todavía.
                const rows = await sql`
                    select f.*,
                           coalesce(
                               jsonb_object_agg(p.part_index,
                                   jsonb_build_object('paid', p.paid, 'waived', p.waived))
                               filter (where p.id is not null),
                               '{}'::jsonb
                           ) as partes
                    from fixed_expenses f
                    left join fixed_expense_payments p
                           on p.fixed_expense_id = f.id and p.period = ${periodo}::date
                    where f.active
                    group by f.id
                    order by f.dia_mes nulls last, f.concepto
                `;
                return json({ periodo, fijos: rows });
            }

            const waiveMatch = url.pathname.match(/^\/api\/fijos\/([\w-]+)\/(waive|unpay)$/);
            if (waiveMatch && request.method === 'POST') {
                const [, fixedId, accion] = waiveMatch;
                const body = await request.json().catch(() => ({}));
                const idx = body.partIndex ?? 0;
                const periodo = (body.period ?? new Date().toISOString().slice(0, 7)) + '-01';

                if (accion === 'waive') {
                    // Condonado: se marca sin movimiento, porque no salió dinero.
                    await sql`
                        insert into fixed_expense_payments (fixed_expense_id, period, part_index, waived)
                        values (${fixedId}, ${periodo}, ${idx}, true)
                        on conflict (fixed_expense_id, period, part_index)
                        do update set waived = true, paid = false
                    `;
                    return json({ ok: true, waived: true });
                }

                // Deshacer: si había movimiento, se borra para que el saldo vuelva.
                await sql.begin(async (tx) => {
                    const [p] = await tx`
                        select transaction_id from fixed_expense_payments
                        where fixed_expense_id = ${fixedId} and period = ${periodo}
                          and part_index = ${idx}
                    `;
                    if (p?.transaction_id) {
                        await tx`delete from transactions where id = ${p.transaction_id}`;
                    }
                    await tx`
                        delete from fixed_expense_payments
                        where fixed_expense_id = ${fixedId} and period = ${periodo}
                          and part_index = ${idx}
                    `;
                });
                return json({ ok: true, undone: true });
            }

            const payMatch = url.pathname.match(/^\/api\/fixed\/([\w-]+)\/pay$/);
            if (payMatch && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const result = await payFixed(sql, payMatch[1], body);
                return json(result, result.error ? 400 : 200);
            }

            const rejectMatch = url.pathname.match(/^\/api\/pending\/([\w-]+)\/reject$/);
            if (rejectMatch && request.method === 'POST') {
                const [row] = await sql`
                    update pending_transactions
                    set status = 'rejected', resolved_at = now()
                    where id = ${rejectMatch[1]} and status = 'pending'
                    returning id
                `;
                return json(row ? { ok: true } : { error: 'no encontrado' }, row ? 200 : 404);
            }

            if (url.pathname === '/api/ingest' && request.method === 'POST') {
                const stats = await runIngest({ sql, credentials: credentialsOf(env) });
                return json(stats);
            }

            return json({ error: 'ruta no encontrada' }, 404);
        } catch (err) {
            console.error(err);
            return json({ error: String(err.message ?? err) }, 500);
        } finally {
            ctx.waitUntil(sql.end());
        }
    },
};
