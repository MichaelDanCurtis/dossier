import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBridge } from './server.mjs';
import { LIMITS, linkedinUrl, resourceAllowed, jobUrl, pageProblem, nextPageAt } from './policy.mjs';

test('restricted destinations and fixed collection policy', () => {
  for (const value of ['http://www.linkedin.com/', 'https://linkedin.com.evil.test/', 'https://me:secret@linkedin.com/', 'https://127.0.0.1/', 'https://www.linkedin.com:444/']) assert.throws(() => linkedinUrl(value));
  for (const value of ['http://linkedin.com/', 'https://metadata.google.internal/', 'https://169.254.169.254/', 'https://licdn.com.evil.test/', 'file:///etc/passwd']) assert.equal(resourceAllowed(value), false);
  assert.equal(resourceAllowed('https://media.licdn.com/a.png'), true);
  assert.equal(resourceAllowed('https://challenges.cloudflare.com/turnstile/v0/api.js'), true);
  assert.equal(resourceAllowed('https://region.challenges.cloudflare.com/cdn-cgi/challenge-platform/'), true);
  for (const url of ['https://challenges.cloudflare.com.evil.test/api.js', 'https://notchallenges.cloudflare.com/', 'https://cloudflare.com/', 'http://challenges.cloudflare.com/', 'https://user:pass@challenges.cloudflare.com/', 'https://challenges.cloudflare.com:444/']) assert.equal(resourceAllowed(url), false);
  assert.equal(jobUrl('https://www.linkedin.com/jobs/view/role-name-123/?trackingId=secret'), 'https://www.linkedin.com/jobs/view/123/');
  assert.ok(pageProblem('https://www.linkedin.com/checkpoint/challenge/', 200));
  assert.ok(pageProblem('https://www.linkedin.com/jobs/', 429));
  assert.equal(nextPageAt({ lastPageAt: 100 }, 200), 30100);
  assert.equal(LIMITS.dayPages, 40); assert.equal(LIMITS.runJobs, 8);
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'careerai-bridge-'));
  let clock = 1794000000000, current = 'about:blank', launches = 0, actions = [], requests = [];
  const page = {
    url: () => current, setDefaultTimeout() {}, on() {}, close: async () => {},
    goto: async (url) => { current = url; clock += 31000; requests.push(url); return { status: () => options.status || 200 }; },
    waitForTimeout: async () => {}, screenshot: async () => Buffer.from('fixture screen'),
    locator: () => ({ innerText: async () => 'Job information', evaluateAll: async () => Array.from({ length: 12 }, (_, i) => `https://www.linkedin.com/jobs/view/${i + 1}/`) }),
    evaluate: async () => ({ title: 'Engineer', company: 'Example', place: 'Remote', text: 'Build and operate engineering systems with a team. '.repeat(5) }),
    mouse: { click: async (...args) => actions.push(['click', ...args]), wheel: async (...args) => actions.push(['wheel', ...args]) }, keyboard: { insertText: async (text) => actions.push(['text', text]), press: async (key) => actions.push(['key', key]) },
  };
  const context = { route: async () => {}, routeWebSocket: async () => {}, on() {}, pages: () => [page], close: async () => {} };
  const chromium = { launchPersistentContext: async () => { launches++; return context; } };
  const token = 'fixture-token-'.repeat(4);
  if (options.dayPages) await writeFile(path.join(directory, 'collection.json'), JSON.stringify({ day: new Date(clock).toISOString().slice(0, 10), dayPages: options.dayPages }));
  const instance = await createBridge({ token, directory, chromium, now: () => clock });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const call = async (route, input, auth = token) => {
    const response = await fetch(base + route, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await instance.close(); instance.server.closeAllConnections(); await new Promise((resolve) => instance.server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { call, directory, actions, requests, launchCount: () => launches, advance: (ms) => { clock += ms; }, token, chromium };
}
test('browser is lazy and manually controlled only with an expiring per-window lease', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/status', undefined, 'wrong')).status, 401);
  assert.equal(f.launchCount(), 0);
  const opened = await f.call('/open', {}); const manualId = opened.body.manualId;
  assert.equal(f.launchCount(), 1);
  assert.equal((await f.call('/input', { manualId: 'other', kind: 'click', x: 1, y: 1, approved: true })).status, 400);
  assert.equal((await f.call('/input', { manualId, kind: 'click', x: 1, y: 1, approved: false })).status, 400);
  assert.equal((await f.call('/input', { manualId, kind: 'click', x: 1, y: 1, approved: true })).status, 200);
  assert.deepEqual(f.actions, [['click', 1, 1]]);
  assert.equal((await f.call('/collect', { keywords: 'Engineer', location: '', approved: true })).status, 400);
  f.advance(LIMITS.manualMs + 1);
  assert.equal((await f.call('/screen', { manualId })).status, 400);
  assert.equal((await f.call('/publish', { approved: true })).status, 400);
  assert.equal((await f.call('/submit', { approved: true })).status, 400);
});
test('one bounded read-only collection persists budgets and canonical opportunities', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/collect', { keywords: 'Engineer', location: 'Remote', approved: true })).status, 200);
  let state;
  for (let i = 0; i < 100; i++) { state = (await f.call('/status')).body; if (!state.running) break; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.equal(state.running, false); assert.equal(state.jobs.length, 8); assert.equal(state.dayPages, 9);
  assert.equal(f.requests.length, 9); assert.deepEqual(f.actions, []);
  assert.equal((await f.call('/collect', { keywords: 'Engineer', location: '', approved: true })).status, 400);
  const persisted = JSON.parse(await readFile(path.join(f.directory, 'collection.json'), 'utf8'));
  assert.equal(persisted.dayPages, 9); assert.equal(persisted.jobs.length, 8);
  const restarted = await createBridge({ token: f.token, directory: f.directory, chromium: f.chromium });
  await restarted.close();
});
test('rate limits stop collection immediately, without retries or manual actions', async (t) => {
  const f = await fixture(t, { status: 429 });
  await f.call('/collect', { keywords: 'Engineer', location: '', approved: true });
  let state;
  for (let i = 0; i < 100; i++) { state = (await f.call('/status')).body; if (!state.running) break; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.equal(f.requests.length, 1); assert.equal(state.jobs.length, 0); assert.match(state.message, /slow down/); assert.deepEqual(f.actions, []);
});
test('two private bridges do not share sessions or accept each other’s browser lease', async (t) => {
  const a = await fixture(t), b = await fixture(t);
  const { manualId } = (await a.call('/open', {})).body;
  assert.equal((await b.call('/screen', { manualId })).status, 400);
  assert.equal(b.launchCount(), 0);
});
test('daily navigation cap survives restart and concurrent collection starts are refused', async (t) => {
  const f = await fixture(t);
  const searches = await Promise.all([f.call('/collect', { keywords: 'Engineer', location: '', approved: true }), f.call('/collect', { keywords: 'Engineer', location: '', approved: true })]);
  assert.deepEqual(searches.map((result) => result.status).sort(), [200, 400]);
  await f.call('/stop', {});
  const persisted = JSON.parse(await readFile(path.join(f.directory, 'collection.json'), 'utf8'));
  assert.ok(persisted.lastRunAt > 0);
  assert.equal(persisted.dayPages, f.requests.length);
});

test('a persisted daily cap blocks all further navigation', async (t) => {
  const f = await fixture(t, { dayPages: 40 });
  await f.call('/collect', { keywords: 'Engineer', location: '', approved: true });
  let state;
  for (let i = 0; i < 50; i++) { state = (await f.call('/status')).body; if (!state.running) break; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.equal(state.dayPages, 40); assert.match(state.message, /Daily collection limit/); assert.equal(f.requests.length, 0);
});
