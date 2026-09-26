import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the global refresh button triggers the same manual email ingest as Inbox', async () => {
    const [mainSource, html] = await Promise.all([
        readFile(new URL('../main.js', import.meta.url), 'utf8'),
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
    ]);

    assert.match(mainSource,
        /refresh-btn'[\s\S]*?await bandeja_buscarAhora\(\{ button: event\.currentTarget \}\)/);
    assert.match(mainSource,
        /function bandeja_buscarAhora[\s\S]*?bandeja_api\('\/api\/ingest', \{ method: 'POST' \}\)/);
    assert.match(mainSource,
        /bandeja-refrescar'[\s\S]*?bandeja_buscarAhora\(\{ button: e\.currentTarget \}\)/);
    assert.match(mainSource, /if \(bandejaIngestPromise\) return bandejaIngestPromise/);
    assert.match(html, /aria-label="Buscar gastos y actualizar"/);
});
