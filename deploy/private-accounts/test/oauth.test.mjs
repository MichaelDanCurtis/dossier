import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createOAuth } from '../oauth.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

async function fixture(t, databasePath) {
  const origin = 'https://dossier.example.test';
  let clock = Date.now();
  const generations = { alice: 'generation-a', bravo: 'generation-b' };
  const config = { sessionSecret: randomBytes(32).toString('hex'), users: ['alice', 'bravo'].map((id) => ({ id, revision: '1', active: true })) };
  const options = { origin, databasePath, connector: async (user) => generations[user.id], now: () => clock };
  let oauth = createOAuth(options);
  t.after(() => oauth.close());
  const client = await oauth.register({ client_name: 'Test client', redirect_uris: ['https://client.example/callback'] }, config);
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: origin + '/api/mcp', state: 'client-state', scope: 'dossier' });
  const exchangeParams = (code) => new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.example/callback', grant_type: 'authorization_code', code, code_verifier: verifier, resource: origin + '/api/mcp' });
  const refreshParams = (token) => new URLSearchParams({ client_id: client.client_id, grant_type: 'refresh_token', refresh_token: token });
  return { get oauth() { return oauth; }, config, params, generations, exchangeParams, refreshParams, advance: (ms) => { clock += ms; }, reopen: () => { oauth.close(); oauth = createOAuth(options); } };
}

test('OAuth consent, PKCE, single-use codes and refresh rotation work without sharing accounts', async (t) => {
  const f = await fixture(t);
  const redirect = new URL(await f.oauth.consent(f.params, f.config.users[0], f.config, true));
  assert.equal(redirect.origin, 'https://client.example');
  assert.equal(redirect.searchParams.get('state'), 'client-state');
  const params = f.exchangeParams(redirect.searchParams.get('code'));
  const wrong = new URLSearchParams(params); wrong.set('code_verifier', randomBytes(32).toString('base64url'));
  await assert.rejects(f.oauth.exchange(wrong, f.config), /authorization request/);
  const pair = await f.oauth.exchange(params, f.config);
  assert.equal((await f.oauth.authenticate(pair.access_token, f.config)).user.id, 'alice');
  assert.equal(await f.oauth.authenticate(pair.refresh_token, f.config), null);
  await assert.rejects(f.oauth.exchange(params, f.config));
  const second = await f.oauth.exchange(f.refreshParams(pair.refresh_token), f.config);
  assert.notEqual(pair.refresh_token, second.refresh_token);
  assert.equal((await f.oauth.authenticate(second.access_token, f.config)).user.id, 'alice');
  await assert.rejects(f.oauth.exchange(f.refreshParams(pair.refresh_token), f.config), /reuse/);
  assert.equal(await f.oauth.authenticate(second.access_token, f.config), null);
});

test('grant scope, redirects, consent denial and connector-generation revocation are enforced', async (t) => {
  const f = await fixture(t);
  for (const [field, value] of [['redirect_uri', 'https://attacker.example/callback'], ['resource', 'https://other.example/api/mcp'], ['scope', 'admin'], ['code_challenge_method', 'plain']]) {
    const bad = new URLSearchParams(f.params); bad.set(field, value);
    await assert.rejects(f.oauth.begin(bad, f.config));
  }
  await assert.rejects(f.oauth.register({ redirect_uris: ['http://public.example/callback'] }, f.config));
  const denied = new URL(await f.oauth.consent(f.params, f.config.users[0], f.config, false));
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.get('code'), null);
  const a = await f.oauth.personal(f.config.users[0]);
  const b = await f.oauth.personal(f.config.users[1]);
  f.generations.alice = 'disconnected-and-enabled-again';
  assert.equal(await f.oauth.authenticate(a.token, f.config), null);
  assert.equal((await f.oauth.authenticate(b.token, f.config)).user.id, 'bravo');
  f.config.users[1].active = false;
  assert.equal(await f.oauth.authenticate(b.token, f.config), null);
});

test('MCP grants survive a gateway restart and expire on schedule', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dossier-oauth-test-'));
  t.after(() => rm(directory, { recursive: true }));
  const f = await fixture(t, path.join(directory, 'tokens.db'));
  const a = await f.oauth.personal(f.config.users[0]);
  f.reopen();
  assert.equal((await f.oauth.authenticate(a.token, f.config)).user.id, 'alice');
  f.advance(91 * 86400_000);
  assert.equal(await f.oauth.authenticate(a.token, f.config), null);
});
