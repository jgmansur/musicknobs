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
import { aprobarPendiente, borrarMovimiento, pagarFijo } from '../../shared/movimientos.js';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-finance-token',
    // Deben listarse TODOS los métodos que usa la API. El navegador lee esta
    // cabecera y bloquea cualquier método ausente, aunque el preflight
    // responda 204 — y el error que ve el usuario no menciona el método.
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
                const r = await borrarMovimiento(sql, movMatch[1]);
                return json(r, r.error ? 404 : 200);
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
                const result = await aprobarPendiente(sql, approveMatch[1], body);
                return json(result, result.error ? 400 : 200);
            }

            if (url.pathname === '/api/hormiga' && request.method === 'GET') {
                // Se devuelven en el orden de columnas de la hoja para que el
                // dashboard aplique su propia clasificación sin cambios.
                const [items, grupos] = await Promise.all([
                    sql`select to_char(fecha, 'YYYY-MM-DD') as fecha, recibo_id, comercio,
                               producto_raw, producto_normalizado, categoria, subcategoria,
                               cantidad, precio_unitario, total_item, forma_pago, recibo_url,
                               confianza, grupo_producto, hormiga_auto, hormiga_override
                        from receipt_items order by fecha desc limit 3000`,
                    sql`select grupo_producto, aliases, hormiga_default, notas,
                               to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
                        from product_groups order by grupo_producto`,
                ]);
                return json({ items, grupos });
            }

            const grupoMatch = url.pathname.match(/^\/api\/hormiga\/grupos\/(.+)$/);
            if (grupoMatch && request.method === 'PUT') {
                const nombre = decodeURIComponent(grupoMatch[1]);
                const b = await request.json().catch(() => ({}));
                await sql`
                    insert into product_groups (grupo_producto, aliases, hormiga_default, notas, updated_at)
                    values (${nombre}, ${b.aliases ?? []}, ${!!b.hormigaDefault}, ${b.notas ?? null}, now())
                    on conflict (grupo_producto) do update set
                        hormiga_default = excluded.hormiga_default,
                        aliases = case when ${b.aliases ?? null}::text[] is null
                                       then product_groups.aliases else excluded.aliases end,
                        notas = coalesce(excluded.notas, product_groups.notas),
                        updated_at = now()
                `;
                return json({ ok: true });
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

            const fijoMatch = url.pathname.match(/^\/api\/fijos\/([\w-]+)$/);
            if (fijoMatch && request.method === 'DELETE') {
                // Baja lógica: los movimientos históricos siguen apuntando a este
                // fijo, y borrarlo de verdad los dejaría huérfanos.
                const [f] = await sql`
                    update fixed_expenses set active = false
                    where id = ${fijoMatch[1]} returning concepto
                `;
                return json(f ? { ok: true, concepto: f.concepto } : { error: 'no encontrado' },
                            f ? 200 : 404);
            }

            if (fijoMatch && request.method === 'PATCH') {
                const b = await request.json().catch(() => ({}));
                const [f] = await sql`
                    update fixed_expenses set
                        concepto        = coalesce(${b.concepto ?? null}, concepto),
                        categoria       = coalesce(${b.categoria ?? null}, categoria),
                        monto           = coalesce(${b.monto ?? null}, monto),
                        moneda          = coalesce(${b.moneda ?? null}, moneda),
                        tipo            = coalesce(${b.tipo ?? null}, tipo),
                        pagos_mes       = coalesce(${b.pagosMes ?? null}, pagos_mes),
                        periodicidad    = coalesce(${b.periodicidad ?? null}, periodicidad),
                        inicio_mes      = coalesce(${b.inicioMes ?? null}, inicio_mes),
                        pagador         = coalesce(${b.pagador ?? null}, pagador),
                        budget_category = coalesce(${b.budgetCategory ?? null}, budget_category),
                        link_group      = ${b.linkGroup ?? null},
                        dia_mes         = coalesce(${b.diaMes ?? null}, dia_mes)
                    where id = ${fijoMatch[1]} returning id
                `;
                return json(f ? { ok: true } : { error: 'no encontrado' }, f ? 200 : 404);
            }

            if (url.pathname === '/api/fijos' && request.method === 'POST') {
                const b = await request.json().catch(() => ({}));
                if (!b.concepto || !Number.isFinite(Number(b.monto))) {
                    return json({ error: 'falta concepto o monto' }, 400);
                }
                const [f] = await sql`
                    insert into fixed_expenses (concepto, categoria, monto, moneda, tipo,
                        pagos_mes, periodicidad, inicio_mes, pagador, budget_category,
                        link_group, dia_mes, fechas_pago)
                    values (${b.concepto}, ${b.categoria ?? null}, ${b.monto},
                        ${b.moneda ?? 'MXN'}, ${b.tipo ?? 'gasto'}, ${b.pagosMes ?? 1},
                        ${b.periodicidad ?? 'mensual'}, ${b.inicioMes ?? null},
                        ${b.pagador ?? null}, ${b.budgetCategory ?? null},
                        ${b.linkGroup ?? null}, ${b.diaMes ?? null}, ${b.fechasPago ?? []})
                    returning id
                `;
                return json({ ok: true, id: f.id });
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

            if (url.pathname === '/api/deudas' && request.method === 'GET') {
                const rows = await sql`
                    select d.*,
                           coalesce(
                               jsonb_agg(jsonb_build_object('indice', i.indice, 'estado', i.estado)
                                         order by i.indice) filter (where i.id is not null),
                               '[]'::jsonb
                           ) as cuotas
                    from debts d
                    left join debt_installments i on i.debt_id = d.id
                    group by d.id order by d.hidden, d.concepto
                `;
                return json({ deudas: rows });
            }

            if (url.pathname === '/api/deudas' && request.method === 'POST') {
                const b = await request.json().catch(() => ({}));
                if (!b.concepto) return json({ error: 'falta el concepto' }, 400);
                const [d] = await sql`
                    insert into debts (concepto, monto, hidden, debt_key, parent_key,
                                       archivos, cuotas_total, cuota_monto, frecuencia,
                                       fecha_inicio, scope)
                    values (${b.concepto}, ${b.monto ?? 0}, ${!!b.hidden},
                            ${b.debtKey ?? null}, ${b.parentKey ?? null}, ${b.archivos ?? null},
                            ${b.cuotasTotal ?? null}, ${b.cuotaMonto ?? null},
                            ${b.frecuencia ?? 'mensual'}, ${b.fechaInicio ?? null},
                            ${b.scope ?? 'self'})
                    returning id
                `;
                return json({ ok: true, id: d.id });
            }

            const deudaMatch = url.pathname.match(/^\/api\/deudas\/([\w-]+)$/);
            if (deudaMatch && request.method === 'PATCH') {
                const b = await request.json().catch(() => ({}));
                const [d] = await sql`
                    update debts set
                        concepto     = coalesce(${b.concepto ?? null}, concepto),
                        monto        = coalesce(${b.monto ?? null}, monto),
                        hidden       = coalesce(${b.hidden ?? null}, hidden),
                        archivos     = coalesce(${b.archivos ?? null}, archivos),
                        cuotas_total = coalesce(${b.cuotasTotal ?? null}, cuotas_total),
                        cuota_monto  = coalesce(${b.cuotaMonto ?? null}, cuota_monto),
                        frecuencia   = coalesce(${b.frecuencia ?? null}, frecuencia),
                        fecha_inicio = coalesce(${b.fechaInicio ?? null}::date, fecha_inicio),
                        scope        = coalesce(${b.scope ?? null}, scope)
                    where id = ${deudaMatch[1]} returning id
                `;
                if (!d) return json({ error: 'deuda no encontrada' }, 404);

                // Las cuotas se reemplazan completas cuando se manda el arreglo:
                // dividir una deuda redefine el plan entero, no una cuota suelta.
                if (Array.isArray(b.cuotas)) {
                    await sql`delete from debt_installments where debt_id = ${d.id}`;
                    for (const c of b.cuotas) {
                        await sql`
                            insert into debt_installments (debt_id, indice, estado)
                            values (${d.id}, ${c.indice}, ${c.estado ?? 'pendiente'})
                        `;
                    }
                }
                return json({ ok: true });
            }

            if (deudaMatch && request.method === 'DELETE') {
                const [d] = await sql`
                    delete from debts where id = ${deudaMatch[1]} returning concepto
                `;
                return json(d ? { ok: true } : { error: 'no encontrada' }, d ? 200 : 404);
            }

            const payMatch = url.pathname.match(/^\/api\/fixed\/([\w-]+)\/pay$/);
            if (payMatch && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const result = await pagarFijo(sql, payMatch[1], body);
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
