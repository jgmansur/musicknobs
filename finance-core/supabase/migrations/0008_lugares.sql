-- Catálogo de lugares.
--
-- "Lugar" era texto libre y terminó con 274 valores distintos para muchos menos
-- lugares reales: OXXO aparecía como "Oxxo", "OXXO", "OXXO El Encanto",
-- "OXXOGRAND PVA" y "OXXO CALLE ANCHA II". Así no se puede agrupar ni reportar.
--
-- Ahora `merchant` guarda el nombre canónico y `merchant_raw` conserva lo que
-- mandó el banco, que sigue sirviendo para depurar y para afinar los alias.

create table places (
    id         uuid primary key default gen_random_uuid(),
    nombre     text not null unique,

    -- Fragmentos que identifican al lugar en el texto crudo del banco.
    aliases    text[] not null default '{}',

    -- 'marcador' son etiquetas internas del sistema (Gasto Fijo, Ingreso Fijo),
    -- no comercios; se listan aparte para no confundirlas con lugares reales.
    tipo       text not null default 'comercio'
               check (tipo in ('comercio', 'persona', 'servicio', 'marcador')),
    categoria  text,
    veces      int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index places_nombre_idx on places (lower(nombre));

alter table transactions add column if not exists merchant_raw text;

create trigger places_touch before update on places
    for each row execute function touch_updated_at();
