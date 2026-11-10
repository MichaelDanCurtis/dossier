import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { hkdfSync, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jwtDecrypt, jwtVerify } from 'jose';
import { createGateway } from '../server.mjs';
import { COOKIE, hashPassword } from '../auth.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const stop = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dossier-accounts-test-'));
  const users = [];
  const backends = [];
  const password = 'test password for private accounts';
  const stored = await hashPassword(password);
  for (const username of ['alice', 'bravo']) {
    const user = { id: username, username, active: true, role: username === 'alice' ? 'admin' : 'user', revision: 'initial', passwordHash: stored, appSecret: randomBytes(32).toString('hex'), appPasswordHash: `argon2id:test-${username}` };
    const deriveKey = (purpose) => new Uint8Array(hkdfSync('sha256', user.appSecret, '', `dossier ${purpose} v1`, 32));
    const backend = http.createServer(async (request, response) => {
      try {
        const native = request.headers.cookie.match(/dossier_session=([^;]+)/)?.[1];
        const { payload } = await jwtDecrypt(native, deriveKey('session'));
        assert.equal(payload.pwd, createHmac('sha256', deriveKey('password-fingerprint')).update(user.appPasswordHash).digest('base64url').slice(0, 16));
        if (request.url === '/api/mcp') {
          const { payload: access } = await jwtVerify(request.headers.authorization.slice(7), deriveKey('connector-access'), { audience: 'dossier-mcp' });
          assert.equal(access.gen, 'test-generation');
          assert.equal(access.pwd, payload.pwd);
        }
        if (request.url === '/signout') response.setHeader('set-cookie', 'dossier_session=; Path=/; Max-Age=0; HttpOnly');
        if (request.url === '/api/files/alice-only' && username !== 'alice') { response.writeHead(404); return response.end('Not found'); }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ username, body: Buffer.concat(chunks).toString(), cookie: request.headers.cookie, forwarded: request.headers['x-forwarded-for'], auth: request.headers.authorization, desktop: request.headers['x-dossier-desktop-token'] }));
      } catch { response.writeHead(401); response.end('Invalid native session'); }
    });
    user.upstream = await listen(backend);
    backends.push(backend);
    users.push(user);
  }
  // Reserve a port before building the gateway's fixed origin.
  const reservation = http.createServer();
  const origin = await listen(reservation);
  const port = reservation.address().port;
  await stop(reservation);
  const registry = { origin, sessionSecret: randomBytes(32).toString('hex'), users };
  const registryPath = path.join(directory, 'registry.json');
  const save = () => writeFile(registryPath, JSON.stringify(registry));
  await save();
  const gateway = createGateway({ origin, registryPath, connectorImpl: async () => 'test-generation', ...options });
  await new Promise((resolve) => gateway.listen(port, '127.0.0.1', resolve));
  t.after(async () => { await stop(gateway); for (const backend of backends) await stop(backend); await rm(directory, { recursive: true }); });
  const request = (route, options = {}) => fetch(origin + route, { redirect: 'manual', ...options });
  const login = async (username, candidate = password) => {
    const response = await request('/_accounts/login', { method: 'POST', headers: { origin }, body: new URLSearchParams({ username, password: candidate }) });
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  return { request, login, registry, save, origin };
}

test('private sessions select only their own backend and ignore caller routing/auth headers', async (t) => {
  const f = await fixture(t);
  const alice = await f.login('alice');
  const bravo = await f.login('bravo');
  assert.equal(alice.response.status, 303);
  assert.match(alice.response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  const first = await f.request('/api/export?user=bravo', { headers: { cookie: `${alice.cookie}; dossier_session=attacker; dossier_theme=dark`, 'x-user': 'bravo', authorization: 'Bearer attacker', 'x-dossier-desktop-token': 'attacker', 'x-forwarded-for': '192.0.2.1, 198.51.100.2' } });
  const data = await first.json();
  assert.equal(data.username, 'alice');
  assert.equal(data.auth, undefined);
  assert.equal(data.desktop, undefined);
  assert.equal(data.forwarded, '198.51.100.2');
  assert.ok(!data.cookie.includes('attacker'));
  assert.ok(!data.cookie.includes(COOKIE));
  assert.ok(data.cookie.includes('dossier_theme=dark'));
  assert.equal((await (await f.request('/api/export', { headers: { cookie: bravo.cookie } })).json()).username, 'bravo');
  assert.equal((await f.request('/api/files/alice-only', { headers: { cookie: bravo.cookie } })).status, 404);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
});

test('anonymous, forged, duplicate, and mixed native cookies cannot access private data', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/')).status, 303);
  assert.equal((await f.request('/api/export')).status, 401);
  assert.equal((await f.request('/api/export', { headers: { cookie: `${COOKIE}=forged; dossier_session=forged` } })).status, 401);
  const { cookie } = await f.login('alice');
  assert.equal((await f.request('/api/export', { headers: { cookie: `${cookie}; ${cookie}` } })).status, 401);
  assert.equal((await f.request('/api/export', { headers: { cookie: cookie.slice(0, -8) + 'tampered' } })).status, 401);
});

test('password changes and disabled accounts immediately revoke old sessions', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login('alice');
  f.registry.users[0].revision = 'new-password';
  f.registry.users[0].passwordHash = await hashPassword('a changed account password');
  await f.save();
  assert.equal((await f.request('/api/export', { headers: { cookie } })).status, 401);
  assert.equal((await f.login('alice')).response.status, 401);
  const changed = await f.login('alice', 'a changed account password');
  assert.equal(changed.response.status, 303);
  f.registry.users[0].active = false;
  await f.save();
  assert.equal((await f.request('/api/export', { headers: { cookie: changed.cookie } })).status, 401);
  assert.equal((await f.login('alice', 'a changed account password')).response.status, 401);
  assert.equal((await f.login('bravo')).response.status, 303);
});

test('login and logout reject CSRF; native Dossier sign-out clears account access', async (t) => {
  const f = await fixture(t);
  const body = () => new URLSearchParams({ username: 'alice', password: 'test password for private accounts' });
  assert.equal((await f.request('/_accounts/login', { method: 'POST', body: body() })).status, 403);
  assert.equal((await f.request('/_accounts/login', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: body() })).status, 403);
  const { cookie } = await f.login('alice');
  assert.equal((await f.request('/_accounts/logout', { method: 'POST', headers: { cookie } })).status, 403);
  const native = await f.request('/signout', { headers: { cookie } });
  assert.match(native.headers.get('set-cookie'), new RegExp(`${COOKIE}=;.*Max-Age=0`));
  const logout = await f.request('/_accounts/logout', { method: 'POST', headers: { cookie, origin: f.origin } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('bad passwords are throttled and external MCP requires authorization', async (t) => {
  const f = await fixture(t, { maxFailures: 2 });
  assert.equal((await f.login('alice', 'wrong')).response.status, 401);
  assert.equal((await f.login('alice', 'wrong')).response.status, 401);
  assert.equal((await f.login('alice', 'wrong')).response.status, 429);
  assert.equal((await f.request('/api/mcp')).status, 401);
  assert.equal((await f.request('/api/oauth/register')).status, 405);
  assert.equal((await f.request('/.well-known/oauth-authorization-server')).status, 200);
  assert.equal((await f.request('/api/desktop/sign-in')).status, 404);
});

test('only an administrator can call user management; admin changes require same-origin POST', async (t) => {
  const calls = [];
  const f = await fixture(t, { controlImpl: async (payload) => { calls.push(payload); return { username: payload.username, message: 'Account created', password: 'one-time-password' }; } });
  const a = await f.login('alice');
  const b = await f.login('bravo');
  assert.equal((await f.request('/_accounts/admin', { headers: { cookie: b.cookie } })).status, 403);
  assert.equal((await f.request('/_accounts/admin', { method: 'POST', headers: { cookie: b.cookie, origin: f.origin }, body: new URLSearchParams({ operation: 'add', username: 'charlie' }) })).status, 403);
  assert.equal((await f.request('/_accounts/admin', { method: 'POST', headers: { cookie: a.cookie }, body: new URLSearchParams({ operation: 'add', username: 'charlie' }) })).status, 403);
  const list = await f.request('/_accounts/admin', { headers: { cookie: a.cookie } });
  const html = await list.text();
  assert.equal(list.status, 200);
  assert.ok(html.includes('Create private account'));
  assert.ok(!html.includes(f.registry.users[0].appSecret));
  const result = await f.request('/_accounts/admin', { method: 'POST', headers: { cookie: a.cookie, origin: f.origin }, body: new URLSearchParams({ operation: 'add', username: 'charlie' }) });
  assert.equal(result.status, 200);
  assert.ok((await result.text()).includes('one-time-password'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor, 'alice');
  assert.equal(calls[0].revision, 'initial');
});

test('personal MCP tokens select the owner without browser cookies and revoke independently', async (t) => {
  const f = await fixture(t);
  const a = await f.login('alice');
  const b = await f.login('bravo');
  async function issue(cookie) {
    const response = await f.request('/_accounts/mcp', { method: 'POST', headers: { cookie, origin: f.origin }, body: new URLSearchParams({ operation: 'create' }) });
    assert.equal(response.status, 200);
    return (await response.text()).match(/dossier_personal_[\w-]+/)[0];
  }
  const at = await issue(a.cookie);
  const bt = await issue(b.cookie);
  const call = (token, cookie) => f.request('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) }, body: '{}' });
  assert.equal((await (await call(at, b.cookie)).json()).username, 'alice');
  assert.equal((await (await call(bt)).json()).username, 'bravo');
  const at2 = await issue(a.cookie);
  assert.equal((await call(at)).status, 401);
  assert.equal((await call(at2)).status, 200);
  f.registry.users[0].revision = 'password-reset';
  await f.save();
  assert.equal((await call(at2)).status, 401);
  assert.equal((await call(bt)).status, 200);
  const revoked = await f.request('/_accounts/mcp', { method: 'POST', headers: { cookie: b.cookie, origin: f.origin }, body: new URLSearchParams({ operation: 'revoke' }) });
  assert.equal(revoked.status, 303);
  assert.equal((await call(bt)).status, 401);
});

test('streamed requests reach the correct workspace without mixing account state', async (t) => {
  const f = await fixture(t);
  const a = await f.login('alice');
  const b = await f.login('bravo');
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => f.request('/api/import', { method: 'POST', headers: { cookie: index % 2 ? a.cookie : b.cookie, origin: f.origin }, body: 'input-' + index })));
  const results = await Promise.all(responses.map((r) => r.json()));
  results.forEach((result, index) => { assert.equal(result.username, index % 2 ? 'alice' : 'bravo'); assert.equal(result.body, 'input-' + index); });
});

test('unified MCP settings enforce session, CSRF, owner isolation and revocation', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/_accounts/api/mcp')).status, 401);
  const alice = await f.login('alice');
  const bravo = await f.login('bravo');
  const operation = (cookie, name, origin = f.origin) => f.request('/_accounts/api/mcp', { method: 'POST', headers: { cookie, origin }, body: new URLSearchParams({ operation: name, username: 'bravo' }) });
  assert.equal((await operation(alice.cookie, 'create', 'https://evil.example')).status, 403);
  assert.equal((await operation(alice.cookie, 'invalid')).status, 400);
  const made = await operation(alice.cookie, 'create');
  assert.equal(made.status, 200);
  assert.equal(made.headers.get('cache-control'), 'private, no-store');
  const { token } = await made.json();
  const using = await f.request('/api/mcp', { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await using.json()).username, 'alice');
  const count = async (cookie) => (await (await f.request('/_accounts/api/mcp', { headers: { cookie } })).json()).authorizations;
  assert.equal(await count(alice.cookie), 1);
  assert.equal(await count(bravo.cookie), 0);
  const listing = await f.request('/_accounts/api/mcp', { headers: { cookie: alice.cookie } });
  assert.ok(!(await listing.text()).includes(token));
  assert.equal((await f.request('/_accounts', { headers: { cookie: alice.cookie } })).headers.get('location'), '/settings?section=connector');
  await operation(bravo.cookie, 'revoke');
  assert.equal((await f.request('/api/mcp', { headers: { authorization: `Bearer ${token}` } })).status, 200);
  await operation(alice.cookie, 'revoke');
  assert.equal((await f.request('/api/mcp', { headers: { authorization: `Bearer ${token}` } })).status, 401);
});

test('unified settings cannot generate a token with the connector switched off', async (t) => {
  const f = await fixture(t, { connectorImpl: async () => { throw new Error('off'); } });
  const { cookie } = await f.login('alice');
  const result = await f.request('/_accounts/api/mcp', { method: 'POST', headers: { cookie, origin: f.origin }, body: new URLSearchParams({ operation: 'create' }) });
  assert.equal(result.status, 409);
});

test('account pages paint Studio by default and honor both appearance cookies before sign-in', async (t) => {
  const f = await fixture(t);
  const initial = await (await f.request('/login')).text();
  assert.match(initial, /<html lang="en" data-ui-theme="studio">/);
  for (const theme of ['studio', 'editorial']) for (const mode of ['light', 'dark']) {
    const html = await (await f.request('/login', { headers: { cookie: `dossier_ui_theme=${theme}; dossier_theme=${mode}` } })).text();
    assert.ok(html.includes(`<html lang="en" data-ui-theme="${theme}" data-theme="${mode}">`));
    assert.ok(html.includes('--ui-color-sidebar: light-dark(#101c34, #0a1427)'));
    assert.ok(html.includes('SourceSerif4-Regular.woff2'));
  }
});

test('appearance cookies are allowlisted and do not change account authorization', async (t) => {
  const f = await fixture(t);
  const invalid = await (await f.request('/login', { headers: { cookie: 'dossier_ui_theme=bad; dossier_theme=bad' } })).text();
  assert.match(invalid, /<html lang="en" data-ui-theme="studio">/);
  assert.equal((await f.request('/_accounts/admin', { headers: { cookie: 'dossier_ui_theme=editorial' } })).status, 303);
  const { cookie } = await f.login('alice');
  const response = await f.request('/_accounts/admin', { headers: { cookie: `${cookie}; dossier_ui_theme=editorial; dossier_theme=dark` } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html lang="en" data-ui-theme="editorial" data-theme="dark">/);
});

test('theme fonts are local allowlisted assets', async (t) => {
  const f = await fixture(t);
  for (const font of ['IBMPlexSans-Regular.woff2', 'SourceSerif4-Regular.woff2']) {
    const response = await f.request(`/_accounts/assets/fonts/${font}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
  assert.equal((await f.request('/_accounts/assets/fonts/unknown.woff2')).status, 404);
});
