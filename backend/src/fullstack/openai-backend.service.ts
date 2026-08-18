import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { FullStackPlan } from './fullstack.types';

@Injectable()
export class OpenAIBackendService {
  private readonly allowedFiles = new Set(['server.js', 'package.json', 'data.json', '.env.example']);
  private readonly allowedDependencies = new Set(['express', 'cors', 'dotenv']);

  async generate(prompt: string, projectName: string): Promise<FullStackPlan> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const model = process.env.OPENAI_BACKEND_MODEL?.trim() || 'gpt-4.1-mini';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
    let response: any;
    try {
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
      throw new BadGatewayException(`OpenAI backend generation failed: ${providerMessage}`);
    }

    const text = this.outputText(response.data);
    const plan = this.parseJson(text);
    this.validate(plan);
    return plan;
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

  private validate(plan: FullStackPlan): void {
    if (!plan?.blueprint || !Array.isArray(plan.blueprint.api) || !Array.isArray(plan.backendFiles)) {
      throw new BadGatewayException('OpenAI response is missing blueprint or backend files');
    }
    const paths = new Set<string>();
    for (const file of plan.backendFiles) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new BadGatewayException('OpenAI returned an invalid backend file');
      }
      const normalized = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!this.allowedFiles.has(normalized) || normalized.includes('..')) {
        throw new BadGatewayException(`Backend file is not allowed: ${file.path}`);
      }
      if (file.content.length > 100_000) throw new BadGatewayException(`Backend file is too large: ${file.path}`);
      file.path = normalized;
      paths.add(normalized);
    }
    if (!paths.has('server.js') || !paths.has('package.json') || !paths.has('data.json')) {
      throw new BadGatewayException('Backend must include server.js, package.json, and data.json');
    }

    const serverFile = plan.backendFiles.find((file) => file.path === 'server.js')!;
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
    const dependencies = Object.keys(packageJson.dependencies || {});
    const disallowed = dependencies.filter((name) => !this.allowedDependencies.has(name));
    if (disallowed.length) throw new BadGatewayException(`Backend dependencies are not allowed: ${disallowed.join(', ')}`);
    const safeDependencies = Object.fromEntries(dependencies.map((name) => [name, String(packageJson.dependencies[name])]));
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
- Plain JavaScript, Node.js and Express only. No TypeScript, ORM, database, authentication, Docker, tests, build step, or frontend files.
- The only allowed dependencies are express, cors and dotenv.
- Return exactly server.js, package.json, data.json and optionally .env.example.
- Persist CRUD data in data.json using fs/promises. Use safe sequential writes and create the file if missing.
- Read PORT from process.env and default to 4000. Listen on 0.0.0.0.
- Include GET /api/health returning { ok: true }.
- Every application endpoint must begin with /api and exactly match the blueprint.
- Use an empty requestBody array for endpoints without a body.
- Validate required request fields and return useful JSON errors and HTTP status codes.
- Never read arbitrary paths, execute commands, access platform secrets, or make external network calls.
- Keep the backend small, complete, and directly runnable with npm install && npm start.`;
  }
}
