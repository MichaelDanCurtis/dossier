import { careeraiRequest } from './api.mjs';
import { WorkspaceEngine, linkedinUrl } from './workspace-engine.mjs';
import { createLauncher } from './launcher.mjs';
const engine = new WorkspaceEngine({ chromeApi: chrome, api: careeraiRequest });
let queue = Promise.resolve(), timer;
const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
const ownPage = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
const panelSender = sender => linkedinUrl(sender.url) && Number.isInteger(sender.tab?.id) && sender.frameId === 0;
async function publicState() {
  const state = await engine.load(), c = (await chrome.storage.local.get('connection')).connection;
  return { ...state, connected: !!c?.token && c.expiresAt > Date.now(), scope: c?.scope || 'jobs', account: c?.account || '' };
}
async function register() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const granted = await chrome.permissions.contains({ origins: ['https://www.linkedin.com/*'] });
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  if (granted && !scripts.some(s => s.id === 'careerai-panel')) await chrome.scripting.registerContentScripts([{ id: 'careerai-panel', matches: ['https://www.linkedin.com/*'], js: ['panel.js'], runAt: 'document_idle' }]);
  if (!granted && scripts.some(s => s.id === 'careerai-panel')) await chrome.scripting.unregisterContentScripts({ ids: ['careerai-panel'] });
}
async function tick() {
  clearTimeout(timer); await engine.step();
  try { await engine.pollJobs(); } catch (error) { const state = await engine.load(); state.problem = error.message; await engine.store(state); }
  const state = await engine.load();
  if (state.run?.status === 'running' || state.pendingJobs?.length) timer = setTimeout(() => serialized(tick).catch(() => {}), 1200);
}
const launcher = createLauncher(chrome, register);
chrome.action.onClicked.addListener(tab => {
  // Request immediately inside Chrome's user gesture, before queuing any work.
  const permission = chrome.permissions.request({ origins: ['https://www.linkedin.com/*'] }).catch(() => false);
  serialized(() => launcher.launch(tab, permission)).catch(error => launcher.report(error)).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => serialized(register));
chrome.runtime.onStartup.addListener(() => serialized(async () => { await register(); await tick(); }));
chrome.permissions.onAdded.addListener(() => serialized(register));
chrome.permissions.onRemoved.addListener(() => { engine.stopRequested = true; serialized(async () => { await engine.stop('LinkedIn site access was removed.'); await register(); }); });
chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'complete') serialized(async () => { await launcher.ready(id).catch(error => launcher.report(error)); await tick(); }).catch(() => {}); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !(ownPage(sender) || panelSender(sender)) || !message || typeof message !== 'object') return false;
  if (message.type === 'STOP') engine.stopRequested = true;
  serialized(async () => {
    switch (message.type) {
      case 'STATUS': await tick(); break;
      case 'OPEN_STATE': {
        const c=(await chrome.storage.local.get('connection')).connection;
        if(c?.scope==='workspace'&&c.expiresAt>Date.now()){
          const setup=await engine.workspace({kind:'STATUS'}),state=await engine.load();
          state.model=setup.model;state.publicistModel=setup.publicistModel;state.chat=setup.chat;await engine.store(state);
        }
        await tick();break;
      }
      case 'OPEN': {
        if (!ownPage(sender)) throw new Error('Open the CareerAI toolbar button.');
        await register(); const tab = await chrome.tabs.get(message.tabId);
        if (!linkedinUrl(tab.url)) throw new Error('Open LinkedIn first.');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel.js'] });
        await chrome.tabs.sendMessage(tab.id, { type: 'CAREERAI_OPEN' }); break;
      }
      case 'PAIR': {
        const code = typeof message.code === 'string' ? message.code.trim() : '';
        if (!code || code.length > 64) throw new Error('Enter your pairing code.');
        const connection = await careeraiRequest('/api/extension/pair', { code });
        await engine.stop();
        await chrome.storage.local.set({ connection }); await chrome.storage.session.remove('workspace'); break;
      }
      case 'DISCONNECT': {
        await engine.stop(); const c = await engine.connection(); await careeraiRequest('/api/extension/revoke', {}, c.token);
        await chrome.storage.local.remove('connection'); await chrome.storage.session.remove('workspace'); break;
      }
      case 'START':
        if (!sender.tab?.id) throw new Error('Start from the panel on LinkedIn.');
        await engine.start(message.input || {}, sender.tab.id); await tick(); break;
      case 'STOP': await engine.stop(); break;
      case 'CHAT': {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text || text.length > 6000) throw new Error('Write a message up to 6,000 characters.');
        const state = await engine.load();
        if (state.pendingJobs.some(j => j.target === 'writer')) throw new Error('Wait for your Publicist to reply first.');
        await engine.enqueueJob({ kind: 'PUBLICIST_CHAT', text, sourceIds: state.feed.slice(0, 6).map(i => i.sourceId).filter(Boolean) }, 'writer');
        const latest = await engine.load(); latest.chat = [...latest.chat, { role: 'user', text }]; await engine.store(latest); await tick(); break;
      }
      case 'RESUME': case 'REPLY': {
        const state = await engine.load(), resume = message.type === 'RESUME';
        if (!(resume ? state.opportunities : state.thread).some(i => (resume ? i.id : i.sourceId) === message.id)) throw new Error('Choose an item from this panel.');
        if (state.pendingJobs.some(j => j.sourceId === message.id)) throw new Error('This draft is already being prepared.');
        await engine.enqueueJob(resume ? { kind: 'PREPARE_RESUME', postingId: message.id } : { kind: 'REPLY_DRAFT', sourceId: message.id }, resume ? 'resume' : 'reply', message.id); await tick(); break;
      }
      default: throw new Error('Unknown CareerAI panel action.');
    }
    return publicState();
  }).then(state => respond({ ok: true, state }), error => respond({ ok: false, error: error.message || 'CareerAI could not complete that request.' }));
  return true;
});
serialized(register).catch(() => {});
