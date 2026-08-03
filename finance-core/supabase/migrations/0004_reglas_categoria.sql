-- Reglas de categorización por comercio.
--
-- El nombre que manda el banco es ruidoso y repetitivo: "DLO*UBER EATS",
-- "MERCADOPAGO *BIRRIA", "APPLE.COM/BILL 866-712-775". Categorizar eso a mano
-- cada vez es trabajo que la máquina puede hacer, porque el patrón se repite.
--
-- Las reglas se aplican en la INGESTA, no solo hacia atrás: si solo sirvieran
-- para el histórico, el cargo de mañana volvería a llegar sin categoría y no se
-- ganaría nada.

create table category_rules (
    id             uuid primary key default gen_random_uuid(),

    -- Texto que debe aparecer en el comercio o el concepto. Se compara sin
    -- distinguir mayúsculas.
    patron         text not null check (length(trim(patron)) >= 2),
    categoria      text not null,

    -- Menor gana. Permite que una regla específica ("UBER EATS") le gane a una
    -- general ("UBER") sin depender del orden de inserción.
    prioridad      int not null default 100,

    -- 'manual' la escribió alguien; 'aprendida' salió de observar el histórico.
    origen         text not null default 'manual' check (origen in ('manual', 'aprendida')),

    veces_aplicada int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- Un mismo patrón no puede tener dos categorías: sería ambiguo y el resultado
-- dependería del orden de lectura.
create unique index category_rules_patron_uniq on category_rules (lower(trim(patron)));
create index category_rules_prioridad_idx on category_rules (prioridad, patron);

create trigger category_rules_touch before update on category_rules
    for each row execute function touch_updated_at();
