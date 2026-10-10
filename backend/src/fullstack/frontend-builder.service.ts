import { Injectable } from '@nestjs/common';
import { FullStackBlueprint } from '../entities/website.entity';

interface UiField {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
}

interface UiModule {
  key: string;
  label: string;
  path: string;
  endpoint: string;
  fields: UiField[];
}

@Injectable()
export class FrontendBuilderService {
  buildContractFrontend(blueprint: FullStackBlueprint) {
    const modules = this.modulesFromBlueprint(blueprint);
    const appSource = this.appSource(blueprint.projectName || 'Generated App', blueprint.summary || '', modules);
    return {
      components: [
        {
          name: 'App',
          type: 'component' as const,
          path: 'src/App.jsx',
          code: appSource,
          language: 'jsx' as const,
        },
      ],
      viteConfig: {
        packageJson: JSON.stringify({
          name: String(blueprint.projectName || 'webgenius-app').replace(/[^a-z0-9-_]/gi, '-').toLowerCase(),
          version: '1.0.0',
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build' },
          dependencies: { '@vitejs/plugin-react': '^4.2.1', vite: '^5.0.8', react: '^18.2.0', 'react-dom': '^18.2.0' },
          devDependencies: {},
        }, null, 2),
        viteConfig: "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
        indexHtml: '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' +
          this.escapeHtml(blueprint.projectName || 'Generated App') +
          '</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
        mainJsx: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './style.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n",
        styleCss: this.styleSource(),
      },
    };
  }

  buildProductionCrmFrontend(blueprint: FullStackBlueprint) {
    return this.buildContractFrontend(blueprint);
  }

  private modulesFromBlueprint(blueprint: FullStackBlueprint): UiModule[] {
    const listEndpoints = (blueprint.api || []).filter((endpoint) => endpoint.method === 'GET' && !endpoint.path.includes('/:') && !/^\/api\/(?:auth|health)(?:\/|$)/.test(endpoint.path));
    const entityByCollection = new Map<string, any>();
    for (const entity of blueprint.entities || []) entityByCollection.set(entity.collection, entity);
    for (const model of blueprint.dataModels || []) entityByCollection.set(this.collectionFromName(model.name), {
      name: model.name,
      collection: this.collectionFromName(model.name),
      fields: model.fields,
    });

    const modules = listEndpoints
      .filter((endpoint) => endpoint.path !== '/api/dashboard')
      .map((endpoint) => {
        const collection = endpoint.path.replace(/^\/api\//, '').split('/')[0];
        const entity = entityByCollection.get(collection) || this.entityByEndpoint(endpoint, blueprint);
        const fields = this.fieldsForEntity(entity, blueprint.api || [], endpoint.path);
        return {
          key: collection,
          label: this.titleCase(collection),
          path: `/${collection}`,
          endpoint: endpoint.path,
          fields,
        };
      })
      .filter((module, index, all) => all.findIndex((candidate) => candidate.endpoint === module.endpoint) === index);

    if (modules.length) return modules;
    return [{
      key: 'records',
      label: 'Records',
      path: '/records',
      endpoint: listEndpoints[0]?.path || '/api/records',
      fields: [{ name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description' }],
    }];
  }

  private entityByEndpoint(endpoint: any, blueprint: FullStackBlueprint) {
    const responseName = String(endpoint.responseShape || '').replace(/\[\]|\{|\}|Array<|>/g, '').trim();
    const model = (blueprint.dataModels || []).find((candidate) => candidate.name === responseName);
    if (model) return { name: model.name, collection: this.collectionFromName(model.name), fields: model.fields };
    return { name: this.titleCase(endpoint.path.split('/').filter(Boolean).pop() || 'Record'), fields: endpoint.requestBody || [] };
  }

  private fieldsForEntity(entity: any, endpoints: FullStackBlueprint['api'], listPath: string): UiField[] {
    const createEndpoint = endpoints.find((endpoint) => endpoint.method === 'POST' && endpoint.path === listPath);
    const source = entity?.fields?.length ? entity.fields : createEndpoint?.requestBody || [];
    const fields = source
      .filter((field: any) => !['id', 'userId', 'createdAt', 'updatedAt'].includes(field.name))
      .map((field: any) => ({
        name: field.name,
        label: this.titleCase(field.name),
        type: field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text',
        required: !!field.required,
        options: field.options,
      }));
    return fields.length ? fields : [{ name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description' }];
  }

  private collectionFromName(name: string): string {
    const base = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return base.endsWith('s') ? base : `${base}s`;
  }

  private titleCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  }

  private appSource(projectName: string, summary: string, modules: UiModule[]): string {
    return `import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = globalThis.__WEBGENIUS_API_BASE__ || '';
const APP_NAME = ${JSON.stringify(projectName)};
const APP_SUMMARY = ${JSON.stringify(summary || 'A generated full-stack app with real backend APIs.')};
const modules = ${JSON.stringify(modules, null, 2)};

function request(path, options = {}, token) {
  return fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed');
    return data;
  });
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash.replace('#', '') || '/');
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace('#', '') || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const active = route === '/' ? null : modules.find((item) => item.path === route);

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError('');
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const payload = authMode === 'signup'
        ? { name: auth.name, email: auth.email, password: auth.password }
        : { email: auth.email, password: auth.password };
      const next = await request(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      setSession(next);
      window.location.hash = '/';
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function logout() {
    if (session?.token) await request('/api/auth/logout', { method: 'POST', body: '{}' }, session.token).catch(() => null);
    setSession(null);
  }

  if (!session?.token) {
    return (
      <main className="authShell">
        <section className="authPanel">
          <div>
            <p className="eyebrow">Generated SaaS</p>
            <h1>{APP_NAME}</h1>
            <p className="lede">{APP_SUMMARY}</p>
          </div>
          <form onSubmit={submitAuth} className="authForm">
            <div className="segmented">
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
              <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Signup</button>
            </div>
            {authMode === 'signup' && <input placeholder="Name" value={auth.name} onChange={(event) => setAuth({ ...auth, name: event.target.value })} />}
            <input placeholder="Email" type="email" value={auth.email} onChange={(event) => setAuth({ ...auth, email: event.target.value })} required />
            <input placeholder="Password (12+ characters)" type="password" minLength={12} value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} required />
            {authError && <p className="error">{authError}</p>}
            <button className="primary" type="submit">{authMode === 'signup' ? 'Create account' : 'Login'}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="appShell">
      <aside>
        <div className="brand">{APP_NAME}</div>
        <nav>
          <a className={!active ? 'active' : ''} href="#/">Overview</a>
          {modules.map((item) => <a key={item.key} className={active?.key === item.key ? 'active' : ''} href={'#' + item.path}>{item.label}</a>)}
        </nav>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>{active ? active.label : 'Overview'}</h1>
          </div>
          <div className="userBox">
            <span>{session.user?.email}</span>
            <button onClick={logout}>Logout</button>
          </div>
        </header>
        {active ? <ModulePage module={active} token={session.token} /> : <Overview token={session.token} />}
      </main>
    </div>
  );
}

function Overview({ token }) {
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all(modules.map((module) => request(module.endpoint, {}, token).then((rows) => [module.key, Array.isArray(rows) ? rows.length : 0]).catch(() => [module.key, 0])))
      .then((entries) => setCounts(Object.fromEntries(entries)))
      .catch((err) => setError(err.message));
  }, [token]);
  if (error) return <p className="error">{error}</p>;
  return (
    <>
      <section className="metricGrid">{modules.map((module) => <article key={module.key}><span>{module.label}</span><strong>{counts[module.key] ?? '...'}</strong></article>)}</section>
      <section className="panel"><h2>Application summary</h2><p className="muted">{APP_SUMMARY}</p></section>
    </>
  );
}

function ModulePage({ module, token }) {
  const initialForm = useMemo(() => Object.fromEntries((module.fields || []).map((field) => [field.name, field.options?.[0] || ''])), [module]);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const q = search ? '?search=' + encodeURIComponent(search) : '';
      setRecords(await request(module.endpoint + q, {}, token));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(initialForm);
    setEditing(null);
    setSearch('');
  }, [initialForm, module.key]);
  useEffect(() => { load(); }, [module.key]);

  async function submit(event) {
    event.preventDefault();
    const method = editing ? 'PATCH' : 'POST';
    const path = editing ? module.endpoint + '/' + editing.id : module.endpoint;
    try {
      await request(path, { method, body: JSON.stringify(form) }, token);
      setForm(initialForm);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(record) {
    if (!confirm('Delete this record?')) return;
    await request(module.endpoint + '/' + record.id, { method: 'DELETE' }, token);
    await load();
  }

  return (
    <div className="moduleGrid">
      <section className="panel">
        <div className="toolbar">
          <input placeholder={'Search ' + module.label.toLowerCase()} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} />
          <button onClick={load}>Search</button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading ? <p className="muted">Loading...</p> : records.length ? <div className="recordList">{records.map((record) => (
          <article key={record.id || JSON.stringify(record)}>
            <div><strong>{record.name || record.title || record.email || record.id || 'Record'}</strong><small>{Object.entries(record).filter(([key]) => !['id', 'userId', 'createdAt', 'updatedAt'].includes(key)).slice(0, 3).map(([key, value]) => key + ': ' + value).join(' · ')}</small></div>
            <div className="rowActions">
              <button onClick={() => { setEditing(record); setForm({ ...initialForm, ...record }); }}>Edit</button>
              <button onClick={() => remove(record)}>Delete</button>
            </div>
          </article>
        ))}</div> : <p className="muted">No records yet.</p>}
      </section>
      <form className="panel formPanel" onSubmit={submit}>
        <h2>{editing ? 'Edit ' : 'Add '}{module.label}</h2>
        {(module.fields || []).map((field) => field.options ? (
          <label key={field.name}>{field.label}<select value={form[field.name] || ''} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}>{field.options.map((option) => <option key={option}>{option}</option>)}</select></label>
        ) : (
          <label key={field.name}>{field.label}<input type={field.type || 'text'} required={field.required} value={form[field.name] || ''} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} /></label>
        ))}
        <button className="primary" type="submit">{editing ? 'Save changes' : 'Create record'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm(initialForm); }}>Cancel</button>}
      </form>
    </div>
  );
}
`;
  }

  private styleSource(): string {
    return `:root { color: #172033; background: #eef2f7; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
button, input, select { font: inherit; }
button { cursor: pointer; border: 1px solid #ccd5e1; background: #fff; color: #172033; border-radius: 8px; padding: 0.65rem 0.9rem; }
input, select { width: 100%; border: 1px solid #ccd5e1; border-radius: 8px; padding: 0.75rem; background: #fff; color: #172033; }
.authShell { min-height: 100vh; display: grid; place-items: center; padding: 2rem; background: linear-gradient(135deg, #eaf2ff, #f7efe8); }
.authPanel { width: min(920px, 100%); display: grid; grid-template-columns: 1fr 360px; gap: 2rem; align-items: center; }
.authPanel h1 { margin: 0.25rem 0; font-size: clamp(2.4rem, 5vw, 4.5rem); }
.lede { color: #4e5b6f; font-size: 1.1rem; line-height: 1.7; }
.authForm, .panel { background: rgba(255,255,255,0.88); border: 1px solid rgba(157,171,190,0.45); box-shadow: 0 20px 60px rgba(54,67,91,0.12); border-radius: 8px; padding: 1rem; }
.authForm { display: grid; gap: 0.8rem; }
.segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; background: #edf2f8; padding: 0.3rem; border-radius: 8px; }
.segmented button.active { background: #172033; color: #fff; }
.primary { background: #2563eb; border-color: #2563eb; color: white; font-weight: 700; }
.appShell { min-height: 100vh; display: grid; grid-template-columns: 240px minmax(0,1fr); }
aside { background: #101827; color: #dbe5f5; padding: 1rem; }
.brand { font-size: 1.35rem; font-weight: 800; margin-bottom: 1rem; }
nav { display: grid; gap: 0.3rem; }
nav a { color: inherit; text-decoration: none; border-radius: 8px; padding: 0.8rem; }
nav a.active, nav a:hover { background: #243148; }
main { padding: 1.25rem; min-width: 0; }
header { display: flex; justify-content: space-between; gap: 1rem; align-items: center; margin-bottom: 1rem; }
h1, h2 { margin: 0; }
.eyebrow { color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; font-weight: 800; margin: 0 0 0.25rem; }
.userBox { display: flex; gap: 0.75rem; align-items: center; color: #4e5b6f; }
.metricGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.85rem; margin-bottom: 1rem; }
.metricGrid article { background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; padding: 1rem; }
.metricGrid span { display: block; color: #64748b; font-size: 0.8rem; }
.metricGrid strong { display: block; margin-top: 0.4rem; font-size: 1.6rem; }
.moduleGrid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 1rem; align-items: start; }
.toolbar { display: grid; grid-template-columns: 1fr auto; gap: 0.6rem; margin-bottom: 1rem; }
.recordList { display: grid; gap: 0.65rem; }
.recordList article { display: flex; justify-content: space-between; gap: 1rem; align-items: center; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.8rem; background: #fff; }
small { display: block; color: #64748b; margin-top: 0.2rem; }
.rowActions { display: flex; gap: 0.45rem; }
.formPanel { display: grid; gap: 0.8rem; }
label { display: grid; gap: 0.35rem; color: #40516a; font-size: 0.9rem; font-weight: 650; }
.muted { color: #64748b; }
.error { color: #dc2626; margin: 0.25rem 0; }
@media (max-width: 900px) { .appShell, .authPanel, .moduleGrid { grid-template-columns: 1fr; } aside { position: static; } header { align-items: flex-start; flex-direction: column; } }
@media (max-width: 560px) { main, aside { padding: 0.85rem; } .recordList article, .userBox, .toolbar { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; } }`;
  }
}
