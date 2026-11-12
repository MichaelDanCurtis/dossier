import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COOKIE, PERSISTENT_SECONDS, checkPassword, createSession, dossierMcpToken, dossierSession, hashPassword, parseCookies, sessionUser, validUsername } from './auth.mjs';
import { createOAuth } from './oauth.mjs';
import { createJobImportAccess, extensionOrigin } from './job-import.mjs';
import { page } from './ui.mjs';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const blocked = /^\/api\/(?:desktop|linkedin\/extension-workspace)(?:\/|$)/;
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const nextPath = (value) => typeof value === 'string' && (value.startsWith('/oauth/authorize?') || value === '/_accounts' || value === '/_accounts/admin') && !/[\r\n\\]/.test(value) ? value : '/';
const loginPage = (error = '', next = '/') => page('Your next chapter starts here', `<p>Sign in to your private job search workspace.</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="/_accounts/login"><input type="hidden" name="next" value="${escapeHtml(nextPath(next))}"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="32" pattern="[a-zA-Z][a-zA-Z0-9_-]{2,31}" autofocus><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><label class="check"><input type="checkbox" name="remember"> Keep me signed in</label><button>Sign in</button></form><p class="small">Accounts are invite-only. Contact the host administrator for access or a password reset.</p>`);

const navigation = (user) => `<nav><a href="/">Workspace</a><a href="/settings?section=appearance">Appearance</a><a href="/settings?section=connector">MCP connector</a>${user.role === 'admin' ? '<a href="/_accounts/admin" aria-current="page">Manage users</a>' : ''}<a href="/_accounts/source">Deployment source</a></nav>`;
const passwordField = '<label>New password <span class="small">(leave blank to generate one)</span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256"></label>';
const userForm = (operation, username, content) => `<form method="post" action="/_accounts/admin"><input type="hidden" name="operation" value="${operation}"><input type="hidden" name="username" value="${escapeHtml(username)}">${content}</form>`;
const adminPage = (config, actor, problem = '') => page('Manage users', `${navigation(actor)}<p>Create private accounts and reset passwords. ${config.users.length} of 5 accounts are allocated.</p>${problem ? `<p class="error" role="alert">${escapeHtml(problem)}</p>` : ''}<div class="admin-grid"><section><h2>Create account</h2><form method="post" action="/_accounts/admin"><input type="hidden" name="operation" value="add"><label>Username<input name="username" required pattern="[a-z][a-z0-9_-]{2,31}" minlength="3" maxlength="32" autocomplete="off"></label>${passwordField}<button ${config.users.length >= 5 ? 'disabled' : ''}>Create private account</button><p class="small">Setup may take up to two minutes. Existing users can continue working.</p></form></section><section><h2>Accounts</h2>${config.users.map((user) => `<details><summary>${escapeHtml(user.username)} · ${user.role === 'admin' ? 'Administrator' : 'User'} · ${escapeHtml(user.status === 'ready' || !user.status ? user.active ? 'Enabled' : 'Disabled' : user.status)}</summary>${userForm('reset-password', user.username, passwordField + '<button class="secondary">Reset password</button>')}<div class="actions">${user.status && user.status !== 'ready' ? userForm('retry', user.username, '<button>Retry setup</button>') : user.username !== actor.username ? userForm(user.active ? 'disable' : 'enable', user.username, `<button class="${user.active ? 'danger' : 'secondary'}">${user.active ? 'Disable access' : 'Enable access'}</button>`) : '<p class="small">Your administrator account cannot disable itself.</p>'}</div></details>`).join('')}</section></div>`, true);

export function createGateway({ registryPath, origin, now = Date.now, maxFailures = 10, tokenDbPath = ':memory:', controlSocket = '/control/control.sock', connectorImpl, controlImpl }) {
  const publicUrl = new URL(origin);
  const attempts = new Map();
  const dummyHash = hashPassword('not-an-account-password');
  let activeChecks = 0;
  const oauth = createOAuth({ origin: publicUrl.origin, databasePath: tokenDbPath, now, connector: connectorImpl ?? connector });
  const jobImports = createJobImportAccess({ databasePath: tokenDbPath === ':memory:' ? ':memory:' : tokenDbPath + '.jobs', now });
  const accountCookie = (value, age) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax${age === undefined ? '' : `; Max-Age=${age}`}`;
  const clearCookie = () => accountCookie('', 0);

  const headers = (response, type = 'text/html; charset=utf-8') => {
    response.setHeader('content-type', type);
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (publicUrl.protocol === 'https:') response.setHeader('strict-transport-security', 'max-age=31536000');
  };
  const reply = (response, status, body, type) => { headers(response, type); response.writeHead(status); response.end(typeof body === 'string' && body.startsWith('<!doctype html>') ? body.replace('<html lang="en">', `<html lang="en" data-ui-theme="${response.dossierUiTheme ?? 'studio'}"${response.dossierTheme ? ` data-theme="${response.dossierTheme}"` : ''}>`) : body); };
  const redirect = (response, path) => { headers(response); response.writeHead(303, { location: path }); response.end(); };
  const sameOrigin = (request) => request.headers.origin === publicUrl.origin && !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']);
  const clientIp = (request) => String(request.headers['x-forwarded-for'] ?? request.socket.remoteAddress).split(',').at(-1).trim();
  const rateKeys = (request, username) => [`ip:${clientIp(request)}`, `user:${username}`];
  const prune = () => { for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key); };

  async function registry() {
    const value = JSON.parse(await readFile(registryPath, 'utf8'));
    if (typeof value.sessionSecret !== 'string' || value.sessionSecret.length < 32 || !Array.isArray(value.users) || value.origin !== publicUrl.origin) throw new Error('Invalid account configuration');
    for (const user of value.users) {
      if (!validUsername(user.username) || typeof user.id !== 'string' || !user.revision || !user.passwordHash || !user.appSecret || !user.appPasswordHash) throw new Error('Invalid account configuration');
      // The config, never a browser header/path/parameter, selects the backend.
      const upstream = new URL(user.upstream);
      if (upstream.protocol !== 'http:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('Invalid backend');
    }
    return value;
  }

  async function readForm(request) {
    if (!String(request.headers['content-type']).startsWith('application/x-www-form-urlencoded')) throw Object.assign(new Error('Unsupported form'), { status: 415 });
    let length = 0;
    const chunks = [];
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 4096) throw Object.assign(new Error('Form too large'), { status: 413 });
      chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  async function connector(user, enable) {
    const response = await fetch(`${user.upstream}/api/account-connector`, { method: enable ? 'POST' : 'GET', headers: { host: publicUrl.host, origin: publicUrl.origin, 'x-forwarded-host': publicUrl.host, 'x-forwarded-proto': publicUrl.protocol.slice(0, -1), cookie: `dossier_session=${await dossierSession(user, false)}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Workspace connector unavailable');
    const { enabledAt } = await response.json();
    if (typeof enabledAt !== 'string') throw new Error('The MCP connector is off');
    return enabledAt;
  }

  async function control(payload, config) {
    if (controlImpl) return controlImpl(payload, config);
    const data = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const request = http.request({ socketPath: controlSocket, path: '/accounts', method: 'POST', headers: { authorization: `Bearer ${config.controlToken}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (response) => {
        const chunks = []; let size = 0;
        response.on('data', (chunk) => { size += chunk.length; if (size > 16384) request.destroy(); else chunks.push(chunk); });
        response.on('end', () => { try { const result = JSON.parse(Buffer.concat(chunks)); if (response.statusCode !== 200) reject(Object.assign(new Error(result.error ?? 'Account operation failed'), { status: response.statusCode })); else resolve(result); } catch { reject(new Error('Account service unavailable')); } });
        response.on('error', reject);
      });
      request.setTimeout(180_000, () => request.destroy(new Error('Account setup timed out')));
      request.on('error', () => reject(new Error('Account service unavailable')));
      request.end(data);
    });
  }

  async function proxy(request, response, authenticated) {
    const { user, persistent } = authenticated;
    const upstream = new URL(user.upstream);
    const outgoing = authenticated.jobImport ? { 'content-type': 'application/json', ...(request.headers['content-length'] ? { 'content-length': request.headers['content-length'] } : {}) } : { ...request.headers };
    const connectionHeaders = String(request.headers.connection ?? '').toLowerCase().split(',').map((name) => name.trim());
    for (const name of Object.keys(outgoing)) {
      if (hopHeaders.has(name) || connectionHeaders.includes(name) || name === 'forwarded' || name.startsWith('x-forwarded-') || name.startsWith('x-dossier-') || name.startsWith('x-careerai-') || name === 'authorization') delete outgoing[name];
    }
    outgoing.host = publicUrl.host;
    outgoing['x-forwarded-host'] = publicUrl.host;
    outgoing['x-forwarded-proto'] = publicUrl.protocol.slice(0, -1);
    outgoing['x-forwarded-for'] = clientIp(request);
    if (authenticated.jobImport) { outgoing.origin = publicUrl.origin; outgoing['sec-fetch-site'] = 'same-origin'; }
    if (authenticated.workspaceImport) outgoing['x-careerai-extension-id'] = authenticated.workspaceImport;
    const cookieParts = [];
    for (const [name, value] of parseCookies(authenticated.jobImport ? undefined : request.headers.cookie)) {
      if (![COOKIE, 'dossier_session', 'dossier_browser'].includes(name) && value !== null) cookieParts.push(`${name}=${value}`);
    }
    cookieParts.push(`dossier_session=${await dossierSession(user, persistent)}`);
    outgoing.cookie = cookieParts.join('; ');
    if (authenticated.mcp) outgoing.authorization = `Bearer ${await dossierMcpToken(user, authenticated.mcp.generation, authenticated.mcp.client_id)}`;
    const proxied = http.request({ hostname: upstream.hostname, port: upstream.port || 80, method: request.method, path: authenticated.workspaceImport ? "/api/linkedin/extension-workspace" : authenticated.jobImport ? "/api/linkedin/extension" : request.url, headers: outgoing }, (received) => {
      const responseHeaders = { ...received.headers };
      const connected = String(received.headers.connection ?? '').toLowerCase().split(',').map((name) => name.trim());
      for (const name of [...hopHeaders, ...connected]) delete responseHeaders[name];
      const cookies = received.headers['set-cookie'] ?? [];
      responseHeaders['set-cookie'] = cookies.filter((cookie) => !/^dossier_(session|browser)=/.test(cookie));
      // Native Dossier's Sign out action also signs out of the account gateway.
      if (cookies.some((cookie) => /^dossier_session=(?:;|\s*;|$)/.test(cookie) || /^dossier_session=.*;\s*Max-Age=0(?:;|$)/i.test(cookie))) responseHeaders['set-cookie'].push(clearCookie());
      if (!responseHeaders['set-cookie'].length) delete responseHeaders['set-cookie'];
      if (authenticated.jobImport) { delete responseHeaders['set-cookie']; responseHeaders['access-control-allow-origin'] = request.headers.origin; responseHeaders.vary = 'Origin'; }
      responseHeaders['cache-control'] = 'private, no-store';
      responseHeaders['x-content-type-options'] = 'nosniff';
      if (publicUrl.protocol === 'https:') responseHeaders['strict-transport-security'] = 'max-age=31536000';
      response.writeHead(received.statusCode ?? 502, responseHeaders);
      received.pipe(response);
      received.on('error', () => response.destroy());
    });
    proxied.setTimeout(600_000, () => proxied.destroy(new Error('Backend timeout')));
    proxied.on('error', () => { if (!response.headersSent) reply(response, 502, page('Workspace unavailable', '<p>Your workspace is starting or temporarily unavailable. Please try again shortly.</p>')); else response.destroy(); });
    request.on('aborted', () => proxied.destroy());
    response.on('close', () => { if (!response.writableFinished) proxied.destroy(); });
    request.pipe(proxied);
  }

  const server = http.createServer({ maxHeaderSize: 16384 }, async (request, response) => {
    try {
      if (request.headers.host !== publicUrl.host || !request.url.startsWith('/') || request.url.startsWith('//') || /[\\\x00-\x20]/.test(request.url)) return reply(response, 400, 'Invalid request', 'text/plain');
      const url = new URL(request.url, publicUrl);
      if (url.origin !== publicUrl.origin) return reply(response, 400, 'Invalid request', 'text/plain');
      const preference = parseCookies(request.headers.cookie).get('dossier_theme');
      response.dossierTheme = ['light', 'dark'].includes(preference) ? preference : undefined;
      const chosenTheme = parseCookies(request.headers.cookie).get('dossier_ui_theme');
      response.dossierUiTheme = ['studio', 'editorial', 'ocean', 'forest', 'violet', 'rose', 'ember', 'graphite'].includes(chosenTheme) ? chosenTheme : 'studio';
      const config = await registry();
      if (url.pathname === '/_accounts/health' && request.method === 'GET') return reply(response, 200, '{"status":"ok"}', 'application/json');
      if (publicUrl.protocol === 'https:' && request.headers['x-forwarded-proto'] !== 'https') return reply(response, 400, 'HTTPS required', 'text/plain');
      if (url.pathname.startsWith('/_accounts/assets/')) {
        const name = url.pathname.slice('/_accounts/assets/fonts/'.length);
        if (request.method !== 'GET' || !url.pathname.startsWith('/_accounts/assets/fonts/') || !['Geist-Regular.woff2', 'Geist-Medium.woff2', 'Geist-SemiBold.woff2', 'Newsreader-Regular.woff2', 'IBMPlexSans-Regular.woff2', 'IBMPlexSans-Medium.woff2', 'IBMPlexSans-SemiBold.woff2', 'SourceSerif4-Regular.woff2', 'SourceSerif4-Medium.woff2', 'SourceSerif4-SemiBold.woff2'].includes(name)) return reply(response, 404, 'Not found', 'text/plain');
        return reply(response, 200, await readFile(new URL(`./assets/fonts/${name}`, import.meta.url)), 'font/woff2');
      }
      if (blocked.test(url.pathname)) return reply(response, 404, 'Not found', 'text/plain');
      const metadata = oauth.metadata(url.pathname);
      if (metadata && request.method === 'GET') return reply(response, 200, JSON.stringify(metadata), 'application/json');
      if (['/api/oauth/register', '/api/oauth/token', '/api/oauth/revoke'].includes(url.pathname)) {
        if (request.method !== 'POST') return reply(response, 405, 'Method not allowed', 'text/plain');
        try {
          if (url.pathname === '/api/oauth/register') {
            if (!String(request.headers['content-type']).startsWith('application/json')) return reply(response, 415, '{}', 'application/json');
            let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 16384) return reply(response, 413, '{}', 'application/json'); }
            return reply(response, 201, JSON.stringify(await oauth.register(JSON.parse(body), config)), 'application/json');
          }
          const params = await readForm(request);
          if (url.pathname === '/api/oauth/revoke') { await oauth.revoke(params, config); return reply(response, 200, '{}', 'application/json'); }
          return reply(response, 200, JSON.stringify(await oauth.exchange(params, config)), 'application/json');
        } catch (problem) { return reply(response, problem.status ?? 400, JSON.stringify({ error: problem.oauthCode ?? 'invalid_request' }), 'application/json'); }
      }
      // Cross-origin access uses account/origin-bound grants. Job-only grants
      // cannot enter the separately consented LinkedIn workspace route.
      if (['/api/extension/pair', '/api/extension/jobs', '/api/extension/workspace', '/api/extension/revoke'].includes(url.pathname)) {
        const extension = request.headers.origin;
        if (!extensionOrigin(extension)) return reply(response, 403, '{"error":"Use the CareerAI Chrome extension."}', 'application/json');
        response.setHeader('access-control-allow-origin', extension);
        response.setHeader('vary', 'Origin');
        if (request.method === 'OPTIONS') {
          response.setHeader('access-control-allow-methods', 'POST');
          response.setHeader('access-control-allow-headers', 'authorization, content-type');
          return reply(response, 204, '', 'application/json');
        }
        if (request.method !== 'POST') return reply(response, 405, '{"error":"Method not allowed."}', 'application/json');
        if (!String(request.headers['content-type']).startsWith('application/json')) return reply(response, 415, '{"error":"Use JSON job details."}', 'application/json');
        if (url.pathname === '/api/extension/pair') {
          let bytes = 0, chunks = [];
          for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024) return reply(response, 413, '{}', 'application/json'); chunks.push(chunk); }
          try { const result = jobImports.exchange(JSON.parse(Buffer.concat(chunks).toString()).code, extension, config); return reply(response, 200, JSON.stringify(result), 'application/json'); }
          catch { return reply(response, 400, '{"error":"Invalid or expired pairing code. Create a new one in CareerAI."}', 'application/json'); }
        }
        let access;
        try { access = jobImports.authenticate(/^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1], extension, config, url.pathname === '/api/extension/jobs' || url.pathname === '/api/extension/workspace'); }
        catch { return reply(response, 429, '{"error":"Too many saves. Wait a minute before trying again."}', 'application/json'); }
        if (!access) return reply(response, 401, '{"error":"Extension access expired or was revoked. Pair CareerAI again."}', 'application/json');
        if (url.pathname === '/api/extension/workspace' && access.scope !== 'workspace') return reply(response, 403, '{"error":"Create a LinkedIn workspace pairing code in CareerAI to enable feed, messages and writing."}', 'application/json');
        if (url.pathname === '/api/extension/revoke') { jobImports.revoke(access.user, access.id); request.resume(); return reply(response, 200, '{}', 'application/json'); }
        return await proxy(request, response, { user: access.user, persistent: false, jobImport: true, ...(url.pathname === '/api/extension/workspace' ? { workspaceImport: access.id } : {}) });
      }
      if (url.pathname === '/api/mcp') {
        if (!['GET', 'POST', 'DELETE'].includes(request.method)) return reply(response, 405, 'Method not allowed', 'text/plain');
        if (request.headers.origin && request.headers.origin !== publicUrl.origin) return reply(response, 403, 'Request refused', 'text/plain');
        const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
        const access = await oauth.authenticate(bearer, config);
        if (!access) {
          response.setHeader('www-authenticate', `Bearer resource_metadata="${publicUrl.origin}/.well-known/oauth-protected-resource/api/mcp", scope="dossier"`);
          return reply(response, 401, '{"error":"invalid_token"}', 'application/json');
        }
        return await proxy(request, response, { user: access.user, persistent: false, mcp: access.grant });
      }
      if (url.pathname === '/_accounts/login' || url.pathname === '/login') {
        if (request.method === 'GET') return reply(response, 200, loginPage('', url.searchParams.get('next')));
        if (request.method !== 'POST') return reply(response, 405, 'Method not allowed', 'text/plain');
        if (!sameOrigin(request)) return reply(response, 403, 'Request refused', 'text/plain');
        prune();
        if (attempts.size >= 10000 || activeChecks >= 2) return reply(response, 429, loginPage('Please wait a moment and try again.'));
        const form = await readForm(request);
        const username = String(form.get('username') ?? '').toLowerCase().trim();
        const password = String(form.get('password') ?? '');
        if (!validUsername(username) || password.length < 1 || password.length > 256) return reply(response, 401, loginPage('The username or password is incorrect.'));
        const keys = rateKeys(request, username);
        if (keys.some((key) => (attempts.get(key)?.count ?? 0) >= maxFailures)) {
          response.setHeader('retry-after', '900');
          return reply(response, 429, loginPage('Too many sign-in attempts. Try again in 15 minutes.'));
        }
        // Reserve before the expensive password check, so simultaneous guesses count.
        for (const key of keys) {
          const value = attempts.get(key) ?? { count: 0, until: now() + 900_000 };
          value.count += 1; attempts.set(key, value);
        }
        const user = config.users.find((user) => user.username === username && user.active);
        activeChecks += 1;
        let matches;
        try { matches = await checkPassword(password, user?.passwordHash ?? await dummyHash); } finally { activeChecks -= 1; }
        if (!user || !matches) return reply(response, 401, loginPage('The username or password is incorrect.'));
        // Recheck the current revision: disabling/resetting an account wins a concurrent sign-in.
        const current = (await registry()).users.find((candidate) => candidate.id === user.id && candidate.active && candidate.revision === user.revision);
        if (!current) return reply(response, 401, loginPage('The username or password is incorrect.'));
        for (const key of keys) attempts.delete(key);
        const remember = form.get('remember') === 'on';
        response.setHeader('set-cookie', accountCookie(await createSession(user, config.sessionSecret, remember), remember ? PERSISTENT_SECONDS : undefined));
        return redirect(response, nextPath(form.get('next')));
      }
      const authenticated = await sessionUser(parseCookies(request.headers.cookie).get(COOKIE), config);
      if (!authenticated) {
        response.setHeader('set-cookie', clearCookie());
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_accounts/api/') || request.headers['next-action']) return reply(response, 401, '{"error":"Please sign in."}', 'application/json');
        return redirect(response, url.pathname === '/oauth/authorize' ? `/login?next=${encodeURIComponent(request.url)}` : '/login');
      }
      if (url.pathname === '/oauth/authorize') {
        try {
          const params = request.method === 'GET' ? url.searchParams : await readForm(request);
          if (request.method === 'POST') {
            if (!sameOrigin(request)) return reply(response, 403, 'Request refused', 'text/plain');
            return redirect(response, await oauth.consent(params, authenticated.user, config, params.get('decision') === 'allow'));
          }
          if (request.method !== 'GET') return reply(response, 405, 'Method not allowed', 'text/plain');
          const grant = await oauth.begin(params, config);
          const hidden = [...params].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
          return reply(response, 200, page('Connect your workspace', `${navigation(authenticated.user)}<p><strong>${escapeHtml(grant.clientName)}</strong> wants to access the private workspace for <strong>${escapeHtml(authenticated.user.username)}</strong>.</p><p>It can read your profile and applications, search and score jobs, and save drafts. It cannot send applications or delete your data.</p><p class="small">The app will return to ${escapeHtml(grant.redirectUri)}. Only connect apps you trust with your career data.</p><form method="post" action="/oauth/authorize">${hidden}<button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Cancel</button></form>`));
        } catch { return reply(response, 400, page('Unable to connect', '<p>The authorization request is invalid or expired. Start again from your MCP client.</p>')); }
      }
      if (url.pathname === '/_accounts/admin') {
        if (authenticated.user.role !== 'admin') return reply(response, 403, 'Administrator access required', 'text/plain');
        if (request.method === 'GET') return reply(response, 200, adminPage(config, authenticated.user));
        if (request.method !== 'POST') return reply(response, 405, 'Method not allowed', 'text/plain');
        if (!sameOrigin(request)) return reply(response, 403, 'Request refused', 'text/plain');
        const form = await readForm(request);
        try {
          const result = await control({ actor: authenticated.user.id, revision: authenticated.user.revision, operation: form.get('operation'), username: form.get('username'), password: form.get('password') || undefined }, config);
          return reply(response, 200, page(result.message, `<p>Username: <strong>${escapeHtml(result.username)}</strong></p>${result.password ? `<p>Save this password now. It will not be shown again.</p><div class="secret"><code>${escapeHtml(result.password)}</code></div>` : ''}<nav><a href="/_accounts/admin">Back to user management</a><a href="/">Open workspace</a></nav>`));
        } catch (problem) { return reply(response, 400, adminPage(await registry(), authenticated.user, problem.status ? problem.message : 'The account service is unavailable. Please try again shortly.')); }
      }
      if (url.pathname === '/_accounts/source' && request.method === 'GET') {
        const file = createReadStream(process.env.SOURCE_ARCHIVE ?? '/source/deployment-source.zip');
        file.once('open', () => { headers(response, 'application/zip'); response.setHeader('content-disposition', 'attachment; filename="dossier-private-source.zip"'); response.writeHead(200); file.pipe(response); });
        file.on('error', () => { if (!response.headersSent) reply(response, 503, 'Source archive unavailable', 'text/plain'); else response.destroy(); });
        response.on('close', () => file.destroy());
        return;
      }
      if (url.pathname === '/_accounts/api/job-extension') {
        if (request.method === 'GET') return reply(response, 200, JSON.stringify({ connections: jobImports.list(authenticated.user) }), 'application/json');
        if (request.method !== 'POST') return reply(response, 405, '{}', 'application/json');
        if (!sameOrigin(request)) return reply(response, 403, '{"error":"Request refused."}', 'application/json');
        const form = await readForm(request);
        if (['pair', 'pair-workspace'].includes(form.get('operation'))) {
          try { return reply(response, 200, JSON.stringify(jobImports.pair(authenticated.user, form.get('operation') === 'pair-workspace' ? 'workspace' : 'jobs')), 'application/json'); }
          catch (error) { return reply(response, 409, JSON.stringify({ error: error.message }), 'application/json'); }
        }
        if (form.get('operation') === 'revoke' && /^(all|[a-f0-9]{32})$/.test(form.get('id') ?? '')) { jobImports.revoke(authenticated.user, form.get('id')); return reply(response, 200, JSON.stringify({ connections: jobImports.list(authenticated.user) }), 'application/json'); }
        return reply(response, 400, '{"error":"Unknown extension operation."}', 'application/json');
      }
      if (url.pathname === '/_accounts/api/mcp') {
        if (request.method === 'GET') return reply(response, 200, JSON.stringify({ authorizations: oauth.count(authenticated.user) }), 'application/json');
        if (request.method !== 'POST') return reply(response, 405, '{}', 'application/json');
        if (!sameOrigin(request)) return reply(response, 403, '{"error":"Request refused"}', 'application/json');
        const form = await readForm(request);
        if (form.get('operation') === 'revoke') {
          oauth.revokeUser(authenticated.user);
          return reply(response, 200, '{"authorizations":0}', 'application/json');
        }
        if (form.get('operation') !== 'create') return reply(response, 400, '{"error":"Invalid operation"}', 'application/json');
        try {
          // Do not silently turn on a connector the user has switched off.
          await (connectorImpl ?? connector)(authenticated.user, false);
          const result = await oauth.personal(authenticated.user);
          return reply(response, 200, JSON.stringify({ ...result, authorizations: oauth.count(authenticated.user) }), 'application/json');
        } catch { return reply(response, 409, '{"error":"Turn on Let apps connect before generating a token."}', 'application/json'); }
      }
      if (url.pathname === '/_accounts/mcp') {
        if (request.method !== 'POST') return reply(response, 405, 'Method not allowed', 'text/plain');
        if (!sameOrigin(request)) return reply(response, 403, 'Request refused', 'text/plain');
        const form = await readForm(request);
        if (form.get('operation') === 'revoke') { oauth.revokeUser(authenticated.user); return redirect(response, '/settings?section=connector'); }
        const result = await oauth.personal(authenticated.user);
        return reply(response, 200, page('Your MCP access token', `${navigation(authenticated.user)}<p>This token can access only <strong>${escapeHtml(authenticated.user.username)}</strong>’s workspace. Save it now; it cannot be shown again.</p><div class="secret"><code>${escapeHtml(result.token)}</code></div><p>HTTP endpoint: <code>${escapeHtml(result.endpoint)}</code></p><p class="small">Expires ${escapeHtml(result.expires.slice(0, 10))}. Generating another token revokes the previous personal token. Browser OAuth clients can connect without copying a token.</p>`));
      }
      if (url.pathname === '/_accounts/logout') {
        if (request.method !== 'POST') return reply(response, 405, 'Method not allowed', 'text/plain');
        if (!sameOrigin(request)) return reply(response, 403, 'Request refused', 'text/plain');
        response.setHeader('set-cookie', clearCookie()); return redirect(response, '/login');
      }
      if (url.pathname === '/_accounts') {
        if (request.method !== 'GET') return reply(response, 405, 'Method not allowed', 'text/plain');
        return redirect(response, '/settings?section=connector');
      }
      if (url.pathname.startsWith('/_accounts/')) return reply(response, 404, 'Not found', 'text/plain');
      await proxy(request, response, authenticated);
    } catch (error) {
      // No request URLs, cookies, passwords, or configuration values in logs.
      if (!response.headersSent) reply(response, error.status ?? 503, 'The service is temporarily unavailable.', 'text/plain');
      else response.destroy();
      if (!error.status) console.error('Account gateway request failed');
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('close', () => { oauth.close(); jobImports.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin || (new URL(origin).protocol !== 'https:' && !process.env.ALLOW_HTTP_TEST)) throw new Error('PUBLIC_ORIGIN must use HTTPS');
  const server = createGateway({ registryPath: process.env.REGISTRY_PATH ?? '/state/registry.json', origin, tokenDbPath: process.env.TOKEN_DB_PATH ?? '/tokens/access.db', controlSocket: process.env.CONTROL_SOCKET ?? '/control/control.sock' });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => console.log('Dossier account gateway ready'));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
