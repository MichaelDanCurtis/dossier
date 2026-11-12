const $ = id => document.getElementById(id);
async function send(message) { const reply = await chrome.runtime.sendMessage(message); if (!reply?.ok) throw new Error(reply?.error || 'Reload the extension and try again.'); return reply.state; }
function render(state) {
  $('account').textContent = state.connected ? `Connected to ${state.account} · ${state.scope === 'workspace' ? 'LinkedIn workspace' : 'jobs only; pair again to enable the workspace'}.` : 'Not connected yet.';
  $('disconnect').hidden = !state.connected;
}
async function run(action) { try { $('status').textContent = ''; await action(); } catch (error) { $('status').textContent = error.message; } }
$('pair-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { render(await send({ type: 'PAIR', code: $('pair-code').value })); $('pair-code').value = ''; $('status').textContent = 'Connected. Open the panel on LinkedIn.'; }); });
$('disconnect').addEventListener('click', () => run(async () => render(await send({ type: 'DISCONNECT' }))));
$('open').addEventListener('click', () => {
  const permission = chrome.permissions.request({ origins: ['https://www.linkedin.com/*'] });
  run(async () => {
    if (!await permission) throw new Error('Approve LinkedIn site access to show the in-page button.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://www.linkedin.com/')) throw new Error('Open LinkedIn in this Chrome window, then click this button again.');
    await send({ type: 'OPEN', tabId: tab.id }); window.close();
  });
});
run(async () => render(await send({ type: 'STATUS' })));
