-- Segunda vía para identificar a un beneficiario: el nombre como lo escribe el
-- banco.
--
-- 0007 asumió que "last4 es lo único que el banco revela en el aviso". Eso vale
-- para Santander, que manda "a la cuenta terminación 1791". BBVA NO: sus avisos
-- dicen "Beneficiario: CAMPOS FIGUEROA" y no incluyen la terminación por ningún
-- lado. Como la resolución del beneficiario exigía last4, toda transferencia
-- hecha desde BBVA caía como "Transferencia" anónima, sin persona ni gasto fijo
-- ligado, aunque el beneficiario estuviera registrado.
--
-- `nombre` es como Jay llama a la persona ("Mariel"); `nombre_banco` es como la
-- escribe el banco ("DE LA ROSA GARCIA MARIEL"). Casi nunca coinciden, por eso
-- son columnas distintas y no se intenta adivinar una a partir de la otra.

alter table payees add column if not exists nombre_banco text;

comment on column payees.nombre_banco is
    'Nombre del titular tal como lo escribe el banco en el aviso. Lo usan los '
    'avisos de BBVA, que dan nombre en vez de terminación de cuenta.';

-- Búsqueda insensible a mayúsculas y acentos desde el ingest.
create index if not exists payees_nombre_banco_idx
    on payees (lower(nombre_banco));
