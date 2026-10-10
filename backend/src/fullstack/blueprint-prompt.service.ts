import { Injectable } from '@nestjs/common';
import { FullStackBlueprint } from '../entities/website.entity';

@Injectable()
export class BlueprintPromptService {
  createMinimalV0SystemPrompt(): string {
    return `You generate complete React 18 + Vite frontends.
Return only a valid JSON object with:
{ "components": [{ "name": "...", "type": "component|page|util", "path": "src/...", "code": "...", "language": "jsx|js|css" }], "viteConfig": { "packageJson": "...", "viteConfig": "...", "indexHtml": "...", "mainJsx": "...", "styleCss": "..." } }
Frontend only. No backend/server/API route files.
Use functional JSX, React hooks, react-router-dom, and custom CSS.
Use real fetch calls from the provided API contract.
Do not use mock/static app data except empty/loading/error UI states.
Define API_BASE exactly as: globalThis.__WEBGENIUS_API_BASE__ || ''
All API fetches must use API_BASE + '/api/...'.
Build a polished responsive multi-page app.`;
  }

  createMinimalV0FrontendPrompt(originalPrompt: string, blueprint: FullStackBlueprint): string {
    const appName = this.oneLine(blueprint.projectName || 'Generated app', 60);
    const goal = this.oneLine(blueprint.summary || originalPrompt, 140);
    const pageLines = this.pageLines(blueprint);
    const apiLines = (blueprint.api || [])
      .filter((endpoint) => endpoint.path?.startsWith('/api/'))
      .map((endpoint) => {
        const body = endpoint.requestBody?.length
          ? ` body ${endpoint.requestBody.map((field) => `${field.name}${field.required ? '' : '?'}:${field.type}`).join(',')}`
          : '';
        const description = endpoint.description ? ` (${this.oneLine(endpoint.description, 60)})` : '';
        return `${endpoint.method} ${endpoint.path}${body} -> ${this.oneLine(endpoint.responseShape || '{}', 70)}${description}`;
      });

    const lines = [
      `App: ${appName}`,
      `Goal: ${goal}`,
      '',
      'Pages:',
      ...pageLines,
      '',
      'API:',
      ...(apiLines.length ? apiLines : ['GET /api/health -> { ok: true }']),
      '',
      'Auth:',
      'POST /api/auth/signup body email:string,password:string,name?:string -> { user, token, expiresAt }',
      'POST /api/auth/login body email:string,password:string -> { user, token, expiresAt }',
      'GET /api/auth/me -> { user }',
      'POST /api/auth/logout -> { ok: true }',
      '',
      'Rules:',
      '- React/Vite only',
      "- use API_BASE = globalThis.__WEBGENIUS_API_BASE__ || ''",
      '- no mock data',
      '- use real API calls',
      '- responsive multi-page UI',
      '- login before protected API calls',
      '- send Authorization: Bearer <token> after login',
    ];

    return this.compactPrompt(lines.join('\n'));
  }

  createFrontendPrompt(originalPrompt: string, blueprint: FullStackBlueprint): string {
    const isV2 = blueprint.blueprintVersion === 2;
    const contract = isV2 ? this.compactProductionContract(blueprint) : JSON.stringify(blueprint, null, 2);
    const productionGuidance = isV2 ? `
Production CRM UI requirements:
- Build a real multi-page SaaS CRM shell with top navigation/sidebar, responsive layout, and separate pages for every item in navigation.
- Required pages: ${(blueprint.navigation || []).map((item) => `${item.label} (${item.path})`).join(', ')}.
- Dashboard widgets: ${(blueprint.dashboardWidgets || []).map((widget) => `${widget.title} from ${widget.sourceApi}`).join(', ')}.
- Each module page must include list, search/filter input, create form, edit/update controls, delete action, loading/empty/error states, and a clear mobile layout.
- Preserve relationships where possible: company selectors for contacts/deals, contact selectors for deals, and related record fields for tasks/notes.
- Do not collapse the CRM into one generic CRUD screen. Make the app feel like a hosted SaaS product ready for small teams.
` : '';

    return `Build the React/Vite frontend for this full-stack application.

Original request:
${originalPrompt}

The backend is generated separately. This API contract is the single source of truth:
${contract}
${productionGuidance}

Frontend integration rules:
- Generate frontend code only. Do not generate API routes, server code, databases, or mock API implementations.
- Use the exact HTTP methods, /api paths, request bodies, and response shapes in the contract.
- Define the API base exactly as: const API_BASE = globalThis.__WEBGENIUS_API_BASE__ || '';
- Every API call must use API_BASE plus a relative path beginning with /api, for example fetch(API_BASE + '/api/tasks'). Never hard-code localhost or a domain.
- Load real data from the API; do not replace application data with static arrays.
- If /api/auth/signup is in the contract, generate signup/login forms and logout controls. Passwords must contain 12 to 128 characters; show validation and duplicate-email errors.
- Signup/login return { user, token, expiresAt }. Keep the generated app token in memory (do not use the WebGenius platform token). Send Authorization: Bearer <token> on every protected API call, including /api/auth/me and /api/auth/logout.
- All application endpoints except /api/health and POST /api/auth/signup or /api/auth/login require authentication. Do not fetch protected data until signed in. On a protected endpoint's 401, clear the session and show login. Never persist passwords. Clear user data on logout; call the logout endpoint to revoke the session.
- Include loading, empty, validation, success, and API error states.
- After every create, update, or delete action, keep the visible UI synchronized with the backend.
- Produce a polished responsive interface while preserving all requested functionality.`;
  }

  private compactProductionContract(blueprint: FullStackBlueprint): string {
    const endpointLines = (blueprint.api || [])
      .map((endpoint) => {
        const body = endpoint.requestBody?.length
          ? ` body: ${endpoint.requestBody.map((field) => `${field.name}${field.required ? '' : '?'}:${field.type}`).join(', ')}`
          : '';
        return `- ${endpoint.method} ${endpoint.path} -> ${endpoint.responseShape}.${body}`;
      })
      .join('\n');
    const entityLines = (blueprint.entities || [])
      .map((entity) => `- ${entity.name} (${entity.collection}): ${entity.fields.map((field) => {
        const options = field.options?.length ? `[${field.options.join('|')}]` : '';
        const relation = field.relationTo ? `->${field.relationTo}` : '';
        return `${field.name}${field.required ? '' : '?'}:${field.type}${relation}${options}`;
      }).join(', ')}`)
      .join('\n');
    const pageLines = (blueprint.pages || [])
      .map((page) => `- ${page.name} ${page.path}: ${page.purpose}`)
      .join('\n');
    const navigation = (blueprint.navigation || []).map((item) => `${item.label}:${item.path}`).join(', ');
    return [
      `Blueprint v2: ${blueprint.projectName}`,
      `Summary: ${blueprint.summary}`,
      `Navigation: ${navigation}`,
      '',
      'Pages:',
      pageLines,
      '',
      'Entities and fields:',
      entityLines,
      '',
      'API endpoints:',
      endpointLines,
      '',
      'Auth endpoints:',
      '- POST /api/auth/signup body: email, password, name? -> { user, token, expiresAt }',
      '- POST /api/auth/login body: email, password -> { user, token, expiresAt }',
      '- GET /api/auth/me -> { user }',
      '- POST /api/auth/logout -> { ok: true }',
      '- GET /api/health -> { ok: true }',
    ].join('\n');
  }

  private pageLines(blueprint: FullStackBlueprint): string[] {
    if (blueprint.pages?.length) {
      return blueprint.pages
        .slice(0, 12)
        .map((page) => `- ${this.oneLine(page.name, 36)}: ${this.oneLine(page.purpose || page.path, 90)}`);
    }
    if (blueprint.dataModels?.length) {
      const modelPages = blueprint.dataModels
        .slice(0, 10)
        .map((model) => `- ${this.pluralize(model.name)}: list, search, create, edit, delete ${this.pluralize(model.name).toLowerCase()}`);
      return ['- Dashboard: overview and quick actions', ...modelPages];
    }
    const collections = Array.from(new Set((blueprint.api || [])
      .map((endpoint) => endpoint.path.match(/^\/api\/([^/:]+)/)?.[1])
      .filter(Boolean) as string[]));
    if (collections.length) {
      return collections.slice(0, 10).map((collection) => `- ${this.titleCase(collection)}: manage ${collection}`);
    }
    return ['- Dashboard: overview', '- Main: manage records'];
  }

  private compactPrompt(value: string): string {
    return value
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private oneLine(value: string, max: number): string {
    const clean = (value || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
  }

  private pluralize(value: string): string {
    const clean = this.titleCase(value || 'Items');
    if (/s$/i.test(clean)) return clean;
    if (/y$/i.test(clean)) return `${clean.slice(0, -1)}ies`;
    return `${clean}s`;
  }

  private titleCase(value: string): string {
    return (value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
