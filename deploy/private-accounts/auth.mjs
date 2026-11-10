import { createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { EncryptJWT, jwtVerify, SignJWT } from 'jose';

const derive = promisify(scrypt);
export const COOKIE = '__Host-dossier_account';
export const SESSION_SECONDS = 24 * 60 * 60;
export const PERSISTENT_SECONDS = 30 * SESSION_SECONDS;
export const validUsername = (name) => typeof name === 'string' && /^[a-z][a-z0-9_-]{2,31}$/.test(name);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const key = await derive(password, salt, 32, options);
  return `scrypt:${salt}:${key.toString('base64url')}`;
}

export async function checkPassword(password, hash) {
  const [algorithm, salt, encoded] = String(hash).split(':');
  if (algorithm !== 'scrypt' || !/^[\w-]{22}$/.test(salt ?? '') || !/^[\w-]{43}$/.test(encoded ?? '')) return false;
  const key = await derive(password, salt, 32, options);
  return timingSafeEqual(key, Buffer.from(encoded, 'base64url'));
}

const key = (secret) => new Uint8Array(hkdfSync('sha256', secret, '', 'dossier account gateway v1', 32));

export async function createSession(user, secret, remember = false) {
  const seconds = remember ? PERSISTENT_SECONDS : SESSION_SECONDS;
  return new SignJWT({ rev: user.revision, persistent: remember })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id)
    .setIssuer('dossier-accounts').setAudience('dossier-accounts')
    .setIssuedAt().setExpirationTime(`${seconds}s`).setJti(randomBytes(16).toString('hex'))
    .sign(key(secret));
}

export async function sessionUser(token, registry) {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, key(registry.sessionSecret), {
      algorithms: ['HS256'], issuer: 'dossier-accounts', audience: 'dossier-accounts',
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
    });
    if (typeof payload.persistent !== 'boolean') return null;
    const user = registry.users.find((user) => user.id === payload.sub && user.active && user.revision === payload.rev);
    return user ? { user, persistent: payload.persistent } : null;
  } catch { return null; }
}

// Matches Dossier 1.13's native session format. Separate keys and password
// fingerprints mean a session for one backend cannot authenticate to another.
export async function dossierSession(user, persistent) {
  const deriveKey = (purpose) => new Uint8Array(hkdfSync('sha256', user.appSecret, '', `dossier ${purpose} v1`, 32));
  const fingerprint = createHmac('sha256', deriveKey('password-fingerprint'))
    .update(user.appPasswordHash, 'utf8').digest('base64url').slice(0, 16);
  return new EncryptJWT({ persistent, pwd: fingerprint })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt()
    .setExpirationTime(`${persistent ? PERSISTENT_SECONDS : SESSION_SECONDS}s`)
    .encrypt(deriveKey('session'));
}

export async function dossierMcpToken(user, generation, clientId) {
  const deriveKey = (purpose) => new Uint8Array(hkdfSync('sha256', user.appSecret, '', `dossier ${purpose} v1`, 32));
  const fingerprint = createHmac('sha256', deriveKey('password-fingerprint')).update(user.appPasswordHash, 'utf8').digest('base64url').slice(0, 16);
  return new SignJWT({ cid: clientId, scope: 'dossier', pwd: fingerprint, gen: generation })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('dossier-mcp').setIssuedAt().setExpirationTime('5m').sign(deriveKey('connector-access'));
}

export function parseCookies(value = '') {
  const cookies = new Map();
  for (const item of value.split(';')) {
    const offset = item.indexOf('=');
    if (offset > 0) {
      const name = item.slice(0, offset).trim();
      // Duplicate auth cookies are ambiguous: fail closed.
      if (cookies.has(name)) cookies.set(name, null);
      else cookies.set(name, item.slice(offset + 1).trim());
    }
  }
  return cookies;
}
