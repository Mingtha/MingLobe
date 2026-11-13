import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * AI provider config is site-wide in this deployment: every account reads the
 * rows owned by the admin (`users.role = 'admin'`, synced from `ADMIN_EMAIL`).
 * With no admin yet the subquery yields NULL and nobody sees any rows.
 */
export const providerConfigOwnerId = sql`(SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)`;

/** Personal-scope predicate pinned to the provider-config owner instead of the caller. */
export const providerConfigOwnerWhere = (cols: {
  userId: AnyPgColumn;
  workspaceId: AnyPgColumn;
}): SQL => and(eq(cols.userId, providerConfigOwnerId), isNull(cols.workspaceId)) as SQL;

/** The provider-config owner's id, for writes that must land in the site-wide config. */
export const getProviderConfigOwnerId = async (db: LobeChatDatabase) => {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.createdAt)
    .limit(1);

  return owner?.id;
};

/** Whether `userId` is the admin that owns the site-wide provider config. */
export const isProviderConfigAdmin = async (db: LobeChatDatabase, userId: string) => {
  const user = await db.query.users.findFirst({
    columns: { role: true },
    where: eq(users.id, userId),
  });

  return user?.role === 'admin';
};
