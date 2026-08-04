-- Orden de las deudas en el dashboard.
--
-- Antes, "subir" o "bajar" una deuda INTERCAMBIABA el contenido entre dos
-- filas y dejaba los ids en su sitio. Era un truco válido cuando el id era el
-- número de fila de la hoja. Con UUID el id identifica a la ENTIDAD, así que
-- intercambiar contenido movía los datos de una deuda al registro de la otra:
-- las cuotas (debt_installments) y las relaciones padre/hijo (debt_key /
-- parent_key) se quedaban apuntando al registro equivocado.
--
-- Con una columna de orden, mover una deuda solo cambia este número.
alter table debts add column if not exists sort_order int not null default 999;

-- Se siembra con el orden actual de creación para no alterar lo que Jay ve hoy.
with orden as (
    select id, row_number() over (order by created_at, concepto) as n from debts
)
update debts d set sort_order = orden.n from orden where orden.id = d.id;
