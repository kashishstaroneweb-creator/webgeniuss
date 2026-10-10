import { BadGatewayException, Injectable } from '@nestjs/common';
import { FullStackBlueprint, GeneratedProjectFile } from '../entities/website.entity';

@Injectable()
export class GenerationValidatorService {
  private readonly requiredCrmModules = ['contacts', 'companies', 'deals', 'tasks', 'notes', 'dashboard'];
  private readonly allowedDependencies = new Set(['express', 'cors', 'dotenv']);

  validateProductionCrmBlueprint(blueprint: FullStackBlueprint): void {
    if (blueprint.blueprintVersion !== 2) throw new BadGatewayException('Production CRM blueprint must use blueprintVersion 2');
    const moduleKeys = new Set((blueprint.modules || []).map((module) => module.key));
    const missing = this.requiredCrmModules.filter((key) => !moduleKeys.has(key));
    if (missing.length) throw new BadGatewayException(`Production CRM blueprint is missing modules: ${missing.join(', ')}`);
    if (!Array.isArray(blueprint.entities) || blueprint.entities.length < 5) {
      throw new BadGatewayException('Production CRM blueprint must include CRM entities');
    }
    const entityNames = new Set(blueprint.entities.map((entity) => entity.name));
    for (const relation of blueprint.relations || []) {
      if (!entityNames.has(relation.from) || !entityNames.has(relation.to)) {
        throw new BadGatewayException(`Invalid relation in blueprint: ${relation.from} -> ${relation.to}`);
      }
    }
    this.validateApi(blueprint);
  }

  validateApi(blueprint: FullStackBlueprint): void {
    const endpointKeys = new Set<string>();
    for (const endpoint of blueprint.api || []) {
      if (!endpoint.path?.startsWith('/api/')) throw new BadGatewayException(`Invalid API path in blueprint: ${endpoint.path}`);
      const key = `${endpoint.method} ${endpoint.path}`;
      if (endpointKeys.has(key)) throw new BadGatewayException(`Duplicate API endpoint: ${key}`);
      endpointKeys.add(key);
    }
  }

  validateBackendFiles(files: GeneratedProjectFile[]): void {
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const routes = byPath.get('routes.js') || '';
    const hasSupportedRouteExport =
      /module\.exports\s*=/.test(routes) ||
      /exports\.registerRoutes\s*=/.test(routes);
    if (!hasSupportedRouteExport) {
      throw new BadGatewayException('Generated routes must export registerRoutes with module.exports or exports.registerRoutes');
    }
    if (/\.listen\s*\(/.test(routes)) {
      throw new BadGatewayException('Generated routes must not start a server; WebGenius supplies server.js');
    }
    if (/auth-data\.json/.test(routes)) {
      throw new BadGatewayException('Generated routes must not access auth-data.json; WebGenius supplies auth.js');
    }
    const forbiddenPatterns: Array<[RegExp, string]> = [
      [/\bchild_process\b/, 'child_process'],
      [/\bworker_threads\b/, 'worker_threads'],
      [/\bcluster\b/, 'cluster'],
      [/\brequire\s*\(\s*['"](?:net|tls|dgram|vm)['"]\s*\)/, 'low-level runtime module'],
      [/\beval\s*\(/, 'eval'],
      [/\bnew\s+Function\s*\(/, 'dynamic Function'],
      [/process\.env\s*\[/, 'dynamic environment access'],
    ];
    const forbidden = forbiddenPatterns.find(([pattern]) => pattern.test(routes));
    if (forbidden) throw new BadGatewayException(`Generated backend uses forbidden capability: ${forbidden[1]}`);

    let manifest: any;
    try {
      manifest = JSON.parse(byPath.get('package.json') || '');
    } catch {
      throw new BadGatewayException('Generated backend package.json is invalid');
    }
    const disallowed = Object.keys(manifest.dependencies || {}).filter((dependency) => !this.allowedDependencies.has(dependency));
    if (disallowed.length) throw new BadGatewayException(`Backend dependencies are not allowed: ${disallowed.join(', ')}`);
  }
}
