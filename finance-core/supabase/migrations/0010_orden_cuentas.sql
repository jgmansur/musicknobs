-- Orden en que Jay quiere ver sus cuentas en el dashboard.
--
-- Antes se listaban alfabéticamente, que no dice nada: el orden útil es el
-- mental —primero donde tiene el dinero del día a día, luego el efectivo, luego
-- las tarjetas, y las inversiones al final—. Se guarda como dato y no en el
-- código para que reordenar no requiera un deploy.
--
-- `sort_order` bajo = más arriba. Las cuentas sin orden explícito quedan en 999
-- y se resuelven alfabéticamente entre ellas.
alter table accounts add column if not exists sort_order int not null default 999;

update accounts set sort_order = 1  where name = 'Santander';
update accounts set sort_order = 2  where name = 'BBVA';
update accounts set sort_order = 3  where name = 'Hey Banco';
update accounts set sort_order = 4  where name = 'Bank of America';
update accounts set sort_order = 5  where name = 'Mercado Pago Débito';
update accounts set sort_order = 6  where name = 'Efectivo';
update accounts set sort_order = 7  where name = 'Cuenta Mariel';
update accounts set sort_order = 8  where name = 'Tarjeta de Crédito LikeU';
update accounts set sort_order = 9  where name = 'Mercado Pago Crédito';
update accounts set sort_order = 10 where name = 'Kueski';
