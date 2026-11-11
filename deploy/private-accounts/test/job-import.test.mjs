import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobImportAccess, extensionOrigin } from '../job-import.mjs';
const origin = 'chrome-extension://' + 'a'.repeat(32), other = 'chrome-extension://' + 'b'.repeat(32);
function fixture(t) {
  let now = 1794000000000;
  const access = createJobImportAccess({ now: () => now });
  t.after(() => access.close());
  const user = { id: 'alice', username: 'alice', revision: 'v1', active: true }, bravo = { id: 'bravo', username: 'bravo', revision: 'v1', active: true };
  return { access, user, bravo, config: { users: [user, bravo] }, advance: (ms) => { now += ms; } };
}
test('pairing is single use, account bound, origin bound and revocable', (t) => {
  const f = fixture(t), code = f.access.pair(f.user).code;
  const result = f.access.exchange(code, origin, f.config);
  assert.equal(result.account, 'alice'); assert.ok(result.token.startsWith('careerai_jobs_'));
  assert.throws(() => f.access.exchange(code, origin, f.config));
  assert.equal(f.access.authenticate(result.token, other, f.config), null);
  assert.equal(f.access.list(f.bravo).length, 0);
  const grant = f.access.authenticate(result.token, origin, f.config); assert.equal(grant.user.id, 'alice');
  f.access.revoke(f.bravo, grant.id); assert.ok(f.access.authenticate(result.token, origin, f.config));
  f.access.revoke(f.user, grant.id); assert.equal(f.access.authenticate(result.token, origin, f.config), null);
});
test('expired codes, replaced codes and non-extension origins are refused', (t) => {
  const f = fixture(t), old = f.access.pair(f.user).code, current = f.access.pair(f.user).code;
  assert.throws(() => f.access.exchange(old, origin, f.config));
  assert.throws(() => f.access.exchange(current, 'https://evil.test', f.config));
  f.advance(300001); assert.throws(() => f.access.exchange(current, origin, f.config));
  assert.equal(extensionOrigin('chrome-extension://' + 'a'.repeat(32) + '.evil.test'), false);
});
test('password changes, disabled accounts, expiry and revoke-all invalidate connections', (t) => {
  const f = fixture(t), pair = () => f.access.exchange(f.access.pair(f.user).code, origin, f.config).token;
  const first = pair(); f.user.revision = 'v2'; assert.equal(f.access.authenticate(first, origin, f.config), null);
  const second = pair(); f.user.active = false; assert.equal(f.access.authenticate(second, origin, f.config), null); f.user.active = true;
  f.access.revoke(f.user, 'all'); assert.equal(f.access.authenticate(second, origin, f.config), null);
  const third = pair(); f.advance(91 * 86400000); assert.equal(f.access.authenticate(third, origin, f.config), null);
});
test('five-device limit and persistent per-minute quota prevent runaway imports', (t) => {
  const f = fixture(t); const tokens = Array.from({ length: 5 }, () => f.access.exchange(f.access.pair(f.user).code, origin, f.config).token);
  assert.throws(() => f.access.pair(f.user));
  for (let i = 0; i < 30; i++) assert.ok(f.access.authenticate(tokens[0], origin, f.config));
  assert.throws(() => f.access.authenticate(tokens[0], origin, f.config), /Too many/);
  assert.ok(f.access.authenticate(tokens[0], origin, f.config, false), 'Revocation remains available even at the save limit');
  f.advance(61000); assert.ok(f.access.authenticate(tokens[0], origin, f.config));
});
test('only token/code hashes are stored, and revocation survives a service restart', async (t) => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const directory = await mkdtemp(path.join(tmpdir(), 'careerai-import-access-')); const filename = path.join(directory, 'tokens.db');
  const user = { id: 'alice', username: 'alice', active: true, revision: 'v1' }, config = { users: [user] };
  let access = createJobImportAccess({ databasePath: filename });
  const code = access.pair(user).code, { token } = access.exchange(code, origin, config); access.close();
  assert.ok(!(await readFile(filename)).includes(Buffer.from(token))); assert.ok(!(await readFile(filename)).includes(Buffer.from(code)));
  access = createJobImportAccess({ databasePath: filename }); const grant = access.authenticate(token, origin, config); assert.ok(grant); access.revoke(user, grant.id); access.close();
  access = createJobImportAccess({ databasePath: filename }); assert.equal(access.authenticate(token, origin, config), null); access.close(); await rm(directory, { recursive: true, force: true });
});
