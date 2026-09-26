export function parseMoneyInput(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
    if (!raw) return 0;
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
        raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (comma >= 0) {
        const decimals = raw.length - comma - 1;
        raw = decimals > 0 && decimals <= 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
    }
    return Number.parseFloat(raw) || 0;
}

export function validateFixedForm({ concept, amount, periodicity, startMonth }) {
    if (!String(concept || '').trim()) return { ok: false, field: 'concept', message: 'Escribe el concepto del gasto fijo.' };
    if (!(Number(amount) > 0)) return { ok: false, field: 'amount', message: 'Escribe un monto mayor a cero.' };
    if (periodicity !== 'mensual' && !/^\d{4}-\d{2}$/.test(String(startMonth || ''))) {
        return { ok: false, field: 'startMonth', message: 'Selecciona el mes en que comienza este gasto anual o periódico.' };
    }
    return { ok: true };
}
