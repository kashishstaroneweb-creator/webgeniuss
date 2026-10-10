import axios from 'axios';
import * as fs from 'fs/promises';
import { Server } from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';
import { AppPlannerService } from './app-planner.service';
import { BackendBuilderService } from './backend-builder.service';
import { BlueprintPromptService } from './blueprint-prompt.service';
import { GenerationValidatorService } from './generation-validator.service';
import { ProjectMergerService } from './project-merger.service';
import { FrontendBuilderService } from './frontend-builder.service';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';

const dynamicPlan: any = {
  blueprint: {
    projectName: 'Inventory Desk',
    summary: 'Inventory and vendor management',
    features: ['Products'],
    dataModels: [{ name: 'Product', fields: [{ name: 'name', type: 'string', required: true }] }],
    api: [
      { method: 'GET', path: '/api/products', description: 'List products', requestBody: [], responseShape: 'Product[]' },
      { method: 'POST', path: '/api/products', description: 'Create product', requestBody: [{ name: 'name', type: 'string', required: true }], responseShape: 'Product' },
    ],
  },
  backendFiles: [
    { path: 'routes.js', content: 'module.exports = function(app) {};' },
    { path: 'package.json', content: '{}' },
    { path: 'data.json', content: '{}' },
    { path: 'server.js', content: '' },
    { path: 'auth.js', content: '' },
  ],
  backendStatus: 'generated',
};

function loadGeneratedSource(source: string, resolve: (name: string) => any, directory: string) {
  const compiled = vm.runInThisContext(`(function(require, module, __dirname) { ${source}\n})`);
  const module = { exports: {} };
  compiled(resolve, module, directory);
  return module.exports as any;
}

describe('Production app generator', () => {
  const validator = new GenerationValidatorService();
  const planner = new AppPlannerService();
  const builder = new BackendBuilderService(validator);

  it('creates a V2 core CRM blueprint with required modules and APIs', () => {
    const blueprint = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');

    expect(blueprint.blueprintVersion).toBe(2);
    expect(blueprint.modules?.map((module) => module.key)).toEqual(expect.arrayContaining([
      'dashboard', 'contacts', 'companies', 'deals', 'tasks', 'notes',
    ]));
    expect(blueprint.api.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual(expect.arrayContaining([
      'GET /api/dashboard',
      'GET /api/contacts',
      'POST /api/companies',
      'PATCH /api/deals/:id',
      'DELETE /api/notes/:id',
    ]));
    expect(() => validator.validateProductionCrmBlueprint(blueprint)).not.toThrow();
  });

  it('rejects duplicate endpoints, missing modules, and invalid relations', () => {
    const duplicate = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    duplicate.api.push({ ...duplicate.api[0] });
    expect(() => validator.validateProductionCrmBlueprint(duplicate)).toThrow('Duplicate API endpoint');

    const missingModule = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    missingModule.modules = missingModule.modules?.filter((module) => module.key !== 'contacts');
    expect(() => validator.validateProductionCrmBlueprint(missingModule)).toThrow('missing modules');

    const invalidRelation = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    invalidRelation.relations?.push({ from: 'Ghost', to: 'Company', type: 'many-to-one', field: 'companyId' });
    expect(() => validator.validateProductionCrmBlueprint(invalidRelation)).toThrow('Invalid relation');
  });

  it('builds safe modular backend files for the CRM runtime', () => {
    const blueprint = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    const files = builder.buildProductionCrmBackend(blueprint);

    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'routes.js', 'package.json', 'data.json', 'server.js', 'auth.js',
    ]));
    expect(files.find((file) => file.path === 'routes.js')?.content).toContain("app.get('/api/dashboard'");
    expect(files.find((file) => file.path === 'routes.js')?.content).toContain('registerCrud(app, entity)');
    expect(() => validator.validateBackendFiles(files)).not.toThrow();
  });

  it('accepts safe object-style route exports in generated backend files', () => {
    expect(() => validator.validateBackendFiles([
      {
        path: 'routes.js',
        content: [
          'function registerRoutes(app) {',
          "  app.get('/api/items', (req, res) => res.json([]));",
          '}',
          'exports.registerRoutes = registerRoutes;',
        ].join('\n'),
      },
      { path: 'package.json', content: JSON.stringify({ dependencies: { express: '4.21.2' } }) },
      { path: 'data.json', content: '{}' },
    ])).not.toThrow();
  });

  it('preserves multi-module APIs through merge and frontend prompting', () => {
    const blueprint = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    const backendFiles = builder.buildProductionCrmBackend(blueprint);
    const prompt = new BlueprintPromptService().createMinimalV0FrontendPrompt('Build a CRM', blueprint);
    const project = new ProjectMergerService(validator).merge({ blueprint, backendFiles }, prompt);

    expect(project.backendFiles).toHaveLength(6);
    expect(project.frontendPrompt).toContain('App: SalesPilot');
    expect(project.frontendPrompt).toContain('Contacts:');
    expect(project.frontendPrompt).toContain('/api/deals');
    expect(project.frontendPrompt).not.toContain('routes.js');
    expect(project.frontendPrompt.length).toBeLessThan(4_000);
  });

  it('emits parseable React app frontend source', () => {
    const blueprint = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    const frontend = new FrontendBuilderService().buildContractFrontend(blueprint);
    const app = frontend.components.find((file) => file.path === 'src/App.jsx');
    expect(app?.code).toContain('const API_BASE = globalThis.__WEBGENIUS_API_BASE__');
    expect(app?.code).toContain('/api/contacts');
    const result = ts.transpileModule(app?.code || '', {
      compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true },
      reportDiagnostics: true,
    });
    expect((result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toHaveLength(0);
  });

  it('emits generic multi-page frontend from any backend blueprint', () => {
    const blueprint: any = {
      projectName: 'Inventory Desk',
      summary: 'Inventory and vendor management',
      features: ['Products', 'Vendors'],
      dataModels: [
        { name: 'Product', fields: [{ name: 'name', type: 'string', required: true }, { name: 'stock', type: 'number', required: false }] },
        { name: 'Vendor', fields: [{ name: 'name', type: 'string', required: true }, { name: 'email', type: 'string', required: false }] },
      ],
      api: [
        { method: 'GET', path: '/api/products', description: 'List products', requestBody: [], responseShape: 'Product[]' },
        { method: 'POST', path: '/api/products', description: 'Create product', requestBody: [{ name: 'name', type: 'string', required: true }, { name: 'stock', type: 'number', required: false }], responseShape: 'Product' },
        { method: 'GET', path: '/api/vendors', description: 'List vendors', requestBody: [], responseShape: 'Vendor[]' },
        { method: 'POST', path: '/api/vendors', description: 'Create vendor', requestBody: [{ name: 'name', type: 'string', required: true }], responseShape: 'Vendor' },
      ],
    };
    const frontend = new FrontendBuilderService().buildContractFrontend(blueprint);
    const app = frontend.components[0].code;

    expect(app).toContain('/api/products');
    expect(app).toContain('/api/vendors');
    expect(app).toContain('Inventory Desk');
    const result = ts.transpileModule(app, {
      compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true },
      reportDiagnostics: true,
    });
    expect((result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toHaveLength(0);
  });

  it('boots the generated CRM backend and owner-scopes records', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webgenius-crm-test-'));
    const blueprint = planner.createProductionCrmBlueprint('Build a CRM', 'SalesPilot');
    const files = builder.buildProductionCrmBackend(blueprint);
    await fs.writeFile(path.join(directory, 'data.json'), files.find((file) => file.path === 'data.json')!.content, 'utf8');
    const authFactory = loadGeneratedSource(files.find((file) => file.path === 'auth.js')!.content, require, directory);
    const routes = loadGeneratedSource(files.find((file) => file.path === 'routes.js')!.content, require, directory);
    const app = loadGeneratedSource(files.find((file) => file.path === 'server.js')!.content, (name) => {
      if (name === './auth') return () => authFactory({ storePath: path.join(directory, 'auth-data.json') });
      if (name === './routes') return routes;
      if (name === 'dotenv') return { config: () => {} };
      return require(name);
    }, directory);
    const server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseURL = `http://127.0.0.1:${(server.address() as any).port}`;
    const request = (method: string, url: string, data?: any, token?: string) => axios.request({
      baseURL,
      method,
      url,
      data,
      proxy: false,
      validateStatus: () => true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    try {
      expect((await request('GET', '/api/health')).status).toBe(200);
      const first = await request('POST', '/api/auth/signup', {
        email: 'owner@example.com',
        password: 'A long test password!',
        name: 'Owner',
      });
      const second = await request('POST', '/api/auth/signup', {
        email: 'other@example.com',
        password: 'A long test password!',
        name: 'Other',
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const created = await request('POST', '/api/contacts', {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      }, first.data.token);
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
      expect(created.data.userId).toBeUndefined();

      const ownContacts = await request('GET', '/api/contacts', undefined, first.data.token);
      const otherContacts = await request('GET', '/api/contacts', undefined, second.data.token);
      expect(ownContacts.data).toHaveLength(1);
      expect(otherContacts.data).toHaveLength(0);
      expect((await request('GET', '/api/dashboard', undefined, first.data.token)).data.contactCount).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('production app coordinator uses OpenAI backend plan plus one-shot compact v0 frontend generation', async () => {
    const saved: any = {
      id: { toString: () => '507f1f77bcf86cd799439011' },
      userId: 'user-1',
      websiteName: 'CRM',
      framework: 'react',
    };
    const repo: any = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: saved.id })),
      findOne: jest.fn(async () => ({ ...saved, id: saved.id })),
    };
    const websiteService: any = {
      generateWebsite: jest.fn(async () => saved),
      rebuildReactPreview: jest.fn(async () => saved),
    };
    const runtime: any = {
      start: jest.fn(async () => ({ ...saved, backendStatus: 'running' })),
    };
    const coordinator = new FullStackCoordinatorService(
      { generate: jest.fn(), generateDirect: jest.fn(async () => dynamicPlan) } as any,
      new BlueprintPromptService(),
      new ProjectMergerService(validator),
      websiteService,
      runtime,
      planner,
      builder,
      new FrontendBuilderService(),
      repo,
    );

    const result = await coordinator.generate('user-1', 'Build inventory management', 'Inventory Desk', 'production-app');

    expect(result.backendStatus).toBe('running');
    expect(websiteService.generateWebsite).toHaveBeenCalledTimes(1);
    const call = websiteService.generateWebsite.mock.calls[0];
    expect(call[1]).toContain('App: Inventory Desk');
    expect(call[1]).toContain('GET /api/products');
    expect(call[8]).toMatchObject({
      maxAttempts: 1,
      retryWithSync: false,
      promptLengthWarningChars: 4000,
      promptLengthHardLimitChars: 5000,
      label: 'fullstack-production-v0',
    });
    expect(call[8].systemPromptOverride.length).toBeLessThan(2_000);
    expect(websiteService.rebuildReactPreview).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'user-1');
    expect(runtime.start).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'user-1');
    expect(repo.save.mock.calls[0][0].backendFiles).toEqual(dynamicPlan.backendFiles);
    expect(repo.save.mock.calls[0][0].fullStackBlueprint).toEqual(dynamicPlan.blueprint);
  });
});
