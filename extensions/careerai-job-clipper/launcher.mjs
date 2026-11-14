import { linkedinUrl } from './workspace-engine.mjs';

/** The toolbar and page button open the same workspace, never a controller page. */
export function createLauncher(chrome, register) {
  const pendingKey = 'careerai-open-tab';
  async function open(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!linkedinUrl(tab.url)) throw new Error('Open LinkedIn, then click CareerAI again.');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['panel.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'CAREERAI_OPEN' });
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Open CareerAI on LinkedIn' });
  }
  async function report(error) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: error.message || 'CareerAI could not open. Click to try again.' });
  }
  async function ready(tabId) {
    const pending = (await chrome.storage.session.get(pendingKey))[pendingKey];
    if (pending !== tabId) return;
    await chrome.storage.session.remove(pendingKey);
    await open(tabId);
  }
  async function launch(tab, permission) {
    if (!await permission) throw new Error('Click CareerAI and allow LinkedIn access to show the page button.');
    await register();
    if (linkedinUrl(tab?.url)) return open(tab.id);
    const [existing] = await chrome.tabs.query({ url: 'https://www.linkedin.com/*', currentWindow: true });
    const target = existing || await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
    if (existing) await chrome.tabs.update(target.id, { active: true });
    await chrome.storage.session.set({ [pendingKey]: target.id });
    // Re-read after storing the pending ID: the tab may have loaded meanwhile.
    if ((await chrome.tabs.get(target.id)).status === 'complete') await ready(target.id);
  }
  return { launch, ready, report };
}
