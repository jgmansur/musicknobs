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
import { parseOxxoTicket, TICKET_SENDERS } from './tickets.js';
import { getAccessToken, listMessageIds, getMessage } from './gmail.js';
import { categoriaPara } from '../../shared/categorias.js';
import { lugarPara } from '../../shared/lugares.js';

const DEFAULT_LOOKBACK_DAYS = 7;

/** Tolerancia al comparar el monto de un movimiento contra un gasto fijo. */
const AMOUNT_TOLERANCE = 0.02;
const DAY_WINDOW = 3;


/**
 * Busca un movimiento ya registrado que se parezca a este.
 *
 * Existe porque Jay a veces captura un pago a mano y después llega el correo del
 * banco: sin esto, el mismo gasto entraría dos veces.
 *
 * Se MARCA la sospecha, no se descarta. Dos compras de $50 en el OXXO el mismo
 * día son perfectamente posibles, y descartar automáticamente perdería una.
 */
async function buscarDuplicado(sql, { accountId, amount, occurredAt }) {
    if (!accountId || !Number.isFinite(amount)) return null;
    const magnitud = Math.abs(amount);
    const [dup] = await sql`
        select id from transactions
        where account_id = ${accountId}
          and abs(abs(amount) - ${magnitud}) < 0.01
          and occurred_at between ${occurredAt}::timestamptz - interval '3 days'
                              and ${occurredAt}::timestamptz + interval '3 days'
        order by abs(extract(epoch from (occurred_at - ${occurredAt}::timestamptz)))
        limit 1
    `;
    return dup?.id ?? null;
}

export function buildQuery(sinceDate) {
    // Los tickets de comercio entran en la misma consulta: traen el desglose por
    // producto que el aviso del banco no incluye.
    const senders = [...TRANSACTIONAL_SENDERS, ...TICKET_SENDERS]
        .map((s) => `from:${s}`).join(' OR ');
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
export function classify(parsed, {
    cardMap, fixedExpenses, bankDefaults = new Map(), reglas = [], beneficiarios = [],
    lugares = [],
}) {
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

    // Beneficiario conocido: le pone nombre a una terminación que el banco deja
    // anónima. "transferencia a la cuenta terminación 1791" se vuelve
    // "Javier Tinajero — Mantenimiento Alberca".
    const payee = parsed.counterpartyLast4
        ? beneficiarios.find((b) => b.last4 === parsed.counterpartyLast4)
        : null;

    // Una cuenta propia registrada como beneficiario convierte el movimiento en
    // transferencia, aunque esa cuenta no exista todavía en el sistema.
    if (payee?.tipo === 'cuenta_propia') {
        return {
            accountId: account?.id ?? null,
            kind: 'transfer',
            status: 'pending',
            payeeId: payee.id,
            merchant: payee.nombre,
            fixedExpenseId: null,
            category: null,
            confidence: 0.95,
        };
    }

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

    // El gasto fijo manda sobre la regla de comercio: es más específico y ya
    // trae su propia categoría.
    const porRegla = categoriaPara(
        { merchant: parsed.merchant, description: parsed.counterparty, kind: parsed.kind }, reglas,
    );

    // "Lugar" se resuelve contra el catálogo: el banco manda ruido de sucursal
    // ("OXXO ZAVALA QRF") que sin normalizar cuenta como un lugar distinto.
    const enCatalogo = parsed.merchant ? lugarPara(parsed.merchant, lugares) : null;

    // El beneficiario es evidencia más fuerte que emparejar por monto: se sabe a
    // quién se le pagó, no solo cuánto.
    const fijoDelPayee = payee?.fixed_expense_id ?? null;
    if (payee) confidence = Math.max(confidence, fijoDelPayee ? 0.95 : 0.85);

    return {
        accountId: account?.id ?? null,
        // Un movimiento interno (apartado BBVA) no es gasto ni ingreso.
        kind: parsed.kind === 'internal' ? null : parsed.kind,
        status: parsed.kind === 'internal' ? 'ignored' : 'pending',
        payeeId: payee?.id ?? null,
        merchant: payee?.nombre ?? enCatalogo?.nombre ?? null,
        merchantRaw: parsed.merchant ?? null,
        categoriaLugar: enCatalogo?.lugar?.categoria ?? null,
        fixedExpenseId: fijoDelPayee ?? fixedMatch?.id ?? null,
        category: payee?.categoria ?? fixedMatch?.categoria ?? porRegla?.categoria
            ?? enCatalogo?.lugar?.categoria ?? null,
        reglaId: porRegla?.regla?.id ?? null,
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


/**
 * Guarda el desglose de un ticket de comercio.
 *
 * NO crea un movimiento: el banco ya reportó esa compra. Lo que hace es
 * enriquecer el movimiento existente con el detalle por producto, que es lo que
 * necesita el análisis de gasto hormiga.
 *
 * `recibo_id` es el id del correo, así que reprocesarlo no duplica artículos.
 */
async function guardarTicket(sql, msg, ticket, cardMap) {
    const [yaEsta] = await sql`
        select 1 from receipt_items where recibo_id = ${msg.id} limit 1
    `;
    if (yaEsta) return { creados: 0, ligados: 0 };

    // Se busca el movimiento del banco que corresponde a esta compra: misma
    // cuenta, mismo total, hasta 3 días de diferencia.
    const cuenta = ticket.cardLast4 ? cardMap.get(ticket.cardLast4) : null;
    const cuando = ticket.fecha ?? msg.receivedAt;
    let movimiento = null;
    if (ticket.total != null) {
        const [t] = await sql`
            select id from transactions
            where abs(abs(amount) - ${ticket.total}) < 0.01
              and (${cuenta?.id ?? null}::uuid is null or account_id = ${cuenta?.id ?? null})
              and occurred_at between ${cuando}::timestamptz - interval '3 days'
                                  and ${cuando}::timestamptz + interval '3 days'
            order by abs(extract(epoch from (occurred_at - ${cuando}::timestamptz)))
            limit 1
        `;
        movimiento = t?.id ?? null;
    }

    // Sin movimiento del banco, el ticket es el ÚNICO registro de esa compra.
    // Pasa siempre con la Apple Pay de BBVA: ese banco no manda aviso. Si el
    // ticket no creara el movimiento, esas compras no existirían para el sistema.
    if (!movimiento && ticket.total != null && cuenta?.id) {
        const [creado] = await sql`
            insert into transactions (occurred_at, account_id, amount, kind,
                merchant, description, category, source, source_ref)
            values (${cuando}, ${cuenta.id}, ${-Math.abs(ticket.total)}, 'gasto',
                    'Oxxo', ${ticket.tienda ?? 'Ticket OXXO'}, 'Gasto hormiga',
                    'receipt', ${'ticket:' + msg.id})
            on conflict (source, source_ref) where source_ref is not null
            do nothing
            returning id
        `;
        movimiento = creado?.id ?? null;
    }

    for (const it of ticket.items) {
        await sql`
            insert into receipt_items (fecha, recibo_id, comercio, producto_raw,
                cantidad, precio_unitario, total_item, forma_pago, confianza,
                transaction_id)
            values (${cuando}, ${msg.id}, ${ticket.tienda ?? 'OXXO'}, ${it.producto},
                    ${it.cantidad}, ${it.unitario}, ${it.total},
                    ${cuenta ? 'tarjeta ****' + ticket.cardLast4 : null},
                    'alta', ${movimiento})
        `;
    }
    return { creados: ticket.items.length, ligados: movimiento ? ticket.items.length : 0,
             movimientoCreado: Boolean(movimiento) };
}

export async function runIngest({
    sql, credentials, lookbackDays = DEFAULT_LOOKBACK_DAYS, maxMessages = 200,
    // Fuerza la ventana completa en vez de arrancar desde el último correo
    // visto. Solo para rellenos puntuales; la corrida normal es incremental.
    forzarDesde = null,
}) {
    const [run] = await sql`
        insert into ingest_runs default values returning id
    `;

    const stats = { seen: 0, created: 0, skipped: 0, unmatched: 0, duplicados: 0,
                    articulos: 0, articulosLigados: 0 };

    try {
        const [cards, fixed, accounts] = await Promise.all([
            sql`select last4, account_id from card_map`,
            sql`select id, concepto, categoria, monto, pagos_mes, fechas_pago
                from fixed_expenses where active`,
            sql`select id, name from accounts`,
        ]);
        const [reglas, beneficiarios] = await Promise.all([
            sql`select id, patron, categoria, prioridad, aplica_a from category_rules`,
            sql`select id, last4, nombre, tipo, fixed_expense_id, categoria from payees`,
        ]);
        const lugares = await sql`select id, nombre, aliases, categoria from places`;
        const cardMap = new Map(cards.map((c) => [c.last4, { id: c.account_id }]));

        // Cuenta por defecto de cada banco, para los avisos que no traen tarjeta.
        const byName = new Map(accounts.map((a) => [a.name, { id: a.id }]));
        const bankDefaults = new Map(
            [['santander', 'Santander'], ['bbva', 'BBVA'], ['hey', 'Hey Banco']]
                .map(([bank, name]) => [bank, byName.get(name)])
                .filter(([, acc]) => acc),
        );

        const token = await getAccessToken(credentials);
        const since = forzarDesde ?? await resolveSince(sql, lookbackDays);
        const ids = await listMessageIds(token, buildQuery(since), maxMessages);
        stats.seen = ids.length;

        for (const id of ids) {
            const msg = await getMessage(token, id);

            // Un ticket de comercio no genera movimiento: enriquece el que el
            // banco ya reportó.
            if (TICKET_SENDERS.has(msg.from)) {
                const ticket = parseOxxoTicket(msg.plain ?? '');
                if (ticket) {
                    const r = await guardarTicket(sql, msg, ticket, cardMap);
                    stats.articulos += r.creados;
                    stats.articulosLigados += r.ligados;
                } else {
                    stats.unmatched += 1;
                }
                stats.skipped += 1;
                continue;
            }

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

            const s = classify(parsed, { cardMap, fixedExpenses: fixed, bankDefaults, reglas, beneficiarios, lugares });

            const duplicado = s.status === 'pending'
                ? await buscarDuplicado(sql, {
                    accountId: s.accountId,
                    amount: parsed.amount,
                    occurredAt: parsed.occurredAt ?? msg.receivedAt,
                })
                : null;

            const inserted = await sql`
                insert into pending_transactions (
                    gmail_message_id, gmail_thread_id, received_at,
                    bank, template, raw_subject, raw_text,
                    occurred_at, amount, currency, merchant, card_last4, counterparty,
                    suggested_account_id, suggested_kind, suggested_category,
                    suggested_fixed_expense_id, match_confidence, status,
                    payee_id, duplicate_of
                ) values (
                    ${msg.id}, ${msg.threadId}, ${msg.receivedAt},
                    ${parsed.bank}, ${parsed.template}, ${msg.subject},
                    ${(parsed.text ?? '').slice(0, 4000)},
                    ${parsed.occurredAt ?? msg.receivedAt},
                    ${parsed.amount ?? null}, ${parsed.currency ?? 'MXN'},
                    ${s.merchant ?? parsed.merchant ?? null}, ${parsed.cardLast4 ?? null},
                    ${parsed.counterparty ?? null},
                    ${s.accountId}, ${s.kind}, ${s.category},
                    ${s.fixedExpenseId}, ${s.confidence}, ${s.status},
                    ${s.payeeId ?? null}, ${duplicado}
                )
                on conflict (gmail_message_id) do nothing
                returning id
            `;

            if (inserted.length) {
                stats.created += 1;
                if (duplicado) stats.duplicados += 1;
                if (s.reglaId) {
                    await sql`
                        update category_rules set veces_aplicada = veces_aplicada + 1
                        where id = ${s.reglaId}
                    `;
                }
            } else stats.skipped += 1;
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
