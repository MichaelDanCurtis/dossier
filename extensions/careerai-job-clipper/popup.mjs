import { extractLinkedinJob } from './extract.mjs';
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
  if (!response.ok) throw new Error(result.error || 'CareerAI could not complete this request.');
  return result;
}
async function work(fn) { if (busy) return; busy = true; render(); try { await fn(); } catch (error) { report(error.message || 'Could not confirm this operation. Check CareerAI before retrying.', true); } finally { busy = false; render(); } }
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
  $('remote').checked = false; $('approved').checked = false; $('review').hidden = false; $('saved').hidden = true;
  report('Review the captured details. Correct missing fields before saving.');
}); });
$('review').addEventListener('input', (event) => { if (event.target.id !== 'approved') $('approved').checked = false; render(); });
$('review').addEventListener('submit', (event) => { event.preventDefault(); void work(async () => {
  if (!connection || !$('approved').checked) throw new Error('Connect CareerAI and approve the reviewed job first.');
  const job = Object.fromEntries(['url', 'title', 'company', 'place', 'salary', 'text'].map((id) => [id, $(id).value.trim()])); job.remote = $('remote').checked;
  await api('/api/extension/jobs', { ...job, approved: true }, connection.token);
  $('approved').checked = false; $('saved').hidden = false; report('Saved to CareerAI. No application was submitted.');
}); });
