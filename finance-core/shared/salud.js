/**
 * Revisión de salud de los datos financieros.
 *
 * Vive aquí, compartida por el Worker y el MCP, por la misma razón que
 * `movimientos.js`: si cada uno tuviera su copia, el día que diverjan la app y
 * el asistente reportarían cosas distintas sobre los mismos datos.
 *
 * Cada revisión nació de un error real que ya costó dinero mal contado, y todas
 * se detectaron porque Jay notó un síntoma raro y alguien fue a escarbar. Ese es
 * justo el trabajo que este archivo existe para eliminar: Hey Banco pasó cinco
 * meses con 65 cargos y ni un solo abono sin que nada lo señalara.
 *
 * Al arreglar un bug de contabilidad, agregar aquí la revisión que lo habría
 * cazado.
 */

/** Diferencia tolerada entre el monto guardado de un fijo y su cobro real. */
const TOLERANCIA_MONTO = 0.02;

export async function revisarSalud(sql) {
    const hallazgos = [];

    // 1. Traspasos cojos. Un movimiento entre cuentas propias tiene DOS patas;
    //    con una sola, la cuenta destino nunca vio el dinero. Fue el bug que
    //    tuvo a Hey Banco en negativo durante meses.
    const cojos = await sql`
        select t.id, t.occurred_at, t.amount, t.merchant, a.name as cuenta
        from transactions t join accounts a on a.id = t.account_id
        where t.kind = 'transfer'
          and (t.transfer_group_id is null
               or (select count(*) from transactions x
                    where x.transfer_group_id = t.transfer_group_id) < 2)
        order by t.occurred_at desc limit 50
    `;
    if (cojos.length) hallazgos.push({
        tipo: 'traspaso_sin_contraparte', gravedad: 'alta', casos: cojos,
        explicacion: 'Traspaso con una sola pata: la cuenta destino nunca vio el dinero.',
    });

    // 2. Cuentas de débito en negativo. Una tarjeta de crédito sí va en
    //    negativo; una cuenta de banco no. Cuando pasa, casi siempre falta
    //    registrar un ingreso o un traspaso.
    const negativas = await sql`
        select name, type, display_balance from account_balances
        where display_balance < 0 and not hidden
          and coalesce(type, '') not ilike '%credit%'
    `;
    if (negativas.length) hallazgos.push({
        tipo: 'cuenta_debito_en_negativo', gravedad: 'alta', casos: negativas,
        explicacion: 'Suele significar que falta registrar un ingreso o un traspaso recibido.',
    });

    // 3. Fijos cuyo cobro real ya no coincide con el monto guardado.
    //
    //    Se compara contra el ÚLTIMO cobro, no contra el promedio: si el precio
    //    subió a media temporada, promediar mezcla el viejo con el nuevo y da
    //    una cifra que no existió nunca.
    //
    //    Importa porque el emparejamiento pendiente→fijo usa el monto como
    //    respaldo: si se desfasa lo suficiente, el fijo deja de reconocer sus
    //    propios cargos. Le pasó a Starlink al subir de $1,305 a $1,405.
    const ultimos = await sql`
        select distinct on (f.id)
               f.concepto, f.monto as registrado,
               abs(t.amount) as ultimo_cobro, p.period as ultimo_mes
        from fixed_expense_payments p
        join fixed_expenses f on f.id = p.fixed_expense_id
        join transactions t on t.id = p.transaction_id
        where p.period >= (current_date - interval '4 months') and f.pagos_mes = 1
        order by f.id, p.period desc
    `;
    const desfasados = ultimos.filter((f) =>
        Math.abs(Number(f.ultimo_cobro) - Number(f.registrado))
            > Math.max(1, Number(f.registrado) * TOLERANCIA_MONTO));
    if (desfasados.length) hallazgos.push({
        tipo: 'monto_de_fijo_desactualizado', gravedad: 'media', casos: desfasados,
        explicacion: 'El cobro real difiere del monto guardado. Preguntarle a Jay si quiere actualizarlo; nunca cambiarlo por cuenta propia.',
    });

    // 4. Beneficiarios de cuenta propia sin cuenta ligada. Sin `account_id` no
    //    hay dónde abonar y el traspaso nace cojo, aunque el código esté bien.
    const sinLigar = await sql`
        select last4, nombre, banco from payees
        where tipo = 'cuenta_propia' and account_id is null
    `;
    if (sinLigar.length) hallazgos.push({
        tipo: 'cuenta_propia_sin_ligar', gravedad: 'media', casos: sinLigar,
        explicacion: 'Sin account_id, un traspaso hacia esta cuenta no puede abonarse.',
    });

    // 5. Períodos que no son día 1. Hay un CHECK que ya lo impide; se revisa por
    //    si una migración futura lo quitara sin darse cuenta.
    const [periodos] = await sql`
        select count(*)::int as n from fixed_expense_payments
        where extract(day from period) <> 1
    `;
    if (periodos.n) hallazgos.push({
        tipo: 'periodo_invalido', gravedad: 'alta', casos: [periodos],
        explicacion: 'El período debe ser el día 1 del mes; si no, la app no encuentra el pago y el fijo reaparece pendiente.',
    });

    return { revisado: new Date().toISOString(), ok: hallazgos.length === 0, hallazgos };
}

/** Render de texto plano, para el MCP y para cualquier reporte. */
export function formatearSalud(d) {
    if (d.ok) return 'Todo en orden: sin hallazgos.';
    return d.hallazgos.map((h) => {
        const casos = h.casos.slice(0, 8)
            .map((c) => '    · ' + Object.entries(c)
                .filter(([k]) => k !== 'id')
                .map(([k, v]) => `${k}=${v}`).join('  '))
            .join('\n');
        const mas = h.casos.length > 8 ? `\n    … y ${h.casos.length - 8} más` : '';
        return `[${h.gravedad.toUpperCase()}] ${h.tipo} — ${h.casos.length} caso(s)\n`
            + `  ${h.explicacion}\n${casos}${mas}`;
    }).join('\n\n');
}
