import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODULOS_COMPARTIDOS, cuerpoGenerado } from '../../scripts/sync_shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(HERE, '..', '..', '..');
const CANONICO = join(RAIZ, 'finance-core', 'shared');
const COPIA = join(RAIZ, 'finance-dashboard', 'shared');

/**
 * Por qué existe este archivo.
 *
 * El dashboard no puede importar de `finance-core/shared/`: Vercel despliega
 * `finance-dashboard/` como raíz, así que todo lo que esté fuera de esa carpeta
 * no viaja al build. Durante un tiempo la salida fue copiar la lógica a mano y
 * dejar un comentario de "si tocas una, toca la otra".
 *
 * Eso ya iba en DOS módulos (`periodicidad` e `ids`), y un comentario no impide
 * nada: el día que alguien arregle un bug en una copia y no en la otra, hay dos
 * verdades y ninguna alarma. Justo el tipo de bug que no se ve hasta que las
 * cuentas ya salieron mal.
 *
 * Ahora la copia la genera `scripts/sync_shared.mjs` y esta prueba falla si las
 * dos versiones se separan. La duplicación sigue existiendo —la impone el
 * despliegue— pero deja de poder divergir en silencio.
 */

test('la carpeta compartida del dashboard existe', () => {
    assert.ok(existsSync(COPIA),
        `falta ${COPIA}: corre "node finance-core/scripts/sync_shared.mjs"`);
});

for (const modulo of MODULOS_COMPARTIDOS) {
    test(`${modulo} está sincronizado entre finance-core y el dashboard`, () => {
        const origen = readFileSync(join(CANONICO, modulo), 'utf8');
        const destino = join(COPIA, modulo);

        assert.ok(existsSync(destino),
            `falta la copia de ${modulo}: corre "node finance-core/scripts/sync_shared.mjs"`);

        assert.equal(
            readFileSync(destino, 'utf8'),
            cuerpoGenerado(modulo, origen),
            `${modulo} divergió. NO edites la copia del dashboard: cambia\n`
            + `  finance-core/shared/${modulo}\n`
            + 'y corre "node finance-core/scripts/sync_shared.mjs".',
        );
    });
}

test('la copia se marca como generada, para que nadie la edite a mano', () => {
    for (const modulo of MODULOS_COMPARTIDOS) {
        const texto = readFileSync(join(COPIA, modulo), 'utf8');
        assert.match(texto, /GENERADO/,
            `${modulo} no lleva la marca de archivo generado`);
    }
});
