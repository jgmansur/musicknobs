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
import { revisarSalud } from '../../shared/salud.js';

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
                           py.nombre as beneficiario, p.duplicate_of,
                           dup.merchant as duplicado_comercio,
                           to_char(dup.occurred_at, 'YYYY-MM-DD') as duplicado_fecha,
                           -- Anterior al ancla del saldo: aprobarlo llena el
                           -- historial pero no mueve el saldo, porque ese gasto
                           -- ya está incluido en el saldo inicial.
                           (p.occurred_at < a.opening_balance_at) as historico
                    from pending_transactions p
                    left join accounts a on a.id = p.suggested_account_id
                    left join fixed_expenses f on f.id = p.suggested_fixed_expense_id
                    left join payees py on py.id = p.payee_id
                    left join transactions dup on dup.id = p.duplicate_of
                    where p.status = 'pending'
                    order by p.occurred_at desc
                    limit 200
                `;
                return json({ pending: rows });
            }

            if (url.pathname === '/api/salud' && request.method === 'GET') {
                return json(await revisarSalud(sql));
            }

            // Categorías ya en uso. Existe para que el editor de la bandeja
            // ofrezca las que Jay YA usa en vez de dejarlo teclear a ciegas:
            // inventar "Comida" cuando ya existe "Alimentos" parte el histórico
            // en dos y ningún reporte vuelve a cuadrar.
            if (url.pathname === '/api/categorias' && request.method === 'GET') {
                const rows = await sql`
                    select category, count(*)::int as n
                    from transactions
                    where category is not null and category <> ''
                      and occurred_at >= (current_date - interval '12 months')
                    group by category
                    order by n desc
                `;
                return json({ categorias: rows.map((r) => r.category) });
            }

            if (url.pathname === '/api/balances' && request.method === 'GET') {
                // Se devuelven TODOS los campos que el dashboard necesita para
                // pintar sus tarjetas, no solo el saldo: así puede dejar de leer
                // la hoja por completo.
                const rows = await sql`
                    select a.id, a.legacy_id, a.name, a.type, a.currency, a.hidden,
                           a.credit_limit, a.credit_limit_visible, a.investment_type,
                           a.custom_annual_rate, a.bitcoin_initial_mxn, a.sort_order,
                           b.balance, b.display_balance, b.movements, b.last_movement_at
                    from accounts a
                    join account_balances b on b.id = a.id
                    -- Orden elegido por Jay; las que no tienen uno explícito
                    -- quedan en 999 y se desempatan alfabéticamente.
                    order by a.sort_order, a.name
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
                    // El `id` va primero porque el dashboard lo necesita para
                    // poder corregir el override de un artículo suelto.
                    sql`select id, to_char(fecha, 'YYYY-MM-DD') as fecha, recibo_id, comercio,
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

            // Override por artículo suelto. `hormigaOverride` puede ser true,
            // false o null: null significa "quita mi corrección y deja que
            // mande el default del grupo".
            const itemMatch = url.pathname.match(/^\/api\/hormiga\/items\/([\w-]+)$/);
            if (itemMatch && request.method === 'PATCH') {
                const b = await request.json().catch(() => ({}));
                const valor = b.hormigaOverride === null || b.hormigaOverride === undefined
                    ? null
                    : !!b.hormigaOverride;
                const [r] = await sql`
                    update receipt_items set hormiga_override = ${valor}
                    where id = ${itemMatch[1]} returning id
                `;
                return json(r ? { ok: true } : { error: 'artículo no encontrado' }, r ? 200 : 404);
            }

            if (url.pathname === '/api/hormiga/items' && request.method === 'POST') {
                // Alta manual del desglose por producto de un ticket. Hasta
                // ahora la ÚNICA vía era el ingest de correos, así que un ticket
                // en papel se quedaba sin artículos y el análisis de gasto
                // hormiga solo veía lo que llegaba por Gmail.
                const b = await request.json().catch(() => ({}));
                const items = Array.isArray(b.items) ? b.items : [];
                if (!items.length) return json({ error: 'no llegó ningún artículo' }, 400);

                const insertados = await sql.begin(async (tx) => {
                    const ids = [];
                    for (const it of items) {
                        const nombre = it.productoNormalizado || it.productoRaw;
                        if (!nombre) continue;

                        // El grupo debe existir antes de referenciarlo: la FK de
                        // receipt_items apunta a product_groups.
                        if (it.grupoProducto) {
                            await tx`
                                insert into product_groups (grupo_producto)
                                values (${it.grupoProducto})
                                on conflict (grupo_producto) do nothing
                            `;
                        }
                        const [fila] = await tx`
                            insert into receipt_items (fecha, recibo_id, comercio,
                                producto_raw, producto_normalizado, categoria, subcategoria,
                                cantidad, precio_unitario, total_item, forma_pago, recibo_url,
                                confianza, grupo_producto, hormiga_auto, hormiga_override,
                                transaction_id)
                            values (${it.fecha ?? b.fecha ?? new Date()},
                                    ${it.reciboId ?? b.reciboId ?? null},
                                    ${it.comercio ?? b.comercio ?? null},
                                    ${it.productoRaw ?? nombre}, ${it.productoNormalizado ?? nombre},
                                    ${it.categoria ?? null}, ${it.subcategoria ?? null},
                                    ${it.cantidad ?? 1}, ${it.precioUnitario ?? null},
                                    ${it.totalItem ?? null},
                                    ${it.formaPago ?? b.formaPago ?? null},
                                    ${it.reciboUrl ?? b.reciboUrl ?? null},
                                    ${it.confianza ?? 'media'}, ${it.grupoProducto ?? null},
                                    ${it.hormigaAuto ?? null}, ${it.hormigaOverride ?? null},
                                    ${it.transactionId ?? b.transactionId ?? null})
                            returning id
                        `;
                        ids.push(fila.id);
                    }
                    return ids;
                });
                return json({ ok: true, insertados: insertados.length, ids: insertados });
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

            if (url.pathname === '/api/lugares' && request.method === 'GET') {
                const rows = await sql`
                    select id, nombre, tipo, categoria from places
                    where tipo <> 'marcador' order by nombre
                `;
                return json({ lugares: rows });
            }

            if (url.pathname === '/api/lugares' && request.method === 'POST') {
                const b = await request.json().catch(() => ({}));
                const nombre = (b.nombre ?? '').trim();
                if (nombre.length < 2) return json({ error: 'nombre inválido' }, 400);
                const [p] = await sql`
                    insert into places (nombre, tipo, aliases, categoria)
                    values (${nombre}, ${b.tipo ?? 'comercio'},
                            ${b.aliases ?? [nombre.toLowerCase()]}, ${b.categoria ?? null})
                    on conflict (nombre) do update set nombre = excluded.nombre
                    returning id, nombre, categoria
                `;
                return json({ ok: true, lugar: p });
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
                    -- El orden lo define sort_order; antes se reordenaba
                    -- intercambiando el contenido entre registros, que con UUID
                    -- movía los datos de una deuda al id de otra.
                    group by d.id order by d.hidden, d.sort_order, d.concepto
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
                        scope        = coalesce(${b.scope ?? null}, scope),
                        sort_order   = coalesce(${b.sortOrder ?? null}, sort_order)
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

            // ── Cuentas ─────────────────────────────────────────────────
            //
            // El dashboard reescribía la hoja de Saldos entera al guardar; aquí
            // se conserva esa semántica con un PUT del arreglo completo.
            //
            // OJO CON EL SALDO: `opening_balance` es el ANCLA, no el saldo que
            // se ve. El saldo mostrado sale de sumar los movimientos encima del
            // ancla. Si este endpoint escribiera el saldo visible en el ancla,
            // los movimientos se contarían dos veces. Por eso el PUT solo toca
            // metadatos, y el ancla se mueve únicamente al crear la cuenta o
            // vía /reconcile, que es una acción deliberada.
            if (url.pathname === '/api/accounts' && request.method === 'PUT') {
                const b = await request.json().catch(() => ({}));
                const cuentas = Array.isArray(b.accounts) ? b.accounts : [];
                if (!cuentas.length) return json({ error: 'no llegó ninguna cuenta' }, 400);

                const resultado = await sql.begin(async (tx) => {
                    const vistos = [];
                    for (const c of cuentas) {
                        if (!c.name) continue;
                        const tipo = ['bank', 'cash', 'credit', 'invest', 'other'].includes(c.type)
                            ? c.type : 'other';
                        // No hay índice único sobre `name`, así que se busca
                        // primero en vez de usar ON CONFLICT.
                        const [existente] = await tx`
                            select id from accounts where lower(name) = lower(${c.name})
                        `;
                        if (existente) {
                            await tx`
                                update accounts set
                                    type = ${tipo}, currency = ${c.currency ?? 'MXN'},
                                    hidden = ${!!c.hidden},
                                    credit_limit = ${Math.abs(Number(c.creditLimit ?? 0))},
                                    credit_limit_visible = ${!!c.creditLimitVisible},
                                    investment_type = ${c.investmentType ?? null},
                                    sort_order = coalesce(${c.sortOrder ?? null}, sort_order),
                                    updated_at = now()
                                where id = ${existente.id}
                            `;
                            vistos.push({ name: c.name, creada: false });
                        } else {
                            // En crédito la deuda se guarda negativa, como LikeU.
                            const apertura = tipo === 'credit'
                                ? -Math.abs(Number(c.openingBalance ?? 0))
                                : Number(c.openingBalance ?? 0);
                            await tx`
                                insert into accounts (name, type, currency, hidden, credit_limit,
                                    credit_limit_visible, investment_type, opening_balance,
                                    opening_balance_at)
                                values (${c.name}, ${tipo}, ${c.currency ?? 'MXN'}, ${!!c.hidden},
                                    ${Math.abs(Number(c.creditLimit ?? 0))}, ${!!c.creditLimitVisible},
                                    ${c.investmentType ?? null}, ${apertura}, now())
                            `;
                            vistos.push({ name: c.name, creada: true });
                        }
                    }
                    return vistos;
                });

                const creadas = resultado.filter((r) => r.creada).map((r) => r.name);
                return json({ ok: true, total: resultado.length, creadas });
            }

            const cuentaMatch = url.pathname.match(/^\/api\/accounts\/([\w-]+)$/);
            if (cuentaMatch && request.method === 'PATCH') {
                // Cambio puntual de UNA cuenta. El PUT del arreglo completo hace
                // 13 SELECT + 13 UPDATE en una transacción y tardaba ~3.4 s, lo
                // que para voltear un solo bit (ocultar una cuenta) es absurdo.
                // Como en el PUT, aquí NO se toca `opening_balance`: eso es el
                // ancla y solo se mueve por /reconcile.
                const b = await request.json().catch(() => ({}));
                const [a] = await sql`
                    update accounts set
                        name                 = coalesce(${b.name ?? null}, name),
                        type                 = coalesce(${b.type ?? null}, type),
                        currency             = coalesce(${b.currency ?? null}, currency),
                        hidden               = coalesce(${b.hidden ?? null}, hidden),
                        credit_limit         = coalesce(${b.creditLimit ?? null}, credit_limit),
                        credit_limit_visible = coalesce(${b.creditLimitVisible ?? null}, credit_limit_visible),
                        investment_type      = coalesce(${b.investmentType ?? null}, investment_type),
                        sort_order           = coalesce(${b.sortOrder ?? null}, sort_order),
                        updated_at           = now()
                    where id = ${cuentaMatch[1]} returning name
                `;
                return json(a ? { ok: true, name: a.name } : { error: 'cuenta no encontrada' },
                            a ? 200 : 404);
            }

            if (cuentaMatch && request.method === 'DELETE') {
                // Borrar una cuenta con movimientos dejaría el historial huérfano
                // o lo arrastraría en cascada. Se rechaza y se dice cuántos hay:
                // esconderla (hidden) casi siempre es lo que se quiere.
                const [{ n }] = await sql`
                    select count(*)::int as n from transactions
                    where account_id = ${cuentaMatch[1]}
                `;
                if (n > 0) {
                    return json({
                        error: `esa cuenta tiene ${n} movimiento(s); ocúltala en vez de borrarla`,
                    }, 409);
                }
                const [borrada] = await sql`
                    delete from accounts where id = ${cuentaMatch[1]} returning name
                `;
                return json(borrada ? { ok: true, name: borrada.name } : { error: 'no encontrada' },
                            borrada ? 200 : 404);
            }

            // ── Catálogos: autos, estudio y recetas ──────────────────────
            //
            // El dashboard venía de hojas, donde guardar significaba reescribir
            // la pestaña completa. Se conserva esa semántica con un PUT que
            // recibe el arreglo entero: hace upsert por `legacy_key` y borra lo
            // que ya no viene. Así el módulo cambia poco y sigue siendo un solo
            // viaje de red. Los volúmenes son de decenas de filas, no miles.
            //
            // `transaction_id` NO se toca en el upsert: el vínculo con el gasto
            // lo maneja el propio módulo al sincronizarlo, y pisarlo aquí
            // dejaría movimientos huérfanos.

            if (url.pathname === '/api/cars' && request.method === 'GET') {
                const [cars, repairs] = await Promise.all([
                    sql`select *, to_char(vencimiento_poliza, 'YYYY-MM-DD') as vencimiento_poliza,
                               to_char(vencimiento_tenencia, 'YYYY-MM-DD') as vencimiento_tenencia
                        from cars order by marca, modelo`,
                    sql`select r.*, to_char(r.fecha, 'YYYY-MM-DD') as fecha, c.legacy_key as car_key
                        from car_repairs r join cars c on c.id = r.car_id
                        order by r.fecha desc nulls last`,
                ]);
                return json({ cars, repairs });
            }

            if (url.pathname === '/api/cars' && request.method === 'PUT') {
                const b = await request.json().catch(() => ({}));
                const cars = Array.isArray(b.cars) ? b.cars : [];
                await sql.begin(async (tx) => {
                    for (const c of cars) {
                        if (!c.legacyKey) continue;
                        await tx`
                            insert into cars (legacy_key, marca, modelo, anio, valor_factura,
                                kilometraje, propietario, tiene_seguro, placa, vin, poliza_seguro,
                                vencimiento_poliza, vencimiento_tenencia, pago_tenencia,
                                proxima_revision_km, contrato_prestamo, emergencia_interior,
                                emergencia_metro, reporte_siniestros_1, reporte_siniestros_2,
                                tipo_llantas, foto_auto, factura_archivo, poliza_archivo,
                                tarjeta_frente, tarjeta_atras, llantas_foto, certificado_polarizado,
                                tabla_pagos, tabla_pagos_seguro, extra_doc_1_nombre, extra_doc_1_url,
                                extra_doc_2_nombre, extra_doc_2_url)
                            values (${c.legacyKey}, ${c.marca ?? '?'}, ${c.modelo ?? '?'},
                                ${c.anio ?? null}, ${c.valorFactura ?? null}, ${c.kilometraje ?? null},
                                ${c.propietario ?? null}, ${!!c.tieneSeguro}, ${c.placa ?? null},
                                ${c.vin ?? null}, ${c.polizaSeguro ?? null},
                                ${c.vencimientoPoliza || null}, ${c.vencimientoTenencia || null},
                                ${c.pagoTenencia ?? null}, ${c.proximaRevisionKm ?? null},
                                ${c.contratoPrestamo ?? null}, ${c.emergenciaInterior ?? null},
                                ${c.emergenciaMetro ?? null}, ${c.reporteSiniestros1 ?? null},
                                ${c.reporteSiniestros2 ?? null}, ${c.tipoLlantas ?? null},
                                ${c.fotoAuto ?? null}, ${c.facturaArchivo ?? null},
                                ${c.polizaArchivo ?? null}, ${c.tarjetaFrente ?? null},
                                ${c.tarjetaAtras ?? null}, ${c.llantasFoto ?? null},
                                ${c.certificadoPolarizado ?? null}, ${c.tablaPagos ?? null},
                                ${c.tablaPagosSeguro ?? null}, ${c.extraDoc1Nombre ?? null},
                                ${c.extraDoc1Url ?? null}, ${c.extraDoc2Nombre ?? null},
                                ${c.extraDoc2Url ?? null})
                            on conflict (legacy_key) do update set
                                marca = excluded.marca, modelo = excluded.modelo,
                                anio = excluded.anio, valor_factura = excluded.valor_factura,
                                kilometraje = excluded.kilometraje, propietario = excluded.propietario,
                                tiene_seguro = excluded.tiene_seguro, placa = excluded.placa,
                                vin = excluded.vin, poliza_seguro = excluded.poliza_seguro,
                                vencimiento_poliza = excluded.vencimiento_poliza,
                                vencimiento_tenencia = excluded.vencimiento_tenencia,
                                pago_tenencia = excluded.pago_tenencia,
                                proxima_revision_km = excluded.proxima_revision_km,
                                contrato_prestamo = excluded.contrato_prestamo,
                                emergencia_interior = excluded.emergencia_interior,
                                emergencia_metro = excluded.emergencia_metro,
                                reporte_siniestros_1 = excluded.reporte_siniestros_1,
                                reporte_siniestros_2 = excluded.reporte_siniestros_2,
                                tipo_llantas = excluded.tipo_llantas,
                                foto_auto = excluded.foto_auto,
                                factura_archivo = excluded.factura_archivo,
                                poliza_archivo = excluded.poliza_archivo,
                                tarjeta_frente = excluded.tarjeta_frente,
                                tarjeta_atras = excluded.tarjeta_atras,
                                llantas_foto = excluded.llantas_foto,
                                certificado_polarizado = excluded.certificado_polarizado,
                                tabla_pagos = excluded.tabla_pagos,
                                tabla_pagos_seguro = excluded.tabla_pagos_seguro,
                                extra_doc_1_nombre = excluded.extra_doc_1_nombre,
                                extra_doc_1_url = excluded.extra_doc_1_url,
                                extra_doc_2_nombre = excluded.extra_doc_2_nombre,
                                extra_doc_2_url = excluded.extra_doc_2_url,
                                updated_at = now()
                        `;
                    }
                    const vivos = cars.map((c) => c.legacyKey).filter(Boolean);
                    if (vivos.length) await tx`delete from cars where legacy_key <> all(${vivos})`;
                    else await tx`delete from cars`;
                });
                return json({ ok: true, total: cars.length });
            }

            if (url.pathname === '/api/repairs' && request.method === 'PUT') {
                const b = await request.json().catch(() => ({}));
                const reps = Array.isArray(b.repairs) ? b.repairs : [];
                await sql.begin(async (tx) => {
                    for (const r of reps) {
                        if (!r.legacyKey || !r.carKey) continue;
                        const [car] = await tx`select id from cars where legacy_key = ${r.carKey}`;
                        if (!car) continue;   // reparación sin auto padre: se ignora
                        await tx`
                            insert into car_repairs (legacy_key, car_id, reparacion, costo, moneda,
                                lugar, fecha, descripcion, forma_pago, foto, recibo, transaction_id)
                            values (${r.legacyKey}, ${car.id}, ${r.reparacion ?? '?'},
                                ${r.costo ?? 0}, ${r.moneda ?? 'MXN'}, ${r.lugar ?? null},
                                ${r.fecha || null}, ${r.descripcion ?? null}, ${r.formaPago ?? null},
                                ${r.foto ?? null}, ${r.recibo ?? null}, ${r.transactionId || null})
                            on conflict (legacy_key) do update set
                                car_id = excluded.car_id, reparacion = excluded.reparacion,
                                costo = excluded.costo, moneda = excluded.moneda,
                                lugar = excluded.lugar, fecha = excluded.fecha,
                                descripcion = excluded.descripcion, forma_pago = excluded.forma_pago,
                                foto = excluded.foto, recibo = excluded.recibo,
                                transaction_id = coalesce(excluded.transaction_id,
                                                          car_repairs.transaction_id),
                                updated_at = now()
                        `;
                    }
                    const vivos = reps.map((r) => r.legacyKey).filter(Boolean);
                    if (vivos.length) await tx`delete from car_repairs where legacy_key <> all(${vivos})`;
                    else await tx`delete from car_repairs`;
                });
                return json({ ok: true, total: reps.length });
            }

            if (url.pathname === '/api/studio' && request.method === 'GET') {
                const items = await sql`
                    select *, to_char(fecha_compra, 'YYYY-MM-DD') as fecha_compra
                    from studio_gear order by tipo, name
                `;
                return json({ items });
            }

            if (url.pathname === '/api/studio' && request.method === 'PUT') {
                const b = await request.json().catch(() => ({}));
                const items = Array.isArray(b.items) ? b.items : [];
                await sql.begin(async (tx) => {
                    for (const g of items) {
                        if (!g.legacyKey || !['equipo', 'plugin'].includes(g.tipo)) continue;
                        await tx`
                            insert into studio_gear (legacy_key, tipo, name, marca, modelo,
                                descripcion, categoria, cantidad, precio_usd, currency, anio_compra,
                                fecha_compra, site, serial, licencia, account, notas, forma_pago,
                                foto, transaction_id)
                            values (${g.legacyKey}, ${g.tipo}, ${g.name ?? '?'}, ${g.marca ?? null},
                                ${g.modelo ?? null}, ${g.descripcion ?? null}, ${g.categoria ?? null},
                                ${g.cantidad ?? 1}, ${g.precioUsd ?? null}, ${g.currency ?? 'USD'},
                                ${g.anioCompra ?? null}, ${g.fechaCompra || null}, ${g.site ?? null},
                                ${g.serial ?? null}, ${g.licencia ?? null}, ${g.account ?? null},
                                ${g.notas ?? null}, ${g.formaPago ?? null}, ${g.foto ?? null},
                                ${g.transactionId || null})
                            on conflict (legacy_key) do update set
                                tipo = excluded.tipo, name = excluded.name, marca = excluded.marca,
                                modelo = excluded.modelo, descripcion = excluded.descripcion,
                                categoria = excluded.categoria, cantidad = excluded.cantidad,
                                precio_usd = excluded.precio_usd, currency = excluded.currency,
                                anio_compra = excluded.anio_compra, fecha_compra = excluded.fecha_compra,
                                site = excluded.site, serial = excluded.serial,
                                licencia = excluded.licencia, account = excluded.account,
                                notas = excluded.notas, forma_pago = excluded.forma_pago,
                                foto = excluded.foto,
                                transaction_id = coalesce(excluded.transaction_id,
                                                          studio_gear.transaction_id),
                                updated_at = now()
                        `;
                    }
                    const vivos = items.map((g) => g.legacyKey).filter(Boolean);
                    if (vivos.length) await tx`delete from studio_gear where legacy_key <> all(${vivos})`;
                    else await tx`delete from studio_gear`;
                });
                return json({ ok: true, total: items.length });
            }

            if (url.pathname === '/api/prescriptions' && request.method === 'GET') {
                const items = await sql`
                    select *, to_char(fecha, 'YYYY-MM-DD') as fecha,
                           to_char(proxima_cita, 'YYYY-MM-DD') as proxima_cita,
                           to_char(vigencia_hasta, 'YYYY-MM-DD') as vigencia_hasta
                    from prescriptions
                    -- Se califica la tabla porque el star ya trae fecha y el
                    -- alias de to_char crea una segunda con el mismo nombre.
                    order by prescriptions.fecha desc nulls last
                `;
                return json({ items });
            }

            if (url.pathname === '/api/prescriptions' && request.method === 'PUT') {
                const b = await request.json().catch(() => ({}));
                const items = Array.isArray(b.items) ? b.items : [];
                await sql.begin(async (tx) => {
                    for (const r of items) {
                        if (!r.legacyKey) continue;
                        await tx`
                            insert into prescriptions (legacy_key, member, fecha, doctor,
                                especialidad, diagnostico, medicamentos, indicaciones, proxima_cita,
                                vigencia_hasta, notas, foto_url, foto_url_2, recibo_url,
                                monto_consulta, forma_pago, transaction_id)
                            values (${r.legacyKey}, ${r.member ?? 'yo'}, ${r.fecha || null},
                                ${r.doctor ?? null}, ${r.especialidad ?? null},
                                ${r.diagnostico ?? null},
                                ${JSON.stringify(r.medicamentos ?? [])}::jsonb,
                                ${r.indicaciones ?? null}, ${r.proximaCita || null},
                                ${r.vigenciaHasta || null}, ${r.notas ?? null},
                                ${r.fotoUrl ?? null}, ${r.fotoUrl2 ?? null}, ${r.reciboUrl ?? null},
                                ${r.montoConsulta ?? null}, ${r.formaPago ?? null},
                                ${r.transactionId || null})
                            on conflict (legacy_key) do update set
                                member = excluded.member, fecha = excluded.fecha,
                                doctor = excluded.doctor, especialidad = excluded.especialidad,
                                diagnostico = excluded.diagnostico,
                                medicamentos = excluded.medicamentos,
                                indicaciones = excluded.indicaciones,
                                proxima_cita = excluded.proxima_cita,
                                vigencia_hasta = excluded.vigencia_hasta, notas = excluded.notas,
                                foto_url = excluded.foto_url, foto_url_2 = excluded.foto_url_2,
                                recibo_url = excluded.recibo_url,
                                monto_consulta = excluded.monto_consulta,
                                forma_pago = excluded.forma_pago,
                                transaction_id = coalesce(excluded.transaction_id,
                                                          prescriptions.transaction_id),
                                updated_at = now()
                        `;
                    }
                    const vivos = items.map((r) => r.legacyKey).filter(Boolean);
                    if (vivos.length) await tx`delete from prescriptions where legacy_key <> all(${vivos})`;
                    else await tx`delete from prescriptions`;
                });
                return json({ ok: true, total: items.length });
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
