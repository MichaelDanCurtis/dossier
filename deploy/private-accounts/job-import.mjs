import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export const extensionOrigin = (value) => typeof value === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(value);
const refuse = (message, status = 400) => Object.assign(new Error(message), { status });

/** Independent import-only credentials. Never enables MCP or issues native cookies to clients. */
export function createJobImportAccess({ databasePath = ':memory:', now = Date.now }) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS job_import_pairs(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,revision TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS job_import_grants(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL,revision TEXT NOT NULL,origin TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,last_used INTEGER NOT NULL DEFAULT 0,minute INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS job_import_user ON job_import_grants(user_id);`);
  const seconds = () => Math.floor(now() / 1000);
  function clean() {
    db.prepare('DELETE FROM job_import_pairs WHERE expires<=?').run(seconds());
    db.prepare('DELETE FROM job_import_grants WHERE expires<=?').run(seconds());
  }
  function count(user) { return db.prepare('SELECT count(*) AS n FROM job_import_grants WHERE user_id=? AND revision=? AND expires>?').get(user.id, user.revision, seconds()).n; }
  return {
    close: () => db.close(),
    list(user) {
      return db.prepare('SELECT id,created,expires,last_used FROM job_import_grants WHERE user_id=? AND revision=? AND expires>? ORDER BY created DESC').all(user.id, user.revision, seconds()).map((row) => ({ id: row.id, createdAt: row.created * 1000, expiresAt: row.expires * 1000, lastUsedAt: row.last_used ? row.last_used * 1000 : null }));
    },
    pair(user) {
      clean();
      if (count(user) >= 5) throw refuse('Revoke an old extension connection before adding another.', 409);
      const code = randomBytes(24).toString('base64url');
      db.prepare('DELETE FROM job_import_pairs WHERE user_id=?').run(user.id);
      db.prepare('INSERT INTO job_import_pairs(hash,user_id,revision,expires) VALUES(?,?,?,?)').run(hash(code), user.id, user.revision, seconds() + 300);
      return { code, expiresAt: (seconds() + 300) * 1000 };
    },
    exchange(code, origin, config) {
      if (!extensionOrigin(origin) || typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw refuse('Invalid or expired pairing code. Create a new one in CareerAI.');
      const pair = db.prepare('SELECT * FROM job_import_pairs WHERE hash=? AND expires>?').get(hash(code), seconds());
      const user = config.users.find((item) => item.active && item.id === pair?.user_id && item.revision === pair.revision);
      if (!user || count(user) >= 5) throw refuse('Invalid or expired pairing code. Create a new one in CareerAI.');
      const token = 'careerai_jobs_' + randomBytes(32).toString('base64url'), id = randomBytes(16).toString('hex'), expires = seconds() + 90 * 86400;
      db.exec('BEGIN IMMEDIATE');
      try {
        const consumed = db.prepare('DELETE FROM job_import_pairs WHERE hash=?').run(hash(code));
        if (consumed.changes !== 1) throw refuse('Pairing code already used.');
        db.prepare('INSERT INTO job_import_grants(id,hash,user_id,revision,origin,created,expires) VALUES(?,?,?,?,?,?,?)').run(id, hash(token), user.id, user.revision, origin, seconds(), expires);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { token, account: user.username, expiresAt: expires * 1000 };
    },
    authenticate(token, origin, config, consume = true) {
      if (!extensionOrigin(origin) || typeof token !== 'string' || !/^careerai_jobs_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const grant = db.prepare('SELECT * FROM job_import_grants WHERE hash=? AND origin=? AND expires>?').get(hash(token), origin, seconds());
      const user = config.users.find((item) => item.active && item.id === grant?.user_id && item.revision === grant.revision);
      if (!user) return null;
      if (!consume) return { user, id: grant.id };
      const minute = Math.floor(seconds() / 60);
      if (grant.minute === minute && grant.requests >= 30) throw refuse('Too many saves. Wait a minute before trying again.', 429);
      db.prepare('UPDATE job_import_grants SET last_used=?,minute=?,requests=? WHERE id=?').run(seconds(), minute, grant.minute === minute ? grant.requests + 1 : 1, grant.id);
      return { user, id: grant.id };
    },
    revoke(user, id) {
      if (id === 'all') {
        db.prepare('DELETE FROM job_import_pairs WHERE user_id=?').run(user.id);
        db.prepare('DELETE FROM job_import_grants WHERE user_id=?').run(user.id);
      } else db.prepare('DELETE FROM job_import_grants WHERE user_id=? AND id=?').run(user.id, id);
    },
  };
}
