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
          requestBody: { title: 'string' },
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
});
