(() => {
  if (document.getElementById('careerai-workspace-host')) return;
  const host = document.createElement('div'); host.id = 'careerai-workspace-host';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{all:initial;font:14px/1.5 system-ui,sans-serif;color:#e9effa}
    *{box-sizing:border-box}button,input,textarea,select{font:inherit}button,a,input,textarea,select{outline-offset:3px}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}
    button{border:1px solid #456086;border-radius:9px;background:#253c60;color:#edf3ff;padding:9px 14px;font-weight:600}button:hover{background:#334f78}button.primary{background:#a9c6ff;color:#10203a;border-color:#a9c6ff}button.quiet{background:transparent}
    a{color:#b4ceff}p{margin:6px 0 14px}.muted{color:#adbbce;font-size:13px}.small{font-size:12px}
    #launcher{position:fixed;top:14px;right:24px;z-index:2147483645;border-radius:22px;box-shadow:0 4px 18px #0005;background:#183154;color:#e9f0ff;padding:8px 16px}#launcher b{display:inline-grid;place-items:center;background:#b4ceff;color:#152742;border-radius:6px;width:23px;height:23px;margin-right:7px}
    #veil{position:fixed;inset:0;z-index:2147483646;background:#050b16a8;display:grid;place-items:center;padding:24px}#veil[hidden],[hidden]{display:none!important}
    #dialog{width:min(1080px,100%);height:min(840px,90vh);display:flex;flex-direction:column;border:1px solid #3b4e6b;border-radius:18px;background:#101e33;box-shadow:0 24px 90px #0009;overflow:hidden}
    header{padding:22px 26px 12px;display:flex;justify-content:space-between;align-items:start;gap:20px}h1{font-size:24px;line-height:1.2;margin:0 0 7px;letter-spacing:-.7px}h2{font-size:19px;margin:0 0 8px}h3{font-size:16px;margin:0 0 6px}
    nav{display:flex;gap:5px;padding:0 26px 15px;border-bottom:1px solid #31425c}nav button{background:transparent;border-color:transparent}nav [aria-selected=true]{background:#2c4c7d;border-color:#5475a7}
    main{overflow:auto;padding:23px 26px;flex:1;min-height:0}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.row>label{flex:1;min-width:140px}.row>label.narrow{flex:0 0 105px;min-width:95px}
    input,textarea,select{display:block;width:100%;border:1px solid #566b89;border-radius:8px;background:#0b1729;color:#edf3ff;padding:9px 11px;margin-top:6px}textarea{resize:vertical;min-height:90px}label{display:block;font-size:13px;color:#bfccdd}.actions{display:flex;flex-wrap:wrap;gap:9px;margin:16px 0}
    .card{background:#182b45;border:1px solid #344a68;border-radius:12px;padding:17px;margin:12px 0}.card p{white-space:pre-wrap;overflow-wrap:anywhere}.card .excerpt{max-height:150px;overflow:auto;color:#bfccdd;font-size:13px}.tag{font-size:12px;color:#b8cff2}.note{border-left:3px solid #90b6fb;padding:8px 12px;background:#1b304d;margin:10px 0}.error{color:#ffd0c9}.chat{max-height:310px;overflow:auto}.chat .user{background:#234369;margin-left:50px}.chat .assistant{margin-right:35px}footer{padding:12px 26px;border-top:1px solid #31425c;background:#0d1a2d;font-size:12px;color:#adbbce}.spaced{display:flex;justify-content:space-between;align-items:center;gap:14px}#progress{margin:0 26px 15px;padding:11px 15px;display:flex;justify-content:space-between;align-items:center;gap:12px;background:#1b304d;border-radius:9px}#progress-text{white-space:pre-wrap}#problem{margin:0 26px 12px}#connection{margin:0 26px 12px}
    @media(max-width:650px){#veil{padding:8px}#dialog{height:96vh}header,main{padding:16px}nav{padding:0 12px 12px}nav button{padding:8px}#launcher{top:70px;right:12px}.chat .user,.chat .assistant{margin-left:0;margin-right:0}}
  </style>
  <button id="launcher" aria-haspopup="dialog" aria-expanded="false"><b>C</b>CareerAI</button>
  <div id="veil" hidden><section id="dialog" role="dialog" aria-modal="true" aria-labelledby="title" tabindex="-1">
  <header><div><h1 id="title">CareerAI on LinkedIn</h1><p class="muted">Find the right roles. Make sense of your network. Write something worth sharing.</p></div><button id="close" class="quiet" aria-label="Close CareerAI">✕</button></header>
  <nav role="tablist" aria-label="CareerAI workspace"><button role="tab" id="tab-jobs" aria-controls="view-jobs" data-tab="jobs" aria-selected="true">Jobs</button><button role="tab" id="tab-feed" aria-controls="view-feed" data-tab="feed" aria-selected="false" tabindex="-1">Feed</button><button role="tab" id="tab-messages" aria-controls="view-messages" data-tab="messages" aria-selected="false" tabindex="-1">Messages</button><button role="tab" id="tab-write" aria-controls="view-write" data-tab="write" aria-selected="false" tabindex="-1">Write</button></nav>
  <p id="connection" class="muted"></p><p id="problem" role="alert" class="error" hidden></p>
  <div id="progress" hidden><span id="progress-text" role="status" aria-live="polite"></span><button id="stop" class="quiet">Stop this read</button></div>
  <main>
  <section id="view-jobs" role="tabpanel" aria-labelledby="tab-jobs"><h2>Which roles should we look at?</h2><p class="muted">Collect a search, then let AI compare full descriptions with your saved experience. Choose the roles you want a résumé for.</p>
  <div class="row"><label>Role or skills<input id="keywords" placeholder="e.g. AI platform architect" maxlength="200"></label><label>Location<input id="location" placeholder="e.g. United States" maxlength="200"></label><label class="narrow">Job limit<select id="limit"><option>10</option><option selected>25</option><option>50</option></select></label></div>
  <div class="actions"><button class="primary" id="search">Search & review</button><button id="current-search">Collect this search</button><button id="current-job" class="quiet">Save this job</button></div>
  <p class="muted small">Reads at least eight seconds apart. Up to five search pages per run, within your chosen limit. Uses your configured AI provider for fit reviews. Nothing is applied to.</p><div id="jobs-list"></div></section>
  <section id="view-feed" role="tabpanel" aria-labelledby="tab-feed" hidden><h2>What’s happening in your network?</h2><p class="muted">Bring in up to 20 visible feed excerpts, then get a short summary and ideas related to your career. Original links appear only when LinkedIn provides a reliable post ID.</p><button class="primary" id="read-feed">Read & summarize my feed</button><div id="feed-list"></div></section>
  <section id="view-messages" role="tabpanel" aria-labelledby="tab-messages" hidden><h2>Who needs your attention?</h2><p class="muted">Read up to 20 inbox previews. Select a conversation for more context and a reply draft. Opening LinkedIn’s inbox or a conversation may mark messages as read.</p><div class="actions"><button class="primary" id="read-inbox">Read & summarize inbox previews</button><button id="read-current-thread">Read current conversation</button></div><div id="thread-list"></div><div id="reply"></div><div id="inbox-list"></div></section>
  <section id="view-write" role="tabpanel" aria-labelledby="tab-write" hidden><div class="spaced"><h2>What do we want to write about?</h2><a href="https://careerai.thecurtis.cloud/agent?workspace=publicist" target="_blank" rel="noreferrer">Publicist settings & images ↗</a></div><p class="muted">Kick around an idea, develop a post, or outline an article. Your publicist can use your saved work and up to six feed excerpts from this panel. Private messages stay out of public writing.</p><p id="model" class="tag"></p><div id="chat" class="chat" aria-live="polite"></div><form id="chat-form"><label>Your idea<textarea id="chat-input" maxlength="6000" placeholder="I’ve been building… What could we share about it?" required></textarea></label><div class="actions"><button class="primary" id="chat-send">Talk it through</button><button type="button" id="copy-writing">Copy latest draft</button></div></form><p class="muted small">Review the final words, then paste into LinkedIn and publish yourself.</p></section>
  </main><footer><span id="model-footer"></span> · Your sign-in stays in Chrome. Captured text goes to your private CareerAI account and its AI provider. <a href="https://careerai.thecurtis.cloud/linkedin?section=extension" target="_blank" rel="noreferrer">Connection settings ↗</a></footer>
  </section></div>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id), base = 'https://careerai.thecurtis.cloud';
  let open = false, lastFocus, state = {}, error = '', sending = false, polling = false, lastRendered = '';
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
  function link(text, url) { const node = el('a', text); const parsed = new URL(url); if (parsed.protocol !== 'https:' || !['careerai.thecurtis.cloud', 'www.linkedin.com'].includes(parsed.hostname)) return el('span', text); node.href = url; node.target = '_blank'; node.rel = 'noreferrer'; return node; }
  function action(text, fn) { const button = el('button', text); button.addEventListener('click', fn); return button; }
  async function send(message) { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Reload the CareerAI extension and refresh LinkedIn.'); state = result.state; render(); return state; }
  async function run(message) {
    const passive = message.type === 'STATUS', urgent = message.type === 'STOP';
    if (passive ? polling : !urgent && sending) return;
    if (passive) polling = true; else if (!urgent) sending = true;
    if (!passive) error = ''; render();
    try { await send(message); } catch (problem) { error = problem.message; }
    finally { if (passive) polling = false; else if (!urgent) sending = false; render(); }
  }
  function show() { open = true; lastFocus = document.activeElement; $('veil').hidden = false; $('launcher').setAttribute('aria-expanded', 'true'); $('close').focus(); run({ type: 'OPEN_STATE' }); }
  function close() { open = false; $('veil').hidden = true; $('launcher').setAttribute('aria-expanded', 'false'); (lastFocus?.isConnected ? lastFocus : $('launcher')).focus(); }
  $('launcher').addEventListener('click', show); $('close').addEventListener('click', close);
  $('veil').addEventListener('click', event => { if (event.target === $('veil')) close(); });
  root.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') { const focusable = [...root.querySelectorAll('button,a,input,textarea,select')].filter(n => n !== $('launcher') && !n.disabled && n.tabIndex >= 0 && n.getClientRects().length); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && root.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  const tabs = [...root.querySelectorAll('[data-tab]')];
  function tab(name) { for (const button of tabs) { const selected = button.dataset.tab === name; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; $('view-' + button.dataset.tab).hidden = !selected; } }
  tabs.forEach((button, index) => { button.addEventListener('click', () => tab(button.dataset.tab)); button.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length)%tabs.length; tab(tabs[next].dataset.tab); tabs[next].focus(); }); });
  const start = input => run({ type: 'START', input });
  const jobsInput = useCurrent => ({ kind: 'jobs', useCurrent, keywords: $('keywords').value, location: $('location').value, limit: Number($('limit').value) });
  $('search').addEventListener('click', () => start(jobsInput(false))); $('current-search').addEventListener('click', () => start(jobsInput(true)));
  $('current-job').addEventListener('click', () => start({ kind: 'job' })); $('read-feed').addEventListener('click', () => start({ kind: 'feed' })); $('read-inbox').addEventListener('click', () => start({ kind: 'inbox' })); $('read-current-thread').addEventListener('click', () => start({ kind: 'thread-current' }));
  $('stop').addEventListener('click', () => run({ type: 'STOP' }));
  $('chat-form').addEventListener('submit', event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text) run({ type: 'CHAT', text }).then(() => { if (!error) $('chat-input').value = ''; }); });
  async function copy(text) { try { await navigator.clipboard.writeText(text); error = 'Copied. Review it before publishing or sending.'; } catch { error = 'Copy was unavailable. Select the draft text and copy it manually.'; } render(); }
  $('copy-writing').addEventListener('click', () => copy([...state.chat || []].reverse().find(m => m.role === 'assistant')?.text || ''));
  function cards(target, items, type) {
    const list = $(target); list.replaceChildren();
    if (!items?.length) { list.append(el('p', type === 'jobs' ? 'Your collected roles and career-fit reviews will appear here.' : 'No captures yet. Start a read above.', 'muted')); return; }
    for (const item of items) {
      const card = el('article', '', 'card'); card.append(el('h3', item.title));
      if (type === 'jobs') {
        card.append(el('p', item.company, 'muted'));
        if (item.review) { card.append(el('p', `${item.review.score}/100 · ${item.review.recommendation.replaceAll('_',' ').toLowerCase()}`, 'tag'), el('p', item.review.summary)); if (item.review.gaps?.length) card.append(el('p', 'Questions to check: ' + item.review.gaps.join(' '), 'muted')); }
        else card.append(el('p', 'Saved. Career review is pending or AI is not configured.', 'muted'));
        const id = item.id || item.postingId, draft = state.drafts?.[id] || item.applicationId;
        card.append(draft ? link('Open résumé draft ↗', base + '/applications/' + encodeURIComponent(draft)) : action('Prepare my résumé', () => run({ type: 'RESUME', id })));
      } else {
        card.append(el('p', item.text, 'excerpt'));
        if (item.analysis) card.append(el('p', item.analysis.summary), el('p', item.analysis.nextStep, 'note'));
        if (type === 'inbox') card.append(action('Read this conversation', () => start({ kind: 'thread', expected: { title: item.title, text: item.text } })));
        if (type === 'thread') card.append(action('Draft a reply for my review', () => run({ type: 'REPLY', id: item.sourceId })));
        if (!item.url && type === 'feed') card.append(el('p', 'Excerpt · LinkedIn did not expose a reliable permalink.', 'tag'));
      }
      if (item.url) { const p = el('p'); p.append(link('View on LinkedIn ↗', item.url)); card.append(p); } list.append(card);
    }
  }
  function render() {
    const running = ['running','reviewing'].includes(state.run?.status);
    $('connection').textContent = !state.connected ? 'Connect once using the CareerAI toolbar button, then reopen this panel.' : state.scope !== 'workspace' ? 'This connection saves jobs only. Create a new LinkedIn workspace pairing code in CareerAI and pair from the toolbar.' : `Connected to ${state.account}’s private CareerAI workspace.`;
    $('problem').textContent = error || state.problem || ''; $('problem').hidden = !($('problem').textContent);
    $('progress').hidden = !state.run && !state.pendingJobs?.length;
    $('progress-text').textContent = [state.run?.message, state.pendingJobs?.length ? state.jobMessage || `${state.pendingJobs.length} AI task(s) working…` : ''].filter(Boolean).join('\n');
    $('stop').hidden = !running;
    $('model-footer').textContent = state.model ? `Career review: ${state.model}` : 'Choose your AI provider in CareerAI';
    $('model').textContent = state.publicistModel ? `Publicist: ${state.publicistModel}` : 'Uses your Publicist’s saved model and effort settings.';
    for (const id of ['search','current-search','current-job','read-feed','read-inbox','read-current-thread']) $(id).disabled = sending || running || !state.connected || state.scope !== 'workspace';
    $('chat-send').disabled = sending || !state.connected || state.scope !== 'workspace' || state.pendingJobs?.some(j => j.target === 'writer');
    const signature = JSON.stringify([state.opportunities, state.run?.rows, state.feed, state.inbox, state.thread, state.reply, state.chat, state.drafts]);
    if (signature === lastRendered) return; lastRendered = signature;
    cards('jobs-list', state.opportunities?.length ? state.opportunities : state.run?.rows, 'jobs'); cards('feed-list', state.feed, 'feed'); cards('inbox-list', state.inbox, 'inbox'); cards('thread-list', state.thread, 'thread');
    $('reply').replaceChildren(); if (state.reply) { const card = el('article', '', 'card'); card.append(el('h3', 'Reply draft — review before sending'), el('p', state.reply.reply), el('p', state.reply.notes, 'muted'), action('Copy reply', () => copy(state.reply.reply))); $('reply').append(card); }
    const chat = $('chat'); chat.replaceChildren(); for (const message of state.chat || []) { const card = el('article', '', 'card ' + message.role); card.append(el('span', message.role === 'user' ? 'You' : 'Your Publicist', 'tag'), el('p', message.text)); chat.append(card); } chat.scrollTop = chat.scrollHeight;
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'CAREERAI_OPEN') show(); });
  setInterval(() => { if (open && !sending) run({ type: 'STATUS' }); }, 4000);
})();
