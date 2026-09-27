import axios from 'axios';
import { ObjectId } from 'mongodb';
import { VercelDeploymentService } from './vercel-deployment.service';

describe('Vercel deployment lifecycle', () => {
  const userId = new ObjectId().toString();
  const websiteId = new ObjectId().toString();
  const websites = { findOne: jest.fn() };
  const deployments = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const users = { findOne: jest.fn() };
  const previews = { deploymentFiles: jest.fn(() => [{ file: 'index.html', data: '<h1>Hello</h1>' }]) };
  let service: VercelDeploymentService;
  const oldToken = process.env.VERCEL_TOKEN;
  const oldTeam = process.env.VERCEL_TEAM_ID;
  const oldV0 = process.env.V0_API_KEY;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERCEL_TOKEN = 'server-only-token';
    process.env.VERCEL_TEAM_ID = 'team_test';
    websites.findOne.mockResolvedValue({ id: new ObjectId(websiteId), userId, framework: 'html' });
    users.findOne.mockResolvedValue({ accountStatus: 'active' });
    deployments.findOne.mockResolvedValue(null);
    deployments.save.mockImplementation(async (value) => ({ id: new ObjectId(), createdAt: new Date(), ...value }));
    service = new VercelDeploymentService(websites as any, deployments as any, users as any, previews as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries({ VERCEL_TOKEN: oldToken, VERCEL_TEAM_ID: oldTeam, V0_API_KEY: oldV0 })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('submits only saved source and stores the remote deployment ID without returning credentials', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { id: 'dpl_test', readyState: 'QUEUED', url: 'site-test.vercel.app', env: { secret: 'must-not-return' } } });
    const result = await service.deploy(websiteId, userId, {});
    expect(post).toHaveBeenCalledWith('https://api.vercel.com/v13/deployments', expect.objectContaining({ name: `webgenius-${websiteId}`, target: 'production', files: expect.any(Array) }), expect.objectContaining({ params: { teamId: 'team_test' } }));
    expect(result.status).toBe('QUEUED');
    expect(result.url).toBe('https://site-test.vercel.app');
    expect(JSON.stringify(result)).not.toMatch(/server-only-token|must-not-return/);
    expect(deployments.save).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'dpl_test' }));
  });

  it('rejects another user before contacting Vercel', async () => {
    websites.findOne.mockResolvedValue({ userId: 'other' });
    const post = jest.spyOn(axios, 'post');
    await expect(service.deploy(websiteId, userId, {})).rejects.toMatchObject({ status: 404 });
    expect(post).not.toHaveBeenCalled();
  });

  it('requires server configuration', async () => {
    delete process.env.VERCEL_TOKEN;
    await expect(service.deploy(websiteId, userId, {})).rejects.toMatchObject({ status: 503 });
  });

  it('requires an externally hosted backend for full-stack projects', async () => {
    websites.findOne.mockResolvedValue({ userId, framework: 'react', backendFiles: [{ path: 'server.js' }] });
    await expect(service.deploy(websiteId, userId, {})).rejects.toMatchObject({ status: 400 });
  });

  it('does not submit a duplicate while a deployment is building', async () => {
    deployments.findOne.mockResolvedValue({ status: 'BUILDING' });
    const post = jest.spyOn(axios, 'post');
    await expect(service.deploy(websiteId, userId, {})).rejects.toMatchObject({ status: 409 });
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshes the stored deployment only and returns the ready URL', async () => {
    deployments.findOne.mockResolvedValue({ id: new ObjectId(), status: 'BUILDING', providerId: 'dpl_owned', teamId: 'team_original' });
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { readyState: 'READY', url: 'ready.vercel.app' } });
    const result = await service.status(websiteId, userId);
    expect(get).toHaveBeenCalledWith('https://api.vercel.com/v13/deployments/dpl_owned', expect.objectContaining({ params: { teamId: 'team_original' } }));
    expect(result.deployment).toMatchObject({ status: 'READY', url: 'https://ready.vercel.app' });
  });

  it('records uncertain network submissions instead of claiming failure or automatically retrying', async () => {
    const post = jest.spyOn(axios, 'post').mockRejectedValue(new Error('timeout'));
    await expect(service.deploy(websiteId, userId, {})).rejects.toMatchObject({ status: 502 });
    expect(deployments.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fetches the complete Next.js files from the owned v0 chat', async () => {
    process.env.V0_API_KEY = 'test-v0';
    websites.findOne.mockResolvedValue({ userId, framework: 'next', v0ChatId: 'owned-chat' });
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { latestVersion: { status: 'completed', files: [
      { name: 'package.json', content: JSON.stringify({ dependencies: { next: 'latest' } }) },
      { name: 'app/page.tsx', content: 'export default function Page(){return <main>Hello</main>}' },
    ] } } });
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { id: 'dpl_next', readyState: 'QUEUED' } });
    await service.deploy(websiteId, userId, {});
    expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ projectSettings: expect.objectContaining({ framework: 'nextjs' }) }));
  });
});
