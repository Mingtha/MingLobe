import { serverDB } from '@lobechat/database';
import { APIError } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { getSignupAllowlist, isSignupAllowed } from '@/database/utils/signupAllowlist';
import { authEnv } from '@/envs/auth';

const isAdminEmail = (email: string) =>
  !!authEnv.ADMIN_EMAIL && email.trim().toLowerCase() === authEnv.ADMIN_EMAIL.trim().toLowerCase();

/**
 * Restrict registration (email sign-up and SSO alike) to the admin-managed
 * allowlist, and make the `ADMIN_EMAIL` account the admin as it is created.
 * Startup re-syncs the role, so a later change of `ADMIN_EMAIL` still applies.
 */
export const emailWhitelist = (): BetterAuthPlugin => ({
  id: 'email-whitelist',
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (user) => {
                if (!user.email) return { data: user };

                if (isAdminEmail(user.email)) return { data: { ...user, role: 'admin' } };

                const allowlist = await getSignupAllowlist(serverDB);
                if (!isSignupAllowed(user.email, authEnv.ADMIN_EMAIL, allowlist)) {
                  throw new APIError('FORBIDDEN', {
                    code: 'EMAIL_NOT_ALLOWED',
                    message: 'EMAIL_NOT_ALLOWED',
                  });
                }

                return { data: { ...user, role: 'user' } };
              },
            },
          },
        },
      },
    };
  },
});
