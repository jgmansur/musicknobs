/**
 * Cliente mínimo de Gmail sobre `fetch`, para que corra igual en Node y en
 * Cloudflare Workers. Solo lectura: lista y baja mensajes, nada más.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    if (!res.ok) {
        throw new Error(`No se pudo refrescar el token de Gmail: ${res.status} ${await res.text()}`);
    }
    return (await res.json()).access_token;
}

async function api(token, path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, v);
    }
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
        throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

/** Devuelve todos los ids que cumplen la query, paginando. */
export async function listMessageIds(token, query, max = 200) {
    const ids = [];
    let pageToken;
    do {
        const page = await api(token, '/messages', {
            q: query,
            pageToken,
            maxResults: Math.min(100, max - ids.length),
        });
        for (const m of page.messages ?? []) ids.push(m.id);
        pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids;
}

function decodeBase64Url(data) {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
}

/** Recorre las partes MIME y prefiere el HTML. */
function extractBody(payload) {
    if (payload?.body?.data && ['text/html', 'text/plain'].includes(payload.mimeType)) {
        return decodeBase64Url(payload.body.data);
    }
    let fallback = '';
    for (const part of payload?.parts ?? []) {
        const got = extractBody(part);
        if (part.mimeType === 'text/html' && got) return got;
        fallback ||= got;
    }
    return fallback;
}

export async function getMessage(token, id) {
    const msg = await api(token, `/messages/${id}`, { format: 'full' });
    const headers = {};
    for (const h of msg.payload?.headers ?? []) {
        headers[h.name.toLowerCase()] = h.value;
    }
    const sender = headers.from ?? '';
    return {
        id: msg.id,
        threadId: msg.threadId,
        from: (sender.includes('<') ? sender.split('<').pop().replace('>', '') : sender)
            .trim()
            .toLowerCase(),
        subject: headers.subject ?? '',
        receivedAt: new Date(Number(msg.internalDate)),
        html: extractBody(msg.payload),
    };
}
