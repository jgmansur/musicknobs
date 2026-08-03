/**
 * Parser del Ticket Digital de OXXO.
 *
 * OXXO manda por su cuenta un correo con el desglose por producto. El aviso del
 * banco solo trae el total, así que este correo es la única fuente de qué se
 * compró — justo lo que necesita el análisis de gasto hormiga.
 *
 * OJO: los artículos NO vienen en una línea por producto. Vienen en tres líneas
 * consecutivas dentro del text/plain:
 *
 *     COCACOLA ZERO 3L NR
 *     2
 *     $74.00
 *
 * nombre, cantidad, importe total de esa partida (no el unitario).
 */

export const TICKET_SENDERS = new Set(['info@oxxoticket.com']);

const IGNORAR = /^(IVA INCLUIDO|TOTAL|AHORRO|SUBTOTAL|EFECTIVO|CAMBIO|PAGO)/i;

const dinero = (s) => {
    const n = Number.parseFloat(String(s).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
};

/** "02/08/2026" + "13:46:00" → Date en hora de México. */
function fechaMx(f, h) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((f ?? '').trim());
    if (!m) return null;
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((h ?? '').trim());
    return new Date(
        `${m[3]}-${m[2]}-${m[1]}T${(t?.[1] ?? '12').padStart(2, '0')}:`
        + `${t?.[2] ?? '00'}:${t?.[3] ?? '00'}-06:00`,
    );
}

/**
 * @param {string} plano  parte text/plain del correo
 * @returns {{tienda, fecha, items: Array, iva, total, cardLast4}|null}
 */
export function parseOxxoTicket(plano) {
    const lineas = (plano ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lineas.some((l) => /ticket digital/i.test(l))) return null;

    const idxFecha = lineas.findIndex((l) => /^\d{2}\/\d{2}\/\d{4}$/.test(l));
    if (idxFecha === -1) return null;
    const fecha = fechaMx(lineas[idxFecha], lineas[idxFecha + 1]);

    // La tienda va justo después de la razón social.
    const idxRazon = lineas.findIndex((l) => /Cadena Comercial OXXO/i.test(l));
    const tienda = idxRazon >= 0 ? (lineas[idxRazon + 1] ?? '').slice(0, 60) : null;

    const items = [];
    let iva = null;
    let total = null;

    // Los artículos van entre la hora y la línea de TOTAL.
    for (let i = idxFecha + 2; i < lineas.length; i += 1) {
        const l = lineas[i];

        if (/^IVA INCLUIDO$/i.test(l)) { iva = dinero(lineas[i + 1]); continue; }
        if (/^TOTAL$/i.test(l)) { total = dinero(lineas[i + 1]); break; }
        if (IGNORAR.test(l)) continue;

        const cantidad = Number.parseInt(lineas[i + 1], 10);
        const importe = /^\$/.test(lineas[i + 2] ?? '') ? dinero(lineas[i + 2]) : null;

        // Un artículo es: texto, entero, importe con signo de pesos. Si las tres
        // no se cumplen, no es una partida y se sigue de largo.
        if (!Number.isInteger(cantidad) || cantidad <= 0 || importe == null) continue;
        if (!/[A-Za-zÁÉÍÓÚÑ]/.test(l)) continue;

        items.push({
            producto: l,
            cantidad,
            total: importe,
            unitario: Math.round((importe / cantidad) * 100) / 100,
        });
        i += 2;
    }

    if (!items.length) return null;

    const tarjeta = /TARJETA\s*\**\s*(\d{4})/i.exec(plano ?? '');

    return {
        tienda,
        fecha,
        items,
        iva,
        total,
        cardLast4: tarjeta ? tarjeta[1] : null,
    };
}
