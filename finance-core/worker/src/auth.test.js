import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedRequest } from './index.js';

const env = {
    API_TOKEN: 'legacy-secret',
    FINANCE_ALLOWED_EMAILS: 'jgmansur2@gmail.com',
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
