import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractLinkedinJob } from './extract.mjs';

test('captures only the selected job pane and strips tracking without reading form fields', () => {
  const dom = new JSDOM(`<html><body><aside>PRIVATE INBOX</aside><div class="job-card"><h1>Other job</h1></div><section class="jobs-search__job-details--container"><div class="job-details-jobs-unified-top-card__job-title"><h1>Platform Engineer</h1></div><div class="job-details-jobs-unified-top-card__company-name">Example Company</div><div class="job-details-jobs-unified-top-card__tertiary-description-container">Seattle</div><div id="job-details"><p>${'Build reliable infrastructure and support engineering teams. '.repeat(3)}</p><input value="PRIVATE INPUT"><textarea>PRIVATE FORM DATA</textarea><button>Apply now</button><script>PRIVATE SCRIPT</script></div></section></body></html>`, { url: 'https://www.linkedin.com/jobs/search/?currentJobId=12345&trackingId=secret' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  const result = extractLinkedinJob();
  assert.equal(result.url, 'https://www.linkedin.com/jobs/view/12345/'); assert.equal(result.title, 'Platform Engineer'); assert.equal(result.company, 'Example Company');
  assert.ok(result.text.length > 80); assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!result.text.includes('Apply now')); assert.equal(result.salary, ''); assert.equal(result.remote, false);
  dom.window.close(); delete globalThis.document; delete globalThis.location;
});
test('refuses unrelated sites and jobs home without a selected opportunity', () => {
  for (const url of ['https://linkedin.com.evil.test/jobs/view/123/', 'https://www.linkedin.com/feed/', 'https://www.linkedin.com/jobs/search/']) {
    const dom = new JSDOM('<html></html>', { url }); globalThis.document = dom.window.document; globalThis.location = dom.window.location;
    assert.throws(() => extractLinkedinJob()); dom.window.close();
  }
  delete globalThis.document; delete globalThis.location;
});
test('minimal permissions and no unattended LinkedIn access', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://careerai.thecurtis.cloud/*']);
  assert.equal(manifest.background, undefined); assert.equal(manifest.content_scripts, undefined);
  const script = await readFile(new URL('./popup.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes("credentials: 'omit'")); assert.ok(!/chrome\.(cookies|debugger|webRequest)/.test(script)); assert.ok(!/document\.cookie/.test(script));
});
