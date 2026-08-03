-- Catálogos que dejan de vivir en Google Sheets: autos, estudio y recetas.
--
-- Los tres son inventarios, no movimientos, pero SÍ generan gastos: una
-- reparación, un plugin nuevo o una consulta médica terminan en `transactions`.
-- Ese vínculo ya se hace con el id del movimiento (antes era un marcador de
-- texto dentro del concepto), y aquí se guarda en `transaction_id`.
--
-- Los archivos (fotos, facturas, pólizas, recetas escaneadas) NO se guardan
-- aquí: siguen en Google Drive y estas tablas solo apuntan a la URL. Una base
-- guarda datos, los archivos viven en el disco.
--
-- Cada tabla conserva la llave de texto que tenía en la hoja (`legacy_key`)
-- porque las filas se referencian entre sí con ella —una reparación apunta a
-- su auto con 'car-1774145155747-2'— y remapear todo a UUID durante la
-- migración era un riesgo sin ganancia.

-- ── Autos ────────────────────────────────────────────────────────────────
create table cars (
    id                    uuid primary key default gen_random_uuid(),
    legacy_key            text unique,
    marca                 text not null,
    modelo                text not null,
    anio                  text,
    valor_factura         numeric(14, 2),
    kilometraje           numeric(12, 0),
    propietario           text,
    tiene_seguro          boolean not null default false,
    placa                 text,
    vin                   text,

    -- Seguro y tenencia
    poliza_seguro         text,
    vencimiento_poliza    date,
    vencimiento_tenencia  date,
    pago_tenencia         numeric(14, 2),
    proxima_revision_km   numeric(12, 0),
    contrato_prestamo     text,

    -- Teléfonos
    emergencia_interior   text,
    emergencia_metro      text,
    reporte_siniestros_1  text,
    reporte_siniestros_2  text,

    tipo_llantas          text,

    -- Archivos: todos son URLs de Drive, no binarios.
    foto_auto             text,
    factura_archivo       text,
    poliza_archivo        text,
    tarjeta_frente        text,
    tarjeta_atras         text,
    llantas_foto          text,
    certificado_polarizado text,
    tabla_pagos           text,
    tabla_pagos_seguro    text,
    extra_doc_1_nombre    text,
    extra_doc_1_url       text,
    extra_doc_2_nombre    text,
    extra_doc_2_url       text,

    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create table car_repairs (
    id             uuid primary key default gen_random_uuid(),
    legacy_key     text unique,
    car_id         uuid not null references cars (id) on delete cascade,
    reparacion     text not null,
    costo          numeric(14, 2) not null default 0,
    moneda         text not null default 'MXN',
    lugar          text,
    fecha          date,
    descripcion    text,
    forma_pago     text,
    foto           text,
    recibo         text,

    -- El gasto que generó esta reparación. Antes se localizaba buscando un
    -- marcador de texto dentro del concepto en la hoja de gastos.
    transaction_id uuid references transactions (id) on delete set null,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index car_repairs_car_idx   on car_repairs (car_id);
create index car_repairs_fecha_idx on car_repairs (fecha desc);

-- ── Estudio ──────────────────────────────────────────────────────────────
create table studio_gear (
    id             uuid primary key default gen_random_uuid(),
    legacy_key     text unique,

    -- 'equipo' (inventario físico) o 'plugin' (software). Comparten casi todas
    -- las columnas y la misma lógica de gasto, así que una sola tabla con
    -- discriminador evita duplicar endpoints.
    tipo           text not null check (tipo in ('equipo', 'plugin')),

    name           text not null,
    marca          text,
    modelo         text,
    descripcion    text,
    categoria      text,
    cantidad       int not null default 1,
    precio_usd     numeric(14, 2),
    currency       text not null default 'USD',
    anio_compra    text,
    fecha_compra   date,
    site           text,
    serial         text,
    licencia       text,
    account        text,
    notas          text,
    forma_pago     text,
    foto           text,

    transaction_id uuid references transactions (id) on delete set null,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index studio_gear_tipo_idx on studio_gear (tipo);

-- ── Recetas médicas ──────────────────────────────────────────────────────
create table prescriptions (
    id                uuid primary key default gen_random_uuid(),
    legacy_key        text unique,
    member            text not null,
    fecha             date,
    doctor            text,
    especialidad      text,
    diagnostico       text,

    -- Lista de longitud variable {nombre, dosis, frecuencia, duracion}. No se
    -- normaliza a tabla aparte porque nunca se consulta por medicamento: se lee
    -- siempre junto con su receta.
    medicamentos      jsonb not null default '[]'::jsonb,

    indicaciones      text,
    proxima_cita      date,
    vigencia_hasta    date,
    notas             text,

    -- Dos recetas escaneadas y el recibo de la consulta, todos en Drive.
    foto_url          text,
    foto_url_2        text,
    recibo_url        text,

    monto_consulta    numeric(14, 2),
    forma_pago        text,
    transaction_id    uuid references transactions (id) on delete set null,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index prescriptions_member_idx on prescriptions (member);
create index prescriptions_fecha_idx  on prescriptions (fecha desc);
