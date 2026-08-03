-- Deudas y sus cuotas.
--
-- En la hoja, las cuotas vivían codificadas como texto en una sola celda:
--
--     "3:734.37:1,2,0:mensual:2026-06-01:self"
--      │  │       │       │        │        └ alcance (self | group)
--      │  │       │       │        └ fecha de inicio
--      │  │       │       └ frecuencia
--      │  │       └ estado por cuota: 0 sin crear, 1 programada, 2 pagada
--      │  └ monto de cada cuota
--      └ cuántas cuotas
--
-- Mismo problema que los bit-fields de los gastos fijos: parsing frágil,
-- imposible de consultar y expuesto a que dos escrituras se pisen. Aquí cada
-- cuota es una fila.

create table debts (
    id            uuid primary key default gen_random_uuid(),
    legacy_row    int,
    debt_key      text unique,           -- 'debt-mn9we70k-aqvjvk', referenciado por otras filas
    parent_key    text,                  -- deuda de la que se desprendió al dividirse
    concepto      text not null,
    monto         numeric(14, 2) not null default 0,
    hidden        boolean not null default false,
    archivos      text,

    -- Configuración de las cuotas; antes, la columna D.
    cuotas_total  int,
    cuota_monto   numeric(14, 2),
    frecuencia    text default 'mensual',
    fecha_inicio  date,
    scope         text default 'self' check (scope in ('self', 'group')),

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table debt_installments (
    id             uuid primary key default gen_random_uuid(),
    debt_id        uuid not null references debts (id) on delete cascade,
    indice         int not null check (indice >= 0),

    -- 'programada' es la cuota que ya existe como gasto fijo pero aún no se paga
    -- (amarilla en la UI); 'pagada' es la verde.
    estado         text not null default 'pendiente'
                   check (estado in ('pendiente', 'programada', 'pagada')),

    transaction_id uuid references transactions (id) on delete set null,
    paid_at        timestamptz,
    created_at     timestamptz not null default now(),

    unique (debt_id, indice)
);

create index debts_hidden_idx on debts (hidden);
create index debt_installments_debt_idx on debt_installments (debt_id, indice);

create trigger debts_touch before update on debts
    for each row execute function touch_updated_at();
