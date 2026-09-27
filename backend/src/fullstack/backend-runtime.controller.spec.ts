import axios from 'axios';
import { BackendRuntimeController } from './backend-runtime.controller';

describe('Generated backend gateway authentication', () => {
  afterEach(() => jest.restoreAllMocks());
  it('forwards the generated app bearer token and preserves auth errors without caching', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ status: 401, headers: {}, data: { message: 'Expired' } });
    const controller = new BackendRuntimeController({ getRuntime: () => ({ port: 4100 }) } as any);
    const req = { method: 'GET', params: { 0: 'auth/me' }, query: {}, get: (name: string) => name === 'authorization' ? 'Bearer generated-app-token' : undefined };
    const res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn() };
    await controller.proxy('project', req as any, res as any);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'content-type': 'application/json', authorization: 'Bearer generated-app-token' } }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
