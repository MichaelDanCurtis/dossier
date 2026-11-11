import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium as realChromium } from 'playwright-core';
import { createBridge } from './server.mjs';

test('real Chromium viewer: user enters a field, screenshots it, and closes a persistent profile without network access', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'careerai-browser-'));
  const token = 'isolated-fixture-token-'.repeat(3);
  let context;
  const fixtureHtml = '<!doctype html><html><body><h1>LinkedIn fixture — offline</h1><label>Example field<input id="field" style="position:absolute;left:40px;top:100px;width:300px;height:50px"></label><input id="attach" type="file" style="position:absolute;left:40px;top:200px;width:300px;height:40px"></body></html>';
  const chromium = { launchPersistentContext: async (...args) => {
    context = await realChromium.launchPersistentContext(...args);
    // Intercept all traffic; this test never contacts LinkedIn or an AI provider.
    context.route = async (_pattern, _handler) => {
      await Object.getPrototypeOf(context).route.call(context, '**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml }));
    };
    return context;
  } };
  const bridge = await createBridge({ token, directory, chromium });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const call = async (operation, data) => {
    const response = await fetch(`http://127.0.0.1:${bridge.server.address().port}/${operation}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
  };
  try {
    const { manualId } = await call('open', {});
    await call('input', { manualId, approved: true, kind: 'click', x: 100, y: 120 });
    await call('input', { manualId, approved: true, kind: 'text', text: 'Typed by the user' });
    assert.equal(await context.pages()[0].locator('#field').inputValue(), 'Typed by the user');
    await call('input', { manualId, approved: true, kind: 'click', x: 100, y: 220 });
    assert.equal((await call('screen', { manualId })).uploadRequested, true);
    await call('input', { manualId, approved: true, kind: 'upload', name: 'reviewed-resume.pdf', data: Buffer.from('%PDF-1.7 offline fixture').toString('base64') });
    assert.equal(await context.pages()[0].locator('#attach').evaluate((field) => field.files[0].name), 'reviewed-resume.pdf');
    const screen = await call('screen', { manualId });
    assert.equal(Buffer.from(screen.image, 'base64')[0], 255); assert.match(screen.url, /linkedin.com/);
    await call('close', { manualId });
  } finally { await bridge.close(); bridge.server.closeAllConnections(); await new Promise((resolve) => bridge.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
