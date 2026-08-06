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

    // 6. El mismo gasto fijo cobrado dos veces en el mismo mes, en DOS cuentas
    //    distintas. Es la firma exacta del bug de Canva.
    //
    //    Cómo se produce: el cargo real llega por correo y entra a la bandeja,
    //    pero el fijo se sigue viendo pendiente. Jay lo marca pagado a mano, y
    //    ese palomeo crea un movimiento propio en la cuenta por defecto — que no
    //    es donde el servicio cobra de verdad. Quedan dos gastos por el mismo
    //    servicio, en Santander y en Hey Banco, y el mes sale inflado.
    //
    //    Canva lo hizo en mayo y en junio de 2026, $149 cada vez. Nadie lo notó
    //    porque cada movimiento, por separado, se ve perfectamente normal.
    //
    //    `debeAutoMarcar` en el ingest ya elimina la causa: el fijo se marca solo
    //    y no queda nada que palomear. Este chequeo es la red por si vuelve a
    //    aparecer por otra vía — captura a mano, una importación, un fijo nuevo
    //    sin `forma_pago`.
    //    OJO con el `coalesce`: NO basta con unir por `fixed_expense_id`. La
    //    mayoría de los movimientos con source='fijo' lo traen en null (todo lo
    //    migrado de las hojas, y parte de lo que sigue entrando hoy). Un chequeo
    //    que dependiera de esa columna estaría ciego justo ante el caso que debe
    //    cazar. Por eso, cuando falta, el concepto se recupera del propio
    //    `description`, que viene como 'Canva (1/1)'.
    const dobles = await sql`
        with ligados as (
            select t.id, t.account_id, t.occurred_at, t.amount,
                   coalesce(f.concepto,
                            case when t.source = 'fijo'
                                 then regexp_replace(t.description, '\\s*\\(\\d+/\\d+\\)\\s*$', '')
                            end) as concepto
            from transactions t
            left join fixed_expenses f on f.id = t.fixed_expense_id
            where t.kind = 'gasto'
              and t.occurred_at >= (current_date - interval '6 months')
              and (t.fixed_expense_id is not null or t.source = 'fijo')
        )
        select l.concepto,
               to_char(l.occurred_at, 'YYYY-MM') as mes,
               string_agg(distinct a.name, ' + ' order by a.name) as donde,
               count(*)::int as movimientos,
               sum(abs(l.amount)) as total
        from ligados l
        join accounts a on a.id = l.account_id
        -- Solo conceptos que son gastos fijos de verdad: evita ruido de
        -- descripciones que casualmente traen paréntesis.
        join fixed_expenses f2 on f2.concepto = l.concepto
        where l.concepto is not null
        group by l.concepto, to_char(l.occurred_at, 'YYYY-MM')
        having count(distinct l.account_id) > 1
        order by mes desc, l.concepto
    `;
    if (dobles.length) hallazgos.push({
        tipo: 'fijo_cobrado_en_dos_cuentas', gravedad: 'alta', casos: dobles,
        explicacion: 'El mismo fijo generó gastos en dos cuentas el mismo mes: casi siempre es el cargo real MÁS un palomeo manual. Revisar cuál sobra, borrarlo, y ponerle forma_pago al fijo.',
    });

    // 7. Fijos sin `forma_pago`. Es la condición que hace posible el hallazgo 6:
    //    sin cuenta configurada, marcar el fijo a mano manda el movimiento a la
    //    cuenta por defecto en vez de a la que de verdad cobra.
    const sinFormaPago = await sql`
        select f.concepto, f.monto,
               (select a.name from transactions t join accounts a on a.id = t.account_id
                 where t.fixed_expense_id = f.id and t.source = 'email'
                 order by t.occurred_at desc limit 1) as cuenta_real
        from fixed_expenses f
        where f.active and (f.forma_pago is null or f.forma_pago = '')
          and exists (select 1 from transactions t
                       where t.fixed_expense_id = f.id and t.source = 'email')
        order by f.concepto
    `;
    if (sinFormaPago.length) hallazgos.push({
        tipo: 'fijo_sin_forma_pago', gravedad: 'media', casos: sinFormaPago,
        explicacion: 'Este fijo ya demostró en qué cuenta cobra, pero no la tiene guardada. Marcarlo a mano lo mandaría a la cuenta equivocada y duplicaría el gasto.',
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
