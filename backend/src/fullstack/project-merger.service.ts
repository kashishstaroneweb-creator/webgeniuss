import { BadGatewayException, Injectable } from '@nestjs/common';
import { FullStackPlan, MergedFullStackProject } from './fullstack.types';
import { GenerationValidatorService } from './generation-validator.service';

@Injectable()
export class ProjectMergerService {
  constructor(private readonly validator?: GenerationValidatorService) {}

  merge(plan: FullStackPlan, frontendPrompt: string): MergedFullStackProject {
    if (this.validator) {
      this.validator.validateApi(plan.blueprint);
    }
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
