/* ⚠️  ARCHIVO GENERADO — NO LO EDITES A MANO.
 *
 * Copia de finance-core/shared/periodicidad.js.
 * Para cambiarlo: edita ese archivo y corre
 *   node finance-core/scripts/sync_shared.mjs
 *
 * Existe porque Vercel despliega finance-dashboard/ como raíz y no puede
 * importar de fuera de esa carpeta. La prueba worker/src/shared-sync.test.js
 * falla si esta copia se separa del original.
 */
/**
 * Cada cuántos meses toca pagar un gasto fijo.
 *
 * Vivía solo en el dashboard, y el backend lo ignoraba por completo: la lista
 * de "fijos que faltan este mes" devolvía TODOS los activos, tocara o no. Con
 * un solo fijo bimestral (Luz Casa Galería) eso ya inflaba el total $3,000 en
 * los meses impares. Con semestrales y anuales el error sería mucho peor: un
 * gasto anual aparecería pendiente once meses de cada doce.
 *
 * El paso de meses es el único parámetro que cambia entre periodicidades, así
 * que se declara en una tabla en vez de encadenar ifs. Agregar "trimestral"
 * mañana es una línea aquí y una opción en el HTML.
 *
 * OJO: el dashboard mantiene su propia copia de esta lógica. No es descuido —
 * Vercel despliega `finance-dashboard/` como raíz, así que un import a
 * `../finance-core/shared/` quedaría fuera del paquete y rompería el build. Si
 * se toca una, hay que tocar la otra.
 */

/** Meses entre pago y pago. `null` = no sigue un ciclo de calendario. */
export const PERIODICIDADES = {
    mensual: 1,
    bimestral: 2,
    trimestral: 3,
    semestral: 6,
    anual: 12,
    'Cuota de Deuda': null,
};

/**
 * Lleva cualquier valor guardado a una periodicidad conocida.
 *
 * Cae en 'mensual' ante lo desconocido a propósito: mostrar de más un fijo es
 * molesto, pero esconderlo hace que Jay no lo pague. El error tiene que doler
 * del lado seguro.
 */
export function normalizarPeriodicidad(val) {
    const raw = (val ?? '').toString().trim().toLowerCase();
    if (raw === 'cuota de deuda') return 'Cuota de Deuda';
    return Object.hasOwn(PERIODICIDADES, raw) ? raw : 'mensual';
}

/** Meses completos entre dos 'YYYY-MM'. Negativo si el segundo es anterior. */
export function diferenciaEnMeses(desdeYm, hastaYm) {
    const [dy, dm] = String(desdeYm).split('-').map(Number);
    const [hy, hm] = String(hastaYm).split('-').map(Number);
    if (![dy, dm, hy, hm].every(Number.isFinite)) return null;
    return (hy - dy) * 12 + (hm - dm);
}

/**
 * ¿Este gasto fijo toca en `mesActual`?
 *
 * `mesInicio` es el primer mes CON pago, y desde ahí se cuenta el ciclo. Sin
 * mes de inicio no hay ciclo que contar, así que se asume que toca: vale más
 * que Jay lo vea y lo salte, a que se le pase un pago.
 */
export function tocaEsteMes(periodicidad, mesInicio, mesActual) {
    const p = normalizarPeriodicidad(periodicidad);

    // Una cuota de deuda no sigue el calendario: se paga hasta liquidarla.
    if (p === 'Cuota de Deuda') {
        const d = diferenciaEnMeses(mesInicio, mesActual);
        return d === null ? true : d >= 0;
    }

    const cada = PERIODICIDADES[p];
    if (cada === 1) return true;

    const diff = diferenciaEnMeses(mesInicio, mesActual);
    if (diff === null) return true;
    // Antes de empezar todavía no toca.
    if (diff < 0) return false;
    return diff % cada === 0;
}
