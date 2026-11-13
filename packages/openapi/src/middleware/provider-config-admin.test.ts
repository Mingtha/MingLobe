import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isProviderConfigAdmin } from '@/database/utils/providerConfigOwner';

import { requireProviderConfigAdmin } from './provider-config-admin';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/utils/providerConfigOwner', () => ({ isProviderConfigAdmin: vi.fn() }));

const createApp = (userId?: string) => {
  const app = new Hono();
  app.onError((error, c) =>
    c.text(error.message, error instanceof HTTPException ? error.status : 500),
  );
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.post('/providers', requireProviderConfigAdmin, (c) => c.text('ok'));
  return app;
};

describe('requireProviderConfigAdmin', () => {
  beforeEach(() => {
    vi.mocked(isProviderConfigAdmin).mockReset();
  });

  it('lets the admin through', async () => {
    vi.mocked(isProviderConfigAdmin).mockResolvedValue(true);

    const res = await createApp('admin').request('/providers', { method: 'POST' });

    expect(res.status).toBe(200);
  });

  it('rejects other accounts and anonymous calls', async () => {
    vi.mocked(isProviderConfigAdmin).mockResolvedValue(false);

    expect((await createApp('friend').request('/providers', { method: 'POST' })).status).toBe(403);
    expect((await createApp().request('/providers', { method: 'POST' })).status).toBe(403);
  });
});
