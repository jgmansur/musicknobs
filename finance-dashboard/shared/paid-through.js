/* ⚠️  ARCHIVO GENERADO — NO LO EDITES A MANO.
 *
 * Copia de finance-core/shared/paid-through.js.
 * Para cambiarlo: edita ese archivo y corre
 *   node finance-core/scripts/sync_shared.mjs
 *
 * Existe porque Vercel despliega finance-dashboard/ como raíz y no puede
 * importar de fuera de esa carpeta. La prueba worker/src/shared-sync.test.js
 * falla si esta copia se separa del original.
 */
/**
 * Normaliza una fecha sin hora. Postgres puede devolver `date` como texto y
 * algunos clientes como ISO completo; aquí solo importa YYYY-MM-DD.
 */
export function normalizarFecha(fecha) {
    const raw = (fecha ?? '').toString().trim().slice(0, 10);
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [, y, mes, dia] = m.map(Number);
    const d = new Date(Date.UTC(y, mes - 1, dia));
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
        return null;
    }
    return raw;
}

/** Fecha local del dispositivo, sin el desfase que introduce toISOString(). */
export function fechaLocal(fecha = new Date()) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * "Pagado hasta" es inclusivo: el gasto vuelve a estar pendiente al día
 * siguiente de la fecha guardada.
 */
export function estaPagadoHasta(fechaLimite, fechaReferencia = fechaLocal()) {
    const limite = normalizarFecha(fechaLimite);
    const referencia = normalizarFecha(fechaReferencia);
    return !!limite && !!referencia && limite >= referencia;
}

/** Último día de un mes YYYY-MM, útil para consultas mensuales históricas. */
export function ultimoDiaDelMes(mes) {
    const m = (mes ?? '').toString().trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const n = Number(m[2]);
    if (n < 1 || n > 12) return null;
    const dia = new Date(Date.UTC(y, n, 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(dia).padStart(2, '0')}`;
}
