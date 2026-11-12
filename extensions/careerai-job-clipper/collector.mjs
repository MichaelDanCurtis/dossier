import { extractLinkedinJob } from './extract.mjs';
import { linkedinAccessState, expandLinkedinDescription } from './search.mjs';

export const COLLECTION_LIMIT = 10;
export const PAGE_INTERVAL_MS = 8000;
export const allowedJobUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.linkedin.com', 'linkedin.com'].includes(url.hostname) && !url.port && !url.username && !url.password && /^\/jobs\//.test(url.pathname); } catch { return false; }
};
const jobId = value => { const url = new URL(value); return /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname)?.[1] || url.searchParams.get('currentJobId'); };
export const pause = message => Object.assign(new Error(message), { pause: true });
export const waitFor = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  signal.addEventListener('abort', stop, { once: true });
});

/** Runs only while the user-opened collection page is alive. No worker, scheduler or LinkedIn API. */
export async function collectJobs({ tabId, sourceUrl, jobs, chromeApi, save, update, signal, wait = waitFor, now = Date.now }) {
  if (!Number.isInteger(tabId) || !allowedJobUrl(sourceUrl) || !Array.isArray(jobs) || !jobs.length || jobs.length > COLLECTION_LIMIT || new Set(jobs.map(j => j.id)).size !== jobs.length || jobs.some(j => !/^\d{1,30}$/.test(j.id) || j.url !== `https://www.linkedin.com/jobs/view/${j.id}/`)) throw new Error('Choose one to ten jobs from a LinkedIn search.');
  const rows = jobs.map(job => ({ ...job, status: 'waiting', message: '', postingId: '' }));
  let expected = sourceUrl, previousNavigation = -Infinity, consecutiveFailures = 0;
  const emit = () => update(rows.map(row => ({ ...row })));
  const assertTab = async () => {
    signal.throwIfAborted();
    let tab; try { tab = await chromeApi.tabs.get(tabId); } catch { throw pause('The LinkedIn tab was closed. Reopen a search and start a new collection.'); }
    if (!allowedJobUrl(tab.url)) throw pause('LinkedIn sign-in, verification or a different page needs your attention. Collection is paused; no verification will be bypassed.');
    if (jobId(tab.url) !== jobId(expected) || new URL(tab.url).pathname.replace(/\/+$/, '') !== new URL(expected).pathname.replace(/\/+$/, '')) throw pause('The LinkedIn tab changed while collecting. Start a new collection from the page you want to use.');
    return tab;
  };
  await emit();
  try {
    for (const row of rows) {
      await assertTab();
      await wait(Math.max(0, PAGE_INTERVAL_MS - (now() - previousNavigation)), signal);
      await assertTab();
      row.status = 'reading'; await emit(); signal.throwIfAborted();
      previousNavigation = now();
      await chromeApi.tabs.update(tabId, { url: row.url }); expected = row.url;
      try {
        let captured, expanded = false, lastProblem = 'The full job details did not load.';
        for (let attempt = 0; attempt < 25; attempt++) {
          signal.throwIfAborted();
          let tab; try { tab = await chromeApi.tabs.get(tabId); } catch { throw pause('The LinkedIn tab was closed.'); }
          if (!allowedJobUrl(tab.url)) throw pause('LinkedIn needs sign-in or verification. Complete that yourself, then start a new collection.');
          if (tab.status !== 'complete') { await wait(1200, signal); continue; }
          if (jobId(tab.url) !== row.id) throw pause('The LinkedIn tab changed to another job. Collection has paused.');
          let access;
          try { [access] = await chromeApi.scripting.executeScript({ target: { tabId }, func: linkedinAccessState }); } catch { throw pause('Chrome cannot read this tab. Open LinkedIn and invoke the CareerAI toolbar button again.'); }
          if (access?.result?.blocked) throw pause('LinkedIn needs sign-in or verification. Complete it yourself before starting again.');
          if (!expanded) {
            const [result] = await chromeApi.scripting.executeScript({ target: { tabId }, func: expandLinkedinDescription });
            expanded = true;
            if (result?.result === true) { await wait(1200, signal); continue; }
          }
          try {
            const [result] = await chromeApi.scripting.executeScript({ target: { tabId }, func: extractLinkedinJob });
            const job = result?.result;
            if (!job || job.url !== row.url || !job.title?.trim() || !job.company?.trim() || job.text?.trim().length < 80) throw new Error('The complete title, company and description are not ready.');
            captured = job; break;
          } catch (error) { if (/cannot access|missing host permission|not allowed|frame.*removed/i.test(error.message || '')) throw pause('Chrome access to the LinkedIn tab changed. Open CareerAI from that tab again.'); lastProblem = error.message || lastProblem; }
          await wait(1200, signal);
        }
        if (!captured) throw new Error(lastProblem);
        await assertTab(); signal.throwIfAborted();
        row.status = 'saving'; await emit(); signal.throwIfAborted();
        // Saving is a single attempt. A lost response is uncertain, never an automatic retry.
        let result;
        try { result = await save(captured, signal); } catch (error) { throw pause(error.status === 401 ? 'CareerAI access expired or was revoked. Pair the extension again; LinkedIn stays signed in.' : 'Could not confirm this save. Check CareerAI before starting again. ' + (error.message || '')); }
        if (typeof result.id !== 'string' || result.saved !== true) throw pause('CareerAI did not confirm the save. Check your saved jobs before trying again.');
        row.status = 'saved'; row.postingId = result.id; row.message = 'Saved full description'; consecutiveFailures = 0;
      } catch (error) {
        if (signal.aborted || error.pause) throw error;
        row.status = 'skipped'; row.message = String(error.message || 'Job details could not be read.').slice(0, 500);
        consecutiveFailures++;
        if (consecutiveFailures === 3) throw pause('Three job descriptions could not be read. Check the LinkedIn tab before starting again.');
      }
      await emit();
    }
    return { status: 'complete', rows };
  } catch (error) {
    const active = rows.find(row => row.status === 'reading' || row.status === 'saving');
    if (active) { active.status = active.status === 'saving' ? 'uncertain' : 'stopped'; active.message = active.status === 'uncertain' ? 'Check CareerAI; the save may have completed.' : 'Stopped before saving.'; }
    await emit();
    return { status: signal.aborted ? 'stopped' : 'paused', message: String(error.message || 'Collection stopped.').slice(0, 1000), rows };
  }
}
