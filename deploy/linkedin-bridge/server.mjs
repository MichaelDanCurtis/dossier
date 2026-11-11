import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { LIMITS, linkedinUrl, resourceAllowed, jobUrl, pageProblem, nextPageAt } from './policy.mjs';

/** No MCP/tool endpoint for manual input, publishing, messaging or application submission. */
export async function createBridge({ token, directory, chromium, now = Date.now }) {
  if (!token || token.length < 32) throw new Error('A private bridge token is required.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, 'collection.json');
  let state = { day: '', dayPages: 0, lastPageAt: 0, lastRunAt: 0, jobs: [], message: 'Open the browser to sign into LinkedIn.' };
  try { state = { ...state, ...JSON.parse(await readFile(stateFile, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let context, page, worker, abort, manual, fileChooser, queue = Promise.resolve(), control = Promise.resolve(), writes = Promise.resolve(), closing = false;
  const serial = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const save = () => { const snapshot = JSON.stringify(state); const result = writes.then(async () => { await writeFile(stateFile + '.tmp', snapshot, { mode: 0o600 }); await rename(stateFile + '.tmp', stateFile); }); writes = result.catch(() => {}); return result; };
  const status = () => ({ running: !!worker, manual: !!manual && manual.until > now(), message: state.message, dayPages: state.day === new Date(now()).toISOString().slice(0, 10) ? state.dayPages : 0, limits: LIMITS, nextRunAt: state.lastRunAt + LIMITS.cooldownMs, jobs: state.jobs });
  async function browser() {
    if (closing) throw new Error('Browser bridge is shutting down.');
    if (!context) {
      context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { headless: true, viewport: { width: 1280, height: 900 }, acceptDownloads: false, serviceWorkers: 'block', args: ['--disable-dev-shm-usage'] });
      await context.route('**/*', (route) => resourceAllowed(route.request().url()) ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', (socket) => socket.close());
      context.on('page', (popup) => { if (page && popup !== page) void popup.close().catch(() => {}); });
      page = context.pages()[0] || await context.newPage();
      for (const extra of context.pages()) if (extra !== page) await extra.close();
      page.setDefaultTimeout(15_000);
      page.on('filechooser', (chooser) => { fileChooser = chooser; });
      page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => {}); });
    }
    return page;
  }
  function checkManual(id) {
    if (!manual || manual.id !== id || manual.until <= now()) throw new Error('Open the browser again; manual control expired or moved to another window.');
    manual.until = now() + LIMITS.manualMs;
  }
  async function stop() { abort?.abort(); if (worker) await worker; }
  async function collect(keywords, location) {
    const signal = abort.signal;
    const navigate = async (url) => {
      signal.throwIfAborted();
      await pause(Math.max(0, nextPageAt(state, now()) - now()), undefined, { signal });
      return serial(async () => {
        signal.throwIfAborted();
        if (manual && manual.until > now()) throw new Error('Collection paused for manual browsing.');
        const day = new Date(now()).toISOString().slice(0, 10);
        if (state.day !== day) { state.day = day; state.dayPages = 0; }
        if (state.dayPages >= LIMITS.dayPages) throw new Error('Daily collection limit reached. Try tomorrow.');
        // Persist before navigation: restart/crash never resets the collection budget.
        state.dayPages++; state.lastPageAt = now(); await save();
        const p = await browser();
        const response = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await p.waitForTimeout(2000);
        const problem = pageProblem(p.url(), response?.status() || 200, (await p.locator('body').innerText()).slice(0, 10000));
        if (problem) throw new Error(problem);
        return p;
      });
    };
    try {
      state.message = 'Collecting one search page, then up to eight descriptions.'; await save();
      const search = new URL('https://www.linkedin.com/jobs/search/'); search.searchParams.set('keywords', keywords); search.searchParams.set('location', location);
      const p = await navigate(search.href);
      const links = await serial(() => p.locator('a[href*="/jobs/view/"]').evaluateAll((items) => items.map((item) => item.href)));
      const urls = [...new Set(links.flatMap((url) => { try { return [jobUrl(url)]; } catch { return []; } }))].slice(0, LIMITS.runJobs);
      if (!urls.length) throw new Error('No job links found. Review the search in the browser; LinkedIn may have changed its page layout.');
      let added = 0;
      for (const url of urls) {
        const p = await navigate(url);
        const item = await serial(() => p.evaluate(() => {
          const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
          return { title: text('h1'), company: text('.job-details-jobs-unified-top-card__company-name') || text('.topcard__org-name-link'), place: text('.job-details-jobs-unified-top-card__tertiary-description-container') || text('.topcard__flavor--bullet'), text: text('.jobs-description__content') || text('.show-more-less-html__markup') };
        }));
        signal.throwIfAborted();
        if (!item.title || !item.company || item.text.length < 80) throw new Error('A job description could not be read completely. Collection stopped; inspect the browser.');
        const row = { url, title: item.title.slice(0, 500), company: item.company.slice(0, 300), place: item.place.slice(0, 300), text: item.text.slice(0, 100000), remote: false, salary: '', collectedAt: new Date(now()).toISOString() };
        state.jobs = [row, ...state.jobs.filter((job) => job.url !== url)].slice(0, 40); added++; await save();
      }
      state.message = `Collected ${added} opportunities. Review and save the ones you want; no applications were sent.`;
    } catch (error) {
      state.message = signal.aborted ? 'Collection stopped. No applications were sent.' : /^(LinkedIn |Daily collection|No job links|A job description|Collection paused)/.test(error.message) ? error.message : 'Collection stopped because the browser could not read the page. Review the browser before trying again.';
    } finally { await save(); }
  }
  async function handle(method, endpoint, input) {
    if (method === 'GET' && endpoint === '/status') return status();
    if (method === 'POST' && endpoint === '/stop') { await stop(); return status(); }
    if (method === 'POST' && endpoint === '/collect') {
      if (worker) throw new Error('A collection is already running.');
      if (manual && manual.until > now()) throw new Error('Close manual browser control before collecting.');
      if (state.lastRunAt && now() < state.lastRunAt + LIMITS.cooldownMs) throw new Error('Wait 15 minutes between collection runs.');
      if (!input.approved || typeof input.keywords !== 'string' || !input.keywords.trim() || input.keywords.length > 200 || typeof input.location !== 'string' || input.location.length > 200) throw new Error('Review your search keywords and location.');
      state.lastRunAt = now(); await save(); abort = new AbortController();
      worker = collect(input.keywords.trim(), input.location.trim()).finally(() => { worker = undefined; });
      return status();
    }
    if (method === 'POST' && endpoint === '/open') {
      await stop();
      return serial(async () => {
        const p = await browser();
        if (input.url) await p.goto(linkedinUrl(input.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        else if (!p.url().startsWith('https://www.linkedin.com/')) await p.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        manual = { id: randomUUID(), until: now() + LIMITS.manualMs };
        return { manualId: manual.id };
      });
    }
    if (method === 'POST' && endpoint === '/close') { checkManual(input.manualId); return serial(async () => { manual = undefined; fileChooser = undefined; if (context) await context.close(); context = undefined; page = undefined; return status(); }); }
    if (method === 'POST' && endpoint === '/disconnect') {
      await stop();
      return serial(async () => {
        manual = undefined; fileChooser = undefined;
        if (context) await context.close(); context = undefined; page = undefined;
        await rm(path.join(directory, 'profile'), { recursive: true, force: true });
        state.jobs = []; state.message = 'Browser session and collected opportunities removed.'; await save(); return status();
      });
    }
    if (method === 'POST' && ['/screen', '/input'].includes(endpoint)) {
      return serial(async () => {
        checkManual(input.manualId); const p = await browser();
        if (endpoint === '/screen') return { image: (await p.screenshot({ type: 'jpeg', quality: 75 })).toString('base64'), url: p.url(), uploadRequested: !!fileChooser };
        if (input.approved !== true) throw new Error('Manual browser actions need your approval.');
        if (input.kind === 'click' && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.x < 1280 && input.y >= 0 && input.y < 900) await p.mouse.click(input.x, input.y);
        else if (input.kind === 'text' && typeof input.text === 'string' && input.text.length <= 4000) await p.keyboard.insertText(input.text);
        else if (input.kind === 'upload' && fileChooser && typeof input.name === 'string' && /^[a-zA-Z0-9 _.-]{1,150}\.(pdf|docx|png|jpe?g|webp)$/i.test(input.name) && typeof input.data === 'string' && input.data.length <= 14_000_000) {
          const buffer = Buffer.from(input.data, 'base64');
          const extension = input.name.toLowerCase().split('.').pop();
          const types = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
          const valid = extension === 'pdf' ? buffer.toString('ascii', 0, 5) === '%PDF-' : extension === 'docx' ? buffer.toString('ascii', 0, 2) === 'PK' : extension === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : extension === 'webp' ? buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
          if (buffer.length > 10 * 1024 * 1024 || !valid) throw new Error('Choose a PDF, DOCX, PNG, JPEG or WebP file up to 10 MB.');
          await fileChooser.setFiles({ name: input.name, mimeType: types[extension], buffer }); fileChooser = undefined;
        }
        else if (input.kind === 'key' && ['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlOrMeta+A', 'Escape'].includes(input.key)) await p.keyboard.press(input.key);
        else if (input.kind === 'scroll' && [-600, 600].includes(input.y)) await p.mouse.wheel(0, input.y);
        else throw new Error('Unsupported manual browser action.');
        return { ok: true };
      });
    }
    throw new Error('Unknown bridge operation.');
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'private, no-store'); response.setHeader('content-type', 'application/json');
    const candidate = Buffer.from(request.headers.authorization || ''); const expected = Buffer.from(`Bearer ${token}`);
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) { response.writeHead(401); response.end('{"error":"Authentication required."}'); return; }
    try {
      let bytes = 0, chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw new Error('Request too large.'); chunks.push(chunk); }
      const input = bytes ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const endpoint = new URL(request.url, 'http://bridge').pathname;
      const operation = control.then(() => handle(request.method, endpoint, input)); control = operation.catch(() => {});
      response.end(JSON.stringify(await operation));
    } catch (error) {
      response.writeHead(400);
      // Never echo browser text, credentials, provider payloads or navigation errors.
      const message = /^(Use |Choose |Open the browser|Manual browser|Unsupported manual|A collection|Close manual|Wait 15|Review your search|Unknown bridge|Request too large)/.test(error.message) ? error.message : 'Browser operation failed. Refresh or reconnect; no action was retried.';
      response.end(JSON.stringify({ error: message }));
    }
  });
  server.requestTimeout = 45_000; server.headersTimeout = 10_000;
  return { server, close: async () => { closing = true; await stop(); await serial(async () => { if (context) await context.close(); }); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const { chromium } = await import('playwright-core');
  const bridge = await createBridge({ token: process.env.BRIDGE_TOKEN, directory: process.env.BRIDGE_DATA_DIR || '/data/linkedin', chromium });
  bridge.server.listen(8090, '0.0.0.0', () => console.log('Private LinkedIn browser bridge ready'));
  process.on('SIGTERM', async () => { bridge.server.close(); await bridge.close(); process.exit(0); });
}
