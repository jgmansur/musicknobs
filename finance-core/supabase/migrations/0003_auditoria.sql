-- Bitácora de reanclajes de saldo.
--
-- Reanclar una cuenta reescribe `opening_balance` y borra el efecto de todos los
-- movimientos anteriores. Es la operación más destructiva del sistema y hasta
-- ahora no dejaba ninguna huella: una prueba mía dejó Santander en $5,000 y solo
-- se detectó al comparar a mano contra el valor esperado.

create table balance_adjustments (
    id             uuid primary key default gen_random_uuid(),
    account_id     uuid not null references accounts (id) on delete cascade,
    saldo_anterior numeric(20, 8) not null,
    saldo_nuevo    numeric(20, 8) not null,
    diferencia     numeric(20, 8) not null,
    motivo         text,
    origen         text not null default 'mcp',
    created_at     timestamptz not null default now()
);

create index balance_adjustments_cuenta_idx
    on balance_adjustments (account_id, created_at desc);
