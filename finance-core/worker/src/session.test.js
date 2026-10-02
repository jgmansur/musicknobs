import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from './session.js';
import { identifyRequest, issueSession } from './index.js';

const secret = 'test-secret-0123456789';
const env = {
    API_TOKEN: 'legacy-secret',
    FINANCE_ALLOWED_EMAILS: 'jgmansur2@gmail.com',
    GOOGLE_CLIENT_IDS: 'dashboard-client.apps.googleusercontent.com',
    SESSION_SECRET: secret,
};
const withSession = (session) =>
    new Request('https://finance.test/api/balances', { headers: { 'x-finance-session': session } });
const noFetch = () => { throw new Error('should not call Google'); };

test('a signed session identifies its email without calling Google', async () => {
    const { session, expiresAt } = await signSession('jgmansur2@gmail.com', secret);
    assert.ok(Date.parse(expiresAt) > Date.now() + 89 * 86_400_000);
    assert.deepEqual(await identifyRequest(withSession(session), env, noFetch), {
        via: 'session',
        email: 'jgmansur2@gmail.com',
    });
});

test('tampered, expired, foreign-secret or other-email sessions are rejected', async () => {
    const { session } = await signSession('jgmansur2@gmail.com', secret);
    const [payload, sig] = session.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'jgmansur2@gmail.com', exp: Date.now() + 1e12 }))
        .toString('base64url');
    assert.equal(await verifySession(`${forged}.${sig}`, secret), null);
    assert.equal(await verifySession(`${payload}.${sig}x`, secret), null);
    assert.equal(await verifySession(session, 'other-secret'), null);
    assert.equal(await verifySession(session, secret, { now: Date.now() + 91 * 86_400_000 }), null);
    assert.equal(await verifySession('garbage', secret), null);
    const other = await signSession('other@example.com', secret);
    assert.equal(await identifyRequest(withSession(other.session), env, noFetch), null);
    assert.equal(await identifyRequest(withSession(session), { ...env, SESSION_SECRET: '' }, noFetch), null);
});

test('only a real Google or Firebase login can open a session', async () => {
    const ok = await issueSession({ via: 'google', email: 'jgmansur2@gmail.com' }, env);
    assert.equal(ok.status, 200);
    assert.equal(await verifySession(ok.body.session, secret), 'jgmansur2@gmail.com');
    assert.equal((await issueSession({ via: 'session', email: 'jgmansur2@gmail.com' }, env)).status, 403);
    assert.equal((await issueSession({ via: 'legacy', email: null }, env)).status, 403);
    assert.equal((await issueSession(null, env)).status, 403);
    assert.equal(
        (await issueSession({ via: 'google', email: 'jgmansur2@gmail.com' }, { ...env, SESSION_SECRET: '' })).status,
        503,
    );
});
