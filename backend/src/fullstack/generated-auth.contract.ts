import { FullStackPlan } from './fullstack.types';

export function addAuthenticationContract(plan: FullStackPlan): void {
  const user = '{ id: string, email: string, name: string }';
  const credentials = [
    { name: 'email', type: 'string', required: true },
    { name: 'password', type: 'string (12–128 characters)', required: true },
  ];
  plan.blueprint.api = plan.blueprint.api.filter((endpoint) =>
    endpoint.path !== '/api/health' && !/^\/api\/auth(?:\/|$)/.test(endpoint.path));
  plan.blueprint.api.push(
    { method: 'GET', path: '/api/health', description: 'Public health check', requestBody: [], responseShape: '{ ok: true }' },
    { method: 'POST', path: '/api/auth/signup', description: 'Public registration; 201 on success, 400 invalid fields, 409 duplicate email, 429 rate limited',
      requestBody: [...credentials, { name: 'name', type: 'string (at most 100 characters)', required: false }],
      responseShape: `{ user: ${user}, token: string, expiresAt: string (ISO date, 24 hours) }` },
    { method: 'POST', path: '/api/auth/login', description: 'Public login; 401 invalid credentials, 429 rate limited',
      requestBody: credentials, responseShape: `{ user: ${user}, token: string, expiresAt: string (ISO date, 24 hours) }` },
    { method: 'GET', path: '/api/auth/me', description: 'Requires Authorization: Bearer <token>; 401 when expired or invalid',
      requestBody: [], responseShape: `{ user: ${user} }` },
    { method: 'POST', path: '/api/auth/logout', description: 'Requires Authorization: Bearer <token>; revokes the current session',
      requestBody: [], responseShape: '{ ok: true }' },
  );
  const feature = 'Email/password authentication with 24-hour Bearer sessions; application endpoints require authentication';
  if (!plan.blueprint.features.includes(feature)) plan.blueprint.features.push(feature);
}
