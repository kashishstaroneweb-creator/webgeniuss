import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { Server } from 'http';
import axios from 'axios';
import { GENERATED_AUTH_SOURCE, GENERATED_SERVER_SOURCE } from './generated-auth.template';

function loadSource(source: string, resolve: (name: string) => any, directory: string) {
  const compiled = vm.runInThisContext(`(function(require, module, __dirname) { ${source}\n})`);
  const module = { exports: {} };
  compiled(resolve, module, directory);
  return module.exports as any;
}

describe('Generated backend authentication (real HTTP and filesystem)', () => {
  let directory: string;
  let server: Server;
  let baseURL: string;
  let clock: number;
  const password = 'A long test password!';
  const request = (method: string, url: string, data?: any, token?: string) => axios.request({
    baseURL, method, url, data, proxy: false, validateStatus: () => true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const signup = (email = 'alice@example.com') => request('POST', '/api/auth/signup', { email, password, name: 'Alice' });
  const stop = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  async function start() {
    const factory = loadSource(GENERATED_AUTH_SOURCE, require, directory);
    const app = loadSource(GENERATED_SERVER_SOURCE, (name) => {
      if (name === './auth') return () => factory({ storePath: path.join(directory, 'auth-data.json'), now: () => clock });
      if (name === './routes') return (application: any) => application.get('/api/private', (req: any, res: any) => res.json({ user: req.user }));
      if (name === 'dotenv') return { config: () => {} };
      return require(name);
    }, directory);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${(server.address() as any).port}`;
  }
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webgenius-auth-test-'));
    clock = Date.now();
    await start();
  });
  afterEach(async () => {
    if (server?.listening) await stop();
    if (directory && path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('webgenius-auth-test-')) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps health public but protects application routes before they execute', async () => {
    expect((await request('GET', '/api/health')).status).toBe(200);
    expect((await request('GET', '/api/private')).status).toBe(401);
    const registered = await signup();
    expect(registered.status).toBe(201);
    const result = await request('GET', '/api/private', undefined, registered.data.token);
    expect(result.status).toBe(200);
    expect(result.data.user).toEqual({ id: expect.any(String), name: 'Alice', email: 'alice@example.com' });
  });

  it('stores independently salted password hashes and hashed session tokens only', async () => {
    const first = await signup();
    const second = await signup('bob@example.com');
    const raw = await fs.readFile(path.join(directory, 'auth-data.json'), 'utf8');
    const stored = JSON.parse(raw);
    expect(stored.users[0].salt).not.toBe(stored.users[1].salt);
    expect(stored.users[0].passwordHash).not.toBe(stored.users[1].passwordHash);
    expect(stored.users[0].passwordHash).toMatch(/^[a-f0-9]{128}$/);
    expect(raw).not.toContain(password);
    expect(raw).not.toContain(first.data.token);
    expect(raw).not.toContain(second.data.token);
    expect(first.data.user).not.toHaveProperty('passwordHash');
    expect(first.data.user).not.toHaveProperty('salt');
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('logs in with normalized email and does not reveal which invalid credential was wrong', async () => {
    await signup();
    const login = await request('POST', '/api/auth/login', { email: ' ALICE@EXAMPLE.COM ', password });
    expect(login.status).toBe(200);
    expect((await request('GET', '/api/auth/me', undefined, login.data.token)).data.user.email).toBe('alice@example.com');
    const wrong = await request('POST', '/api/auth/login', { email: 'alice@example.com', password: 'incorrect password' });
    const missing = await request('POST', '/api/auth/login', { email: 'missing@example.com', password });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.data).toEqual(missing.data);
  });

  it.each([
    { email: 'invalid', password },
    { email: 'alice@example.com', password: 'short' },
    { email: 'alice@example.com', password: 'x'.repeat(129) },
    { email: 'alice@example.com', password, name: { invalid: true } },
  ])('rejects invalid signup fields: %p', async (body) => {
    expect((await request('POST', '/api/auth/signup', body)).status).toBe(400);
  });

  it('prevents duplicate accounts even during simultaneous signup requests', async () => {
    const results = await Promise.all([signup(), signup('ALICE@example.com')]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'auth-data.json'), 'utf8')).users).toHaveLength(1);
  });

  it('rejects missing, forged and expired sessions', async () => {
    const result = await signup();
    expect((await request('GET', '/api/auth/me')).status).toBe(401);
    expect((await request('GET', '/api/auth/me', undefined, 'fake-token')).status).toBe(401);
    expect((await request('GET', '/api/auth/me', undefined, 'a'.repeat(64))).status).toBe(401);
    clock += 24 * 60 * 60 * 1000 + 1;
    expect((await request('GET', '/api/auth/me', undefined, result.data.token)).status).toBe(401);
  });

  it('preserves accounts and sessions across restart and revokes logout across restart', async () => {
    const result = await signup();
    await stop(); await start();
    expect((await request('GET', '/api/auth/me', undefined, result.data.token)).status).toBe(200);
    expect((await request('POST', '/api/auth/logout', {}, result.data.token)).status).toBe(200);
    await stop(); await start();
    expect((await request('GET', '/api/private', undefined, result.data.token)).status).toBe(401);
    expect((await request('POST', '/api/auth/login', { email: 'alice@example.com', password })).status).toBe(200);
  });

  it('limits repeated credential attempts and allows them after the cooldown', async () => {
    for (let index = 0; index < 10; index++) {
      expect((await request('POST', '/api/auth/login', { email: 'nobody@example.com', password })).status).toBe(401);
    }
    expect((await request('POST', '/api/auth/login', { email: 'nobody@example.com', password })).status).toBe(429);
    clock += 15 * 60 * 1000 + 1;
    expect((await request('POST', '/api/auth/login', { email: 'nobody@example.com', password })).status).toBe(401);
  }, 15000);

  it('fails closed on corrupt credential storage without overwriting it', async () => {
    await fs.writeFile(path.join(directory, 'auth-data.json'), 'broken');
    expect((await signup()).status).toBe(500);
    expect(await fs.readFile(path.join(directory, 'auth-data.json'), 'utf8')).toBe('broken');
  });
});

describe('Generated backend route module compatibility', () => {
  it('accepts model-written { registerRoutes } exports', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webgenius-routes-test-'));
    const factory = loadSource(GENERATED_AUTH_SOURCE, require, directory);
    const app = loadSource(GENERATED_SERVER_SOURCE, (name) => {
      if (name === './auth') return () => factory({ storePath: path.join(directory, 'auth-data.json') });
      if (name === './routes') {
        return {
          registerRoutes: (application: any) =>
            application.get('/api/private', (req: any, res: any) => res.json({ user: req.user })),
        };
      }
      if (name === 'dotenv') return { config: () => {} };
      return require(name);
    }, directory);
    const server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
      const baseURL = `http://127.0.0.1:${(server.address() as any).port}`;
      const response = await axios.get('/api/health', { baseURL, proxy: false, validateStatus: () => true });
      expect(response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
