import { TRPCError } from '@trpc/server';
import { asc, eq, inArray } from 'drizzle-orm';

import { auth } from '@/auth';
import { serverDBEnv } from '@/config/db';
import { AGENT_TRANSFER_PENDING_OWNER_DELETE } from '@/database/models/agentTransferJob';
import { UserModel } from '@/database/models/user';
import { files, globalFiles, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { revokeOIDCArtifactsByUserId } from '@/libs/oidc-provider/access-control';
import { FileService } from '@/server/services/file';

const DISABLED_REASON = 'Disabled by admin';

/** Every account on the site, oldest first. */
export const listMembers = (db: LobeChatDatabase) =>
  db
    .select({
      avatar: users.avatar,
      banned: users.banned,
      createdAt: users.createdAt,
      email: users.email,
      fullName: users.fullName,
      id: users.id,
      lastActiveAt: users.lastActiveAt,
      role: users.role,
      username: users.username,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

/** The admin manages everyone but itself; the admin role is owned by `ADMIN_EMAIL`. */
const findManageable = async (db: LobeChatDatabase, adminId: string, targetId: string) => {
  if (targetId === adminId)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot manage your own account' });

  const target = await UserModel.findById(db, targetId);
  if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
  if (target.role === 'admin')
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The admin account cannot be managed' });

  return target;
};

/**
 * Disable: Better Auth's admin plugin then refuses new sign-ins, the internal
 * adapter revokes existing sessions in Redis and the database alike (the same
 * steps as its `banUser`), OIDC refresh tokens are revoked for desktop / CLI
 * clients, and API keys stop resolving in `ApiKeyModel`.
 */
const disable = async (db: LobeChatDatabase, userId: string) => {
  const { internalAdapter } = await auth.$context;
  await internalAdapter.updateUser(userId, {
    banExpires: null,
    banReason: DISABLED_REASON,
    banned: true,
  });
  await internalAdapter.deleteUserSessions(userId);
  await revokeOIDCArtifactsByUserId(db, userId);
};

const enable = async (userId: string) => {
  const { internalAdapter } = await auth.$context;
  await internalAdapter.updateUser(userId, { banExpires: null, banReason: null, banned: false });
};

export const setMemberDisabled = async (
  db: LobeChatDatabase,
  adminId: string,
  targetId: string,
  disabled: boolean,
) => {
  await findManageable(db, adminId, targetId);

  return disabled ? disable(db, targetId) : enable(targetId);
};

/** Storage objects whose last referencing file row is gone: drop their global rows, return URLs. */
const releaseUnreferencedGlobalFiles = async (db: LobeChatDatabase, hashes: string[]) => {
  if (!serverDBEnv.REMOVE_GLOBAL_FILE || hashes.length === 0) return [];

  const stillUsed = new Set(
    (
      await db
        .selectDistinct({ hash: files.fileHash })
        .from(files)
        .where(inArray(files.fileHash, hashes))
    ).map((row) => row.hash),
  );
  const orphaned = hashes.filter((hash) => !stillUsed.has(hash));
  if (orphaned.length === 0) return [];

  const removed = await db
    .delete(globalFiles)
    .where(inArray(globalFiles.hashId, orphaned))
    .returning({ url: globalFiles.url });

  return removed.map((row) => row.url);
};

/**
 * Delete an account with its data, then the storage objects no one else
 * references. The account delete is one transaction and runs first, so a
 * failure leaves files and access exactly as they were.
 */
export const deleteMember = async (db: LobeChatDatabase, adminId: string, targetId: string) => {
  const target = await findManageable(db, adminId, targetId);

  // A workspace cascades with its primary owner, taking other members' data along
  const [ownedWorkspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.primaryOwnerId, targetId))
    .limit(1);
  if (ownedWorkspace)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This member owns a workspace; transfer or delete it first',
    });

  // Every file row the member owns, in any scope, before the user cascade removes them
  const hashes = (
    await db.selectDistinct({ hash: files.fileHash }).from(files).where(eq(files.userId, targetId))
  )
    .map((row) => row.hash)
    .filter((hash): hash is string => !!hash);

  // Lock the account out so no session or upload lands while it is being removed
  await disable(db, targetId);
  try {
    await UserModel.deleteUser(db, targetId);
  } catch (error) {
    if (!target.banned) await enable(targetId);
    if (error instanceof Error && error.message === AGENT_TRANSFER_PENDING_OWNER_DELETE)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'An agent transfer for this member is still running; try again shortly',
      });
    throw error;
  }

  const urls = await releaseUnreferencedGlobalFiles(db, hashes);
  if (urls.length > 0) {
    // shortcut: a storage failure leaves orphaned objects behind; the account is already gone
    await new FileService(db, adminId)
      .deleteFiles(urls)
      .catch((error) => console.error('[memberAdmin] failed to delete member files', error));
  }
};
