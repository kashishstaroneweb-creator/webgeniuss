import axios from 'axios';
import { OpenAIBackendService } from './openai-backend.service';
import { GENERATED_AUTH_SOURCE, GENERATED_SERVER_SOURCE } from './generated-auth.template';
import { BlueprintPromptService } from './blueprint-prompt.service';

describe('Backend generation authentication assembly', () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousUrl = process.env.BACKEND_GENERATOR_URL;
  const previousRender = process.env.RENDER;
  const makePlan = () => ({
    blueprint: { projectName: 'Tasks', summary: 'Tasks', features: [], dataModels: [], api: [
      { method: 'GET', path: '/api/tasks', description: 'List tasks', requestBody: [], responseShape: 'Task[]' },
    ] },
    backendFiles: [
      { path: 'routes.js', content: "module.exports = function(app) { app.get('/api/tasks', (req, res) => res.json([])); };" },
      { path: 'package.json', content: JSON.stringify({ dependencies: { express: 'https://invalid.example/package' }, scripts: { postinstall: 'unsafe' } }) },
      { path: 'data.json', content: '{}' },
    ],
  });
  beforeEach(() => { process.env.OPENAI_API_KEY = 'test-key'; });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: previousKey, BACKEND_GENERATOR_URL: previousUrl, RENDER: previousRender })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('adds trusted auth code and an API contract to model-written business routes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { output_text: JSON.stringify(makePlan()) } });
    const plan = await new OpenAIBackendService().generateDirect('Build tasks', 'Tasks');
    expect(plan.backendFiles.find((file) => file.path === 'auth.js')?.content).toBe(GENERATED_AUTH_SOURCE);
    expect(plan.backendFiles.find((file) => file.path === 'server.js')?.content).toBe(GENERATED_SERVER_SOURCE);
    expect(plan.blueprint.api.map((endpoint) => endpoint.path)).toEqual(expect.arrayContaining([
      '/api/tasks', '/api/auth/signup', '/api/auth/login', '/api/auth/me', '/api/auth/logout',
    ]));
    const manifest = JSON.parse(plan.backendFiles.find((file) => file.path === 'package.json')!.content);
    expect(manifest.scripts).toEqual({ start: 'node server.js' });
    expect(manifest.dependencies.express).toBe('4.21.2');
    const frontend = new BlueprintPromptService().createFrontendPrompt('Build tasks', plan.blueprint);
    expect(frontend).toContain('Authorization: Bearer <token>');
    expect(frontend).toContain('do not use the WebGenius platform token');
  });

  it('rejects a model-written replacement for the trusted authentication module', async () => {
    const plan = makePlan();
    plan.backendFiles.push({ path: 'auth.js', content: 'unsafe' });
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { output_text: JSON.stringify(plan) } });
    await expect(new OpenAIBackendService().generateDirect('Build tasks', 'Tasks')).rejects.toThrow('Backend file is not allowed');
  });

  it('rejects application code that starts its own unauthenticated listener', async () => {
    const plan = makePlan();
    plan.backendFiles[0].content += '\napp.listen(4000);';
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { output_text: JSON.stringify(plan) } });
    await expect(new OpenAIBackendService().generateDirect('Build tasks', 'Tasks')).rejects.toThrow('without starting a server');
  });

  it('validates remote plans and rejects mismatched authentication code', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { output_text: JSON.stringify(makePlan()) } });
    const service = new OpenAIBackendService();
    const plan = await service.generateDirect('Build tasks', 'Tasks');
    process.env.BACKEND_GENERATOR_URL = 'https://generator.example';
    process.env.RENDER = 'false';
    post.mockResolvedValue({ data: plan });
    const remote = await service.generate('Build tasks', 'Tasks');
    expect(remote.blueprint.api.filter((endpoint) => endpoint.path === '/api/auth/signup')).toHaveLength(1);
    plan.backendFiles.find((file) => file.path === 'auth.js')!.content = 'modified';
    await expect(service.generate('Build tasks', 'Tasks')).rejects.toThrow('authentication version differs');
  });

  it('explains how to recover when the remote generator still returns the legacy server format', async () => {
    process.env.BACKEND_GENERATOR_URL = 'https://generator.example';
    process.env.RENDER = 'false';
    const plan = makePlan();
    plan.backendFiles[0] = { path: 'server.js', content: 'app.listen(4000);' };
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: plan });
    await expect(new OpenAIBackendService().generate('Build tasks', 'Tasks'))
      .rejects.toThrow('Redeploy the service configured by BACKEND_GENERATOR_URL');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('uses the current local generator when the remote URL is cleared', async () => {
    process.env.BACKEND_GENERATOR_URL = '';
    process.env.RENDER = 'false';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { output_text: JSON.stringify(makePlan()) } });
    const plan = await new OpenAIBackendService().generate('Build tasks', 'Tasks');
    expect(plan.backendFiles.find((file) => file.path === 'auth.js')?.content).toBe(GENERATED_AUTH_SOURCE);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatch(/\/v1\/responses$/);
  });
});
