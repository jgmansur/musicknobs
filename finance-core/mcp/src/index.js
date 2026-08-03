#!/usr/bin/env node
/**
 * MCP de las finanzas de Jay.
 *
 * Da a cualquier asistente acceso a la base de finance-core con las reglas de
 * negocio aplicadas: transferencias que no son gasto, signo de las tarjetas de
 * crédito, gastos fijos que al marcarse crean su movimiento, idempotencia.
 *
 * Lee la conexión de finance-core/.env (SUPABASE_DB_URL).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import postgres from 'postgres';
import {
    montoConSigno, validarMovimiento, detectarTransferencia, ambiguedad,
    BUDGET_BUCKETS,
} from './reglas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = join(HERE, '..', '..', '.env');

function envValue(key) {
    for (const line of readFileSync(ENV, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i > 0 && t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
    }
    throw new Error(`Falta ${key} en ${ENV}`);
}

const sql = postgres(envValue('SUPABASE_DB_URL'), { prepare: false, max: 3 });

const texto = (s) => ({ content: [{ type: 'text', text: s }] });
const dinero = (n) =>
    Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Resuelve una cuenta por nombre, tolerando abreviaciones ("likeu", "hey").
 *
 * Devuelve `{cuenta}` si hay una sola, `{error}` si no existe o si el término es
 * ambiguo. Nunca elige por su cuenta entre varias: hacerlo puede registrar un
 * movimiento en la cuenta equivocada y nadie se entera hasta que no cuadran los
 * saldos.
 */
async function buscarCuenta(nombre) {
    const [exacta] = await sql`
        select id, name, type, currency from accounts where lower(name) = lower(${nombre ?? ''})
    `;
    if (exacta) return { cuenta: exacta };

    const parciales = await sql`
        select id, name, type, currency from accounts
        where name ilike ${'%' + (nombre ?? '') + '%'}
        order by name
    `;
    if (parciales.length === 1) return { cuenta: parciales[0] };
    if (parciales.length > 1) {
        return { error: ambiguedad(nombre, parciales.map((c) => c.name), 'cuenta') };
    }

    const todas = await sql`select name from accounts order by name`;
    return {
        error: `No existe la cuenta "${nombre}". Las disponibles son:\n`
            + todas.map((c) => `  - ${c.name}`).join('\n'),
    };
}

/** Lista de nombres de cuentas propias, para detectar transferencias. */
async function nombresDeCuentas() {
    const rows = await sql`select name from accounts`;
    return rows.map((r) => r.name);
}

const server = new McpServer({ name: 'finanzas-jay', version: '1.0.0' });

// ---------------------------------------------------------------- Consultas

server.tool(
    'finanzas_saldos',
    'Saldos actuales de todas las cuentas. Se derivan de los movimientos, no se capturan.',
    {},
    async () => {
        const rows = await sql`
            select name, type, currency, display_balance, movements, last_movement_at
            from account_balances order by type, name
        `;
        const lineas = rows.map((r) => {
            const etiqueta = r.type === 'credit' ? ' (deuda)' : '';
            return `  ${r.name.padEnd(28)} ${dinero(r.display_balance).padStart(14)} ${r.currency}${etiqueta}`;
        });
        return texto(`Saldos:\n${lineas.join('\n')}`);
    },
);

server.tool(
    'finanzas_resumen_mes',
    'Gastos e ingresos de un mes, desglosados por categoría.',
    { mes: z.string().regex(/^\d{4}-\d{2}$/).describe('Mes en formato YYYY-MM') },
    async ({ mes }) => {
        const rows = await sql`
            select coalesce(category, 'sin categoría') as categoria, gasto, ingreso
            from monthly_spend where period = ${mes + '-01'}::date
            order by gasto desc nulls last
        `;
        if (!rows.length) return texto(`No hay movimientos registrados en ${mes}.`);

        const gasto = rows.reduce((s, r) => s + Number(r.gasto || 0), 0);
        const ingreso = rows.reduce((s, r) => s + Number(r.ingreso || 0), 0);
        const detalle = rows
            .filter((r) => Number(r.gasto) > 0)
            .map((r) => `  ${r.categoria.padEnd(34)} ${dinero(r.gasto).padStart(12)}`)
            .join('\n');

        return texto(
            `${mes}\n\nGasto total:   ${dinero(gasto)}\nIngreso total: ${dinero(ingreso)}\n` +
            `Balance:       ${dinero(ingreso - gasto)}\n\nPor categoría:\n${detalle}\n\n` +
            'Las transferencias entre cuentas propias quedan fuera: no son gasto.',
        );
    },
);

server.tool(
    'finanzas_buscar_movimientos',
    'Busca movimientos por texto, cuenta o rango de fechas.',
    {
        texto: z.string().optional().describe('Busca en comercio y concepto'),
        cuenta: z.string().optional(),
        desde: z.string().optional().describe('YYYY-MM-DD'),
        hasta: z.string().optional().describe('YYYY-MM-DD'),
        limite: z.number().int().min(1).max(100).default(25),
    },
    async ({ texto: q, cuenta, desde, hasta, limite }) => {
        const rows = await sql`
            select to_char(t.occurred_at, 'YYYY-MM-DD') as fecha, t.merchant, t.description,
                   t.amount, t.kind, a.name as cuenta
            from transactions t join accounts a on a.id = t.account_id
            where (${q ?? null}::text is null
                   or t.merchant ilike ${'%' + (q ?? '') + '%'}
                   or t.description ilike ${'%' + (q ?? '') + '%'})
              and (${cuenta ?? null}::text is null or a.name ilike ${'%' + (cuenta ?? '') + '%'})
              and (${desde ?? null}::date is null or t.occurred_at >= ${desde ?? null}::date)
              and (${hasta ?? null}::date is null or t.occurred_at < ${hasta ?? null}::date + 1)
            order by t.occurred_at desc limit ${limite}
        `;
        if (!rows.length) return texto('Sin resultados.');
        const lineas = rows.map(
            (r) => `  ${r.fecha}  ${dinero(r.amount).padStart(12)}  ${(r.merchant || r.description || '').slice(0, 34).padEnd(34)} ${r.cuenta}`,
        );
        return texto(`${rows.length} movimientos:\n${lineas.join('\n')}`);
    },
);

// ------------------------------------------------------------------ Escritura

server.tool(
    'finanzas_registrar_movimiento',
    'Registra un gasto o ingreso. BLOQUEA cuando identifica que el destino es otra '
    + 'cuenta propia (sería una transferencia y contaría doble); si solo lo sospecha '
    + 'por el texto, registra y advierte.',
    {
        tipo: z.enum(['gasto', 'ingreso']),
        monto: z.number().describe('Siempre positivo; el signo lo pone el sistema'),
        cuenta: z.string().describe('Cuenta o forma de pago. Usa finanzas_saldos para verlas.'),
        concepto: z.string(),
        comercio: z.string().optional(),
        categoria: z.string().optional(),
        fecha: z.string().optional().describe('YYYY-MM-DD; por omisión hoy'),
        destino: z.string().optional()
            .describe('Si el dinero fue a otra cuenta propia, decláralo: se bloqueará'),
        idempotency_key: z.string().optional()
            .describe('Repetir la llamada con la misma clave no duplica el movimiento'),
    },
    async ({ tipo, monto, cuenta, concepto, comercio, categoria, fecha, destino, idempotency_key }) => {
        const problemas = validarMovimiento({ cuenta, monto, tipo, concepto, categoria });
        if (problemas.length) return texto(`No se registró:\n- ${problemas.join('\n- ')}`);

        const { cuenta: acc, error } = await buscarCuenta(cuenta);
        if (error) return texto(error);

        const sospecha = detectarTransferencia({
            cuenta: acc.name, destino, concepto, comercio,
            cuentasPropias: await nombresDeCuentas(),
        });
        // Certeza: no existe un caso legítimo donde esto sea un gasto.
        if (sospecha?.nivel === 'certeza') {
            return texto(`NO se registró.\n\n${sospecha.mensaje}`);
        }

        const [t] = await sql`
            insert into transactions (occurred_at, account_id, amount, kind, merchant,
                                      description, category, source, source_ref)
            values (${fecha ? `${fecha}T12:00:00-06:00` : new Date()}, ${acc.id},
                    ${montoConSigno(monto, tipo)}, ${tipo}, ${comercio ?? null},
                    ${concepto}, ${categoria ?? null}, 'manual',
                    ${idempotency_key ? `mcp:${idempotency_key}` : null})
            on conflict (source, source_ref) where source_ref is not null do nothing
            returning id
        `;
        if (!t) {
            return texto('Ese movimiento ya estaba registrado con esa misma clave; no se duplicó.');
        }

        const [saldo] = await sql`
            select display_balance from account_balances where id = ${acc.id}
        `;
        return texto(
            `Registrado: ${tipo} de ${dinero(monto)} en ${acc.name}.\n` +
            `Saldo ahora: ${dinero(saldo.display_balance)}${acc.type === 'credit' ? ' de deuda' : ''}.` +
            (sospecha ? `\n\nAviso: ${sospecha.mensaje}` : ''),
        );
    },
);

server.tool(
    'finanzas_transferencia',
    'Mueve dinero entre dos cuentas propias. Crea dos movimientos ligados que NO cuentan como gasto.',
    {
        origen: z.string(),
        destino: z.string(),
        monto: z.number().positive(),
        concepto: z.string().optional(),
        fecha: z.string().optional().describe('YYYY-MM-DD; por omisión hoy'),
        idempotency_key: z.string().optional()
            .describe('Repetir la llamada con la misma clave no duplica la transferencia'),
    },
    async ({ origen, destino, monto, concepto, fecha, idempotency_key }) => {
        const [ra, rb] = await Promise.all([buscarCuenta(origen), buscarCuenta(destino)]);
        if (ra.error) return texto(`Origen: ${ra.error}`);
        if (rb.error) return texto(`Destino: ${rb.error}`);
        const a = ra.cuenta, b = rb.cuenta;
        if (a.id === b.id) return texto('El origen y el destino son la misma cuenta.');

        if (idempotency_key) {
            const [ya] = await sql`
                select id from transactions
                where source = 'manual' and source_ref = ${`mcp:tr:${idempotency_key}`}
            `;
            if (ya) return texto('Esa transferencia ya estaba registrada con esa clave.');
        }

        const cuando = fecha ? `${fecha}T12:00:00-06:00` : new Date();
        const etiqueta = concepto || `Transferencia ${a.name} → ${b.name}`;

        // Las dos filas comparten transfer_group_id y kind='transfer', así que los
        // reportes de gasto las excluyen y el dinero no se cuenta dos veces.
        await sql.begin(async (tx) => {
            const [{ gen_random_uuid: grupo }] = await tx`select gen_random_uuid()`;
            await tx`
                insert into transactions (occurred_at, account_id, amount, kind, merchant,
                                          description, transfer_group_id, source, source_ref)
                values (${cuando}, ${a.id}, ${-Math.abs(monto)}, 'transfer', ${b.name},
                        ${etiqueta}, ${grupo}, 'manual',
                        ${idempotency_key ? `mcp:tr:${idempotency_key}` : null}),
                       (${cuando}, ${b.id}, ${Math.abs(monto)}, 'transfer', ${a.name},
                        ${etiqueta}, ${grupo}, 'manual', null)
            `;
        });

        const saldos = await sql`
            select name, display_balance from account_balances where id in (${a.id}, ${b.id})
        `;
        const detalle = saldos.map((s) => `  ${s.name}: ${dinero(s.display_balance)}`).join('\n');
        return texto(
            `Transferencia de ${dinero(monto)} de ${a.name} a ${b.name}.\n` +
            `No cuenta como gasto.\n\nSaldos:\n${detalle}`,
        );
    },
);

server.tool(
    'finanzas_ajustar_saldo',
    'Reconcilia una cuenta contra el banco: fija el saldo real y reancla el cálculo. '
    + 'Es la operación más destructiva del sistema — borra el efecto de todos los '
    + 'movimientos anteriores — así que exige el saldo actual esperado y queda en bitácora.',
    {
        cuenta: z.string(),
        saldo_real: z.number().describe('En crédito, la deuda como número positivo'),
        saldo_esperado: z.number().optional()
            .describe('Saldo que crees que tiene ahora. Si no coincide, se aborta: '
                + 'protege contra reanclar sobre un estado que ya cambió.'),
        motivo: z.string().optional().describe('Por qué se reancla; queda en la bitácora'),
        dry_run: z.boolean().default(false).describe('Muestra el efecto sin escribir'),
    },
    async ({ cuenta, saldo_real, saldo_esperado, motivo, dry_run }) => {
        const { cuenta: acc, error } = await buscarCuenta(cuenta);
        if (error) return texto(error);

        const [antes] = await sql`select display_balance from account_balances where id = ${acc.id}`;
        const actual = Number(antes.display_balance);
        const diff = Number(saldo_real) - actual;

        // Concurrencia optimista. Una confirmación no sirve aquí: la IA se
        // confirmaría sola. Exigir el valor esperado sí detecta que algo cambió
        // entre que se leyó el saldo y se decidió reanclarlo.
        if (saldo_esperado != null && Math.abs(saldo_esperado - actual) > 0.01) {
            return texto(
                `Abortado: esperabas ${dinero(saldo_esperado)} pero la cuenta tiene `
                + `${dinero(actual)}. Algo cambió desde que lo consultaste. `
                + 'Vuelve a leer el saldo y decide con el dato nuevo.',
            );
        }

        const resumen =
            `${acc.name}\n  Antes: ${dinero(actual)}\n  Después: ${dinero(saldo_real)}\n`
            + `  Diferencia: ${dinero(diff)}`;

        if (dry_run) {
            return texto(`Simulación, no se escribió nada.\n\n${resumen}`);
        }

        // En crédito el usuario dicta la deuda como positiva; internamente va negativa.
        const guardado = acc.type === 'credit' ? -Math.abs(saldo_real) : saldo_real;

        await sql.begin(async (tx) => {
            await tx`
                update accounts set opening_balance = ${guardado}, opening_balance_at = now()
                where id = ${acc.id}
            `;
            await tx`
                insert into balance_adjustments (account_id, saldo_anterior, saldo_nuevo,
                                                 diferencia, motivo, origen)
                values (${acc.id}, ${actual}, ${saldo_real}, ${diff}, ${motivo ?? null}, 'mcp')
            `;
        });

        return texto(
            `${acc.name} reanclada.\n${resumen}\n\n`
            + 'Los movimientos anteriores a este momento ya no afectan el saldo. '
            + 'El cambio quedó en la bitácora.',
        );
    },
);

server.tool(
    'finanzas_historial_ajustes',
    'Bitácora de reanclajes de saldo: quién movió qué cuenta, cuándo y por qué.',
    { cuenta: z.string().optional(), limite: z.number().int().min(1).max(50).default(20) },
    async ({ cuenta, limite }) => {
        let accId = null;
        if (cuenta) {
            const r = await buscarCuenta(cuenta);
            if (r.error) return texto(r.error);
            accId = r.cuenta.id;
        }
        const rows = await sql`
            select to_char(b.created_at, 'YYYY-MM-DD HH24:MI') as cuando, a.name,
                   b.saldo_anterior, b.saldo_nuevo, b.diferencia, b.motivo, b.origen
            from balance_adjustments b join accounts a on a.id = b.account_id
            where (${accId}::uuid is null or b.account_id = ${accId})
            order by b.created_at desc limit ${limite}
        `;
        if (!rows.length) return texto('Sin reanclajes registrados.');
        return texto(
            `${rows.length} reanclajes:\n` + rows.map((r) =>
                `  ${r.cuando}  ${r.name.padEnd(24)} ${dinero(r.saldo_anterior).padStart(12)} → `
                + `${dinero(r.saldo_nuevo).padStart(12)}  (${dinero(r.diferencia)})`
                + `${r.motivo ? `\n      ${r.motivo}` : ''}`,
            ).join('\n'),
        );
    },
);

// -------------------------------------------------------------- Gastos fijos

server.tool(
    'finanzas_fijos_pendientes',
    'Gastos fijos que faltan por pagar este mes.',
    { mes: z.string().regex(/^\d{4}-\d{2}$/).optional() },
    async ({ mes }) => {
        const periodo = (mes ?? new Date().toISOString().slice(0, 7)) + '-01';
        const rows = await sql`
            select f.id, f.concepto, f.monto, f.pagos_mes, f.forma_pago, f.fechas_pago,
                   coalesce(count(p.id) filter (where p.paid or p.waived), 0) as pagadas
            from fixed_expenses f
            left join fixed_expense_payments p
                   on p.fixed_expense_id = f.id and p.period = ${periodo}::date
            where f.active and f.monto > 0
            group by f.id
            having coalesce(count(p.id) filter (where p.paid or p.waived), 0) < f.pagos_mes
            order by f.monto desc
        `;
        if (!rows.length) return texto(`Todos los fijos de ${periodo.slice(0, 7)} están cubiertos.`);

        const total = rows.reduce(
            (s, r) => s + (Number(r.monto) / r.pagos_mes) * (r.pagos_mes - Number(r.pagadas)), 0,
        );
        const lineas = rows.map((r) => {
            const faltan = r.pagos_mes - Number(r.pagadas);
            const parcial = r.pagos_mes > 1 ? ` (${r.pagadas}/${r.pagos_mes})` : '';
            const dias = r.fechas_pago?.length ? `  días ${r.fechas_pago.join(', ')}` : '';
            return `  ${r.concepto.slice(0, 30).padEnd(30)} ${dinero(Number(r.monto) / r.pagos_mes).padStart(10)}` +
                   `${parcial} × ${faltan}${dias}`;
        });
        return texto(`Pendientes de ${periodo.slice(0, 7)} — falta ${dinero(total)}:\n${lineas.join('\n')}`);
    },
);

server.tool(
    'finanzas_pagar_fijo',
    'Marca pagado un gasto fijo. Crea su movimiento, así que el saldo se mueve.',
    {
        concepto: z.string().describe('Nombre del gasto fijo'),
        cuenta: z.string().describe('De dónde salió el dinero'),
        parte: z.number().int().min(1).default(1).describe('Cuál parte, si el fijo se paga en varias'),
        monto: z.number().optional().describe('Solo si difiere del monto normal'),
        fecha: z.string().optional(),
    },
    async ({ concepto, cuenta, parte, monto, fecha }) => {
        const exactos = await sql`
            select id, concepto, monto, pagos_mes, tipo, categoria
            from fixed_expenses where lower(concepto) = lower(${concepto}) and active
        `;
        const candidatos = exactos.length ? exactos : await sql`
            select id, concepto, monto, pagos_mes, tipo, categoria
            from fixed_expenses where concepto ilike ${'%' + concepto + '%'} and active
            order by concepto
        `;
        if (!candidatos.length) {
            return texto(`No encontré un gasto fijo que se llame "${concepto}".`);
        }
        // Varios fijos pueden parecerse ("Escuela Roby" y "Escuela Hans"): elegir
        // uno en silencio pagaría el equivocado y movería mal el saldo.
        if (candidatos.length > 1) {
            return texto(ambiguedad(concepto, candidatos.map((c) => c.concepto), 'gasto fijo'));
        }
        const f = candidatos[0];

        const { cuenta: acc, error } = await buscarCuenta(cuenta);
        if (error) return texto(error);
        if (parte > f.pagos_mes) return texto(`"${f.concepto}" solo tiene ${f.pagos_mes} parte(s).`);

        const cuando = fecha ? new Date(`${fecha}T12:00:00-06:00`) : new Date();
        const periodo = `${cuando.getFullYear()}-${String(cuando.getMonth() + 1).padStart(2, '0')}-01`;
        const idx = parte - 1;

        const [ya] = await sql`
            select paid from fixed_expense_payments
            where fixed_expense_id = ${f.id} and period = ${periodo} and part_index = ${idx}
        `;
        if (ya?.paid) return texto(`La parte ${parte} de "${f.concepto}" ya estaba pagada este mes.`);

        const importe = monto ?? Number(f.monto) / (f.pagos_mes || 1);
        const esIngreso = f.tipo === 'ingreso';

        const res = await sql.begin(async (tx) => {
            const [t] = await tx`
                insert into transactions (occurred_at, account_id, amount, kind, merchant,
                                          description, category, source, source_ref, fixed_expense_id)
                values (${cuando}, ${acc.id}, ${montoConSigno(importe, esIngreso ? 'ingreso' : 'gasto')},
                        ${esIngreso ? 'ingreso' : 'gasto'}, 'Gasto Fijo',
                        ${`${f.concepto} (${parte}/${f.pagos_mes})`}, ${f.categoria},
                        'fijo', ${`fijo:${f.id}:${periodo}:${idx}`}, ${f.id})
                on conflict (source, source_ref) where source_ref is not null do nothing
                returning id
            `;
            if (!t) return null;
            await tx`
                insert into fixed_expense_payments (fixed_expense_id, period, part_index,
                                                    paid, paid_at, transaction_id)
                values (${f.id}, ${periodo}, ${idx}, true, now(), ${t.id})
                on conflict (fixed_expense_id, period, part_index)
                do update set paid = true, waived = false, paid_at = now(),
                              transaction_id = excluded.transaction_id
            `;
            return t;
        });
        if (!res) return texto('Esa parte ya tenía movimiento registrado.');

        const [saldo] = await sql`select display_balance from account_balances where id = ${acc.id}`;
        return texto(
            `"${f.concepto}" parte ${parte}/${f.pagos_mes} pagada: ${dinero(importe)} desde ${acc.name}.\n` +
            `Saldo de ${acc.name}: ${dinero(saldo.display_balance)}.`,
        );
    },
);

// ----------------------------------------------------------------- Bandeja

server.tool(
    'finanzas_pendientes',
    'Movimientos detectados en el correo que esperan aprobación.',
    { solo_nuevos: z.boolean().default(true).describe('Excluye los anteriores al ancla del saldo') },
    async ({ solo_nuevos }) => {
        const rows = await sql`
            select p.id, to_char(p.occurred_at, 'YYYY-MM-DD') as fecha, p.merchant, p.counterparty,
                   p.amount, p.suggested_kind, p.match_confidence,
                   a.name as cuenta, f.concepto as fijo,
                   (p.occurred_at < a.opening_balance_at) as historico
            from pending_transactions p
            left join accounts a on a.id = p.suggested_account_id
            left join fixed_expenses f on f.id = p.suggested_fixed_expense_id
            where p.status = 'pending'
            order by p.occurred_at desc limit 60
        `;
        const visibles = solo_nuevos ? rows.filter((r) => !r.historico) : rows;
        if (!visibles.length) {
            return texto(
                solo_nuevos
                    ? `Nada nuevo. Quedan ${rows.length} históricos, que al aprobarse completan el historial pero no mueven saldos.`
                    : 'La bandeja está vacía.',
            );
        }
        const lineas = visibles.map((r) => {
            const monto = r.amount == null ? 'SIN MONTO' : dinero(r.amount);
            const extra = [r.fijo && `fijo: ${r.fijo}`, r.historico && 'histórico',
                           Number(r.match_confidence) < 0.6 && 'revisar'].filter(Boolean).join(', ');
            return `  ${r.fecha}  ${monto.padStart(12)}  ${(r.merchant || r.counterparty || '—').slice(0, 28).padEnd(28)}` +
                   ` ${r.cuenta ?? 'SIN CUENTA'}${extra ? `  [${extra}]` : ''}\n    id: ${r.id}`;
        });
        return texto(`${visibles.length} pendientes:\n${lineas.join('\n')}`);
    },
);

server.tool(
    'finanzas_buckets_planner',
    'Los 6 buckets válidos del planner. Un fijo con otra categoría queda invisible ahí.',
    {},
    async () => texto(`Buckets del planner:\n  ${BUDGET_BUCKETS.join('\n  ')}`),
);

const transport = new StdioServerTransport();
await server.connect(transport);
