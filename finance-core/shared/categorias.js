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

/**
 * Prioridad de las reglas nacidas de una corrección de Jay.
 *
 * Por debajo de la default (100) a propósito: si él dice que "UBER EATS" es
 * Comida, eso tiene que ganarle a una regla general "UBER" → Transporte sin
 * depender de en qué orden se insertaron.
 */
const PRIORIDAD_CORRECCION = 50;

/** Palabras que solo describen la sucursal o la plaza, nunca el negocio. */
const RUIDO_DE_SUCURSAL = new Set([
    'sa', 'de', 'cv', 'sab', 'sapi', 'mexico', 'mx', 'cdmx', 'qrf', 'qro',
    'suc', 'sucursal', 'plaza', 'centro', 'norte', 'sur', 'nte', 'pva',
]);

/**
 * Procesadoras de pago que se anteponen al comercio real.
 *
 * "DLO*UBER EATS" es dLocal cobrando por Uber Eats; "STR*TELCEL" es Stripe
 * cobrando por Telcel. Quedarse con la procesadora aprende justo al revés:
 * agruparía Uber Eats con Telcel por compartir intermediario, y no reconocería
 * a Uber Eats el día que cobre por otra vía.
 */
const PROCESADORAS = new Set([
    'dlo', 'dlocal', 'str', 'stripe', 'paypal', 'ebanx', 'sq', 'square',
    'mercadopago', 'mp', 'clip', 'openpay', 'conekta', 'recurrente',
]);

/**
 * Convierte una corrección explícita de Jay en una regla comercio → categoría.
 *
 * Aprobar en la bandeja no dejaba ninguna huella: Jay podía categorizar el
 * mismo comercio cincuenta veces y a la cincuentaiuna la app seguía sin saber
 * qué era. Cada clic era trabajo que no se capitalizaba en nada.
 *
 * Una corrección vale MÁS que una inferencia sobre el histórico: no es una
 * estadística, es una persona diciendo "esto es esto". Por eso basta una sola,
 * mientras que `aprenderReglas` exige varias repeticiones sin contradicción.
 *
 * Lo delicado es el patrón. El banco manda ruido de sucursal —"OXXOGRAND PVA",
 * "OXXO ZAVALA QRF"— y guardar el comercio completo daría una regla que solo
 * sirve para esa tienda. Se recorta a las primeras palabras con significado.
 *
 * Devuelve `null` cuando no hay nada que aprender, en vez de una regla mala:
 * una regla equivocada mal-categoriza en silencio todo lo que venga después.
 */
export function reglaDesdeCorreccion({ merchant, categoria, kind = 'gasto' }) {
    // Un traspaso entre cuentas propias no tiene categoría de consumo: mover
    // dinero de Santander a Hey no es un concepto de gasto.
    if (kind === 'transfer') return null;
    if (!categoria || !String(categoria).trim()) return null;

    const limpio = normalizar(merchant);
    if (limpio.length < 3) return null;

    // Se conservan las primeras dos palabras útiles: suficiente para
    // identificar el negocio ("uber eats", "farmacia guadalajara") y corto
    // como para valer en todas sus sucursales.
    const palabras = limpio
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length >= 2 && !RUIDO_DE_SUCURSAL.has(p) && !/^\d+$/.test(p));

    // Se quita la procesadora solo si detrás queda un comercio de verdad. Si es
    // lo único que hay ("PAYPAL" a secas), vale más un patrón mediocre que
    // ninguno.
    const sinProcesadora = palabras.filter((p) => !PROCESADORAS.has(p));
    const utiles = sinProcesadora.length ? sinProcesadora : palabras;

    const patron = (utiles.slice(0, 2).join(' ') || limpio).trim();
    if (patron.length < 3) return null;

    return {
        patron,
        categoria: String(categoria).trim(),
        prioridad: PRIORIDAD_CORRECCION,
        aplica_a: kind === 'ingreso' ? 'ingreso' : 'gasto',
        origen: 'correccion',
    };
}
