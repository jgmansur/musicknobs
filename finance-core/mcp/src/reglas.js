/**
 * Reglas de negocio de las finanzas de Jay.
 *
 * Hasta ahora vivían en la memoria del asistente, lo que las hacía frágiles:
 * si el asistente cambiaba o no estaba, las reglas dejaban de existir y
 * cualquier IA podía escribir datos incoherentes. Aquí son código, con sus
 * validaciones, y se aplican sin importar quién llame.
 */

/** Cuentas propias: mover dinero entre ellas nunca es gasto. */
export const CUENTAS_PROPIAS = [
    'Santander', 'BBVA', 'Hey Banco', 'Bank of America',
    'Tarjeta de Crédito LikeU', 'Cetes', 'MiFel', 'Bitcoin',
];

/**
 * Formas de pago que NO son cuentas propias. Un gasto pagado así sí sale del
 * patrimonio de Jay, pero no descuenta de ninguna de sus cuentas.
 *
 * "Cuenta Mariel" es el caso típico: es un gasto normal, no una transferencia.
 */
export const PAGADORES_EXTERNOS = ['Cuenta Mariel', 'Efectivo'];

/** Los 6 buckets del planner. Un fijo fuera de esta lista queda invisible ahí. */
export const BUDGET_BUCKETS = [
    'Seguros',
    'Gasolina y Autos',
    'Super',
    'Mantenimiento y Pago de Servicios',
    'Muchachas y Pago de Deudas',
    'Suscripciones (Hey)',
];

/**
 * Convierte un monto a la convención de signo del sistema: el flujo de efectivo
 * visto desde la cuenta. Negativo = sale dinero.
 *
 * En tarjetas de crédito una compra es negativa porque crece la deuda; la vista
 * `account_balances` la vuelve a mostrar positiva para leerla como deuda.
 */
export function montoConSigno(monto, tipo) {
    const magnitud = Math.abs(Number(monto));
    if (!Number.isFinite(magnitud) || magnitud === 0) {
        throw new Error('El monto debe ser un número distinto de cero.');
    }
    return tipo === 'ingreso' ? magnitud : -magnitud;
}

/**
 * Valida un gasto o ingreso antes de escribirlo.
 * Devuelve la lista de problemas; vacía significa que se puede guardar.
 */
export function validarMovimiento({ cuenta, monto, tipo, concepto, categoria }) {
    const problemas = [];

    if (!cuenta) {
        problemas.push('Falta la cuenta o forma de pago. Nunca registres un movimiento sin ella.');
    }
    if (!Number.isFinite(Number(monto)) || Number(monto) === 0) {
        problemas.push('El monto debe ser un número distinto de cero.');
    }
    if (!['gasto', 'ingreso'].includes(tipo)) {
        problemas.push("El tipo debe ser 'gasto' o 'ingreso'.");
    }
    if (!concepto || !concepto.trim()) {
        problemas.push('Falta el concepto: sin él el movimiento es inútil para analizar después.');
    }

    // Regla propia de Jay: las reparaciones de autos siempre llevan forma de pago
    // explícita, incluso cuando el auto es de un tercero, porque el gasto es suyo.
    if (/reparaci[óo]n|taller|mec[áa]nico|llanta|afinaci[óo]n/i.test(`${concepto} ${categoria ?? ''}`)
        && !cuenta) {
        problemas.push('Las reparaciones de autos siempre requieren forma de pago.');
    }

    return problemas;
}

/** Palabras que sugieren un movimiento entre cuentas propias. */
const VERBOS_TRANSFERENCIA = /transferenc|traspas|fonde|dep[óo]sito a mi|mov[íi] a|pas[ée] a/i;

/**
 * Detecta el error más caro de este dominio: registrar como gasto un movimiento
 * entre dos cuentas propias. Duplica el dinero, porque el gasto real aparece
 * después cuando se usa la cuenta destino.
 *
 * El caso vivo: Jay transfiere de Santander a Hey para fondear la tarjeta de
 * suscripciones. Eso no es un gasto, es cambiar de bolsillo.
 *
 * Devuelve el nivel de evidencia, porque la respuesta correcta es distinta:
 *
 *   'certeza'  — se identificó la cuenta destino y es de Jay. Se BLOQUEA: no
 *                existe un caso legítimo donde esto sea un gasto.
 *   'sospecha' — el texto suena a traspaso pero no se identificó destino. Solo
 *                se ADVIERTE, porque un gasto real puede decir "traspaso" y
 *                bloquearlo sería estorbar sin fundamento.
 *
 * @param {{cuenta: string, destino?: string|null, concepto?: string,
 *          comercio?: string, cuentasPropias?: string[]}} args
 * @returns {{nivel: 'certeza'|'sospecha', mensaje: string, destino?: string}|null}
 */
export function detectarTransferencia({
    cuenta, destino = null, concepto = '', comercio = '', cuentasPropias = CUENTAS_PROPIAS,
}) {
    const propias = cuentasPropias.filter(Boolean);
    const esPropia = (n) => propias.some((p) => p.toLowerCase() === (n ?? '').toLowerCase());

    // Destino declarado explícitamente: la evidencia más fuerte.
    if (destino && esPropia(destino) && esPropia(cuenta)) {
        return {
            nivel: 'certeza',
            destino,
            mensaje: `${cuenta} y ${destino} son cuentas tuyas: esto es una transferencia, no un `
                + 'gasto. Regístralo con finanzas_transferencia para que el dinero no cuente doble.',
        };
    }

    const texto = `${concepto} ${comercio}`.toLowerCase();

    // Destino deducido: el texto nombra otra cuenta propia Y suena a traspaso.
    // Una de las dos señales sola no basta — "pagué el súper con Santander"
    // nombra una cuenta sin ser transferencia.
    if (VERBOS_TRANSFERENCIA.test(texto)) {
        const mencionada = propias.find(
            (p) => p.toLowerCase() !== (cuenta ?? '').toLowerCase()
                && texto.includes(p.toLowerCase()),
        );
        if (mencionada && esPropia(cuenta)) {
            return {
                nivel: 'certeza',
                destino: mencionada,
                mensaje: `El concepto menciona "${mencionada}", que es otra cuenta tuya: esto es `
                    + 'una transferencia, no un gasto. Usa finanzas_transferencia.',
            };
        }
        return {
            nivel: 'sospecha',
            mensaje: 'El concepto suena a transferencia entre cuentas propias. Si lo es, usa '
                + 'finanzas_transferencia; si el dinero sí salió de tu patrimonio, ignora esto.',
        };
    }
    return null;
}

/**
 * Construye el mensaje de una búsqueda ambigua.
 *
 * Elegir la primera coincidencia en silencio puede registrar un movimiento en
 * la cuenta equivocada, y nadie se entera hasta que los saldos no cuadran.
 */
export function ambiguedad(termino, opciones, queEs = 'cuenta') {
    return `"${termino}" coincide con ${opciones.length} ${queEs}s y no voy a elegir por ti:\n`
        + opciones.map((o) => `  - ${o}`).join('\n')
        + '\n\nRepite la llamada con el nombre exacto.';
}
