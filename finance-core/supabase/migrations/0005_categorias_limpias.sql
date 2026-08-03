-- Una categoría por movimiento.
--
-- El campo `categoria` de los gastos fijos guardaba listas de etiquetas de dos
-- ejes mezclados: para quién es (Familia, Trabajo) y de qué se trata (Casa,
-- Educación, Suscripción). Ejemplos reales:
--
--     "Familia, Casa, Educación, Salud y Deportes"
--     "Trabajo, Suscripción, Producción Musical"
--     "__tipo_gasto, Trabajo, Suscripción"   ← token del filtro de la UI, filtrado a los datos
--
-- Con eso no se puede reportar: un movimiento no puede estar en cuatro cubetas.
-- Jay decidió una categoría por movimiento.
--
-- Las reglas mecánicas no sirvieron. Probada "quédate con la última etiqueta",
-- Amazon Prime y Netflix acababan en Casa. La asignación se hizo leyendo el
-- concepto de cada grupo, y usando SOLO etiquetas que ya existían: no se inventó
-- vocabulario nuevo.
--
-- Los valores originales quedaron en `fixed_expenses_categoria_backup` por si
-- alguna asignación hay que corregirla.

create table if not exists fixed_expenses_categoria_backup (
    fixed_expense_id  uuid primary key references fixed_expenses (id) on delete cascade,
    categoria_original text,
    guardado_at       timestamptz not null default now()
);

insert into fixed_expenses_categoria_backup (fixed_expense_id, categoria_original)
select id, categoria from fixed_expenses where categoria is not null
on conflict (fixed_expense_id) do nothing;

update fixed_expenses set categoria = m.nueva
from (values
    ('Familia, Casa',                                      'Casa'),              -- Agua, Gas, Luz, Alberca
    ('Trabajo, Suscripción, Producción Musical',           'Suscripción'),       -- Dropbox, Protools, Suno
    ('Familia, Trabajo',                                   'Trabajo'),           -- Gasolina y seguro del Taos
    ('Familia',                                            'Familia'),           -- Aporte de mamá, rentas
    ('Familia, Casa, Educación, Salud y Deportes',         'Salud y Deportes'),  -- Futbol, gimnasia, padel
    ('Trabajo',                                            'Trabajo'),           -- Contador, Telcel
    ('Familia, Educación, Salud y Deportes',               'Salud y Deportes'),  -- Pádel y terapias de Roby
    ('Familia, Ocio, Suscripción, Casa',                   'Suscripción'),       -- Amazon Prime, Netflix
    ('Familia, Salud y Deportes',                          'Salud y Deportes'),
    ('Trabajo, Suscripción',                               'Suscripción'),       -- Canva, Gemini
    ('Familia, Casa, Educación',                           'Educación'),         -- Escuelas
    ('Trabajo, Suscripción, Educación, Producción Musical','Suscripción'),       -- ChatGPT, YouTube Premium
    ('General',                                            'General'),
    ('Ocio',                                               'Ocio'),
    ('Propiedades, Mantenimiento',                         'Propiedades'),
    ('Suscripción',                                        'Suscripción'),
    ('Deudas',                                             'Deudas'),
    ('Familia, Trabajo, Ocio, Suscripción',                'Suscripción'),       -- Apple One
    ('Familia, Inversión',                                 'Inversión'),
    ('__tipo_gasto, Trabajo, Suscripción',                 'Suscripción'),       -- Claude AI
    ('Familia, Trabajo, Casa',                             'Familia'),           -- Sueldo de Mariel
    ('Familia, Trabajo, Casa, Producción Musical',         'Casa'),              -- Starlink
    ('Familia, Educación',                                 'Educación')          -- Clases de piano
) as m(vieja, nueva)
where fixed_expenses.categoria = m.vieja;

-- Los pagos de fijos ya registrados heredan la categoría de su fijo. La
-- migración desde la hoja no copiaba este campo, así que 112 movimientos
-- históricos habían quedado sin categoría.
update transactions t set category = f.categoria
from fixed_expenses f
where t.fixed_expense_id = f.id and t.category is null and f.categoria is not null;

update transactions t set category = f.categoria
from fixed_expenses f
where t.category is null and t.merchant = 'Gasto Fijo'
  and f.categoria is not null
  and t.description like f.concepto || ' (%';
