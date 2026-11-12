import { extractLinkedinJob } from './extract.mjs';
import { extractLinkedinResults } from './search.mjs';
const base = 'https://careerai.thecurtis.cloud';
const $ = (id) => document.getElementById(id);
let connection, busy = false;
const report = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = String(error); };
function render() {
  $('pairing').hidden = !!connection; $('connection').hidden = !connection;
  $('account').textContent = connection ? `Connected to ${connection.account}’s private workspace.` : '';
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  $('save').disabled = busy || !connection || !$('approved').checked;
}
async function api(path, body, token) {
  const response = await fetch(base + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  let result; try { result = await response.json(); } catch { throw new Error('CareerAI returned an unexpected response. Sign in there and try again.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'CareerAI could not complete this request.'), { status: response.status });
  return result;
}
async function work(fn) { if (busy) return; busy = true; render(); try { await fn(); } catch (error) { if (error.status === 401 && connection) { connection = undefined; await chrome.storage.local.remove('connection'); report('CareerAI access expired or was revoked. Create a new pairing code and connect again.', true); } else report(error.message || 'Could not confirm this operation. Check CareerAI before retrying.', true); } finally { busy = false; render(); } }
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
connection = (await chrome.storage.local.get('connection')).connection;
if (connection && connection.expiresAt <= Date.now()) { connection = undefined; await chrome.storage.local.remove('connection'); }
render();
$('pair-form').addEventListener('submit', (event) => { event.preventDefault(); void work(async () => {
  const code = $('pair-code').value.trim(); $('pair-code').value = '';
  const result = await api('/api/extension/pair', { code });
  if (!result.token?.startsWith('careerai_jobs_') || typeof result.account !== 'string' || !Number.isFinite(result.expiresAt)) throw new Error('CareerAI returned an invalid connection. Create another pairing code.');
  connection = { token: result.token, account: result.account, expiresAt: result.expiresAt };
  await chrome.storage.local.set({ connection }); report('Connected. Capture a job to review and save it.');
}); });
$('disconnect').addEventListener('click', () => { void work(async () => {
  await api('/api/extension/revoke', {}, connection.token); connection = undefined; await chrome.storage.local.remove('connection'); report('Extension access revoked. LinkedIn stays signed in.');
}); });
$('capture').addEventListener('click', () => { void work(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?linkedin\.com\/jobs\//.test(tab.url || '')) throw new Error('Open a LinkedIn job or select one in LinkedIn’s job search first.');
  const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinkedinJob });
  if (!capture?.result) throw new Error('The job could not be captured. Open the job details and try again.');
  const job = capture.result;
  for (const id of ['url', 'title', 'company', 'place', 'salary', 'text']) $(id).value = typeof job[id] === 'string' ? job[id] : '';
  $('remote').checked = job.remote === true; $('approved').checked = false; $('review').hidden = false; $('saved').hidden = true;
  report('Review the captured details. Correct missing fields before saving.');
}); });
$('collect-search').addEventListener('click', () => { void work(async () => {
  if (!connection) throw new Error('Connect CareerAI before starting a collection.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a LinkedIn job search first.');
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinkedinResults });
  if (!result?.result?.jobs?.length) throw new Error('No job results could be read. Wait for the search to finish loading.');
  const existing = await chrome.storage.session.get(null);
  const keys = Object.keys(existing).filter(key => key.startsWith('collection:')).sort((a, b) => (existing[b].capturedAt || 0) - (existing[a].capturedAt || 0));
  await chrome.storage.session.remove(keys.slice(3));
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ ['collection:' + id]: { ...result.result, tabId: tab.id } });
  await chrome.tabs.create({ url: chrome.runtime.getURL('collect.html') + '?session=' + id });
  report('Collection preview opened. Choose the jobs and start there.');
}); });
$('review').addEventListener('input', (event) => { if (event.target.id !== 'approved') $('approved').checked = false; render(); });
$('review').addEventListener('submit', (event) => { event.preventDefault(); void work(async () => {
  if (!connection || !$('approved').checked) throw new Error('Connect CareerAI and approve the reviewed job first.');
  const job = Object.fromEntries(['url', 'title', 'company', 'place', 'salary', 'text'].map((id) => [id, $(id).value.trim()])); job.remote = $('remote').checked;
  await api('/api/extension/jobs', { ...job, approved: true }, connection.token);
  $('approved').checked = false; $('saved').hidden = false; report('Saved to CareerAI. No application was submitted.');
}); });
