import { DatabaseSync } from 'node:sqlite';
import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const clientKey = (secret) => new Uint8Array(hkdfSync('sha256', secret, '', 'dossier gateway oauth clients v1', 32));
const error = (code, message = 'The authorization request is invalid.') => Object.assign(new Error(message), { oauthCode: code, status: 400 });

export function createOAuth({ origin, databasePath = ':memory:', connector, now = Date.now }) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,revision TEXT NOT NULL,client_id TEXT NOT NULL,generation TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,kind TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS codes(hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS user_grants ON grants(user_id);
  `);
  const resource = `${origin}/api/mcp`;
  const seconds = () => Math.floor(now() / 1000);
  const userFor = (grant, config) => config.users.find((user) => user.active && user.id === grant?.user_id && user.revision === grant.revision);
  const grantFor = (id) => db.prepare('SELECT * FROM grants WHERE id=? AND revoked=0 AND expires>?').get(id, seconds());

  function grant(user, clientId, generation) {
    const id = random();
    db.prepare('INSERT INTO grants(id,user_id,revision,client_id,generation,expires) VALUES(?,?,?,?,?,?)').run(id, user.id, user.revision, clientId, generation, seconds() + 90 * 86400);
    return id;
  }
  function token(grantId, kind, lifetime) {
    const value = `dossier_${kind}_${random()}`;
    db.prepare('INSERT INTO tokens(hash,grant_id,kind,expires) VALUES(?,?,?,?)').run(digest(value), grantId, kind, seconds() + lifetime);
    return value;
  }
  function pair(grantId) {
    return { access_token: token(grantId, 'access', 3600), refresh_token: token(grantId, 'refresh', 30 * 86400), expires_in: 3600, token_type: 'Bearer', scope: 'dossier' };
  }
  async function current(grantId, config) {
    const value = grantFor(grantId);
    const user = userFor(value, config);
    if (!user || (await connector(user, false)) !== value.generation) throw error('invalid_grant', 'The authorization was revoked or the MCP connector is off.');
    return { user, grant: value };
  }
  function redirectAllowed(uri) {
    try {
      const url = new URL(uri);
      return !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
    } catch { return false; }
  }
  async function client(clientId, config) {
    try {
      const { payload } = await jwtVerify(clientId, clientKey(config.sessionSecret), { audience: 'dossier-gateway-client', algorithms: ['HS256'] });
      if (typeof payload.name !== 'string' || !Array.isArray(payload.redirects) || !payload.redirects.every((uri) => typeof uri === 'string' && redirectAllowed(uri))) throw new Error();
      return payload;
    } catch { throw error('invalid_client'); }
  }
  async function begin(params, config) {
    const clientId = params.get('client_id') ?? '';
    const registered = await client(clientId, config);
    const redirectUri = params.get('redirect_uri') ?? '';
    const challenge = params.get('code_challenge') ?? '';
    if (!registered.redirects.includes(redirectUri) || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !['', 'dossier'].includes(params.get('scope') ?? '') || (params.get('resource') && params.get('resource') !== resource) || (params.get('state')?.length ?? 0) > 2048) throw error('invalid_request');
    return { clientId, clientName: registered.name, redirectUri, challenge, state: params.get('state') ?? '' };
  }
  const authorizationMetadata = {
    issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/api/oauth/token`, registration_endpoint: `${origin}/api/oauth/register`, revocation_endpoint: `${origin}/api/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['dossier'],
  };

  return {
    resource,
    close: () => db.close(),
    metadata(pathname) {
      if (/^\/\.well-known\/oauth-authorization-server(?:\/.*)?$/.test(pathname) || pathname === '/api/oauth/metadata') return authorizationMetadata;
      if (/^\/\.well-known\/oauth-protected-resource(?:\/.*)?$/.test(pathname) || pathname === '/api/oauth/protected-resource') return { resource, authorization_servers: [origin], scopes_supported: ['dossier'], bearer_methods_supported: ['header'], resource_name: 'Dossier private workspace' };
      return null;
    },
    async register(value, config) {
      const redirects = value.redirect_uris;
      if (!Array.isArray(redirects) || !redirects.length || redirects.length > 5 || !redirects.every((uri) => typeof uri === 'string' && uri.length <= 2048 && redirectAllowed(uri)) || (value.token_endpoint_auth_method && value.token_endpoint_auth_method !== 'none')) throw error('invalid_client_metadata');
      const name = typeof value.client_name === 'string' ? value.client_name.slice(0, 100) : 'MCP client';
      const clientId = await new SignJWT({ name, redirects }).setProtectedHeader({ alg: 'HS256' }).setAudience('dossier-gateway-client').setIssuedAt().setJti(random()).sign(clientKey(config.sessionSecret));
      return { client_id: clientId, client_id_issued_at: seconds(), client_name: name, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
    },
    begin,
    async consent(params, user, config, allowed) {
      const request = await begin(params, config);
      const redirect = new URL(request.redirectUri);
      if (request.state) redirect.searchParams.set('state', request.state);
      if (!allowed) { redirect.searchParams.set('error', 'access_denied'); return redirect.href; }
      const generation = await connector(user, true);
      const grantId = grant(user, request.clientId, generation);
      const code = random();
      db.prepare('INSERT INTO codes(hash,grant_id,client_id,redirect_uri,challenge,expires) VALUES(?,?,?,?,?,?)').run(digest(code), grantId, request.clientId, request.redirectUri, request.challenge, seconds() + 300);
      redirect.searchParams.set('code', code);
      return redirect.href;
    },
    async exchange(params, config) {
      const clientId = params.get('client_id') ?? '';
      await client(clientId, config);
      if (params.get('resource') && params.get('resource') !== resource) throw error('invalid_target');
      if (params.get('grant_type') === 'authorization_code') {
        const code = db.prepare('SELECT * FROM codes WHERE hash=? AND expires>?').get(digest(params.get('code') ?? ''), seconds());
        const verifier = params.get('code_verifier') ?? '';
        if (!code || code.client_id !== clientId || code.redirect_uri !== params.get('redirect_uri') || !/^[\w.~\-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== code.challenge) throw error('invalid_grant');
        await current(code.grant_id, config);
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!db.prepare('DELETE FROM codes WHERE hash=?').run(code.hash).changes) throw error('invalid_grant');
          const result = pair(code.grant_id); db.exec('COMMIT'); return result;
        } catch (problem) { db.exec('ROLLBACK'); throw problem; }
      }
      if (params.get('grant_type') === 'refresh_token') {
        const stored = db.prepare("SELECT * FROM tokens WHERE hash=? AND kind='refresh' AND expires>?").get(digest(params.get('refresh_token') ?? ''), seconds());
        if (!stored) throw error('invalid_grant');
        const active = await current(stored.grant_id, config);
        if (active.grant.client_id !== clientId) throw error('invalid_grant');
        db.exec('BEGIN IMMEDIATE');
        try {
          const fresh = db.prepare('SELECT used FROM tokens WHERE hash=?').get(stored.hash);
          if (!fresh || fresh.used) {
            db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(stored.grant_id);
            db.exec('COMMIT'); throw error('invalid_grant', 'Refresh token reuse revoked this authorization. Connect again.');
          }
          db.prepare('UPDATE tokens SET used=1 WHERE hash=?').run(stored.hash);
          const result = pair(stored.grant_id); db.exec('COMMIT'); return result;
        } catch (problem) { if (db.isTransaction) db.exec('ROLLBACK'); throw problem; }
      }
      throw error('unsupported_grant_type');
    },
    async authenticate(value, config) {
      if (typeof value !== 'string' || value.length > 256) return null;
      const stored = db.prepare("SELECT * FROM tokens WHERE hash=? AND kind IN ('access','personal') AND expires>? AND used=0").get(digest(value), seconds());
      if (!stored) return null;
      try { return await current(stored.grant_id, config); } catch { return null; }
    },
    async personal(user) {
      const generation = await connector(user, true);
      db.prepare("UPDATE grants SET revoked=1 WHERE user_id=? AND client_id='personal'").run(user.id);
      const id = grant(user, 'personal', generation);
      return { token: token(id, 'personal', 90 * 86400), expires: new Date((seconds() + 90 * 86400) * 1000).toISOString(), endpoint: resource };
    },
    revokeUser(user) { db.prepare('UPDATE grants SET revoked=1 WHERE user_id=?').run(user.id); },
    async revoke(params, config) {
      const clientId = params.get('client_id') ?? '';
      await client(clientId, config);
      const stored = db.prepare('SELECT g.id,g.client_id FROM tokens t JOIN grants g ON t.grant_id=g.id WHERE t.hash=?').get(digest(params.get('token') ?? ''));
      if (stored?.client_id === clientId) db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(stored.id);
    },
    count(user) { return db.prepare('SELECT COUNT(*) AS count FROM grants WHERE user_id=? AND revision=? AND revoked=0 AND expires>?').get(user.id, user.revision, seconds()).count; },
  };
}
