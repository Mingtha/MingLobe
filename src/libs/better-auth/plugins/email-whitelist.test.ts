import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SignupAllowlistModule from '@/database/utils/signupAllowlist';
import { getSignupAllowlist } from '@/database/utils/signupAllowlist';

import { emailWhitelist } from './email-whitelist';

vi.mock('@lobechat/database', () => ({ serverDB: {} }));
vi.mock('@/envs/auth', () => ({ authEnv: { ADMIN_EMAIL: 'Admin@Example.com' } }));
vi.mock('@/database/utils/signupAllowlist', async (importOriginal) => ({
  ...(await importOriginal<typeof SignupAllowlistModule>()),
  getSignupAllowlist: vi.fn(),
}));

const beforeCreate = (emailWhitelist().init as any)().options.databaseHooks.user.create.before as (
  user: Record<string, unknown>,
) => Promise<{ data: Record<string, unknown> }>;

describe('emailWhitelist', () => {
  beforeEach(() => {
    vi.mocked(getSignupAllowlist).mockResolvedValue([]);
  });

  it('creates the ADMIN_EMAIL account as admin, whatever the allowlist', async () => {
    const result = await beforeCreate({ email: 'admin@example.com' });

    expect(result.data.role).toBe('admin');
    expect(getSignupAllowlist).not.toHaveBeenCalled();
  });

  it('rejects everyone else while the allowlist is empty', async () => {
    await expect(beforeCreate({ email: 'friend@example.com' })).rejects.toMatchObject({
      body: { code: 'EMAIL_NOT_ALLOWED' },
    });
  });

  it('admits listed emails and domains as plain users', async () => {
    vi.mocked(getSignupAllowlist).mockResolvedValue(['friend@example.com', 'team.org']);

    expect((await beforeCreate({ email: 'Friend@Example.com' })).data.role).toBe('user');
    expect((await beforeCreate({ email: 'a@team.org' })).data.role).toBe('user');
    await expect(beforeCreate({ email: 'a@sub.team.org' })).rejects.toBeDefined();
  });
});
