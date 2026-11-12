import { collectJobs, allowedJobUrl, COLLECTION_LIMIT } from './collector.mjs';
import { careeraiRequest, careeraiOrigin } from './api.mjs';

const $ = id => document.getElementById(id);
const sessionId = new URL(location.href).searchParams.get('session');
const key = 'collection:' + sessionId;
let session, connection, controller, running = false;
const report = (message, error = false) => { $('collection-status').textContent = message; $('collection-status').dataset.error = String(error); };
function refreshControls() {
  const selected = Array.from($('job-options').querySelectorAll('input:checked')).length;
  $('start-collection').disabled = running || !connection || !selected || selected > COLLECTION_LIMIT || !$('collection-approved').checked;
  $('start-collection').textContent = running ? 'Collecting…' : `Collect ${selected} ${selected === 1 ? 'job' : 'jobs'}`;
  $('stop-collection').disabled = !running;
  $('collection-approved').disabled = running;
  for (const input of $('job-options').querySelectorAll('input')) input.disabled = running;
}
function renderProgress(rows) {
  $('collection-progress').replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span');
    title.textContent = `${row.title} · ${row.company}`;
    detail.textContent = ` — ${row.status}${row.message ? ': ' + row.message : ''}`;
    li.append(title, detail); $('collection-progress').append(li);
  }
  const saved = rows.filter(row => row.status === 'saved');
  $('collection-count').textContent = `${saved.length} saved · ${rows.filter(row => row.status === 'skipped').length} skipped · ${rows.filter(row => row.status === 'uncertain').length} saves to check`;
  const ids = saved.map(row => row.postingId);
  const uncertain = rows.some(row => row.status === 'uncertain');
  $('open-careerai').hidden = !ids.length && !uncertain;
  $('open-careerai').textContent = uncertain ? 'Open CareerAI and check saved jobs →' : 'Open CareerAI review →';
  $('open-careerai').href = careeraiOrigin + '/linkedin?section=jobs' + (uncertain ? '' : '&batch=' + encodeURIComponent(ids.join(',')));
}

async function boot() {
  if (!/^[a-f0-9-]{36}$/.test(sessionId || '')) throw new Error('Open collection from the CareerAI toolbar button on a LinkedIn search.');
  session = (await chrome.storage.session.get(key))[key];
  if (!session || Date.now() - session.capturedAt > 60 * 60 * 1000 || !allowedJobUrl(session.sourceUrl)) throw new Error('This search preview expired. Open CareerAI again from your LinkedIn search.');
  connection = (await chrome.storage.local.get('connection')).connection;
  if (!connection?.token || connection.expiresAt <= Date.now()) { connection = undefined; report('Pair CareerAI in the extension popup before collecting. Your LinkedIn session stays local.', true); }
  $('collection-account').textContent = connection ? `Saving to ${connection.account}’s private CareerAI workspace.` : 'CareerAI pairing required.';
  $('search-label').textContent = session.keywords ? `LinkedIn search: ${session.keywords}` : 'Jobs from the search you opened in Chrome';
  $('return-search').href = session.sourceUrl; $('return-search').hidden = false;
  for (const [index, job] of session.jobs.entries()) {
    const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
    label.className = 'check job-option'; input.type = 'checkbox'; input.value = job.id; input.checked = index < COLLECTION_LIMIT;
    text.textContent = [job.title, job.company, job.place].filter(Boolean).join(' · '); label.append(input, text); $('job-options').append(label);
  }
  if (session.rows) { renderProgress(session.rows); report(session.state === 'running' ? 'The previous collection was interrupted. Check saved jobs before starting again.' : session.message || 'Previous collection results are shown below.'); }
  else if (connection) report('Review the selected results, then start collection.');
  refreshControls();
}
$('job-options').addEventListener('change', () => { $('collection-approved').checked = false; refreshControls(); });
$('collection-approved').addEventListener('change', refreshControls);
$('stop-collection').addEventListener('click', () => controller?.abort(new Error('You stopped collection. Saved jobs remain in CareerAI.')));
$('start-collection').addEventListener('click', async () => {
  if (running || !connection || !$('collection-approved').checked) return;
  const selected = new Set(Array.from($('job-options').querySelectorAll('input:checked')).map(input => input.value));
  const jobs = session.jobs.filter(job => selected.has(job.id));
  if (!jobs.length || jobs.length > COLLECTION_LIMIT) return report('Choose between one and ten jobs.', true);
  controller = new AbortController(); running = true; refreshControls();
  try {
    if (!navigator.locks) throw new Error('This Chrome version cannot keep collections separate. Update Chrome and try again.');
    await navigator.locks.request('careerai-linkedin-tab-' + session.tabId, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Another collection is using this LinkedIn tab. Stop it before starting another.');
      report('Reading and saving the selected jobs. You can stop collection at any time.');
      const result = await collectJobs({ tabId: session.tabId, sourceUrl: session.sourceUrl, jobs, chromeApi: chrome, signal: controller.signal,
        save: async (job, signal) => {
          if ((await chrome.storage.local.get('connection')).connection?.token !== connection.token) throw new Error('The CareerAI connection changed. Start a new collection with the intended account.');
          try { return await careeraiRequest('/api/extension/jobs', { ...job, approved: true, collection: true }, connection.token, signal); }
          catch (error) { if (error.status === 401) { await chrome.storage.local.remove('connection'); connection = undefined; } throw error; }
        },
        update: async rows => { session.rows = rows; session.state = 'running'; renderProgress(rows); await chrome.storage.session.set({ [key]: session }); },
      });
      session = { ...session, state: result.status, rows: result.rows, message: result.message || 'Collection complete. Open CareerAI to review fit and choose your résumé drafts.' };
      await chrome.storage.session.set({ [key]: session }); renderProgress(result.rows); report(session.message, result.status === 'paused');
    });
  } catch (error) { report(error.message || 'Collection stopped. Check your saved jobs before restarting.', true); }
  finally { running = false; $('collection-approved').checked = false; refreshControls(); }
});
boot().catch(error => report(error.message || 'This collection could not be opened.', true));
