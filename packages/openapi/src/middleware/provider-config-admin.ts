import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { isProviderConfigAdmin } from '@/database/utils/providerConfigOwner';

/** The AI provider config is site-wide and owned by the admin; only the admin may write it. */
export const requireProviderConfigAdmin = async (c: Context, next: Next) => {
  const userId = c.get('userId') as string | undefined;

  if (!userId || !(await isProviderConfigAdmin(await getServerDB(), userId))) {
    throw new HTTPException(403, { message: 'Only the admin can change AI provider settings' });
  }

  await next();
};
