/**
 * Sesión propia del dashboard, firmada por el worker.
 *
 * El dashboard entra con Google una vez; el worker verifica ese login y le da
 * esta sesión, que vive en el navegador y no depende de que Google o Firebase
 * renueven nada. Los tokens de Google duran una hora y Safari bloquea las
 * ventanas con que se renuevan: depender de ellos dejaba la app sin datos.
 *
 * Formato: base64url(payload JSON) + "." + base64url(HMAC-SHA256). El payload
 * lleva el correo y el vencimiento. Rotar SESSION_SECRET cierra todas las
 * sesiones de golpe.
 */

export const SESSION_DAYS = 90;

const encoder = new TextEncoder();

const toBase64Url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (text) => {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const key = (secret) =>
    crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );

export async function signSession(email, secret, { now = Date.now(), days = SESSION_DAYS } = {}) {
    if (!secret) throw new Error('SESSION_SECRET no está configurado');
    const exp = now + days * 86_400_000;
    const payload = toBase64Url(encoder.encode(JSON.stringify({ email, exp })));
    const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
    return { session: `${payload}.${toBase64Url(signature)}`, expiresAt: new Date(exp).toISOString() };
}

/** El correo de una sesión válida y vigente, o null. Nunca lanza. */
export async function verifySession(token, secret, { now = Date.now() } = {}) {
    if (!secret || typeof token !== 'string') return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    try {
        const valid = await crypto.subtle.verify(
            'HMAC',
            await key(secret),
            fromBase64Url(signature),
            encoder.encode(payload),
        );
        if (!valid) return null;
        const { email, exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
        if (typeof email !== 'string' || !Number.isFinite(exp) || exp <= now) return null;
        return email.toLowerCase();
    } catch {
        return null;
    }
}
