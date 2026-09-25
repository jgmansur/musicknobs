export const SIN_CATEGORIA = 'Sin categoría';

/**
 * Cada fijo aporta a un solo total para que el desglose nunca duplique dinero.
 * Las etiquetas internas de filtros no son categorías financieras.
 */
export function categoriaPrincipalFijo(categoria) {
    const categorias = (categoria ?? '')
        .toString()
        .split(',')
        .map((valor) => valor.trim())
        .filter((valor) => valor && !valor.startsWith('__tipo_'));
    const categoriaReal = categorias.find((valor) => valor.toLowerCase() !== 'general');
    return categoriaReal || SIN_CATEGORIA;
}

/** Totales completos del mes, sin importar quién paga ni si ya se liquidaron. */
export function resumenGastosFijosPorCategoria(items) {
    const grupos = new Map();
    (items || [])
        .filter((item) => item.tipo === 'gasto' && item.isDueThisMonth)
        .forEach((item) => {
            const categoria = categoriaPrincipalFijo(item.categoria);
            const actual = grupos.get(categoria) || { categoria, monto: 0, cantidad: 0 };
            actual.monto += Math.abs(Number(item.monto) || 0);
            actual.cantidad += 1;
            grupos.set(categoria, actual);
        });
    return [...grupos.values()].sort((a, b) =>
        b.monto - a.monto || a.categoria.localeCompare(b.categoria, 'es'),
    );
}
