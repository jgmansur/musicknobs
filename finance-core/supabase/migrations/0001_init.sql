-- Finance Core — esquema inicial
--
-- Principio central del rediseño: el saldo de una cuenta NO se captura, se deriva.
--   saldo = opening_balance + suma de movimientos posteriores a opening_balance_at
-- Por eso `accounts` no tiene columna `balance`. Ver la vista `account_balances`.
--
-- Convención de signo en `transactions.amount`: siempre desde el punto de vista del
-- flujo de efectivo de la cuenta. Negativo = sale dinero, positivo = entra.
-- En tarjetas de crédito una compra es negativa (crece la deuda); la vista expone
-- `display_balance` con el signo que Jay espera ver (deuda como positivo).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Cuentas
-- ---------------------------------------------------------------------------
create table accounts (
    id                    uuid primary key default gen_random_uuid(),
    legacy_id             text unique,                    -- ID en el sheet Saldos, para migrar sin perder trazabilidad
    name                  text not null,
    type                  text not null check (type in ('bank', 'credit', 'invest', 'cash')),
    currency              text not null default 'MXN',
    hidden                boolean not null default false,
    credit_limit          numeric(14, 2) not null default 0,
    credit_limit_visible  boolean not null default false,
    investment_type       text,                           -- cetes | mifel | bitcoin | custom
    custom_annual_rate    numeric(8, 4) not null default 0,
    bitcoin_initial_mxn   numeric(14, 2) not null default 0,

    -- Ancla del saldo derivado. Al reconciliar contra el banco se reescriben ambos.
    opening_balance       numeric(20, 8) not null default 0,
    opening_balance_at    timestamptz not null default now(),

    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Gastos fijos
-- ---------------------------------------------------------------------------
create table fixed_expenses (
    id               uuid primary key default gen_random_uuid(),
    legacy_row       int,                                  -- fila original en el sheet Fijos
    concepto         text not null,
    categoria        text,
    monto            numeric(14, 2) not null,
    moneda           text not null default 'MXN',
    tipo             text,
    pagos_mes        int not null default 1 check (pagos_mes between 1 and 31),
    periodicidad     text,
    inicio_mes       int,
    pagador          text,
    forma_pago       text,
    budget_category  text,                                 -- uno de los 6 buckets del planner
    link_group       text,
    fechas_pago      int[] not null default '{}',          -- días del mes en que toca cada parte
    active           boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Movimientos
-- ---------------------------------------------------------------------------
create table transactions (
    id            uuid primary key default gen_random_uuid(),
    occurred_at   timestamptz not null,
    account_id    uuid not null references accounts (id) on delete restrict,
    amount        numeric(20, 8) not null check (amount <> 0),
    kind          text not null check (kind in ('gasto', 'ingreso', 'transfer')),

    merchant      text,                                    -- "Lugar" en el sheet
    description   text,                                    -- "Concepto" en el sheet
    category      text,
    receipt_url   text,
    is_hormiga    boolean,

    -- Una transferencia entre cuentas propias son DOS filas con el mismo grupo.
    -- Nunca cuenta como gasto: los reportes filtran kind <> 'transfer'.
    transfer_group_id uuid,

    -- Procedencia: de dónde salió esta fila.
    source        text not null default 'manual'
                  check (source in ('manual', 'email', 'receipt', 'fijo', 'import', 'script')),
    source_ref    text,                                    -- gmail message id, id de recibo, etc.

    fixed_expense_id uuid references fixed_expenses (id) on delete set null,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Idempotencia: el mismo correo nunca puede entrar dos veces.
create unique index transactions_source_ref_uniq
    on transactions (source, source_ref)
    where source_ref is not null;

create index transactions_account_time_idx on transactions (account_id, occurred_at desc);
create index transactions_occurred_idx     on transactions (occurred_at desc);
create index transactions_transfer_idx     on transactions (transfer_group_id)
    where transfer_group_id is not null;

-- ---------------------------------------------------------------------------
-- Estado de pago de los fijos
--
-- Reemplaza los bit-fields serializados como string en celdas del sheet
-- (`pagosEstado`, `waivedEstado`). Cada parte es su propia fila, con constraint
-- único: se acaban las race conditions y el parsing frágil.
-- ---------------------------------------------------------------------------
create table fixed_expense_payments (
    id                uuid primary key default gen_random_uuid(),
    fixed_expense_id  uuid not null references fixed_expenses (id) on delete cascade,
    period            date not null,                       -- primer día del mes
    part_index        int not null check (part_index >= 0),
    paid              boolean not null default false,
    waived            boolean not null default false,      -- condonado (ej. cuotas de super)
    paid_at           timestamptz,
    transaction_id    uuid references transactions (id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    unique (fixed_expense_id, period, part_index),
    constraint not_paid_and_waived check (not (paid and waived))
);

create index fep_period_idx on fixed_expense_payments (period, paid);

-- ---------------------------------------------------------------------------
-- Mapeo terminación de tarjeta → cuenta
--
-- Regla aprendida: el "Emisor" que aparece en un ticket es el banco del POS,
-- NO la tarjeta de Jay. La terminación de las alertas del banco sí es confiable.
-- Los DPAN de Apple Pay difieren del plástico y también se mapean aquí.
-- ---------------------------------------------------------------------------
create table card_map (
    last4       text primary key,
    account_id  uuid not null references accounts (id) on delete cascade,
    instrument  text not null check (instrument in ('debito', 'credito', 'cuenta', 'apple_pay')),
    label       text,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bandeja de entrada: movimientos detectados en correo, pendientes de aprobación
--
-- La ingesta NUNCA escribe directo a `transactions`. Todo pasa por aquí y Jay
-- aprueba. `gmail_message_id` único hace el polling idempotente.
-- ---------------------------------------------------------------------------
create table pending_transactions (
    id                 uuid primary key default gen_random_uuid(),
    gmail_message_id   text not null unique,
    gmail_thread_id    text,
    received_at        timestamptz not null,

    bank               text not null,                      -- santander | bbva
    template           text not null,                      -- qué parser hizo match
    raw_subject        text,
    raw_text           text,                               -- cuerpo ya convertido a texto plano

    -- Campos extraídos
    occurred_at        timestamptz,
    amount             numeric(20, 8),
    currency           text not null default 'MXN',
    merchant           text,
    card_last4         text,
    counterparty       text,                               -- beneficiario / ordenante

    -- Sugerencias del clasificador
    suggested_account_id       uuid references accounts (id) on delete set null,
    suggested_kind             text check (suggested_kind in ('gasto', 'ingreso', 'transfer')),
    suggested_category         text,
    suggested_fixed_expense_id uuid references fixed_expenses (id) on delete set null,
    match_confidence           numeric(4, 3) check (match_confidence between 0 and 1),

    status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'ignored', 'duplicate')),
    transaction_id     uuid references transactions (id) on delete set null,
    resolved_at        timestamptz,
    created_at         timestamptz not null default now()
);

create index pending_status_idx on pending_transactions (status, received_at desc);

-- ---------------------------------------------------------------------------
-- Bitácora de ingesta — para saber hasta dónde leyó el cron y depurar
-- ---------------------------------------------------------------------------
create table ingest_runs (
    id            uuid primary key default gen_random_uuid(),
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    messages_seen int not null default 0,
    created       int not null default 0,
    skipped       int not null default 0,
    unmatched     int not null default 0,                  -- correos de banco sin parser
    error         text
);

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------

-- Saldo derivado. Ésta es la única fuente de verdad de "cuánto tengo".
create view account_balances as
select
    a.id,
    a.name,
    a.type,
    a.currency,
    a.hidden,
    a.credit_limit,
    a.opening_balance + coalesce(sum(t.amount), 0)  as balance,
    -- Para crédito Jay lee la deuda como número positivo.
    case
        when a.type = 'credit'
            then -(a.opening_balance + coalesce(sum(t.amount), 0))
        else a.opening_balance + coalesce(sum(t.amount), 0)
    end                                             as display_balance,
    count(t.id)                                     as movements,
    max(t.occurred_at)                              as last_movement_at
from accounts a
left join transactions t
       on t.account_id = a.id
      and t.occurred_at >= a.opening_balance_at
group by a.id;

-- Gasto real por mes: las transferencias entre cuentas propias NO son gasto.
create view monthly_spend as
select
    date_trunc('month', t.occurred_at)::date as period,
    t.category,
    sum(-t.amount) filter (where t.kind = 'gasto')   as gasto,
    sum(t.amount)  filter (where t.kind = 'ingreso') as ingreso
from transactions t
where t.kind <> 'transfer'
group by 1, 2;

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger accounts_touch    before update on accounts
    for each row execute function touch_updated_at();
create trigger transactions_touch before update on transactions
    for each row execute function touch_updated_at();
create trigger fixed_touch        before update on fixed_expenses
    for each row execute function touch_updated_at();
create trigger fep_touch          before update on fixed_expense_payments
    for each row execute function touch_updated_at();
