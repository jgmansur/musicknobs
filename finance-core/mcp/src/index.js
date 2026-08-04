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
// Las mismas operaciones que usa el Worker: aprobar y revertir tiene que hacer
// exactamente lo mismo venga de la app o de un asistente.
import { aprobarPendiente, borrarMovimiento } from '../../shared/movimientos.js';
import { categoriaPara, aprenderReglas, normalizar } from '../../shared/categorias.js';
import { lugarPara, sinCatalogar } from '../../shared/lugares.js';

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


// ------------------------------------------------- Ciclo de vida de un movimiento

server.tool(
    'finanzas_aprobar_pendiente',
    'Convierte un pendiente de la bandeja en movimiento real. Los pendientes '
    + 'anteriores al ancla del saldo llenan el historial pero no mueven saldos.',
    {
        id: z.string().describe('id del pendiente; sale de finanzas_pendientes'),
        monto: z.number().optional()
            .describe('Obligatorio si el pendiente no traía monto (SPEI de Hey)'),
        cuenta: z.string().optional().describe('Si hay que corregir la cuenta sugerida'),
        categoria: z.string().optional(),
        concepto: z.string().optional(),
    },
    async ({ id, monto, cuenta, categoria, concepto }) => {
        let accountId;
        if (cuenta) {
            const r = await buscarCuenta(cuenta);
            if (r.error) return texto(r.error);
            accountId = r.cuenta.id;
        }
        const res = await aprobarPendiente(sql, id, {
            amount: monto, accountId, category: categoria, description: concepto,
        });
        if (res.error) return texto(`No se aprobó: ${res.error}`);

        const [t] = await sql`
            select a.name, ab.display_balance, t.amount,
                   (t.occurred_at < a.opening_balance_at) as historico
            from transactions t
            join accounts a on a.id = t.account_id
            join account_balances ab on ab.id = a.id
            where t.id = ${res.transactionId}
        `;
        return texto(
            `Aprobado: ${dinero(Math.abs(t.amount))} en ${t.name}.\n`
            + (t.historico
                ? 'Es histórico (anterior al ancla), así que completa el historial pero no movió el saldo.'
                : `Saldo de ${t.name}: ${dinero(t.display_balance)}.`),
        );
    },
);

server.tool(
    'finanzas_rechazar_pendiente',
    'Descarta un pendiente de la bandeja sin crear movimiento.',
    { id: z.string(), motivo: z.string().optional() },
    async ({ id, motivo }) => {
        const [p] = await sql`
            update pending_transactions
            set status = 'rejected', resolved_at = now()
            where id = ${id} and status = 'pending'
            returning merchant, amount
        `;
        if (!p) return texto('Ese pendiente no existe o ya se resolvió.');
        return texto(
            `Descartado: ${p.merchant ?? 'movimiento'} `
            + `${p.amount == null ? '(sin monto)' : dinero(Math.abs(p.amount))}.`
            + (motivo ? `\nMotivo: ${motivo}` : ''),
        );
    },
);

server.tool(
    'finanzas_editar_movimiento',
    'Corrige un movimiento existente. Solo cambia los campos que se envían.',
    {
        id: z.string(),
        monto: z.number().optional().describe('Positivo; el signo lo conserva el tipo'),
        cuenta: z.string().optional(),
        comercio: z.string().optional(),
        concepto: z.string().optional(),
        categoria: z.string().optional(),
        fecha: z.string().optional().describe('YYYY-MM-DD'),
    },
    async ({ id, monto, cuenta, comercio, concepto, categoria, fecha }) => {
        let accountId = null;
        if (cuenta) {
            const r = await buscarCuenta(cuenta);
            if (r.error) return texto(r.error);
            accountId = r.cuenta.id;
        }
        const [t] = await sql`
            update transactions set
                amount = case when ${monto ?? null}::numeric is null then amount
                              when kind = 'ingreso' then abs(${monto ?? null}::numeric)
                              else -abs(${monto ?? null}::numeric) end,
                account_id  = coalesce(${accountId}, account_id),
                merchant    = coalesce(${comercio ?? null}, merchant),
                description = coalesce(${concepto ?? null}, description),
                category    = coalesce(${categoria ?? null}, category),
                occurred_at = coalesce(${fecha ? `${fecha}T12:00:00-06:00` : null}::timestamptz,
                                       occurred_at)
            where id = ${id}
            returning id, account_id
        `;
        if (!t) return texto('No encontré ese movimiento.');
        const [b] = await sql`
            select name, display_balance from account_balances where id = ${t.account_id}
        `;
        return texto(`Movimiento actualizado. Saldo de ${b.name}: ${dinero(b.display_balance)}.`);
    },
);

server.tool(
    'finanzas_revertir_movimiento',
    'Borra un movimiento y deshace sus efectos: libera la parte del gasto fijo que '
    + 'saldaba, devuelve el pendiente a la bandeja, y si era transferencia borra '
    + 'las dos filas ligadas.',
    { id: z.string() },
    async ({ id }) => {
        const [antes] = await sql`
            select a.name, t.amount, t.description from transactions t
            join accounts a on a.id = t.account_id where t.id = ${id}
        `;
        if (!antes) return texto('No encontré ese movimiento.');

        const res = await borrarMovimiento(sql, id);
        if (res.error) return texto(`No se revirtió: ${res.error}`);

        const [b] = await sql`select display_balance from account_balances where name = ${antes.name}`;
        return texto(
            `Revertido: ${dinero(Math.abs(antes.amount))} — ${antes.description ?? ''}\n`
            + `Saldo de ${antes.name}: ${dinero(b.display_balance)}.`
            + (res.ligadas ? `\nSe borró también la fila ligada de la transferencia.` : ''),
        );
    },
);

server.tool(
    'finanzas_categorias',
    'Categorías en uso, con cuántos movimientos y cuánto suman. Sirve para no '
    + 'inventar categorías nuevas cuando ya existe una equivalente.',
    { meses: z.number().int().min(1).max(36).default(6) },
    async ({ meses }) => {
        // Gasto e ingreso se reportan por separado. Sumarlos en un solo total
        // daría un número sin significado: no es lo mismo el dinero que sale
        // que el que entra, aunque compartan el nombre de la categoría.
        const rows = await sql`
            select coalesce(category, '(sin categoría)') as categoria, kind,
                   count(*)::int as n, round(sum(abs(amount))) as total
            from transactions
            where kind <> 'transfer'
              and occurred_at >= now() - (${meses} || ' months')::interval
            group by 1, 2 order by n desc
        `;
        // El vocabulario real de Jay vive en los gastos fijos, que sí están
        // categorizados. Sin esto, un asistente inventaría categorías nuevas en
        // vez de reusar las que él ya definió.
        const vocabulario = await sql`
            select distinct categoria from fixed_expenses
            where categoria is not null and trim(categoria) <> '' order by categoria
        `;
        const enUso = new Set(rows.map((r) => r.categoria));
        const sinUsar = vocabulario.map((v) => v.categoria).filter((c) => !enUso.has(c));

        if (!rows.length) return texto('No hay movimientos en ese periodo.');
        const bloque = (kind, titulo) => {
            const r = rows.filter((x) => x.kind === kind);
            if (!r.length) return '';
            return `\n${titulo}:\n` + r.map((x) =>
                `  ${String(x.n).padStart(5)}  ${dinero(x.total).padStart(12)}  ${x.categoria}`).join('\n');
        };
        const sinCat = rows.filter((r) => r.categoria === '(sin categoría)')
            .reduce((s2, r) => s2 + r.n, 0);
        return texto(
            `Últimos ${meses} meses:\n`
            + bloque('gasto', 'GASTOS') + '\n' + bloque('ingreso', 'INGRESOS')
            + (sinCat ? `\n\nHay ${sinCat} movimientos sin categorizar.` : '')
            + (sinUsar.length
                ? `\n\nCategorías que Jay ya usa en sus gastos fijos y aquí no aparecen `
                  + `(reúsalas antes de inventar nuevas):\n  ${sinUsar.join('\n  ')}`
                : ''),
        );
    },
);

server.tool(
    'finanzas_sin_categoria',
    'Movimientos sin categoría, agrupados por comercio. Por omisión solo gastos: '
    + 'los ingresos usan otro vocabulario y mezclarlos lleva a clasificar mal.',
    {
        limite: z.number().int().min(1).max(50).default(20),
        tipo: z.enum(['gasto', 'ingreso']).default('gasto'),
    },
    async ({ limite, tipo }) => {
        const rows = await sql`
            select coalesce(merchant, description, '(sin nombre)') as comercio,
                   count(*)::int as n, round(sum(abs(amount))) as total,
                   to_char(max(occurred_at), 'YYYY-MM-DD') as ultimo
            from transactions
            where category is null and kind = ${tipo}
            group by 1 order by n desc, total desc limit ${limite}
        `;
        if (!rows.length) return texto(`Todos los ${tipo}s están categorizados.`);
        return texto(
            `Comercios sin categoría (${tipo}s):\n`
            + rows.map((r) => `  ${String(r.n).padStart(4)}× ${dinero(r.total).padStart(11)}  `
                + `${r.comercio.slice(0, 34).padEnd(34)} último ${r.ultimo}`).join('\n')
            + '\n\nUsa finanzas_categorizar_comercio para clasificarlos todos de una vez.',
        );
    },
);

server.tool(
    'finanzas_categorizar_comercio',
    'Asigna una categoría a TODOS los movimientos de un comercio. Devuelve cuántos '
    + 'tocaría antes de escribir si se usa dry_run.',
    {
        comercio: z.string().describe('Texto a buscar en comercio o concepto'),
        categoria: z.string(),
        tipo: z.enum(['gasto', 'ingreso']).default('gasto'),
        solo_sin_categoria: z.boolean().default(true)
            .describe('Si es false, sobrescribe categorías ya asignadas'),
        dry_run: z.boolean().default(false),
    },
    async ({ comercio, categoria, tipo, solo_sin_categoria, dry_run }) => {
        const patron = `%${comercio}%`;
        const afectados = await sql`
            select id from transactions
            where (merchant ilike ${patron} or description ilike ${patron})
              and kind = ${tipo}
              and (${!solo_sin_categoria} or category is null)
        `;
        if (!afectados.length) return texto(`Ningún movimiento coincide con "${comercio}".`);
        if (dry_run) {
            return texto(`Simulación: ${afectados.length} movimientos quedarían como "${categoria}".`);
        }
        await sql`
            update transactions set category = ${categoria}
            where id in ${sql(afectados.map((r) => r.id))}
        `;
        return texto(`${afectados.length} movimientos de "${comercio}" categorizados como "${categoria}".`);
    },
);


// ------------------------------------------------ Reglas de categorización

server.tool(
    'finanzas_reglas_categoria',
    'Reglas que asignan categoría por comercio. Se aplican en la ingesta, así que '
    + 'los cargos nuevos llegan ya clasificados.',
    {},
    async () => {
        const rows = await sql`
            select patron, categoria, prioridad, origen, veces_aplicada, aplica_a
            from category_rules order by prioridad, patron
        `;
        if (!rows.length) {
            return texto('Sin reglas todavía. Usa finanzas_aprender_reglas para proponer '
                + 'algunas a partir de lo que ya está categorizado.');
        }
        return texto(
            `${rows.length} reglas:\n` + rows.map((r) =>
                `  ${String(r.prioridad).padStart(4)}  ${r.patron.slice(0, 26).padEnd(26)} → `
                + `${r.categoria.padEnd(20)} [${r.aplica_a}] (${r.origen}, ${r.veces_aplicada}×)`,
            ).join('\n'),
        );
    },
);

server.tool(
    'finanzas_crear_regla_categoria',
    'Crea una regla comercio → categoría. Con dry_run dice a cuántos movimientos '
    + 'del histórico afectaría antes de escribir.',
    {
        patron: z.string().min(2).describe('Texto a buscar en comercio o concepto, ej. "UBER EATS"'),
        categoria: z.string(),
        prioridad: z.number().int().default(100)
            .describe('Menor gana. Usa un número bajo para reglas específicas.'),
        aplica_a: z.enum(['gasto', 'ingreso', 'ambos']).default('gasto')
            .describe('"Mariel" no significa lo mismo cuando le pagas que cuando te transfiere'),
        aplicar_historico: z.boolean().default(true)
            .describe('Categoriza también los movimientos ya registrados que no tengan categoría'),
        dry_run: z.boolean().default(false),
    },
    async ({ patron, categoria, prioridad, aplica_a, aplicar_historico, dry_run }) => {
        const [existente] = await sql`
            select patron, categoria from category_rules
            where lower(trim(patron)) = lower(trim(${patron}))
        `;
        if (existente && !dry_run) {
            return texto(
                `Ya existe una regla para "${existente.patron}" → ${existente.categoria}. `
                + 'Bórrala primero si quieres cambiarla.',
            );
        }

        const alcance = await sql`
            select id from transactions
            where (merchant ilike ${'%' + patron + '%'} or description ilike ${'%' + patron + '%'})
              and category is null
              and (${aplica_a} = 'ambos' or kind = ${aplica_a})
        `;
        if (dry_run) {
            return texto(
                `Simulación: la regla "${patron}" → ${categoria} categorizaría `
                + `${alcance.length} movimientos del histórico que hoy no tienen categoría.`,
            );
        }

        await sql`
            insert into category_rules (patron, categoria, prioridad, origen, aplica_a)
            values (${patron.trim()}, ${categoria}, ${prioridad}, 'manual', ${aplica_a})
        `;
        let tocados = 0;
        if (aplicar_historico && alcance.length) {
            await sql`
                update transactions set category = ${categoria}
                where id in ${sql(alcance.map((r) => r.id))}
            `;
            tocados = alcance.length;
        }
        return texto(
            `Regla creada: "${patron}" → ${categoria}.\n`
            + `Se aplicará a los cargos nuevos durante la ingesta`
            + (tocados ? `, y se categorizaron ${tocados} movimientos del histórico.` : '.'),
        );
    },
);

server.tool(
    'finanzas_borrar_regla_categoria',
    'Elimina una regla. Los movimientos ya categorizados no cambian.',
    { patron: z.string() },
    async ({ patron }) => {
        const [r] = await sql`
            delete from category_rules
            where lower(trim(patron)) = lower(trim(${patron}))
            returning patron, categoria
        `;
        return texto(r
            ? `Regla borrada: "${r.patron}" → ${r.categoria}. Los movimientos ya categorizados se quedan como están.`
            : `No hay ninguna regla con el patrón "${patron}".`);
    },
);

server.tool(
    'finanzas_aprender_reglas',
    'Propone reglas mirando el histórico ya categorizado. Solo propone cuando el '
    + 'comercio siempre cayó en la misma categoría: si hay dudas, no inventa.',
    {
        minimo: z.number().int().min(2).default(3).describe('Repeticiones mínimas para proponer'),
        crear: z.boolean().default(false).describe('Si es true, crea las reglas propuestas'),
    },
    async ({ minimo, crear }) => {
        const movs = await sql`
            select merchant, description, category, kind from transactions
            where kind <> 'transfer'
        `;
        const existentes = new Set(
            (await sql`select patron from category_rules`).map((r) => normalizar(r.patron)),
        );
        const propuestas = aprenderReglas(movs, { minimo })
            .filter((p) => !existentes.has(normalizar(p.patron)));

        if (!propuestas.length) {
            const [{ n: categorizados }] = await sql`
                select count(*)::int as n from transactions
                where category is not null and kind <> 'transfer'
            `;
            return texto(
                categorizados === 0
                    ? 'No hay nada que aprender: ningún movimiento tiene categoría todavía. '
                      + 'La hoja de Gastos nunca tuvo columna de categoría, así que el histórico '
                      + 'llegó sin ella.\n\nEmpieza al revés: mira finanzas_sin_categoria para ver '
                      + 'los comercios más frecuentes y crea reglas con '
                      + 'finanzas_crear_regla_categoria. En cuanto haya movimientos categorizados, '
                      + 'esta herramienta empezará a proponer sola.'
                    : `Hay ${categorizados} movimientos categorizados, pero ningún comercio se `
                      + 'repite lo suficiente con una sola categoría como para deducir una regla.',
            );
        }
        const lista = propuestas.slice(0, 25).map((p) =>
            `  ${p.patron.slice(0, 32).padEnd(32)} → ${p.categoria.padEnd(24)}`
            + `(${p.coincidencias}/${p.apariciones} movimientos)`).join('\n');

        if (!crear) {
            return texto(
                `${propuestas.length} reglas propuestas:\n${lista}\n\n`
                + 'Vuelve a llamar con crear:true para guardarlas.',
            );
        }
        for (const p of propuestas) {
            await sql`
                insert into category_rules (patron, categoria, origen)
                values (${p.patron}, ${p.categoria}, 'aprendida')
                on conflict do nothing
            `;
        }
        return texto(`${propuestas.length} reglas creadas a partir del histórico:\n${lista}`);
    },
);

server.tool(
    'finanzas_aplicar_reglas_historico',
    'Pasa las reglas existentes sobre los movimientos sin categoría. Útil después '
    + 'de crear varias reglas de golpe.',
    { dry_run: z.boolean().default(false) },
    async ({ dry_run }) => {
        const [reglas, sinCat] = await Promise.all([
            sql`select id, patron, categoria, prioridad, aplica_a from category_rules`,
            sql`select id, merchant, description, kind from transactions
                where category is null and kind <> 'transfer'`,
        ]);
        if (!reglas.length) return texto('No hay reglas definidas todavía.');

        const porCategoria = new Map();
        const asignaciones = [];
        for (const m of sinCat) {
            const hit = categoriaPara(m, reglas);
            if (!hit) continue;
            asignaciones.push({ id: m.id, categoria: hit.categoria });
            porCategoria.set(hit.categoria, (porCategoria.get(hit.categoria) ?? 0) + 1);
        }
        if (!asignaciones.length) {
            return texto(`Ninguno de los ${sinCat.length} movimientos sin categoría coincide con las reglas.`);
        }
        const detalle = [...porCategoria].sort((a, b) => b[1] - a[1])
            .map(([c, n]) => `  ${String(n).padStart(5)}  ${c}`).join('\n');

        if (dry_run) {
            return texto(`Simulación: se categorizarían ${asignaciones.length} movimientos.\n${detalle}`);
        }
        for (const a of asignaciones) {
            await sql`update transactions set category = ${a.categoria} where id = ${a.id}`;
        }
        return texto(
            `${asignaciones.length} movimientos categorizados:\n${detalle}\n\n`
            + `Quedan ${sinCat.length - asignaciones.length} sin categoría.`,
        );
    },
);


// -------------------------------------------------------- Beneficiarios

server.tool(
    'finanzas_beneficiarios',
    'Cuentas a las que Jay transfiere, identificadas por la terminación que revela '
    + 'el banco. Con esto una transferencia anónima se vuelve un gasto fijo con nombre.',
    {},
    async () => {
        const rows = await sql`
            select p.last4, p.banco, p.nombre, p.descripcion, p.tipo, p.categoria,
                   f.concepto as fijo, p.veces_visto
            from payees p left join fixed_expenses f on f.id = p.fixed_expense_id
            order by p.tipo, p.nombre
        `;
        if (!rows.length) return texto('No hay beneficiarios registrados.');
        return texto(
            `${rows.length} beneficiarios:\n` + rows.map((r) =>
                `  ••${r.last4}  ${(r.banco ?? '').padEnd(13)} ${r.nombre.slice(0, 26).padEnd(26)}`
                + ` [${r.tipo}]${r.fijo ? ` → ${r.fijo}` : ''}`
                + `${r.descripcion ? `\n         ${r.descripcion}` : ''}`).join('\n'),
        );
    },
);

server.tool(
    'finanzas_registrar_beneficiario',
    'Registra a quién pertenece una terminación de cuenta, para que las '
    + 'transferencias futuras se identifiquen solas.',
    {
        last4: z.string().length(4).describe('Últimos 4 dígitos de la cuenta o CLABE'),
        nombre: z.string(),
        banco: z.string().optional(),
        descripcion: z.string().optional(),
        tipo: z.enum(['fijo', 'variable', 'persona', 'cuenta_propia']).default('persona'),
        gasto_fijo: z.string().optional().describe('Concepto del gasto fijo que salda'),
        categoria: z.string().optional(),
    },
    async ({ last4, nombre, banco, descripcion, tipo, gasto_fijo, categoria }) => {
        let fixedId = null;
        if (gasto_fijo) {
            const candidatos = await sql`
                select id, concepto from fixed_expenses
                where concepto ilike ${'%' + gasto_fijo + '%'} and active
            `;
            if (!candidatos.length) return texto(`No existe un gasto fijo como "${gasto_fijo}".`);
            if (candidatos.length > 1) {
                return texto(ambiguedad(gasto_fijo, candidatos.map((c) => c.concepto), 'gasto fijo'));
            }
            fixedId = candidatos[0].id;
        }
        const [p] = await sql`
            insert into payees (last4, banco, nombre, descripcion, tipo, fixed_expense_id, categoria)
            values (${last4}, ${banco ?? null}, ${nombre}, ${descripcion ?? null},
                    ${tipo}, ${fixedId}, ${categoria ?? null})
            on conflict (last4, coalesce(lower(banco), '')) do update set
                nombre = excluded.nombre, descripcion = excluded.descripcion,
                tipo = excluded.tipo, fixed_expense_id = excluded.fixed_expense_id,
                categoria = excluded.categoria
            returning id
        `;
        return texto(
            `Registrado: ••${last4} ${banco ? `(${banco}) ` : ''}→ ${nombre} [${tipo}]`
            + (gasto_fijo ? `, ligado al fijo "${gasto_fijo}"` : '')
            + '.\nLas transferencias futuras a esa cuenta se identificarán solas.',
        );
    },
);

server.tool(
    'finanzas_posibles_duplicados',
    'Pendientes que se parecen a un movimiento ya registrado — misma cuenta, mismo '
    + 'monto, hasta 3 días de diferencia. Se marcan, no se descartan: dos compras '
    + 'iguales el mismo día son posibles.',
    {},
    async () => {
        const rows = await sql`
            select to_char(p.occurred_at, 'YYYY-MM-DD') as fecha, p.merchant, p.amount, p.id,
                   to_char(t.occurred_at, 'YYYY-MM-DD') as fecha_ya,
                   t.merchant as ya_registrado, t.source
            from pending_transactions p
            join transactions t on t.id = p.duplicate_of
            where p.status = 'pending'
            order by p.occurred_at desc
        `;
        if (!rows.length) return texto('No hay pendientes que parezcan duplicados.');
        return texto(
            `${rows.length} posibles duplicados:\n` + rows.map((r) =>
                `  ${r.fecha}  ${dinero(Math.abs(r.amount))}  ${(r.merchant ?? '—').slice(0, 24)}\n`
                + `      ya existe: ${r.fecha_ya} ${(r.ya_registrado ?? '—').slice(0, 24)} (${r.source})\n`
                + `      id: ${r.id}`).join('\n'),
        );
    },
);


server.tool(
    'finanzas_ligar_articulos',
    'Amarra los artículos de los tickets con el movimiento del banco que les '
    + 'corresponde. Se corre después de aprobar pendientes: el ticket llega antes '
    + 'de que el movimiento exista, así que al ingerirlo todavía no hay a qué ligarlo.',
    { dry_run: z.boolean().default(false) },
    async ({ dry_run }) => {
        const sueltos = await sql`
            select distinct recibo_id, fecha, sum(total_item) as total, forma_pago
            from receipt_items
            where transaction_id is null and recibo_id is not null
            group by recibo_id, fecha, forma_pago
        `;
        if (!sueltos.length) return texto('Todos los artículos ya están ligados.');

        let ligados = 0;
        const sinPareja = [];
        for (const r of sueltos) {
            const [t] = await sql`
                select id from transactions
                where abs(abs(amount) - ${r.total}) < 0.01
                  and occurred_at between ${r.fecha}::timestamptz - interval '3 days'
                                      and ${r.fecha}::timestamptz + interval '3 days'
                order by abs(extract(epoch from (occurred_at - ${r.fecha}::timestamptz)))
                limit 1
            `;
            if (!t) { sinPareja.push(`${r.fecha} ${dinero(r.total)}`); continue; }
            if (!dry_run) {
                await sql`
                    update receipt_items set transaction_id = ${t.id}
                    where recibo_id = ${r.recibo_id}
                `;
            }
            ligados += 1;
        }
        return texto(
            `${dry_run ? 'Simulación: se ligarían' : 'Ligados'} ${ligados} de ${sueltos.length} tickets.`
            + (sinPareja.length
                ? `\n\n${sinPareja.length} sin movimiento que les corresponda:\n  `
                  + sinPareja.slice(0, 12).join('\n  ')
                  + '\n\nSuelen ser compras con Apple Pay de BBVA: ese banco no manda '
                  + 'aviso de compra, así que el ticket es el único registro.'
                : ''),
        );
    },
);


// ---------------------------------------------------------- Catálogo de lugares

server.tool(
    'finanzas_lugares',
    'Catálogo del campo "Lugar". Es cerrado a propósito: como texto libre había '
    + '274 valores para muchos menos lugares reales y no se podía agrupar.',
    {},
    async () => {
        const rows = await sql`
            select p.nombre, p.tipo, p.categoria, p.aliases,
                   (select count(*)::int from transactions t where t.merchant = p.nombre) as usos
            from places p order by p.tipo, p.nombre
        `;
        return texto(
            `${rows.length} lugares:\n` + rows.map((r) =>
                `  ${r.nombre.padEnd(20)} [${r.tipo}]${r.categoria ? ` → ${r.categoria}` : ''}`
                + `  ${r.usos} movs`
                + (r.aliases?.length ? `\n      alias: ${r.aliases.join(', ')}` : '')).join('\n'),
        );
    },
);

server.tool(
    'finanzas_crear_lugar',
    'Da de alta un lugar y normaliza hacia atrás los movimientos que le correspondan.',
    {
        nombre: z.string().describe('Nombre canónico, como quieres verlo en los reportes'),
        aliases: z.array(z.string()).default([])
            .describe('Fragmentos que manda el banco, ej. ["oxxo", "oxxogrand"]'),
        tipo: z.enum(['comercio', 'persona', 'servicio', 'marcador']).default('comercio'),
        categoria: z.string().optional().describe('Categoría por omisión de sus gastos'),
        dry_run: z.boolean().default(false),
    },
    async ({ nombre, aliases, tipo, categoria, dry_run }) => {
        const candidato = { nombre, aliases };
        const movs = await sql`
            select id, merchant from transactions where merchant is not null
        `;
        const afectados = movs.filter((m) => lugarPara(m.merchant, [candidato]));

        if (dry_run) {
            const ejemplos = [...new Set(afectados.map((m) => m.merchant))].slice(0, 8);
            return texto(
                `Simulación: "${nombre}" absorbería ${afectados.length} movimientos.\n`
                + ejemplos.map((e) => `  ${e}`).join('\n'),
            );
        }

        await sql`
            insert into places (nombre, tipo, aliases, categoria)
            values (${nombre}, ${tipo}, ${aliases}, ${categoria ?? null})
            on conflict (nombre) do update set
                aliases = excluded.aliases, categoria = excluded.categoria, tipo = excluded.tipo
        `;
        for (const m of afectados) {
            if (m.merchant === nombre) continue;
            await sql`
                update transactions set merchant_raw = coalesce(merchant_raw, merchant),
                                        merchant = ${nombre},
                                        category = coalesce(category, ${categoria ?? null})
                where id = ${m.id}
            `;
        }
        return texto(`Lugar "${nombre}" creado. Se normalizaron ${afectados.length} movimientos.`);
    },
);

server.tool(
    'finanzas_lugares_sin_catalogar',
    'Valores de "Lugar" que no corresponden a ningún lugar del catálogo, agrupados '
    + 'para darlos de alta en bloque.',
    { limite: z.number().int().min(1).max(60).default(25) },
    async ({ limite }) => {
        const [catalogo, movs] = await Promise.all([
            sql`select nombre, aliases from places`,
            sql`select merchant from transactions where merchant is not null`,
        ]);
        const sueltos = sinCatalogar(movs.map((m) => m.merchant), catalogo);
        if (!sueltos.length) return texto('Todos los lugares están catalogados.');
        return texto(
            `${sueltos.length} valores fuera del catálogo:\n`
            + sueltos.slice(0, limite).map((s) =>
                `  ${String(s.n).padStart(4)}×  ${s.crudo.slice(0, 46)}`).join('\n')
            + '\n\nUsa finanzas_crear_lugar para agruparlos.',
        );
    },
);

/* ==========================================================================
   CATÁLOGOS: autos, estudio y recetas
   Migrados de Google Sheets a Supabase. Son inventarios, pero generan gastos:
   una reparación, un plugin o una consulta terminan en `transactions`, y el
   vínculo es `transaction_id`. Los archivos siguen en Drive; aquí solo hay URLs.
   ========================================================================== */

server.tool(
    'finanzas_autos',
    'Autos de Jay con kilometraje, seguro, tenencia y cuánto se les ha gastado en reparaciones.',
    {},
    async () => {
        const autos = await sql`
            select c.marca, c.modelo, c.anio, c.placa, c.kilometraje, c.propietario,
                   c.tiene_seguro, c.poliza_seguro,
                   to_char(c.vencimiento_poliza, 'YYYY-MM-DD')   as vence_poliza,
                   to_char(c.vencimiento_tenencia, 'YYYY-MM-DD') as vence_tenencia,
                   c.pago_tenencia, c.proxima_revision_km,
                   coalesce(sum(r.costo), 0) as gastado,
                   count(r.id)               as reparaciones
            from cars c
            left join car_repairs r on r.car_id = c.id
            group by c.id order by c.marca, c.modelo
        `;
        if (!autos.length) return texto('No hay autos registrados.');
        const lineas = autos.map((a) => {
            const km = a.kilometraje ? `${Number(a.kilometraje).toLocaleString('es-MX')} km` : 'sin km';
            const seguro = a.tiene_seguro ? (a.vence_poliza ? `póliza vence ${a.vence_poliza}` : 'con seguro') : 'SIN SEGURO';
            const ten = a.vence_tenencia ? `tenencia vence ${a.vence_tenencia}` : 'tenencia sin registrar';
            return `  ${a.marca} ${a.modelo} ${a.anio || ''} · ${a.placa || 'sin placa'}\n`
                 + `    ${km} · ${seguro} · ${ten}\n`
                 + `    ${a.reparaciones} reparación(es), $${dinero(a.gastado)} MXN · ${a.propietario || 'sin propietario'}`;
        });
        return texto(`${autos.length} auto(s):\n\n${lineas.join('\n\n')}`);
    },
);

server.tool(
    'finanzas_reparaciones',
    'Reparaciones de los autos, de la más reciente a la más vieja. Se puede filtrar por auto.',
    {
        auto: z.string().optional().describe('Filtra por marca, modelo o placa'),
        limite: z.number().int().min(1).max(100).default(20),
    },
    async ({ auto, limite }) => {
        const filtro = auto ? `%${auto.toLowerCase()}%` : null;
        const rows = await sql`
            select r.reparacion, r.costo, r.moneda, r.lugar,
                   to_char(r.fecha, 'YYYY-MM-DD') as fecha,
                   r.forma_pago, r.transaction_id,
                   c.marca, c.modelo, c.placa
            from car_repairs r join cars c on c.id = r.car_id
            where ${filtro}::text is null
               or lower(c.marca) like ${filtro} or lower(c.modelo) like ${filtro}
               or lower(coalesce(c.placa, '')) like ${filtro}
            order by r.fecha desc nulls last limit ${limite}
        `;
        if (!rows.length) return texto(auto ? `Sin reparaciones para "${auto}".` : 'Sin reparaciones registradas.');
        const total = rows.reduce((s, r) => s + Number(r.costo || 0), 0);
        const lineas = rows.map((r) =>
            `  ${r.fecha || '(sin fecha)'}  ${(r.marca + ' ' + r.modelo).padEnd(18).slice(0, 18)} `
            + `$${dinero(r.costo).padStart(11)} ${r.moneda}  ${(r.reparacion || '').slice(0, 34)}`
            + `${r.transaction_id ? '' : '  [sin gasto ligado]'}`);
        return texto(`${rows.length} reparación(es), total $${dinero(total)}:\n\n${lineas.join('\n')}`);
    },
);

server.tool(
    'finanzas_estudio',
    'Inventario y plugins del estudio, con el valor total. Equipo y software comparten tabla.',
    {
        tipo: z.enum(['equipo', 'plugin', 'todo']).default('todo'),
        buscar: z.string().optional().describe('Filtra por nombre, marca o categoría'),
    },
    async ({ tipo, buscar }) => {
        const filtroTipo = tipo === 'todo' ? null : tipo;
        const q = buscar ? `%${buscar.toLowerCase()}%` : null;
        const rows = await sql`
            select tipo, name, marca, categoria, cantidad, precio_usd, currency,
                   to_char(fecha_compra, 'YYYY-MM-DD') as fecha_compra, transaction_id
            from studio_gear
            where (${filtroTipo}::text is null or tipo = ${filtroTipo})
              and (${q}::text is null
                   or lower(name) like ${q} or lower(coalesce(marca, '')) like ${q}
                   or lower(coalesce(categoria, '')) like ${q})
            order by tipo, name
        `;
        if (!rows.length) return texto('Nada coincide en el estudio.');
        const total = rows.reduce((s, r) => s + Number(r.precio_usd || 0) * (r.cantidad || 1), 0);
        const lineas = rows.map((r) =>
            `  ${r.tipo === 'plugin' ? '🔌' : '🎛️'} ${(r.name || '').padEnd(30).slice(0, 30)} `
            + `${String(r.cantidad || 1).padStart(2)}× $${dinero(r.precio_usd || 0).padStart(9)} ${r.currency} `
            + `${(r.categoria || '').slice(0, 18)}`);
        return texto(`${rows.length} artículo(s), valor $${dinero(total)} USD:\n\n${lineas.join('\n')}`);
    },
);

server.tool(
    'finanzas_recetas',
    'Recetas médicas de la familia: doctor, diagnóstico, medicamentos y costo de la consulta.',
    {
        miembro: z.string().optional().describe('yo, mariel, roby, hans, romi, papa, mama...'),
        limite: z.number().int().min(1).max(50).default(15),
    },
    async ({ miembro, limite }) => {
        const m = miembro ? miembro.toLowerCase() : null;
        const rows = await sql`
            select member, to_char(fecha, 'YYYY-MM-DD') as fecha, doctor, especialidad,
                   diagnostico, medicamentos, monto_consulta, forma_pago,
                   to_char(proxima_cita, 'YYYY-MM-DD')   as proxima_cita,
                   to_char(vigencia_hasta, 'YYYY-MM-DD') as vigencia_hasta,
                   (foto_url <> '' or foto_url_2 <> '') as tiene_foto
            from prescriptions
            where ${m}::text is null or lower(member) = ${m}
            order by prescriptions.fecha desc nulls last limit ${limite}
        `;
        if (!rows.length) return texto(miembro ? `Sin recetas de ${miembro}.` : 'Sin recetas registradas.');
        const lineas = rows.map((r) => {
            const meds = Array.isArray(r.medicamentos) ? r.medicamentos : [];
            const listaMeds = meds.length
                ? meds.map((x) => `${x.nombre}${x.dosis ? ` (${x.dosis})` : ''}`).join(', ')
                : 'sin medicamentos';
            const costo = r.monto_consulta ? ` · consulta $${dinero(r.monto_consulta)}` : '';
            const cita = r.proxima_cita ? ` · próxima cita ${r.proxima_cita}` : '';
            return `  ${r.fecha || '(sin fecha)'} · ${r.member} · ${r.doctor || 'sin doctor'}`
                 + `${r.especialidad ? ` (${r.especialidad})` : ''}${costo}${cita}\n`
                 + `    ${r.diagnostico || 'sin diagnóstico'}\n`
                 + `    💊 ${listaMeds}${r.tiene_foto ? ' · 📎 con foto' : ''}`;
        });
        return texto(`${rows.length} receta(s):\n\n${lineas.join('\n\n')}`);
    },
);

server.tool(
    'finanzas_vencimientos',
    'Qué está por vencer: pólizas de seguro, tenencias, tratamientos médicos y próximas citas. '
    + 'Pensado para revisarlo sin que Jay tenga que preguntar por cada cosa.',
    { dias: z.number().int().min(1).max(365).default(45).describe('Ventana hacia adelante') },
    async ({ dias }) => {
        const [autos, recetas] = await Promise.all([
            sql`
                select marca, modelo, placa,
                       to_char(vencimiento_poliza, 'YYYY-MM-DD')   as poliza,
                       to_char(vencimiento_tenencia, 'YYYY-MM-DD') as tenencia,
                       vencimiento_poliza   - current_date as dias_poliza,
                       vencimiento_tenencia - current_date as dias_tenencia
                from cars
                where vencimiento_poliza   between current_date - 30 and current_date + ${dias}
                   or vencimiento_tenencia between current_date - 30 and current_date + ${dias}
            `,
            sql`
                select member, doctor,
                       to_char(proxima_cita, 'YYYY-MM-DD')   as cita,
                       to_char(vigencia_hasta, 'YYYY-MM-DD') as hasta,
                       proxima_cita   - current_date as dias_cita,
                       vigencia_hasta - current_date as dias_trat
                from prescriptions
                where proxima_cita   between current_date and current_date + ${dias}
                   or vigencia_hasta between current_date and current_date + ${dias}
            `,
        ]);

        const avisos = [];
        const etiqueta = (d) => d < 0 ? `venció hace ${Math.abs(d)} d` : d === 0 ? 'HOY' : `en ${d} d`;
        for (const a of autos) {
            const quien = `${a.marca} ${a.modelo} (${a.placa || 'sin placa'})`;
            if (a.poliza)   avisos.push([a.dias_poliza,   `🛡️  Póliza ${quien} — ${a.poliza} · ${etiqueta(a.dias_poliza)}`]);
            if (a.tenencia) avisos.push([a.dias_tenencia, `🧾 Tenencia ${quien} — ${a.tenencia} · ${etiqueta(a.dias_tenencia)}`]);
        }
        for (const r of recetas) {
            if (r.cita)  avisos.push([r.dias_cita, `🩺 Cita de ${r.member} con ${r.doctor || 'doctor'} — ${r.cita} · ${etiqueta(r.dias_cita)}`]);
            if (r.hasta) avisos.push([r.dias_trat, `💊 Tratamiento de ${r.member} termina ${r.hasta} · ${etiqueta(r.dias_trat)}`]);
        }
        if (!avisos.length) return texto(`Nada por vencer en los próximos ${dias} días.`);
        avisos.sort((a, b) => a[0] - b[0]);
        return texto(`${avisos.length} vencimiento(s) en ${dias} días:\n\n${avisos.map((a) => '  ' + a[1]).join('\n')}`);
    },
);

server.tool(
    'finanzas_marcar_hormiga',
    'Marca o desmarca un artículo suelto de un ticket como gasto hormiga. '
    + 'Pasar `hormiga: null` borra la corrección y deja mandar al default del grupo.',
    {
        buscar: z.string().describe('Parte del nombre del producto'),
        hormiga: z.boolean().nullable().describe('true, false, o null para quitar la corrección'),
    },
    async ({ buscar, hormiga }) => {
        const q = `%${buscar.toLowerCase()}%`;
        const items = await sql`
            select id, producto_normalizado, comercio, total_item,
                   to_char(fecha, 'YYYY-MM-DD') as fecha, hormiga_override
            from receipt_items
            where lower(coalesce(producto_normalizado, producto_raw, '')) like ${q}
            order by receipt_items.fecha desc limit 12
        `;
        if (!items.length) return texto(`Ningún artículo coincide con "${buscar}".`);
        if (items.length > 1) {
            const lista = items.map((i, n) =>
                `  ${n + 1}. ${i.fecha} · ${(i.producto_normalizado || '').slice(0, 34)} · `
                + `${i.comercio || ''} · $${dinero(i.total_item || 0)}`).join('\n');
            return texto(
                `Hay ${items.length} coincidencias; afina la búsqueda para no marcar la equivocada:\n\n${lista}`);
        }
        const it = items[0];
        await sql`update receipt_items set hormiga_override = ${hormiga} where id = ${it.id}`;
        const estado = hormiga === null ? 'sin corrección (manda el grupo)'
                     : hormiga ? 'SÍ es hormiga' : 'NO es hormiga';
        return texto(`"${it.producto_normalizado}" (${it.fecha}, $${dinero(it.total_item || 0)}) → ${estado}.`);
    },
);

server.tool(
    'finanzas_recibos_sin_procesar',
    'Movimientos que tienen recibo pero les falta comercio, concepto o monto. Son los '
    + 'que Jay sube desde el dashboard adjuntando solo la foto: la idea es leerlos y completarlos.',
    { limite: z.number().int().min(1).max(50).default(15) },
    async ({ limite }) => {
        const rows = await sql`
            select t.id, to_char(t.occurred_at, 'YYYY-MM-DD') as fecha,
                   t.merchant, t.description, t.amount, t.receipt_url, a.name as cuenta
            from transactions t join accounts a on a.id = t.account_id
            where t.receipt_url is not null and t.receipt_url <> ''
              and (t.merchant is null or t.merchant = ''
                   or t.description is null or t.description = ''
                   or abs(t.amount) = 0)
            order by t.occurred_at desc limit ${limite}
        `;
        if (!rows.length) return texto('No hay recibos pendientes de completar.');
        const lineas = rows.map((r) => {
            const falta = [];
            if (!r.merchant) falta.push('comercio');
            if (!r.description) falta.push('concepto');
            if (Math.abs(Number(r.amount)) === 0) falta.push('monto');
            return `  ${r.fecha} · ${r.cuenta} · $${dinero(Math.abs(r.amount))}\n`
                 + `    falta: ${falta.join(', ')}\n`
                 + `    id: ${r.id}\n`
                 + `    recibo: ${r.receipt_url}`;
        });
        return texto(
            `${rows.length} recibo(s) por completar:\n\n${lineas.join('\n\n')}\n\n`
            + 'Usa finanzas_editar_movimiento con el id para completarlos. NO registres uno '
            + 'nuevo: el movimiento ya existe y lo duplicarías.');
    },
);

const transport = new StdioServerTransport();
await server.connect(transport);
