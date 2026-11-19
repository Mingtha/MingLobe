import { sql } from 'drizzle-orm';

import type { Transaction } from '../type';

const catalogKey = (providerId: string, workspaceId?: string) =>
  `ai-model-catalog:${workspaceId ? `workspace:${workspaceId}` : 'site'}:${providerId}`;

export const lockRemoteModelCatalog = (tx: Transaction, providerId: string, workspaceId?: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${catalogKey(providerId, workspaceId)}))`);

export const tryLockRemoteModelCatalog = async (
  tx: Transaction,
  providerId: string,
  workspaceId?: string,
) => {
  const { rows } = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtext(${catalogKey(providerId, workspaceId)})) as locked`,
  );
  return rows[0]?.locked === true;
};
