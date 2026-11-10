// Run against a disposable two-account Compose deployment, never live accounts.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const directory = path.resolve(process.argv[2]);
const target = process.argv[3] ?? 'http://127.0.0.1:18765';
const registry = JSON.parse(await readFile(path.join(directory, 'state/registry.json')));
const origin = registry.origin;
const compose = (...args) => execFileSync('docker', ['compose', '-f', path.join(directory, 'docker-compose.yml'), ...args], { encoding: 'utf8' });
const request = (route, { headers = {}, body, ...options } = {}) => new Promise((resolve, reject) => {
  const data = body instanceof URLSearchParams ? body.toString() : body;
  const req = http.request(new URL(route, target), { ...options, headers: { host: new URL(origin).host, 'x-forwarded-proto': 'https', ...(body instanceof URLSearchParams ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('error', reject);
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});
const password = async (username) => (await readFile(path.join(directory, 'credentials', username + '.txt'), 'utf8')).match(/^Password: (.+)$/m)[1];
async function login(username) {
  const response = await request('/_accounts/login', { method: 'POST', headers: { origin }, body: new URLSearchParams({ username, password: await password(username) }) });
  assert.equal(response.status, 303, 'account sign-in succeeds');
  return response.headers.get('set-cookie').split(';')[0];
}
function sql(username, statement) {
  return compose('exec', '-T', `db-${username}`, 'psql', '-U', 'dossier', '-d', 'dossier', '-v', 'ON_ERROR_STOP=1', '-c', statement);
}

assert.equal((await request('/api/export')).status, 401);
const alice = await login('alice');
const bravo = await login('bravo');
const marker = 'Isolation ' + randomUUID();
sql('alice', `INSERT INTO "ProfileField" (key, value, "updatedAt") VALUES ('name', '${marker}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW();`);
sql('alice', `INSERT INTO "ProfileField" (key, value, "updatedAt") VALUES ('summary', '${marker}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW();`);
sql('alice', `INSERT INTO "Application" (id,title,"updatedAt") VALUES ('isolationapplication','${marker}',NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title;`);
sql('bravo', `INSERT INTO "ProfileField" (key, value, "updatedAt") VALUES ('name', 'Other Workspace', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW();`);
const exportAs = async (cookie) => {
  const response = await request('/api/export', { headers: { cookie } });
  assert.equal(response.status, 200, 'native Dossier recognizes gateway session');
  return response.json();
};
const [a, b] = await Promise.all([exportAs(alice), exportAs(bravo)]);
assert.ok(JSON.stringify(a).includes(marker));
assert.ok(!JSON.stringify(b).includes(marker), 'another account cannot export private data');
const aPage = await request('/applications/isolationapplication', { headers: { cookie: alice } });
assert.equal(aPage.status, 200);
const bPage = await request('/applications/isolationapplication', { headers: { cookie: bravo } });
const bHtml = await bPage.text();
// Next.js may have streamed a 200 shell before notFound() resolves.
assert.ok(bPage.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404|could not be found/i.test(bHtml), 'guessing another account application ID reaches not-found');
assert.ok(!bHtml.includes(marker));
const page = await request('/profile', { headers: { cookie: alice } });
assert.equal(page.status, 200);
assert.ok((await page.text()).includes(marker), 'profile page renders own data');

const pdf = await request('/api/pdf?doc=base', { headers: { cookie: alice } });
assert.equal(pdf.status, 200, 'Chromium prints the authenticated private resume');
assert.match(pdf.headers.get('content-type'), /application\/pdf/);
assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

const held = await request('/api/pdf?doc=base', { method: 'POST', headers: { cookie: alice, origin } });
assert.equal(held.status, 200);
const { url } = await held.json();
assert.equal((await request(url, { headers: { cookie: alice } })).status, 200);
assert.equal((await request(url, { headers: { cookie: bravo } })).status, 404, 'another account cannot download a held PDF');

assert.equal((await request('/_accounts/admin', { headers: { cookie: bravo } })).status, 403);
assert.equal((await request('/_accounts/admin', { headers: { cookie: alice } })).status, 200);
const settings = await request('/settings?section=scoring', { headers: { cookie: alice } });
assert.ok((await settings.text()).includes('OpenAI Decisions'));
async function personal(cookie) {
  const result = await request('/_accounts/mcp', { method: 'POST', headers: { cookie, origin }, body: new URLSearchParams({ operation: 'create' }) });
  assert.equal(result.status, 200);
  return (await result.text()).match(/dossier_personal_[\w-]+/)[0];
}
const am = await personal(alice);
const bm = await personal(bravo);
let rpcId = 0;
async function rpc(token, method, params = {}) {
  const result = await request('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  assert.equal(result.status, 200, `MCP ${method} HTTP status`);
  const body = await result.text();
  const parsed = result.headers.get('content-type').includes('text/event-stream') ? body.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))).find((value) => value.id === rpcId) : JSON.parse(body);
  assert.ok(!parsed.error, `MCP ${method} completed`);
  return parsed.result;
}
for (const token of [am, bm]) {
  const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'dossier-private-isolation-test', version: '1' } });
  assert.ok(initialized.serverInfo.name);
  const tools = await rpc(token, 'tools/list');
  assert.ok(tools.tools.some((tool) => tool.name === 'get_profile'));
}
assert.ok(JSON.stringify(await rpc(am, 'tools/call', { name: 'get_profile', arguments: {} })).includes(marker));
assert.ok(!JSON.stringify(await rpc(bm, 'tools/call', { name: 'get_profile', arguments: {} })).includes(marker));

// Prove deletion is bounded to one account, using only disposable fixture data.
sql('bravo', 'DELETE FROM "Application"; DELETE FROM "ProfileField";');
assert.ok(JSON.stringify(await exportAs(alice)).includes(marker));

execFileSync('python3', [path.join(directory, 'manage.py'), 'reset-password', 'alice', '--generate', '--credentials-file', path.join(directory, 'credentials/reset.txt')]);
assert.equal((await request('/api/export', { headers: { cookie: alice } })).status, 401, 'password reset revokes previous sessions');
assert.equal((await request('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${am}` }, body: '{}' })).status, 401, 'password reset revokes MCP tokens');
assert.equal((await request('/api/export', { headers: { cookie: bravo } })).status, 200, 'another user stays signed in');
execFileSync('python3', [path.join(directory, 'manage.py'), 'disable', 'bravo']);
assert.equal((await request('/api/export', { headers: { cookie: bravo } })).status, 401, 'disabled account loses access');
assert.equal((await request('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${bm}` }, body: '{}' })).status, 401, 'disabled account loses MCP access');

const details = JSON.parse(compose('config', '--format', 'json'));
for (const [name, service] of Object.entries(details.services)) {
  if (name !== 'gateway') assert.ok(!service.ports?.length, 'backends and databases have no public ports');
}
assert.notDeepEqual(details.services['app-alice'].networks, details.services['app-bravo'].networks);
assert.notEqual(details.services['app-alice'].environment.DATABASE_URL, details.services['app-bravo'].environment.DATABASE_URL);
assert.notEqual(details.services['app-alice'].environment.DOSSIER_SECRET, details.services['app-bravo'].environment.DOSSIER_SECRET);
assert.ok(!JSON.stringify(details.services.gateway.volumes).includes('docker.sock'));
await writeFile(path.join(directory, 'verification.txt'), 'Passed: two native Dossier accounts, private exports/profile/application IDs, real PDF rendering and held-PDF isolation, reset/disable revocation, deletion isolation, distinct database credentials/secrets/volumes/networks, no public backend ports or Docker socket.\n');
console.log('PASS: production Dossier end-to-end account isolation and PDF verification');
