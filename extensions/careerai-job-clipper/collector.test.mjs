import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collectJobs, PAGE_INTERVAL_MS } from './collector.mjs';
import { extractLinkedinResults } from './search.mjs';

test('reads distinct modern search cards, not private page content or hidden duplicate labels', () => {
  const dom = new JSDOM('<aside>PRIVATE INBOX</aside><div role="button" componentkey="job-card-component-ref-123"><p>Platform Lead<span aria-hidden="true">Platform Lead</span></p><p>Example</p><p>Remote</p><button>Dismiss</button></div><div role="button" componentkey="job-card-component-ref-123"><p>Duplicate</p></div><div role="button" componentkey="job-card-component-ref-456"><p>AI Architect</p><p>Other</p><p>Seattle</p></div>', { url: 'https://www.linkedin.com/jobs/search-results/?keywords=platform' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  const result = extractLinkedinResults();
  assert.deepEqual(result.jobs.map(job => job.id), ['123', '456']); assert.equal(result.jobs[0].title, 'Platform Lead'); assert.equal(result.jobs[0].company, 'Example');
  assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result.jobs).includes('Dismiss'));
  dom.window.close(); delete globalThis.document; delete globalThis.location;
});

const choices = Array.from({ length: 4 }, (_, n) => ({ id: String(1000 + n), url: `https://www.linkedin.com/jobs/view/${1000 + n}/`, title: `Role ${n}`, company: 'Example', place: 'Seattle' }));
function fixture() {
  const control = new AbortController(), sourceUrl = 'https://www.linkedin.com/jobs/search-results/?keywords=platform';
  const state = { clock: 0, current: { url: sourceUrl, status: 'complete' }, navigations: [], saves: [], blocked: false, broken: false, snapshots: [], onWait: () => {}, failSave: false };
  const chromeApi = { tabs: { get: async () => ({ ...state.current }), update: async (_id, { url }) => { state.navigations.push({ url, at: state.clock }); state.current.url = url; } }, scripting: { executeScript: async ({ func }) => {
    if (func.name === 'linkedinAccessState') return [{ result: { blocked: state.blocked } }];
    if (func.name === 'expandLinkedinDescription') return [{ result: false }];
    if (state.broken) throw new Error('The complete description is not ready.');
    const id = /view\/(\d+)/.exec(state.current.url)[1];
    return [{ result: { url: state.current.url, title: 'Role ' + id, company: 'Example', place: 'Seattle', salary: '', remote: false, text: 'A complete description of infrastructure, architecture and customer-facing engineering work. '.repeat(3) } }];
  } } };
  const args = { tabId: 42, sourceUrl, jobs: choices.slice(0, 3), chromeApi, signal: control.signal, now: () => state.clock, wait: async ms => { state.clock += ms; state.onWait(ms); control.signal.throwIfAborted(); }, save: async job => { state.saves.push(job); if (state.failSave) throw new Error('Response lost'); return { id: 'saved-' + /view\/(\d+)/.exec(job.url)[1], saved: true }; }, update: async rows => state.snapshots.push(rows) };
  return { args, state, control };
}
test('collects full descriptions sequentially under the page budget', async () => {
  const { args, state } = fixture(); const result = await collectJobs(args);
  assert.equal(result.status, 'complete'); assert.equal(state.saves.length, 3); assert.ok(state.saves.every(job => job.text.length > 80));
  assert.equal(state.navigations[1].at - state.navigations[0].at, PAGE_INTERVAL_MS);
  assert.equal(state.navigations[2].at - state.navigations[1].at, PAGE_INTERVAL_MS);
  assert.ok(result.rows.every(row => row.status === 'saved' && row.postingId.startsWith('saved-')));
});
test('rejects more than ten jobs, duplicate identities and non-job navigation', async () => {
  for (const change of [{ sourceUrl: 'https://evil.test/jobs/search/' }, { jobs: [...choices, ...choices, ...choices] }, { jobs: [choices[0], choices[0]] }, { jobs: [{ ...choices[0], url: 'https://www.linkedin.com/messaging/' }] }]) {
    const { args, state } = fixture(); await assert.rejects(collectJobs({ ...args, ...change })); assert.equal(state.navigations.length, 0); assert.equal(state.saves.length, 0);
  }
});
test('pauses when the user navigates away without taking the tab back', async () => {
  const { args, state } = fixture(); state.onWait = ms => { if (ms > 0) state.current.url = 'https://www.linkedin.com/messaging/'; };
  const result = await collectJobs(args); assert.equal(result.status, 'paused'); assert.equal(state.saves.length, 1); assert.equal(state.navigations.length, 1); assert.match(state.current.url, /messaging/);
});
test('pauses on verification without saving, solving or continuing', async () => {
  const { args, state } = fixture(); state.blocked = true;
  const result = await collectJobs(args); assert.equal(result.status, 'paused'); assert.match(result.message, /verification/); assert.equal(state.saves.length, 0); assert.equal(state.navigations.length, 1);
});
test('stops after a confirmed save and retains it without opening another job', async () => {
  const { args, state, control } = fixture(); const save = args.save;
  args.save = async job => { const result = await save(job); control.abort(new Error('Stopped')); return result; };
  const result = await collectJobs(args); assert.equal(result.status, 'stopped'); assert.equal(state.navigations.length, 1); assert.equal(result.rows[0].status, 'saved');
});
test('keeps uncertain saves visible and never retries them automatically', async () => {
  const { args, state } = fixture(); state.failSave = true;
  const result = await collectJobs(args); assert.equal(result.status, 'paused'); assert.equal(state.saves.length, 1); assert.equal(state.navigations.length, 1); assert.equal(result.rows[0].status, 'uncertain');
});
test('pauses after three unreadable jobs rather than navigating indefinitely', async () => {
  const { args, state } = fixture(); state.broken = true; args.jobs = choices;
  const result = await collectJobs(args); assert.equal(result.status, 'paused'); assert.equal(state.navigations.length, 3); assert.equal(state.saves.length, 0);
});
