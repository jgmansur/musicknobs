import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'index.js'), 'utf8');

/**
 * Un método ausente de `access-control-allow-methods` hace que el navegador
 * bloquee la petición aunque el preflight responda 204, y el error que llega al
 * usuario es un genérico "no se pudo guardar" que no menciona el método.
 *
 * Pasó dos veces: primero con el preflight devolviendo 500, luego con PUT,
 * PATCH y DELETE sin declarar. Esta prueba lee las rutas del propio worker y
 * exige que la cabecera las cubra, así que no hay que acordarse de nada.
 */
test('CORS declara todos los métodos que la API atiende', () => {
    const usados = new Set(
        [...source.matchAll(/request\.method === '([A-Z]+)'/g)].map((m) => m[1]),
    );
    assert.ok(usados.size > 0, 'no se encontró ninguna ruta: ¿cambió la forma de enrutar?');

    const cabecera = /'access-control-allow-methods':\s*'([^']+)'/.exec(source);
    assert.ok(cabecera, 'falta la cabecera access-control-allow-methods');
    const declarados = new Set(cabecera[1].split(',').map((s) => s.trim()));

    const faltantes = [...usados].filter((m) => !declarados.has(m));
    assert.deepEqual(
        faltantes, [],
        `estos métodos se atienden pero no están declarados en CORS: ${faltantes.join(', ')}`,
    );
    assert.ok(declarados.has('OPTIONS'), 'OPTIONS debe estar declarado para el preflight');
});

test('el preflight responde sin cuerpo', () => {
    // Un 204 con cuerpo hace que el runtime tire 500 y el navegador aborte.
    assert.match(
        source,
        /new Response\(null,\s*\{\s*status:\s*204/,
        'el preflight debe devolver `new Response(null, { status: 204, ... })`',
    );
});
