import { BadGatewayException, Injectable } from '@nestjs/common';
import { FullStackPlan, MergedFullStackProject } from './fullstack.types';

@Injectable()
export class ProjectMergerService {
  merge(plan: FullStackPlan, frontendPrompt: string): MergedFullStackProject {
    const endpointKeys = new Set<string>();
    for (const endpoint of plan.blueprint.api) {
      if (!endpoint.path?.startsWith('/api/')) {
        throw new BadGatewayException(`Invalid API path in blueprint: ${endpoint.path}`);
      }
      const key = `${endpoint.method} ${endpoint.path}`;
      if (endpointKeys.has(key)) throw new BadGatewayException(`Duplicate API endpoint: ${key}`);
      endpointKeys.add(key);
    }
    return { blueprint: plan.blueprint, backendFiles: plan.backendFiles, frontendPrompt };
  }
}
