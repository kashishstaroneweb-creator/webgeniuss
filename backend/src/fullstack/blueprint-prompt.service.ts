import { Injectable } from '@nestjs/common';
import { FullStackBlueprint } from '../entities/website.entity';

@Injectable()
export class BlueprintPromptService {
  createFrontendPrompt(originalPrompt: string, blueprint: FullStackBlueprint): string {
    return `Build the React/Vite frontend for this full-stack application.

Original request:
${originalPrompt}

The backend is generated separately. This API contract is the single source of truth:
${JSON.stringify(blueprint, null, 2)}

Frontend integration rules:
- Generate frontend code only. Do not generate API routes, server code, databases, or mock API implementations.
- Use the exact HTTP methods, /api paths, request bodies, and response shapes in the contract.
- Define the API base exactly as: const API_BASE = globalThis.__WEBGENIUS_API_BASE__ || '';
- Every API call must use API_BASE plus a relative path beginning with /api, for example fetch(API_BASE + '/api/tasks'). Never hard-code localhost or a domain.
- Load real data from the API; do not replace application data with static arrays.
- Include loading, empty, validation, success, and API error states.
- After every create, update, or delete action, keep the visible UI synchronized with the backend.
- Produce a polished responsive interface while preserving all requested functionality.`;
  }
}
