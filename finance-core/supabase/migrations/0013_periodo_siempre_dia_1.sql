-- El período de un pago de gasto fijo SIEMPRE es el día 1 del mes.
--
-- `shared/movimientos.js` lo calculaba con `setDate(1)` + `toISOString()`.
-- setDate trabaja en hora local y toISOString convierte a UTC, así que en
-- México (UTC-6) cualquier movimiento con hora local de 18:00 en adelante
-- rodaba al día siguiente y el pago se guardaba con period '2026-07-02'.
--
-- La app siempre consulta el día 1, así que esos pagos eran INVISIBLES: el
-- fijo reaparecía pendiente aunque estuviera pagado, y al volver a marcarlo se
-- creaba un segundo registro. Ya pasó 11 veces entre abril y julio de 2026.
--
-- El código ya se corrigió (primerDiaDelMes). Este constraint es el candado:
-- si algún camino nuevo vuelve a escribir mal, falla de inmediato en vez de
-- perder el pago en silencio.

-- 1. Los que no chocan se normalizan al día 1.
update fixed_expense_payments p
   set period = date_trunc('month', period)::date
 where extract(day from period) <> 1
   and not exists (
       select 1 from fixed_expense_payments q
        where q.fixed_expense_id = p.fixed_expense_id
          and q.part_index       = p.part_index
          and q.period           = date_trunc('month', p.period)::date
   );

-- 2. Los que sí chocan (mismo fijo, mes y parte ya ocupada) se desligan del
--    fijo, NO se borran los movimientos: fueron compras reales, con montos y
--    fechas distintas. El gasto sigue contando; lo único que se elimina es el
--    segundo palomeo del mismo fijo, que el bug provocó.
delete from fixed_expense_payments p
 where extract(day from period) <> 1
   and exists (
       select 1 from fixed_expense_payments q
        where q.fixed_expense_id = p.fixed_expense_id
          and q.part_index       = p.part_index
          and q.period           = date_trunc('month', p.period)::date
   );

-- 3. El candado.
alter table fixed_expense_payments
    drop constraint if exists fixed_expense_payments_period_dia_1;

alter table fixed_expense_payments
    add constraint fixed_expense_payments_period_dia_1
    check (extract(day from period) = 1);

comment on constraint fixed_expense_payments_period_dia_1 on fixed_expense_payments is
    'El período identifica un MES. Guardar cualquier día que no sea el 1 hace '
    'que la consulta de la app no lo encuentre y el pago desaparezca.';
