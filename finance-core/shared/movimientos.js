/**
 * Operaciones sobre movimientos, compartidas por el Worker y el MCP.
 *
 * Viven aquí y no duplicadas en cada uno porque son reglas de negocio: aprobar
 * un pendiente o revertir un movimiento tiene que hacer exactamente lo mismo
 * venga de la app o de un asistente. Dos copias divergen, y el día que lo hagan
 * la misma acción daría resultados distintos según quién la pidió.
 *
 * Cada función recibe el cliente `sql` de postgres.js, así que sirven igual en
 * Cloudflare Workers y en Node.
 */

/**
 * Convierte un pendiente de la bandeja en movimiento real.
 *
 * Todo ocurre en una transacción: o queda el movimiento y el pendiente marcado
 * como aprobado, o no queda nada. Nunca un pendiente aprobado sin su movimiento.
 */
export async function aprobarPendiente(sql, id, overrides = {}) {
    return sql.begin(async (tx) => {
        const [p] = await tx`
            select * from pending_transactions where id = ${id} and status = 'pending'
        `;
        if (!p) return { error: 'pendiente no encontrado o ya resuelto' };

        const accountId = overrides.accountId ?? p.suggested_account_id;
        if (!accountId) return { error: 'falta la cuenta: mapea la tarjeta o elígela' };

        const monto = overrides.amount ?? p.amount;
        if (!Number.isFinite(Number(monto)) || Number(monto) === 0) {
            return {
                error: 'ese movimiento no trae monto (los SPEI de Hey no lo incluyen): '
                    + 'hay que indicarlo para poder aprobarlo',
            };
        }

        const kind = overrides.kind ?? p.suggested_kind ?? 'gasto';
        const magnitude = Math.abs(Number(monto));
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
        return { ok: true, transactionId: trx.id, amount };
    });
}

/**
 * Borra un movimiento dejando el sistema consistente.
 *
 * Tres efectos que no se pueden omitir:
 *  - si saldaba una parte de un gasto fijo, esa parte vuelve a quedar pendiente;
 *  - si vino de un correo, el pendiente regresa a la bandeja en vez de perderse;
 *  - si era una transferencia, se borran las DOS filas ligadas, porque borrar
 *    una sola haría aparecer o desaparecer dinero de la nada.
 */
export async function borrarMovimiento(sql, id) {
    return sql.begin(async (tx) => {
        const [existe] = await tx`select id from transactions where id = ${id}`;
        if (!existe) return { error: 'movimiento no encontrado' };

        await tx`delete from fixed_expense_payments where transaction_id = ${id}`;
        await tx`
            update pending_transactions
            set status = 'pending', transaction_id = null, resolved_at = null
            where transaction_id = ${id}
        `;
        const [t] = await tx`
            delete from transactions where id = ${id} returning id, transfer_group_id, amount
        `;
        let ligadas = 0;
        if (t?.transfer_group_id) {
            const otras = await tx`
                delete from transactions where transfer_group_id = ${t.transfer_group_id}
                returning id
            `;
            ligadas = otras.length;
        }
        return { ok: true, ligadas };
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
export async function pagarFijo(sql, fixedId, opts = {}) {
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
        return { ok: true, transactionId: trx.id, amount: signed, concepto: f.concepto,
                 partes: f.pagos_mes || 1 };
    });
}
