const moneyNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? '').trim().replace(/[^\d,.-]/g, '').replace(/,/g, '');
    return Number.parseFloat(normalized) || 0;
};

export function isSelfOwnerName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    return ['yo', 'mi', 'mio', 'mía', 'mia'].includes(normalized);
}

export function propertySharePercent(property) {
    const owners = Array.isArray(property?.owners) ? property.owners : [];
    const self = owners.find((owner) => isSelfOwnerName(owner?.name));
    if (self) return Math.max(0, Math.min(100, moneyNumber(self.percent)));
    if (owners.length) return Math.max(0, Math.min(100, moneyNumber(owners[0]?.percent)));
    return Math.max(0, Math.min(100, moneyNumber(property?.miPorcentaje || 100)));
}

export function partnerEmails(property) {
    const owners = Array.isArray(property?.owners) ? property.owners : [];
    return [...new Set(owners
        .filter((owner) => !isSelfOwnerName(owner?.name))
        .map((owner) => String(owner?.email || '').trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

export function projectPropertyFixedExpense(property, expense) {
    const totalAmount = Math.max(0, moneyNumber(expense?.amount ?? expense?.monto));
    const sharePercent = propertySharePercent(property);
    const extraEmails = String(expense?.alertEmails || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const alerts = expense?.notifyPartners === false
        ? extraEmails
        : [...partnerEmails(property), ...extraEmails];
    return {
        totalAmount,
        sharePercent,
        myAmount: totalAmount * (sharePercent / 100),
        alertEmails: [...new Set(alerts)],
    };
}
