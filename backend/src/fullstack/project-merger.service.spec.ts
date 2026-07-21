import { ProjectMergerService } from './project-merger.service';

describe('ProjectMergerService', () => {
  const basePlan: any = {
    blueprint: {
      projectName: 'Tasks',
      summary: 'Task tracker',
      features: [],
      dataModels: [],
      api: [{ method: 'GET', path: '/api/tasks', description: 'List', responseShape: 'Task[]' }],
    },
    backendFiles: [
      { path: 'server.js', content: '' },
      { path: 'package.json', content: '{}' },
      { path: 'data.json', content: '{}' },
    ],
  };

  it('merges backend output and the derived frontend prompt', () => {
    const project = new ProjectMergerService().merge(basePlan, 'frontend task');
    expect(project.backendFiles).toHaveLength(3);
    expect(project.frontendPrompt).toBe('frontend task');
  });

  it('rejects paths outside the shared API namespace', () => {
    const invalid = JSON.parse(JSON.stringify(basePlan));
    invalid.blueprint.api[0].path = '/tasks';
    expect(() => new ProjectMergerService().merge(invalid, 'frontend task')).toThrow('Invalid API path');
  });
});
