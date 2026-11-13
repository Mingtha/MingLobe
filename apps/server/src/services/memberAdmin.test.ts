// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { UserModel } from '@/database/models/user';
import { files, globalFiles, users, workspaces } from '@/database/schemas';

import { deleteMember, listMembers, setMemberDisabled } from './memberAdmin';

const { mockDeleteFiles, mockDeleteUserSessions, mockRevokeOIDC, mockUpdateUser } = vi.hoisted(
  () => ({
    mockDeleteFiles: vi.fn(),
    mockDeleteUserSessions: vi.fn(),
    mockRevokeOIDC: vi.fn(),
    mockUpdateUser: vi.fn(),
  }),
);

vi.mock('@/libs/oidc-provider/access-control', () => ({
  revokeOIDCArtifactsByUserId: mockRevokeOIDC,
}));

vi.mock('@/auth', () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        deleteUserSessions: mockDeleteUserSessions,
        updateUser: mockUpdateUser,
      },
    }),
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFiles = mockDeleteFiles;
  },
}));

const db = await getTestDB();
const ids = { admin: 'member-admin', friend: 'member-friend', other: 'member-other' };

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await db.delete(users).where(inArray(users.id, Object.values(ids)));
  await db.delete(globalFiles).where(inArray(globalFiles.hashId, ['h-own', 'h-shared']));
  await db.insert(users).values([
    { createdAt: new Date('2026-01-01'), email: 'a@x.com', id: ids.admin, role: 'admin' },
    { createdAt: new Date('2026-01-02'), email: 'f@x.com', id: ids.friend, role: 'user' },
    { createdAt: new Date('2026-01-03'), email: 'o@x.com', id: ids.other, role: 'user' },
  ]);
});

describe('memberAdmin', () => {
  it('lists every account oldest first', async () => {
    const members = (await listMembers(db)).filter((m) => Object.values(ids).includes(m.id));

    expect(members.map((m) => m.email)).toEqual(['a@x.com', 'f@x.com', 'o@x.com']);
  });

  it('refuses to manage the admin itself or a missing account', async () => {
    await expect(setMemberDisabled(db, ids.admin, ids.admin, true)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(deleteMember(db, ids.admin, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('disables by banning and revoking sessions, and re-enables', async () => {
    await setMemberDisabled(db, ids.admin, ids.friend, true);
    expect(mockUpdateUser).toHaveBeenCalledWith(
      ids.friend,
      expect.objectContaining({ banned: true }),
    );
    expect(mockDeleteUserSessions).toHaveBeenCalledWith(ids.friend);
    // Desktop / CLI refresh tokens must not outlive the disable
    expect(mockRevokeOIDC).toHaveBeenCalledWith(db, ids.friend);

    vi.clearAllMocks();
    await setMemberDisabled(db, ids.admin, ids.friend, false);
    expect(mockUpdateUser).toHaveBeenCalledWith(
      ids.friend,
      expect.objectContaining({ banned: false }),
    );
    expect(mockDeleteUserSessions).not.toHaveBeenCalled();
  });

  it('deletes the account and only storage objects no one else references', async () => {
    await db.insert(globalFiles).values([
      { creator: ids.friend, fileType: 'text/plain', hashId: 'h-own', size: 1, url: 'files/own' },
      {
        creator: ids.friend,
        fileType: 'text/plain',
        hashId: 'h-shared',
        size: 1,
        url: 'files/shared',
      },
    ]);
    await db.insert(files).values([
      {
        fileHash: 'h-own',
        fileType: 'text/plain',
        name: 'own',
        size: 1,
        url: 'files/own',
        userId: ids.friend,
      },
      {
        fileHash: 'h-shared',
        fileType: 'text/plain',
        name: 's',
        size: 1,
        url: 'files/shared',
        userId: ids.friend,
      },
      {
        fileHash: 'h-shared',
        fileType: 'text/plain',
        name: 's',
        size: 1,
        url: 'files/shared',
        userId: ids.other,
      },
    ]);
    mockDeleteFiles.mockRejectedValueOnce(new Error('s3 down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await deleteMember(db, ids.admin, ids.friend);

    expect(mockDeleteUserSessions).toHaveBeenCalledWith(ids.friend);
    expect(mockDeleteFiles).toHaveBeenCalledWith(['files/own']);
    expect(await db.query.users.findFirst({ where: eq(users.id, ids.friend) })).toBeUndefined();
    expect(await db.select().from(files).where(eq(files.userId, ids.other))).toHaveLength(1);
    expect(
      await db.select().from(globalFiles).where(eq(globalFiles.hashId, 'h-shared')),
    ).toHaveLength(1);
  });

  it('keeps files and restores access when the account delete fails', async () => {
    await db.insert(globalFiles).values({
      creator: ids.friend,
      fileType: 'text/plain',
      hashId: 'h-own',
      size: 1,
      url: 'files/own',
    });
    await db.insert(files).values({
      fileHash: 'h-own',
      fileType: 'text/plain',
      name: 'own',
      size: 1,
      url: 'files/own',
      userId: ids.friend,
    });
    vi.spyOn(UserModel, 'deleteUser').mockRejectedValueOnce(new Error('fk restrict'));

    await expect(deleteMember(db, ids.admin, ids.friend)).rejects.toThrow('fk restrict');

    expect(mockDeleteFiles).not.toHaveBeenCalled();
    expect(await db.select().from(files).where(eq(files.userId, ids.friend))).toHaveLength(1);
    expect(mockUpdateUser).toHaveBeenLastCalledWith(
      ids.friend,
      expect.objectContaining({ banned: false }),
    );
  });

  it('refuses to delete a workspace owner, whose workspace would cascade away', async () => {
    await db.insert(workspaces).values({ name: 'w', primaryOwnerId: ids.friend, slug: 'member-w' });

    await expect(deleteMember(db, ids.admin, ids.friend)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
