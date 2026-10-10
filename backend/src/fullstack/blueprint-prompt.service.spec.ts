import { BlueprintPromptService } from './blueprint-prompt.service';
import { FullStackBlueprint } from '../entities/website.entity';

describe('BlueprintPromptService', () => {
  it('turns the shared API contract into a frontend-only v0 prompt', () => {
    const blueprint: FullStackBlueprint = {
      projectName: 'Tasks',
      summary: 'Task tracker',
      features: ['Create tasks'],
      dataModels: [],
      api: [
        {
          method: 'POST',
          path: '/api/tasks',
          description: 'Create a task',
          requestBody: [{ name: 'title', type: 'string', required: true }],
          responseShape: 'Task',
        },
      ],
    };

    const prompt = new BlueprintPromptService().createFrontendPrompt('Build tasks', blueprint);

    expect(prompt).toContain('POST');
    expect(prompt).toContain('/api/tasks');
    expect(prompt).toContain('globalThis.__WEBGENIUS_API_BASE__');
    expect(prompt).toContain("fetch(API_BASE + '/api/tasks')");
    expect(prompt).toContain('Do not generate API routes');
  });

  it('creates a compact production v0 prompt from a generic API plan', () => {
    const blueprint: FullStackBlueprint = {
      projectName: 'Gym Desk',
      summary: 'Membership, class booking, and trainer scheduling',
      features: ['Members', 'Classes', 'Bookings'],
      dataModels: [
        { name: 'Member', fields: [{ name: 'name', type: 'string', required: true }] },
        { name: 'Class', fields: [{ name: 'title', type: 'string', required: true }] },
      ],
      api: [
        {
          method: 'GET',
          path: '/api/members',
          description: 'List members',
          requestBody: [],
          responseShape: 'Member[]',
        },
        {
          method: 'POST',
          path: '/api/bookings',
          description: 'Create booking',
          requestBody: [{ name: 'memberId', type: 'string', required: true }],
          responseShape: 'Booking',
        },
      ],
    };

    const service = new BlueprintPromptService();
    const prompt = service.createMinimalV0FrontendPrompt('Build a gym app', blueprint);
    const systemPrompt = service.createMinimalV0SystemPrompt();

    expect(prompt).toContain('App: Gym Desk');
    expect(prompt).toContain('GET /api/members');
    expect(prompt).toContain('POST /api/bookings body memberId:string');
    expect(prompt).toContain("API_BASE = globalThis.__WEBGENIUS_API_BASE__ || ''");
    expect(prompt).not.toContain('routes.js');
    expect(prompt).not.toContain('backendFiles');
    expect(prompt.length).toBeLessThan(3_500);
    expect(systemPrompt.length).toBeLessThan(2_000);
  });
});
