import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { ClaudeFullStackPlan } from './fullstack.types';

@Injectable()
export class ClaudeBackendService {
  private readonly allowedFiles = new Set(['server.js', 'package.json', 'data.json', '.env.example']);
  private readonly allowedDependencies = new Set(['express', 'cors', 'dotenv']);

  async generate(prompt: string, projectName: string): Promise<ClaudeFullStackPlan> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured');

    const model = process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-20250514';
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const response = await axios.post(
      `${baseUrl}/v1/messages`,
      {
        model,
        max_tokens: 12_000,
        temperature: 0,
        system: this.systemPrompt(),
        messages: [{ role: 'user', content: `Project name: ${projectName}\n\nUser request:\n${prompt}` }],
      },
      {
        timeout: Number(process.env.CLAUDE_TIMEOUT_MS) || 180_000,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
    );

    const text = (response.data?.content || [])
      .filter((part: any) => part?.type === 'text')
      .map((part: any) => part.text)
      .join('\n');
    const plan = this.parseJson(text);
    this.validate(plan);
    return plan;
  }

  private parseJson(text: string): ClaudeFullStackPlan {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          // Use the consistent error below.
        }
      }
      throw new BadGatewayException('Claude returned invalid full-stack JSON');
    }
  }

  private validate(plan: ClaudeFullStackPlan): void {
    if (!plan?.blueprint || !Array.isArray(plan.blueprint.api) || !Array.isArray(plan.backendFiles)) {
      throw new BadGatewayException('Claude response is missing blueprint or backend files');
    }
    const paths = new Set<string>();
    for (const file of plan.backendFiles) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new BadGatewayException('Claude returned an invalid backend file');
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
    const safeDependencies = Object.fromEntries(
      dependencies.map((name) => [name, String(packageJson.dependencies[name])]),
    );
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

  private systemPrompt(): string {
    return `You are the central application architect and backend generator for a small full-stack MVP.
Return ONLY valid JSON. Do not use markdown fences or explanations.

Output exactly:
{
  "blueprint": {
    "projectName": "string",
    "summary": "string",
    "features": ["string"],
    "dataModels": [{ "name": "string", "fields": [{ "name": "string", "type": "string|number|boolean", "required": true }] }],
    "api": [{ "method": "GET|POST|PUT|PATCH|DELETE", "path": "/api/...", "description": "string", "requestBody": { "field": "type" }, "responseShape": "string" }]
  },
  "backendFiles": [{ "path": "server.js", "content": "complete file contents" }]
}

Backend rules:
- Plain JavaScript, Node.js and Express only. No TypeScript, ORM, database, authentication, Docker, tests, build step, or frontend files.
- The only allowed dependencies are express, cors and dotenv.
- Return exactly server.js, package.json, data.json and optionally .env.example.
- Persist CRUD data in data.json using fs/promises. Use safe sequential writes and create the file if missing.
- Read PORT from process.env and default to 4000. Listen on 0.0.0.0.
- Include GET /api/health returning { ok: true }.
- Every application endpoint must begin with /api and exactly match the blueprint.
- Validate required request fields and return useful JSON errors and HTTP status codes.
- Never read arbitrary paths, execute commands, access platform secrets, or make external network calls.
- Keep the backend small, complete, and directly runnable with npm install && npm start.`;
  }
}
