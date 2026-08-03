/**
 * Categorización por comercio, compartida por el Worker y el MCP.
 *
 * Igual que `movimientos.js`: si el ingestor y el asistente usaran lógicas
 * distintas, el mismo gasto quedaría en una categoría diferente según quién lo
 * registró, y los reportes por categoría dejarían de ser confiables.
 */

/**
 * Normaliza para comparar: sin acentos, sin mayúsculas, sin espacios repetidos.
 * Los bancos escriben el mismo comercio de formas distintas ("Oxxo", "OXXO",
 * "OXXO  GAS"), y sin esto cada variante necesitaría su propia regla.
 */
export function normalizar(texto) {
    return (texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Busca la primera regla que aplique, por prioridad.
 *
 * Empatando prioridad gana el patrón más largo, porque es el más específico:
 * entre "uber" y "uber eats" sobre un cargo de Uber Eats, el segundo describe
 * mejor el gasto.
 *
 * @param {{merchant?: string, description?: string}} mov
 * @param {Array<{id?: string, patron: string, categoria: string, prioridad?: number}>} reglas
 * @returns {{regla: object, categoria: string}|null}
 */
export function categoriaPara(mov, reglas) {
    const texto = normalizar(`${mov.merchant ?? ''} ${mov.description ?? ''}`);
    if (!texto) return null;

    // Una regla vale para gastos, para ingresos o para ambos. "Mariel" no
    // significa lo mismo cuando le pagas que cuando ella te transfiere, y sin
    // esta distinción una sola regla mancharía las dos direcciones del dinero.
    const kind = mov.kind ?? 'gasto';
    const candidatas = reglas
        .filter((r) => (r.aplica_a ?? 'gasto') === 'ambos' || (r.aplica_a ?? 'gasto') === kind)
        .filter((r) => texto.includes(normalizar(r.patron)))
        .sort((a, b) => (a.prioridad ?? 100) - (b.prioridad ?? 100)
            || normalizar(b.patron).length - normalizar(a.patron).length);

    return candidatas.length ? { regla: candidatas[0], categoria: candidatas[0].categoria } : null;
}

/**
 * Propone reglas mirando el histórico ya categorizado.
 *
 * Solo propone cuando el comercio es consistente: si "OXXO" aparece con tres
 * categorías distintas, no hay regla que valga y hay que decidir a mano. Exigir
 * unanimidad evita ensuciar el histórico con una regla mal deducida.
 *
 * @param {Array<{merchant?: string, description?: string, category?: string}>} movimientos
 * @param {{minimo?: number}} opts  minimo de repeticiones para proponer
 */
export function aprenderReglas(movimientos, opts = {}) {
    const { minimo = 3 } = opts;
    const porComercio = new Map();

    for (const m of movimientos) {
        const clave = normalizar(m.merchant || m.description || '');
        if ((m.kind ?? 'gasto') !== (opts.kind ?? 'gasto')) continue;
        if (clave.length < 3) continue;
        if (!porComercio.has(clave)) porComercio.set(clave, { total: 0, categorias: new Map() });
        const e = porComercio.get(clave);
        e.total += 1;
        if (m.category) e.categorias.set(m.category, (e.categorias.get(m.category) ?? 0) + 1);
    }

    const propuestas = [];
    for (const [comercio, e] of porComercio) {
        if (e.total < minimo || e.categorias.size !== 1) continue;
        const [categoria, veces] = [...e.categorias][0];
        // Todas las apariciones categorizadas coinciden Y cubren la mayoría del
        // total: si la mitad está sin categoría, la evidencia es débil.
        if (veces < minimo || veces / e.total < 0.6) continue;
        propuestas.push({ patron: comercio, categoria, apariciones: e.total, coincidencias: veces });
    }
    return propuestas.sort((a, b) => b.apariciones - a.apariciones);
}
