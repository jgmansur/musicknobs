/**
 * Resolución del campo "Lugar" contra el catálogo, compartida por Worker y MCP.
 *
 * El banco manda el comercio con ruido de sucursal y de procesador de pago:
 * "OXXO ZAVALA QRF", "DLO*UBER EATS", "D LOCAL*STARLINK CIUDAD DE MEXDF". Sin
 * normalizar, cada sucursal cuenta como un lugar distinto y no hay reporte que
 * sirva.
 *
 * `merchant` guarda el nombre canónico; `merchant_raw` conserva el original,
 * que sigue haciendo falta para depurar y para afinar los alias.
 */

import { normalizar } from './categorias.js';

/**
 * Encuentra el lugar canónico para un texto crudo del banco.
 *
 * Gana el alias más largo que aparezca en el texto: entre "oxxo" y "oxxo gas"
 * sobre "OXXO GAS PIPILA", el segundo describe mejor dónde se gastó.
 *
 * @param {string} crudo
 * @param {Array<{id?: string, nombre: string, aliases?: string[]}>} catalogo
 * @returns {{lugar: object, nombre: string}|null}
 */
export function lugarPara(crudo, catalogo) {
    const texto = normalizar(crudo);
    if (!texto) return null;

    let mejor = null;
    let largo = 0;
    for (const lugar of catalogo) {
        // El nombre canónico también funciona como alias implícito.
        const candidatos = [lugar.nombre, ...(lugar.aliases ?? [])];
        for (const a of candidatos) {
            const alias = normalizar(a);
            if (alias.length >= 3 && texto.includes(alias) && alias.length > largo) {
                mejor = lugar;
                largo = alias.length;
            }
        }
    }
    return mejor ? { lugar: mejor, nombre: mejor.nombre } : null;
}

/**
 * Agrupa los textos crudos que no encontraron lugar, para poder darlos de alta
 * en bloque en vez de uno por uno.
 */
export function sinCatalogar(crudos, catalogo) {
    const conteo = new Map();
    for (const c of crudos) {
        if (!c || lugarPara(c, catalogo)) continue;
        conteo.set(c, (conteo.get(c) ?? 0) + 1);
    }
    return [...conteo].map(([crudo, n]) => ({ crudo, n })).sort((a, b) => b.n - a.n);
}
