#!/usr/bin/env node
/**
 * Copia los módulos compartidos de `finance-core/shared/` al dashboard.
 *
 * POR QUÉ HACE FALTA
 *
 * El dashboard no puede importar de `finance-core/shared/`. Vercel despliega
 * `finance-dashboard/` como raíz y el deploy corre desde dentro de esa carpeta,
 * así que nada de afuera viaja al build: un `import '../finance-core/...'`
 * rompe la compilación.
 *
 * La salida durante un tiempo fue copiar la lógica a mano con un comentario de
 * "si tocas una, toca la otra". Eso ya iba en dos módulos, y un comentario no
 * impide nada: el día que alguien arregle un bug en una copia y no en la otra
 * hay dos verdades y ninguna alarma.
 *
 * Ahora la copia es MECÁNICA y `worker/src/shared-sync.test.js` falla si las
 * versiones se separan. La duplicación sigue —la impone el despliegue— pero ya
 * no puede divergir en silencio.
 *
 * QUÉ PUEDE ENTRAR AQUÍ
 *
 * Solo módulos SIN dependencias: se copian tal cual, así que un `import` a otro
 * archivo de `shared/` quedaría roto del lado del dashboard. Si algún día hace
 * falta uno con dependencias, hay que copiar el árbol completo, no parchar.
 *
 * USO
 *   node finance-core/scripts/sync_shared.mjs          escribe las copias
 *   node finance-core/scripts/sync_shared.mjs --check  solo avisa si divergen
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(HERE, '..', '..');
const CANONICO = join(RAIZ, 'finance-core', 'shared');
const COPIA = join(RAIZ, 'finance-dashboard', 'shared');

/** Módulos que el dashboard necesita. Puros, sin imports entre ellos. */
export const MODULOS_COMPARTIDOS = ['ids.js', 'periodicidad.js'];

/**
 * El contenido exacto que debe tener la copia.
 *
 * La prueba de sincronía usa esta misma función, así que el formato del
 * encabezado no puede desincronizarse del que se valida.
 */
export function cuerpoGenerado(nombre, fuente) {
    return `/* ⚠️  ARCHIVO GENERADO — NO LO EDITES A MANO.
 *
 * Copia de finance-core/shared/${nombre}.
 * Para cambiarlo: edita ese archivo y corre
 *   node finance-core/scripts/sync_shared.mjs
 *
 * Existe porque Vercel despliega finance-dashboard/ como raíz y no puede
 * importar de fuera de esa carpeta. La prueba worker/src/shared-sync.test.js
 * falla si esta copia se separa del original.
 */
${fuente}`;
}

function main() {
    const soloRevisar = process.argv.includes('--check');
    if (!existsSync(COPIA)) mkdirSync(COPIA, { recursive: true });

    const divergentes = [];
    for (const nombre of MODULOS_COMPARTIDOS) {
        const fuente = readFileSync(join(CANONICO, nombre), 'utf8');
        const esperado = cuerpoGenerado(nombre, fuente);
        const destino = join(COPIA, nombre);
        const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : null;

        if (actual === esperado) {
            console.log(`  = ${nombre}`);
            continue;
        }
        divergentes.push(nombre);
        if (soloRevisar) {
            console.log(`  ✗ ${nombre} divergió`);
        } else {
            writeFileSync(destino, esperado);
            console.log(`  → ${nombre} actualizado`);
        }
    }

    if (soloRevisar && divergentes.length) {
        console.error(
            `\n${divergentes.length} módulo(s) fuera de sincronía. `
            + 'Corre: node finance-core/scripts/sync_shared.mjs',
        );
        process.exit(1);
    }
    console.log(divergentes.length ? '\nListo.' : '\nTodo sincronizado.');
}

// Solo corre si se invoca directamente; importarlo desde la prueba no debe
// escribir nada en disco.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
