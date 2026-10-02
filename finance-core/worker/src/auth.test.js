import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedRequest } from './index.js';

const env = {
    API_TOKEN: 'legacy-secret',
    FINANCE_ALLOWED_EMAILS: 'jgmansur2@gmail.com',
    GOOGLE_CLIENT_IDS: 'dashboard-client.apps.googleusercontent.com',
};

test('accepts the legacy finance token without calling Firebase', async () => {
    const request = new Request('https://finance.test/api/fijos', {
        headers: { 'x-finance-token': 'legacy-secret' },
    });
    const authorized = await isAuthorizedRequest(request, env, () => {
        throw new Error('Firebase should not be called');
    });
    assert.equal(authorized, true);
});

test('accepts a verified Firebase user from the allowlist', async () => {
    const request = new Request('https://finance.test/api/fijos', {
        headers: { authorization: 'Bearer firebase-id-token' },
    });
    const authorized = await isAuthorizedRequest(request, env, async (_url, options) => {
        assert.deepEqual(JSON.parse(options.body), { idToken: 'firebase-id-token' });
        return Response.json({ users: [{ email: 'jgmansur2@gmail.com', emailVerified: true }] });
    });
    assert.equal(authorized, true);
});

test('rejects a valid Firebase user outside the allowlist', async () => {
    const request = new Request('https://finance.test/api/fijos', {
        headers: { authorization: 'Bearer firebase-id-token' },
    });
    const authorized = await isAuthorizedRequest(request, env, async () =>
        Response.json({ users: [{ email: 'other@example.com', emailVerified: true }] }),
    );
    assert.equal(authorized, false);
});

const googleRequest = () => new Request('https://finance.test/api/balances', {
    headers: { 'x-google-token': 'google-access-token' },
});
const tokeninfo = (fields) => async (url) => {
    assert.match(String(url), /tokeninfo\?access_token=google-access-token/);
    return Response.json({
        aud: 'dashboard-client.apps.googleusercontent.com',
        email: 'jgmansur2@gmail.com',
        email_verified: 'true',
        expires_in: '3500',
        ...fields,
    });
};

test('accepts the Google login of the dashboard for an allowed email', async () => {
    assert.equal(await isAuthorizedRequest(googleRequest(), env, tokeninfo({})), true);
});

test('rejects a Google token issued to another app, another email, or without email', async () => {
    assert.equal(await isAuthorizedRequest(googleRequest(), env, tokeninfo({ aud: 'other-app' })), false);
    assert.equal(await isAuthorizedRequest(googleRequest(), env, tokeninfo({ email: 'other@example.com' })), false);
    assert.equal(await isAuthorizedRequest(googleRequest(), env, tokeninfo({ email: undefined })), false);
    assert.equal(await isAuthorizedRequest(googleRequest(), env, tokeninfo({ email_verified: 'false' })), false);
    assert.equal(
        await isAuthorizedRequest(googleRequest(), env, async () => new Response('bad', { status: 400 })),
        false,
    );
});
