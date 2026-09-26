function normalizeSearch(value) {
    return String(value || '').trim().toLowerCase();
}

export function shouldShowFixedItem(item, query = '') {
    const normalizedQuery = normalizeSearch(query);
    const searchableText = `${item?.concepto || ''} ${item?.categoria || ''}`.toLowerCase();
    const matchesSearch = !normalizedQuery || searchableText.includes(normalizedQuery);

    return matchesSearch && (Boolean(item?.isDueThisMonth) || Boolean(normalizedQuery));
}
