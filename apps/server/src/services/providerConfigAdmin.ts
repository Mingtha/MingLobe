import { TRPCError } from '@trpc/server';

import type { LobeChatDatabase } from '@/database/type';
import { isProviderConfigAdmin } from '@/database/utils/providerConfigOwner';

/**
 * Mutations that are not config writes, so any account may call them:
 * a read routed through a mutation, and the per-user reasoning preference.
 */
const OPEN_MUTATIONS = new Set([
  'aiModel.updateAiModelReasoningConfig',
  'aiProvider.getProviderBindingRuntime',
]);

/**
 * The AI provider config is site-wide and owned by the admin: resolve whether
 * the caller is that admin and reject everyone else's config writes.
 */
export const resolveProviderConfigAccess = async (
  db: LobeChatDatabase,
  userId: string,
  call: { path: string; type: string },
) => {
  const isProviderAdmin = await isProviderConfigAdmin(db, userId);

  if (call.type === 'mutation' && !isProviderAdmin && !OPEN_MUTATIONS.has(call.path)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the admin can change AI provider settings',
    });
  }

  return { isProviderAdmin };
};
