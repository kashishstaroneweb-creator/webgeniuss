import { Injectable } from '@nestjs/common';
import { FullStackBlueprint, GeneratedProjectFile } from '../entities/website.entity';
import { GENERATED_AUTH_SOURCE, GENERATED_SERVER_SOURCE } from './generated-auth.template';
import { GenerationValidatorService } from './generation-validator.service';

@Injectable()
export class BackendBuilderService {
  constructor(private readonly validator: GenerationValidatorService) {}

  buildProductionCrmBackend(blueprint: FullStackBlueprint): GeneratedProjectFile[] {
    this.validator.validateProductionCrmBlueprint(blueprint);
    const files: GeneratedProjectFile[] = [
      { path: 'routes.js', content: this.routesSource(blueprint) },
      { path: 'package.json', content: this.packageJson(blueprint.projectName) },
      { path: 'data.json', content: this.initialData(blueprint) },
      { path: 'server.js', content: GENERATED_SERVER_SOURCE },
      { path: 'auth.js', content: GENERATED_AUTH_SOURCE },
      { path: '.env.example', content: 'PORT=4100\n' },
    ];
    this.validator.validateBackendFiles(files);
    return files;
  }

  private packageJson(projectName: string): string {
    return JSON.stringify({
      name: String(projectName || 'webgenius-crm').replace(/[^a-z0-9-_]/gi, '-').toLowerCase(),
      version: '1.0.0',
      private: true,
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '4.21.2', cors: '2.8.5', dotenv: '16.6.1' },
    }, null, 2);
  }

  private initialData(blueprint: FullStackBlueprint): string {
    const collections = Object.fromEntries((blueprint.entities || []).map((entity) => [entity.collection, []]));
    return JSON.stringify(collections, null, 2);
  }

  private routesSource(blueprint: FullStackBlueprint): string {
    const entities = (blueprint.entities || []).map((entity) => ({
      name: entity.name,
      collection: entity.collection,
      fields: entity.fields,
    }));
    return String.raw`'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_PATH = path.join(__dirname, 'data.json');
const ENTITIES = ${JSON.stringify(entities, null, 2)};
let queue = Promise.resolve();

function emptyStore() {
  return Object.fromEntries(ENTITIES.map((entity) => [entity.collection, []]));
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    return { ...emptyStore(), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const store = emptyStore();
    await writeStore(store);
    return store;
  }
}

async function writeStore(store) {
  const temporary = DATA_PATH + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(temporary, DATA_PATH);
}

function withStore(operation, save = false) {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await operation(store);
    if (save) await writeStore(store);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

const endpoint = (handler) => (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Request failed' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const cleanText = (value) => typeof value === 'string' ? value.trim().slice(0, 5000) : '';
const cleanNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const publicRecord = (record) => {
  const { userId, ...rest } = record;
  return rest;
};

function applyFields(entity, body, current = {}) {
  const next = { ...current };
  for (const field of entity.fields) {
    if (body[field.name] === undefined) {
      if (field.required && current[field.name] === undefined) throw fail(400, field.name + ' is required');
      continue;
    }
    if (field.type === 'number') next[field.name] = cleanNumber(body[field.name]);
    else if (field.type === 'boolean') next[field.name] = Boolean(body[field.name]);
    else if (field.type === 'enum') {
      const value = cleanText(body[field.name]);
      if (field.options && field.options.length && !field.options.includes(value)) throw fail(400, field.name + ' is invalid');
      next[field.name] = value;
    } else {
      const value = cleanText(body[field.name]);
      if (field.required && !value) throw fail(400, field.name + ' is required');
      next[field.name] = value;
    }
  }
  return next;
}

function matchesSearch(record, query) {
  if (!query) return true;
  const text = Object.values(record).join(' ').toLowerCase();
  return text.includes(String(query).toLowerCase());
}

function registerCrud(app, entity) {
  const base = '/api/' + entity.collection;
  app.get(base, endpoint(async (req, res) => {
    const records = await withStore((store) => {
      return (store[entity.collection] || [])
        .filter((record) => record.userId === req.user.id)
        .filter((record) => matchesSearch(record, req.query.search || req.query.q))
        .map(publicRecord);
    });
    res.json(records);
  }));

  app.post(base, endpoint(async (req, res) => {
    const record = await withStore((store) => {
      const entityRecords = store[entity.collection] || [];
      const created = {
        id: crypto.randomUUID(),
        userId: req.user.id,
        ...applyFields(entity, req.body || {}),
        createdAt: now(),
        updatedAt: now(),
      };
      entityRecords.push(created);
      store[entity.collection] = entityRecords;
      return publicRecord(created);
    }, true);
    res.status(201).json(record);
  }));

  app.patch(base + '/:id', endpoint(async (req, res) => {
    const updated = await withStore((store) => {
      const records = store[entity.collection] || [];
      const index = records.findIndex((record) => record.id === req.params.id && record.userId === req.user.id);
      if (index === -1) throw fail(404, entity.name + ' not found');
      records[index] = { ...applyFields(entity, req.body || {}, records[index]), updatedAt: now() };
      return publicRecord(records[index]);
    }, true);
    res.json(updated);
  }));

  app.delete(base + '/:id', endpoint(async (req, res) => {
    await withStore((store) => {
      const records = store[entity.collection] || [];
      const index = records.findIndex((record) => record.id === req.params.id && record.userId === req.user.id);
      if (index === -1) throw fail(404, entity.name + ' not found');
      records.splice(index, 1);
      store[entity.collection] = records;
    }, true);
    res.json({ ok: true });
  }));
}

function registerRoutes(app) {
  app.get('/api/dashboard', endpoint(async (req, res) => {
    const summary = await withStore((store) => {
      const own = (collection) => (store[collection] || []).filter((record) => record.userId === req.user.id);
      const deals = own('deals');
      const tasks = own('tasks');
      const notes = own('notes');
      return {
        contactCount: own('contacts').length,
        companyCount: own('companies').length,
        dealCount: deals.length,
        openDealValue: deals.filter((deal) => !['Won', 'Lost'].includes(deal.stage)).reduce((sum, deal) => sum + Number(deal.value || 0), 0),
        openTaskCount: tasks.filter((task) => task.status !== 'Done').length,
        recentNotes: notes.slice(-5).reverse().map(publicRecord),
      };
    });
    res.json(summary);
  }));
  for (const entity of ENTITIES) registerCrud(app, entity);
}

module.exports = registerRoutes;
`;
  }
}
