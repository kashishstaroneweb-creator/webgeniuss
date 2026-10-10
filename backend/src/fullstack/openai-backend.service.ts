import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { FullStackPlan } from './fullstack.types';
import { GENERATED_AUTH_SOURCE, GENERATED_SERVER_SOURCE } from './generated-auth.template';
import { addAuthenticationContract } from './generated-auth.contract';

@Injectable()
export class OpenAIBackendService {
  private readonly logger = new Logger(OpenAIBackendService.name);
  private readonly allowedFiles = new Set(['routes.js', 'package.json', 'data.json', '.env.example']);
  private readonly allowedDependencies = new Set(['express', 'cors', 'dotenv']);

  async generate(prompt: string, projectName: string): Promise<FullStackPlan> {
    const generatorUrl = process.env.RENDER === 'true'
      ? ''
      : process.env.BACKEND_GENERATOR_URL?.trim().replace(/\/+$/, '');
    if (generatorUrl) {
      const endpoint = `${generatorUrl}/fullstack/backend-plan`;
      this.logger.log(`Requesting remote backend plan from ${endpoint} for "${projectName}"`);
      try {
        const response = await axios.post(
          endpoint,
          { prompt, websiteName: projectName },
          { timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 180_000 },
        );
        this.validate(response.data, true);
        this.logger.log(`Remote backend plan received for "${projectName}"`);
        return response.data;
      } catch (error: any) {
        const message = error?.response?.data?.message || error?.message || 'Render backend generator failed';
        this.logger.error(
          `Remote backend generation failed for "${projectName}" via ${endpoint}: ${message}`,
          this.describeAxiosError(error),
        );
        throw new BadGatewayException(`Remote backend generation failed: ${message}`);
      }
    }
    return this.generateDirect(prompt, projectName);
  }

  async generateDirect(prompt: string, projectName: string): Promise<FullStackPlan> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const model = process.env.OPENAI_BACKEND_MODEL?.trim() || 'gpt-4.1-mini';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
    let response: any;
    try {
      this.logger.log(`Generating backend plan with OpenAI model "${model}" for "${projectName}"`);
      response = await axios.post(
        `${baseUrl}/v1/responses`,
        {
          model,
          instructions: this.systemPrompt(),
          input: `Project name: ${projectName}\n\nUser request:\n${prompt}`,
          max_output_tokens: 16_000,
          text: {
            format: {
              type: 'json_schema',
              name: 'webgenius_fullstack_plan',
              strict: true,
              schema: this.responseSchema(),
            },
          },
        },
        {
          timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 180_000,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
        },
      );
    } catch (error: any) {
      const providerMessage = error?.response?.data?.error?.message || error?.message || 'OpenAI request failed';
      this.logger.error(
        `OpenAI backend generation request failed for "${projectName}": ${providerMessage}`,
        this.describeAxiosError(error),
      );
      throw new BadGatewayException(`OpenAI backend generation failed: ${providerMessage}`);
    }

    const text = this.outputText(response.data);
    const plan = this.parseJson(text);
    this.validate(plan);
    plan.backendFiles.push({ path: 'server.js', content: GENERATED_SERVER_SOURCE }, { path: 'auth.js', content: GENERATED_AUTH_SOURCE });
    addAuthenticationContract(plan);
    this.logger.log(`OpenAI backend plan validated for "${projectName}" with ${plan.backendFiles.length} files`);
    return plan;
  }

  private describeAxiosError(error: any): string {
    const details = {
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      url: error?.config?.url,
      method: error?.config?.method,
      code: error?.code,
      responseData: this.truncateForLog(error?.response?.data),
      stack: error?.stack,
    };
    return JSON.stringify(details, null, 2);
  }

  private truncateForLog(value: unknown): unknown {
    if (value === undefined || value === null) return value;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}... [truncated]` : text;
  }

  private outputText(response: any): string {
    if (typeof response?.output_text === 'string') return response.output_text;
    return (response?.output || [])
      .flatMap((item: any) => item?.content || [])
      .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }

  private parseJson(text: string): FullStackPlan {
    if (!text?.trim()) throw new BadGatewayException('OpenAI returned no backend plan');
    try {
      return JSON.parse(text);
    } catch {
      throw new BadGatewayException('OpenAI returned invalid full-stack JSON');
    }
  }

  private validate(plan: FullStackPlan, assembled = false): void {
    if (!plan?.blueprint || !Array.isArray(plan.blueprint.api) || !Array.isArray(plan.blueprint.features) || !Array.isArray(plan.backendFiles)) {
      throw new BadGatewayException('OpenAI response is missing blueprint or backend files');
    }
    const paths = new Set<string>();
    for (const file of plan.backendFiles) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new BadGatewayException('OpenAI returned an invalid backend file');
      }
      const normalized = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
      const trustedFile = assembled && (normalized === 'server.js' || normalized === 'auth.js');
      if ((!this.allowedFiles.has(normalized) && !trustedFile) || normalized.includes('..')) {
        throw new BadGatewayException(`Backend file is not allowed: ${file.path}`);
      }
      if (file.content.length > 100_000) throw new BadGatewayException(`Backend file is too large: ${file.path}`);
      file.path = normalized;
      if (paths.has(normalized)) throw new BadGatewayException(`Duplicate backend file: ${normalized}`);
      paths.add(normalized);
    }
    if (!paths.has('routes.js') || !paths.has('package.json') || !paths.has('data.json')) {
      if (assembled && paths.has('server.js') && !paths.has('routes.js')) {
        throw new BadGatewayException(
          'Remote generator uses the old backend format (server.js without routes.js). ' +
          'Redeploy the service configured by BACKEND_GENERATOR_URL with the current WebGenius backend code, then retry. ' +
          'For local generation, clear BACKEND_GENERATOR_URL, configure OPENAI_API_KEY locally, and restart the backend.',
        );
      }
      throw new BadGatewayException('Backend must include routes.js, package.json, and data.json');
    }

    if (assembled) {
      if (plan.backendFiles.find((file) => file.path === 'server.js')?.content !== GENERATED_SERVER_SOURCE ||
          plan.backendFiles.find((file) => file.path === 'auth.js')?.content !== GENERATED_AUTH_SOURCE) {
        throw new BadGatewayException('Remote generator authentication version differs. Update both WebGenius services.');
      }
      addAuthenticationContract(plan);
    }

    const serverFile = plan.backendFiles.find((file) => file.path === 'routes.js')!;
    serverFile.content = this.replaceUuidPackageUsage(serverFile.content);
    const hasSupportedRouteExport =
      /module\.exports\s*=/.test(serverFile.content) ||
      /exports\.registerRoutes\s*=/.test(serverFile.content);
    if (!hasSupportedRouteExport) {
      this.logger.warn(`Rejected generated routes.js without supported export. Preview: ${this.truncateForLog(serverFile.content)}`);
      throw new BadGatewayException('Generated routes must export registerRoutes with module.exports or exports.registerRoutes');
    }
    if (/\.listen\s*\(/.test(serverFile.content)) {
      this.logger.warn(`Rejected generated routes.js because it starts a server. Preview: ${this.truncateForLog(serverFile.content)}`);
      throw new BadGatewayException('Generated routes must not start a server; WebGenius supplies server.js');
    }
    if (/auth-data\.json/.test(serverFile.content)) {
      this.logger.warn(`Rejected generated routes.js because it accesses auth storage. Preview: ${this.truncateForLog(serverFile.content)}`);
      throw new BadGatewayException('Generated routes must not access auth-data.json; WebGenius supplies auth.js');
    }
    const forbiddenServerPatterns: Array<[RegExp, string]> = [
      [/\bchild_process\b/, 'child_process'],
      [/\bworker_threads\b/, 'worker_threads'],
      [/\bcluster\b/, 'cluster'],
      [/\brequire\s*\(\s*['"](?:net|tls|dgram|vm)['"]\s*\)/, 'low-level runtime module'],
      [/\beval\s*\(/, 'eval'],
      [/\bnew\s+Function\s*\(/, 'dynamic Function'],
      [/process\.env\s*\[/, 'dynamic environment access'],
    ];
    const forbidden = forbiddenServerPatterns.find(([pattern]) => pattern.test(serverFile.content));
    if (forbidden) throw new BadGatewayException(`Generated backend uses forbidden capability: ${forbidden[1]}`);

    const packageFile = plan.backendFiles.find((file) => file.path === 'package.json')!;
    let packageJson: any;
    try {
      packageJson = JSON.parse(packageFile.content);
    } catch {
      throw new BadGatewayException('Generated backend package.json is invalid');
    }
    if (packageJson.dependencies?.uuid) {
      this.logger.warn('Generated backend requested uuid; using Node crypto.randomUUID() instead.');
      delete packageJson.dependencies.uuid;
    }
    const dependencies = Object.keys(packageJson.dependencies || {});
    const disallowed = dependencies.filter((name) => !this.allowedDependencies.has(name));
    if (disallowed.length) throw new BadGatewayException(`Backend dependencies are not allowed: ${disallowed.join(', ')}`);
    // Known registry versions only; a model must not supply URLs, local paths or install scripts.
    const safeDependencies = { express: '4.21.2', cors: '2.8.5', dotenv: '16.6.1' };
    packageFile.content = JSON.stringify(
      {
        name: String(packageJson.name || 'webgenius-generated-backend').replace(/[^a-z0-9-_]/gi, '-').toLowerCase(),
        version: '1.0.0',
        private: true,
        main: 'server.js',
        scripts: { start: 'node server.js' },
        dependencies: safeDependencies,
      },
      null,
      2,
    );
  }

  private replaceUuidPackageUsage(code: string): string {
    return code
      .replace(
        /const\s*\{\s*v4\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*require\(\s*['"]uuid['"]\s*\)\s*;?/g,
        'const $1 = () => require("crypto").randomUUID();',
      )
      .replace(
        /const\s*\{\s*v4\s*\}\s*=\s*require\(\s*['"]uuid['"]\s*\)\s*;?/g,
        'const v4 = () => require("crypto").randomUUID();',
      )
      .replace(
        /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]uuid['"]\s*\)\s*;?/g,
        'const $1 = { v4: () => require("crypto").randomUUID() };',
      );
  }

  private responseSchema(): Record<string, any> {
    const fieldSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'type', 'required'],
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        required: { type: 'boolean' },
      },
    };
    return {
      type: 'object',
      additionalProperties: false,
      required: ['blueprint', 'backendFiles'],
      properties: {
        blueprint: {
          type: 'object',
          additionalProperties: false,
          required: ['projectName', 'summary', 'features', 'dataModels', 'api'],
          properties: {
            projectName: { type: 'string' },
            summary: { type: 'string' },
            features: { type: 'array', items: { type: 'string' } },
            dataModels: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'fields'],
                properties: {
                  name: { type: 'string' },
                  fields: { type: 'array', items: fieldSchema },
                },
              },
            },
            api: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['method', 'path', 'description', 'requestBody', 'responseShape'],
                properties: {
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
                  path: { type: 'string' },
                  description: { type: 'string' },
                  requestBody: { type: 'array', items: fieldSchema },
                  responseShape: { type: 'string' },
                },
              },
            },
          },
        },
        backendFiles: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'content'],
            properties: { path: { type: 'string' }, content: { type: 'string' } },
          },
        },
      },
    };
  }

  private systemPrompt(): string {
    return `You are the central application architect and backend generator for a small full-stack MVP.
Create the shared API blueprint and a complete plain Node.js backend matching it exactly.

Backend rules:
- Plain JavaScript, Node.js and Express only. No TypeScript, ORM, database, Docker, tests, build step, or frontend files.
- The only allowed dependencies are express, cors and dotenv.
- Do not use uuid, nanoid, shortid, or any ID package. For IDs, use require('crypto').randomUUID().
- Return exactly routes.js, package.json, data.json and optionally .env.example. Use CommonJS.
- routes.js MUST define function registerRoutes(app) and end with module.exports = { registerRoutes } or module.exports = registerRoutes. Register application routes on that app. Do NOT create an Express app or call listen; WebGenius supplies server.js.
- WebGenius supplies tested signup/login/session authentication in auth.js. Do NOT implement authentication or define /api/auth or /api/health endpoints yourself.
- All application endpoints require a Bearer session token. req.user contains { id, email, name } from trusted middleware. Never accept identity or ownership from request bodies.
- For user-owned records, persist userId from req.user.id, filter all reads by it, and check ownership before updates/deletes. Return 404 for records owned by others.
- Do not include passwords, salts, tokens, sessions, or auth users in data.json, the dataModels or application API responses. Do not read/write auth-data.json. Do not serve static directories.
- Persist CRUD data in data.json using fs/promises. Use safe sequential writes and create the file if missing.
- WebGenius supplies the server listener and PORT configuration; routes.js must not start a listener.
- The host supplies GET /api/health returning { ok: true } and /api/auth/signup, /api/auth/login, /api/auth/me, /api/auth/logout. These are added to the blueprint automatically.
- Every application endpoint must begin with /api and exactly match the blueprint.
- Use an empty requestBody array for endpoints without a body.
- Validate required request fields and return useful JSON errors and HTTP status codes.
- Never read arbitrary paths, execute commands, access platform secrets, or make external network calls.
- Keep the backend small, complete, and directly runnable with npm install && npm start.`;
  }
}
