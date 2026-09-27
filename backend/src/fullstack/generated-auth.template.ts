/** Trusted source shipped with each generated backend; no model-written password handling. */
export const GENERATED_AUTH_SOURCE = String.raw`'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');
const scrypt = promisify(crypto.scrypt);

module.exports = function createAuth(options = {}) {
  const storePath = options.storePath || path.join(__dirname, 'auth-data.json');
  const now = options.now || Date.now;
  const sessionLifetime = 24 * 60 * 60 * 1000;
  let queue = Promise.resolve();
  let hashing = 0;
  const attempts = new Map();
  const router = express.Router();
  const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name });
  const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const endpoint = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Authentication is temporarily unavailable' });
  });

  // Serialize read/modify/write operations and replace the file atomically. Never reset a corrupt store.
  function withStore(operation, save = false) {
    const result = queue.then(async () => {
      let store;
      try { store = JSON.parse(await fs.readFile(storePath, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        store = { users: [], sessions: [] };
      }
      if (!Array.isArray(store.users) || !Array.isArray(store.sessions)) throw new Error('Invalid auth store');
      const value = operation(store);
      if (save) {
        const temporary = storePath + '.tmp';
        await fs.writeFile(temporary, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, storePath);
      }
      return value;
    });
    queue = result.catch(() => {});
    return result;
  }

  async function hashPassword(password, salt) {
    if (hashing >= 2) throw fail(429, 'Too many authentication requests. Try again shortly.');
    hashing++;
    try {
      return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    } finally { hashing--; }
  }

  function credentials(body) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address');
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw fail(400, 'Password must contain 12 to 128 characters');
    }
    for (const [key, entry] of attempts) if (entry.until <= now()) attempts.delete(key);
    const entry = attempts.get(email) || { count: 0, until: now() + 15 * 60 * 1000 };
    if (entry.count >= 10 || (!attempts.has(email) && attempts.size >= 1000)) {
      throw fail(429, 'Too many authentication attempts. Try again in 15 minutes.');
    }
    entry.count++;
    attempts.set(email, entry);
    return { email, password };
  }

  function issueSession(store, user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + sessionLifetime;
    store.sessions = store.sessions.filter((session) => session.expiresAt > now());
    // Keep at most ten active sessions per user.
    const own = store.sessions.filter((session) => session.userId === user.id);
    const remove = new Set(own.slice(0, Math.max(0, own.length - 9)).map((session) => session.tokenHash));
    store.sessions = store.sessions.filter((session) => !remove.has(session.tokenHash));
    store.sessions.push({ tokenHash: digest(token), userId: user.id, expiresAt });
    return { user: publicUser(user), token, expiresAt: new Date(expiresAt).toISOString() };
  }

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/signup', endpoint(async (req, res) => {
    const { email, password } = credentials(req.body);
    const name = req.body.name === undefined ? '' : req.body.name;
    if (typeof name !== 'string' || name.trim().length > 100) throw fail(400, 'Name must be at most 100 characters');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await hashPassword(password, salt)).toString('hex');
    const result = await withStore((store) => {
      if (store.users.some((user) => user.email === email)) throw fail(409, 'An account with this email already exists');
      const user = { id: crypto.randomUUID(), email, name: name.trim(), salt, passwordHash };
      store.users.push(user);
      return issueSession(store, user);
    }, true);
    res.status(201).json(result);
  }));

  router.post('/login', endpoint(async (req, res) => {
    const { email, password } = credentials(req.body);
    const user = await withStore((store) => store.users.find((candidate) => candidate.email === email));
    const actual = await hashPassword(password, user ? user.salt : '00000000000000000000000000000000');
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
    if (!user || expected.length !== actual.length || !crypto.timingSafeEqual(actual, expected)) {
      throw fail(401, 'Invalid email or password');
    }
    const result = await withStore((store) => issueSession(store, user), true);
    res.json(result);
  }));

  const requireAuth = endpoint(async (req, res, next) => {
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('authorization') || '');
    if (!match) throw fail(401, 'Authentication required');
    const tokenHash = digest(match[1]);
    const user = await withStore((store) => {
      const session = store.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now());
      return session && store.users.find((item) => item.id === session.userId);
    });
    if (!user) throw fail(401, 'Session is invalid or expired');
    req.user = publicUser(user);
    req.authTokenHash = tokenHash;
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  router.post('/logout', requireAuth, endpoint(async (req, res) => {
    await withStore((store) => {
      store.sessions = store.sessions.filter((session) => session.tokenHash !== req.authTokenHash);
    }, true);
    res.json({ ok: true });
  }));
  return { router, requireAuth };
};
`;

export const GENERATED_SERVER_SOURCE = String.raw`'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const createAuth = require('./auth');
const registerRoutes = require('./routes');
const app = express();
app.disable('x-powered-by');
app.use(cors({ allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '100kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
const auth = createAuth();
app.use('/api/auth', auth.router);
// Authentication runs before every generated application route.
app.use('/api', auth.requireAuth);
registerRoutes(app);
app.use((_req, res) => res.status(404).json({ message: 'Endpoint not found' }));
app.use((error, _req, res, _next) => {
  res.status(error.status === 400 ? 400 : 500).json({ message: error.status === 400 ? 'Invalid JSON request' : 'Request failed' });
});
if (require.main === module) app.listen(Number(process.env.PORT) || 4000, '0.0.0.0');
module.exports = app;
`;
