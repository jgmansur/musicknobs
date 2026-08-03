-- Beneficiarios conocidos: a quién le transfiere Jay.
--
-- Los correos de transferencia de Santander y BBVA traen la terminación de la
-- cuenta destino, pero por sí sola no dice nada: "transferencia a la cuenta
-- terminación 1791" queda como un gasto anónimo que hay que clasificar a mano
-- cada mes.
--
-- Esta tabla le pone nombre a esas terminaciones, y con eso la ingesta puede
-- resolver de una vez el comercio, la categoría y el gasto fijo que salda.

create table payees (
    id            uuid primary key default gen_random_uuid(),

    -- Últimos 4 dígitos de la cuenta o CLABE destino. Es lo único que el banco
    -- revela en el aviso.
    last4         text not null,
    banco         text,
    nombre        text not null,
    descripcion   text,

    tipo          text not null default 'persona'
                  check (tipo in ('fijo', 'variable', 'persona', 'cuenta_propia')),

    -- Si la transferencia salda un gasto fijo, aquí queda ligado.
    fixed_expense_id uuid references fixed_expenses (id) on delete set null,
    categoria     text,

    -- Una cuenta propia convierte la transferencia en movimiento interno: no es
    -- gasto, es cambiar de bolsillo. Mismo caso que Hey Banco.
    account_id    uuid references accounts (id) on delete set null,

    notas         text,
    veces_visto   int not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Una terminación puede repetirse entre bancos distintos, pero no dentro del
-- mismo: ahí sería ambiguo.
create unique index payees_last4_banco_uniq
    on payees (last4, coalesce(lower(banco), ''));

create index payees_last4_idx on payees (last4);

create trigger payees_touch before update on payees
    for each row execute function touch_updated_at();
