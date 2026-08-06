-- Las reglas de categoría podían nacer de dos formas: 'manual' (alguien la
-- escribió) o 'aprendida' (salió de observar el histórico). Falta la tercera,
-- que es la más valiosa: la que nace de una CORRECCIÓN de Jay en la bandeja.
--
-- Vale más que 'aprendida' porque no es una inferencia estadística sobre el
-- pasado, es una persona diciendo "esto es esto". Por eso basta una sola
-- corrección para crearla, mientras que el aprendizaje pasivo exige varias
-- repeticiones sin contradicción.
--
-- Se distingue en su propio valor y no se mete dentro de 'manual' porque son
-- cosas distintas al revisarlas: una regla manual se escribió pensándola en
-- frío; una corrección salió de un movimiento real mal clasificado. Cuando haya
-- que auditar por qué algo quedó en cierta categoría, el origen es la pista.

alter table category_rules drop constraint if exists category_rules_origen_check;

alter table category_rules
    add constraint category_rules_origen_check
    check (origen in ('manual', 'aprendida', 'correccion'));

-- Un mismo patrón no debe existir dos veces: la segunda nunca se aplicaría y
-- solo confundiría al revisar. Hace falta ahora que las reglas se crean solas
-- desde el ingest y desde las correcciones, sin nadie mirando.
--
-- Se normaliza a minúsculas porque `categoriaPara` compara sin distinguir
-- mayúsculas: "OXXO" y "oxxo" son la misma regla.
create unique index if not exists category_rules_patron_aplica_uniq
    on category_rules (lower(trim(patron)), aplica_a);
