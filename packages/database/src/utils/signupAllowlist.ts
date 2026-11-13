import { eq, sql } from 'drizzle-orm';

import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * The admin-managed sign-up allowlist lives under this key of the admin's
 * `users.preference`. Preference writes merge by key, so client updates keep it;
 * it is stripped from what the client reads so a stale copy is never sent back.
 */
export const SIGNUP_ALLOWLIST_KEY = 'signupAllowlist';

export const omitSignupAllowlist = <T>(preference: T): T => {
  if (!preference || typeof preference !== 'object' || !(SIGNUP_ALLOWLIST_KEY in preference))
    return preference;
  const { [SIGNUP_ALLOWLIST_KEY]: _omit, ...rest } = preference as Record<string, unknown>;
  return rest as T;
};

/** Normalize entries: trimmed, lower-cased, de-duplicated; `@x.com` becomes the domain `x.com`. */
export const normalizeSignupAllowlist = (entries: string[]) => [
  ...new Set(entries.map((entry) => entry.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)),
];

export const getSignupAllowlist = async (db: LobeChatDatabase): Promise<string[]> => {
  const admin = await db.query.users.findFirst({
    columns: { preference: true },
    // Same admin as getProviderConfigOwnerId when more than one row holds the role
    orderBy: users.createdAt,
    where: eq(users.role, 'admin'),
  });
  const list = (admin?.preference as Record<string, unknown> | null)?.[SIGNUP_ALLOWLIST_KEY];

  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
};

export const setSignupAllowlist = async (
  db: LobeChatDatabase,
  adminUserId: string,
  entries: string[],
) => {
  const list = normalizeSignupAllowlist(entries);
  await db
    .update(users)
    .set({
      preference: sql`jsonb_set(COALESCE(${users.preference}, '{}'::jsonb), ${`{${SIGNUP_ALLOWLIST_KEY}}`}::text[], ${JSON.stringify(list)}::jsonb)`,
    })
    .where(eq(users.id, adminUserId));

  return list;
};

/**
 * Sign-up rule: the admin email always passes; otherwise the email or its domain
 * must be listed. An empty list admits nobody but the admin.
 */
export const isSignupAllowed = (email: string, adminEmail: string | undefined, list: string[]) => {
  const normalized = email.trim().toLowerCase();
  if (adminEmail && normalized === adminEmail.trim().toLowerCase()) return true;

  const domain = normalized.split('@')[1];
  return list.some((item) => (item.includes('@') ? item === normalized : item === domain));
};
