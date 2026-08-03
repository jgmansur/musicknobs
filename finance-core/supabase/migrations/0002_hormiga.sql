-- Analítica de gasto hormiga.
--
-- Estas dos tablas NO afectan saldos: son el desglose por producto de los
-- recibos, para poder responder "¿en qué se me va el dinero de a poquito?".
-- Un movimiento de $140 en el OXXO sigue siendo un solo movimiento; aquí se
-- guarda qué venía dentro de ese ticket.

create table product_groups (
    grupo_producto  text primary key,
    aliases         text[] not null default '{}',
    hormiga_default boolean not null default false,
    notas           text,
    updated_at      timestamptz not null default now()
);

create table receipt_items (
    id                   uuid primary key default gen_random_uuid(),
    fecha                date not null,
    recibo_id            text,
    comercio             text,
    producto_raw         text,
    producto_normalizado text,
    categoria            text,
    subcategoria         text,
    cantidad             numeric(12, 3),
    precio_unitario      numeric(14, 2),
    total_item           numeric(14, 2),
    forma_pago           text,
    recibo_url           text,
    confianza            text,
    grupo_producto       text references product_groups (grupo_producto) on delete set null,

    -- `hormiga_auto` es lo que dedujo el clasificador; `hormiga_override` es la
    -- palabra de Jay. Se separan para poder corregir sin perder el original.
    hormiga_auto         boolean,
    hormiga_override     boolean,

    -- Enlace opcional al movimiento que pagó este ticket.
    transaction_id       uuid references transactions (id) on delete set null,
    created_at           timestamptz not null default now()
);

create index receipt_items_fecha_idx  on receipt_items (fecha desc);
create index receipt_items_grupo_idx  on receipt_items (grupo_producto);

-- NO se define aquí una vista "es_hormiga".
--
-- La clasificación real es una cascada que vive en el dashboard: override de
-- Jay → default del grupo → lo que dedujo el clasificador → heurístico de texto
-- con reglas por producto. Reimplementarla en SQL crearía un segundo motor que
-- tarde o temprano discrepa del primero, y los totales cambiarían sin que nadie
-- sepa por qué. Estas tablas solo guardan; la app decide.
