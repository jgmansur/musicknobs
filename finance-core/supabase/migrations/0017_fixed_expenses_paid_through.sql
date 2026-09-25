-- Cobertura opcional para pagos anticipados de seguros y suscripciones.
-- Es inclusiva: el fijo vuelve a estar pendiente al día siguiente.
alter table fixed_expenses
    add column if not exists paid_through date;
