/**
 * Parsers de alertas bancarias (Santander MX y BBVA MX).
 *
 * Cada matcher recibe el texto plano del correo y devuelve un movimiento
 * normalizado, o null si no aplica. El orden importa: el primero que hace
 * match gana, así que los patrones específicos van antes que los genéricos.
 *
 * `kind: 'internal'` marca operaciones que mueven dinero dentro de la misma
 * cuenta (retiro de apartado BBVA) — se registran como ignoradas para que no
 * inflen el gasto.
 */

// Remitentes que mandan avisos de operación. El resto del correo bancario es
// publicidad y nunca debe llegar al parser.
export const TRANSACTIONAL_SENDERS = new Set([
    'santander@envio.santander.com.mx',
    'clientes@bbva.mx',
    'alertas@heybanco.com',
    'noreply@hey.inc',
]);

// Remitentes de marketing, listados explícitamente para documentar por qué se
// excluyen y para que un cambio de dominio salte a la vista.
export const MARKETING_SENDERS = new Set([
    'clientes@envios.santander.com.mx',
    'info@envio.santander.com.mx',
    'miexperiencia@calidad.santander.com.mx',
    'clientes@email.bbva.mx',
    'marketingdir@email.banamex.com',
    'noreply@conecta.hey.inc',
]);

const HTML_ENTITIES = {
    '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó',
    '&uacute;': 'ú', '&ntilde;': 'ñ', '&Aacute;': 'Á', '&Eacute;': 'É',
    '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú', '&Ntilde;': 'Ñ',
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&aacute': 'á',
};

/** Convierte el HTML del correo a texto plano de una sola línea. */
export function htmlToText(html) {
    if (!html) return '';
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|tr|td|h[1-6]|table)>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&[a-zA-Z]+;?/g, (m) => HTML_ENTITIES[m] ?? ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Los bancos escriben el monto en formato inglés: coma para miles, punto para
 * decimales. Ojo: el sheet legacy usa el formato español (coma decimal), así
 * que esta función NO sirve para migrar el histórico.
 */
export function parseAmount(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[^\d.,]/g, '').replace(/,/g, '');
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
}

/** "29/07/2026" + "13:05:19" → Date en hora de México (UTC-6, sin horario de verano). */
export function parseMxDateTime(ddmmyyyy, hhmmss) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((ddmmyyyy || '').trim());
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((hhmmss || '').trim());
    const hh = time ? time[1].padStart(2, '0') : '12';
    const mi = time ? time[2] : '00';
    const ss = time ? (time[3] ?? '00') : '00';
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-06:00`);
}

const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** BBVA escribe la fecha larga: "22 de abril de 2026" + "13:48:44". */
export function parseSpanishDate(dia, mes, anio, hora) {
    const mm = MESES[(mes || '').toLowerCase()];
    if (!mm) return null;
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((hora || '').trim());
    const hh = time ? time[1].padStart(2, '0') : '12';
    const mi = time ? time[2] : '00';
    const ss = time ? (time[3] ?? '00') : '00';
    return new Date(
        `${anio}-${String(mm).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${hh}:${mi}:${ss}-06:00`,
    );
}

const AMOUNT = String.raw`\$\s*([\d,]+(?:\.\d{2})?)`;

const MATCHERS = [
    {
        bank: 'santander',
        template: 'santander_compra',
        // "se ha realizado una compra en el comercio X con tu tarjeta de débito
        //  terminación **6137, por un monto de $483.00 MXN. El 29/07/2026 a las 13:05:19"
        re: new RegExp(
            String.raw`compra en el comercio\s+(.+?)\s+con tu tarjeta de\s+(d[ée]bito|TDC|cr[ée]dito)\s+` +
            String.raw`terminaci[óo]n\s*\**\s*(\d{4})\s*,?\s*por\s+un\s+monto\s+de\s+${AMOUNT}\s*([A-Z]{3})?` +
            String.raw`(?:.*?El\s+(\d{2}\/\d{2}\/\d{4})\s*a\s+las\s+([\d:]+))?`,
            'i',
        ),
        build: (m) => ({
            kind: 'gasto',
            merchant: m[1].replace(/\s+/g, ' ').trim(),
            instrument: /tdc|cr[ée]dito/i.test(m[2]) ? 'credito' : 'debito',
            cardLast4: m[3],
            amount: parseAmount(m[4]),
            currency: m[5] || 'MXN',
            occurredAt: parseMxDateTime(m[6], m[7]),
        }),
    },
    {
        bank: 'santander',
        template: 'santander_spei_abono',
        // "recibiste vía SPEI un abono por $2500.00 MXN a tu cuenta terminación 3482"
        re: new RegExp(
            String.raw`recibiste\s+v[íi]a\s+SPEI\s+un\s+abono\s+por\s+${AMOUNT}\s*([A-Z]{3})?` +
            String.raw`\s*a\s+tu\s+cuenta\s+terminaci[óo]n\s*\**\s*(\d{4})` +
            String.raw`(?:.*?Fecha:\s*(\d{2}\/\d{2}\/\d{4}))?`,
            'i',
        ),
        build: (m) => ({
            kind: 'ingreso',
            amount: parseAmount(m[1]),
            currency: m[2] || 'MXN',
            cardLast4: m[3],
            instrument: 'cuenta',
            occurredAt: parseMxDateTime(m[4], null),
        }),
    },
    {
        bank: 'santander',
        template: 'santander_transferencia',
        // "realizaste una transferencia de tu cuenta terminación 3482 a la cuenta
        //  terminación 1234 ... $500.00"
        re: new RegExp(
            String.raw`realizaste\s+una\s+transferencia\s+de\s+tu\s+cuenta\s+terminaci[óo]n\s*\**\s*(\d{4})` +
            String.raw`\s*a\s+la\s+cuenta\s+terminaci[óo]n\s*\**\s*(\d{3,4})` +
            String.raw`(?:.*?${AMOUNT})?`,
            'i',
        ),
        build: (m) => ({
            // Salida de dinero. Si la cuenta destino también es de Jay, la UI la
            // reclasifica como 'transfer' al aprobar.
            kind: 'gasto',
            cardLast4: m[1],
            instrument: 'cuenta',
            counterparty: `cuenta ****${m[2]}`,
            counterpartyLast4: m[2],
            amount: parseAmount(m[3]),
            currency: 'MXN',
        }),
    },
    {
        bank: 'hey',
        template: 'hey_compra',
        // "La transacción que realizaste con tu Debito Hey con terminación **1884
        //  fue exitosa. ... Comercio: Canva* 04842-55657800 Sydney
        //  Cantidad: $149.00 Fecha y hora de la transacción: 08/04/2026 - 13:33 hrs"
        re: new RegExp(
            String.raw`transacci[óo]n\s+que\s+realizaste\s+con\s+tu\s+(.+?)\s+con\s+terminaci[óo]n` +
            String.raw`\s*\**\s*(\d{4})\s+fue\s+exitosa` +
            String.raw`.*?Comercio:\s*(.+?)\s+Cantidad:\s*${AMOUNT}` +
            String.raw`(?:.*?Fecha\s+y\s+hora\s+de\s+la\s+transacci[óo]n:\s*` +
            String.raw`(\d{2}\/\d{2}\/\d{4})\s*-\s*([\d:]+))?`,
            'i',
        ),
        build: (m) => ({
            kind: 'gasto',
            instrument: /cr[ée]dito/i.test(m[1]) ? 'credito' : 'debito',
            cardLast4: m[2],
            merchant: m[3].replace(/\s+/g, ' ').trim(),
            amount: parseAmount(m[4]),
            currency: 'MXN',
            occurredAt: parseMxDateTime(m[5], m[6]),
        }),
    },
    {
        bank: 'hey',
        template: 'hey_spei_recibido',
        // Hey avisa que llegó dinero pero NO dice cuánto. Se deja pasar sin monto
        // a propósito: mejor que Jay lo complete en la bandeja a perder 29
        // entradas de dinero al año.
        re: new RegExp(
            String.raw`Recibiste\s+una\s+transferencia\s+nacional\s+SPEI\s+de\s+la\s+cuenta` +
            String.raw`\s+con\s+terminaci[óo]n\s*\**\s*(\d{4})\s+a\s+tu\s+tarjeta\s+Hey`,
            'i',
        ),
        amountOptional: true,
        build: (m) => ({
            kind: 'ingreso',
            counterparty: `cuenta ****${m[1]}`,
            counterpartyLast4: m[1],
            instrument: 'cuenta',
            currency: 'MXN',
            amount: null,
        }),
    },
    {
        bank: 'hey',
        template: 'hey_ahorro',
        // Movimientos entre la cuenta Hey y su bolsa de ahorro: mismo dinero,
        // distinto cajón. No es gasto ni ingreso.
        re: new RegExp(
            String.raw`(?:dep[óo]sito\s+a\s+tu\s+ahorro|retiro\s+a\s+tu\s+ahorro|` +
            String.raw`retiro\s+de\s+tu\s+Ahorro\s+Inmediato)`,
            'i',
        ),
        build: () => ({ kind: 'internal', instrument: 'cuenta', currency: 'MXN' }),
    },
    {
        bank: 'bbva',
        template: 'bbva_retiro_apartado',
        // Movimiento interno: del apartado al saldo de la MISMA cuenta.
        // No es gasto ni ingreso — se registra como ignorado.
        re: new RegExp(
            String.raw`retiro\s+de\s+dinero\s+de\s+tu\s+apartado\s+en\s+la\s+cuenta\s+terminaci[óo]n\s*\**\s*(\d{4})`,
            'i',
        ),
        build: (m) => ({
            kind: 'internal',
            cardLast4: m[1],
            instrument: 'cuenta',
            currency: 'MXN',
        }),
    },
    {
        bank: 'bbva',
        template: 'bbva_retiro_efectivo',
        // "Cuenta de retiro: **6240 Importe: $1,000.00"
        re: new RegExp(
            String.raw`Cuenta\s+de\s+retiro:\s*\**\s*(\d{4})\s*Importe:\s*${AMOUNT}`,
            'i',
        ),
        build: (m) => ({
            kind: 'gasto',
            merchant: 'Retiro de efectivo',
            cardLast4: m[1],
            instrument: 'cuenta',
            amount: parseAmount(m[2]),
            currency: 'MXN',
        }),
    },
    {
        bank: 'bbva',
        template: 'bbva_pago_tdc',
        // "La transferencia que hiciste desde tu tarjeta de débito a la tarjeta de
        //  crédito ... Importe: $ 1,000.00 Tarjeta depósito: 8914
        //  Fecha: 22 de abril de 2026 Hora: 13:48:44"
        // Si la tarjeta destino es de Jay, al aprobar se reclasifica como 'transfer'.
        re: new RegExp(
            String.raw`transferencia\s+que\s+hiciste\s+desde\s+tu\s+tarjeta\s+de\s+d[ée]bito` +
            String.raw`\s+a\s+la\s+tarjeta\s+de\s+cr[ée]dito.*?fue\s+exitosa` +
            String.raw`.*?Importe:\s*${AMOUNT}` +
            String.raw`(?:.*?Tarjeta\s+dep[óo]sito:\s*\**\s*(\d{4}))?` +
            String.raw`(?:.*?Fecha:\s*(\d{1,2})\s+de\s+([a-zá-ú]+)\s+de\s+(\d{4}))?` +
            String.raw`(?:.*?Hora:\s*([\d:]+))?`,
            'i',
        ),
        build: (m) => ({
            kind: 'gasto',
            merchant: 'Pago de tarjeta de crédito',
            amount: parseAmount(m[1]),
            counterparty: m[2] ? `tarjeta ****${m[2]}` : null,
            counterpartyLast4: m[2] ?? null,
            instrument: 'cuenta',
            currency: 'MXN',
            occurredAt: parseSpanishDate(m[3], m[4], m[5], m[6]),
        }),
    },
    {
        bank: 'bbva',
        template: 'bbva_transferencia',
        // "La transferencia a cuenta de débito BBVA fue exitosa ... Importe: $ 500.00
        //  Beneficiario: CAMPOS FIGUEROA ..."
        re: new RegExp(
            String.raw`transferencia\s+a\s+cuenta[\s\S]{0,80}?fue\s+exitosa` +
            String.raw`.*?Importe:\s*${AMOUNT}` +
            String.raw`(?:.*?Beneficiario:\s*([A-ZÁÉÍÓÚÑ][^:]{2,60}?)\s{2,})?`,
            'i',
        ),
        build: (m) => ({
            kind: 'gasto',
            merchant: 'Transferencia',
            amount: parseAmount(m[1]),
            counterparty: m[2] ? m[2].trim() : null,
            instrument: 'cuenta',
            currency: 'MXN',
        }),
    },
];

/**
 * Intenta extraer un movimiento de un correo.
 *
 * @param {{from: string, subject: string, html?: string, text?: string, receivedAt: Date}} msg
 * @returns {{matched: boolean, reason?: string, ...}} resultado normalizado
 */
export function parseBankEmail(msg) {
    const from = (msg.from || '').toLowerCase().trim();

    if (MARKETING_SENDERS.has(from)) {
        return { matched: false, reason: 'marketing' };
    }
    if (!TRANSACTIONAL_SENDERS.has(from)) {
        return { matched: false, reason: 'unknown_sender' };
    }

    const text = msg.text || htmlToText(msg.html);

    // Aviso de rechazo: no movió dinero. El motivo varía (fondos insuficientes,
    // parámetros de montos, ...), así que se detecta el rechazo en sí y no la causa.
    if (
        /rechazo\s+en\s+tarjeta/i.test(msg.subject || '') ||
        /(?:fue|ha\s+sido)\s+rechazad[ao]/i.test(text) ||
        /se\s+identific[óo]\s+un\s+rechazo/i.test(text) ||
        /fondos\s+insuficientes/i.test(text)
    ) {
        return { matched: false, reason: 'declined' };
    }

    for (const matcher of MATCHERS) {
        const m = matcher.re.exec(text);
        if (!m) continue;

        const parsed = matcher.build(m);
        if (!matcher.amountOptional && parsed.kind !== 'internal' && !Number.isFinite(parsed.amount)) {
            // Hizo match la forma pero no el monto: mejor mandarlo a revisión
            // que inventar un número.
            return {
                matched: false,
                reason: 'amount_missing',
                bank: matcher.bank,
                template: matcher.template,
                text,
            };
        }

        return {
            matched: true,
            bank: matcher.bank,
            template: matcher.template,
            occurredAt: parsed.occurredAt || msg.receivedAt,
            text,
            ...parsed,
        };
    }

    return { matched: false, reason: 'no_template', text };
}
