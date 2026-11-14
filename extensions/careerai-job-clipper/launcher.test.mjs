import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLauncher } from './launcher.mjs';

function fixture(existing = []) {
  const saved = {}, calls = [], tabs = new Map([[1, { id: 1, url: 'https://www.linkedin.com/jobs/search/', status: 'complete' }]]);
  const chrome = {
    storage: { session: { get: async key => ({ [key]: saved[key] }), set: async value => Object.assign(saved, value), remove: async key => { delete saved[key]; } } },
    action: { setBadgeText: async value => calls.push(['badge', value]), setTitle: async value => calls.push(['title', value]) },
    scripting: { executeScript: async value => calls.push(['inject', value]) },
    tabs: {
      get: async id => tabs.get(id), query: async () => existing,
      create: async value => { calls.push(['create', value]); const tab = { ...value, id: 2, status: 'loading' }; tabs.set(2, tab); return tab; },
      update: async (id, value) => calls.push(['activate', id, value]),
      sendMessage: async (id, value) => calls.push(['message', id, value]),
    },
  };
  return { chrome, calls, saved, tabs, launcher: createLauncher(chrome, async () => calls.push(['register'])) };
}
test('toolbar opens the modal on the current LinkedIn page without any extra page', async () => {
  const f = fixture(); await f.launcher.launch(f.tabs.get(1), Promise.resolve(true));
  assert.equal(f.calls.filter(([kind]) => kind === 'create').length, 0);
  assert.deepEqual(f.calls.find(([kind]) => kind === 'inject')[1], { target: { tabId: 1 }, files: ['panel.js'] });
  assert.deepEqual(f.calls.find(([kind]) => kind === 'message'), ['message', 1, { type: 'CAREERAI_OPEN' }]);
});
test('denied permission leaves the page and stored connection untouched', async () => {
  const f = fixture(); await assert.rejects(f.launcher.launch(f.tabs.get(1), Promise.resolve(false)), /allow LinkedIn access/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.saved, {});
});
test('outside LinkedIn the toolbar reuses a LinkedIn tab in the same window', async () => {
  const f = fixture([{ id: 1 }]); await f.launcher.launch({ id: 3, url: 'https://example.com/' }, Promise.resolve(true));
  assert.ok(f.calls.some(([kind]) => kind === 'activate')); assert.ok(!f.calls.some(([kind]) => kind === 'create'));
  assert.ok(f.calls.some(([kind]) => kind === 'message')); assert.deepEqual(f.saved, {});
});
test('a newly opened LinkedIn tab opens the modal once after load, even with a new launcher', async () => {
  const f = fixture(); await f.launcher.launch({ id: 3, url: 'https://example.com/' }, Promise.resolve(true));
  assert.deepEqual(f.calls.find(([kind]) => kind === 'create')[1], { url: 'https://www.linkedin.com/feed/', active: true });
  assert.ok(!f.calls.some(([kind]) => kind === 'inject'));
  const resumed = createLauncher(f.chrome, async () => {});
  f.tabs.get(2).status = 'complete'; await resumed.ready(1); await resumed.ready(2); await resumed.ready(2);
  assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1); assert.deepEqual(f.saved, {});
});
test('a tab that leaves LinkedIn before load is never injected', async () => {
  const f = fixture(); await f.launcher.launch({}, Promise.resolve(true));
  f.tabs.get(2).url = 'https://www.linkedin.com.evil.test/'; await assert.rejects(f.launcher.ready(2), /Open LinkedIn/);
  assert.ok(!f.calls.some(([kind]) => kind === 'inject'));
});
