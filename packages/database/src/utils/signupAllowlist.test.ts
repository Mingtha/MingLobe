import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import {
  getSignupAllowlist,
  isSignupAllowed,
  normalizeSignupAllowlist,
  omitSignupAllowlist,
  setSignupAllowlist,
} from './signupAllowlist';

let db: LobeChatDatabase;

beforeAll(async () => {
  db = await getTestDB();
}, 30000);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([
    {
      email: 'admin@example.com',
      id: 'admin',
      preference: { useCmdEnterToSend: true },
      role: 'admin',
    },
    { email: 'friend@example.com', id: 'friend', role: 'user' },
  ]);
});

describe('signupAllowlist', () => {
  it('stores the list on the admin without touching other preference keys', async () => {
    await setSignupAllowlist(db, 'admin', [' Friend@Example.com ', '@team.org', 'team.org']);

    expect(await getSignupAllowlist(db)).toEqual(['friend@example.com', 'team.org']);
    const admin = await db.query.users.findFirst({ where: eq(users.id, 'admin') });
    expect(admin?.preference).toMatchObject({ useCmdEnterToSend: true });
  });

  it('reads an empty list when nothing is stored', async () => {
    expect(await getSignupAllowlist(db)).toEqual([]);
  });

  it('hides the list from preference reads', () => {
    expect(omitSignupAllowlist({ signupAllowlist: ['a@b.c'], x: 1 })).toEqual({ x: 1 });
    expect(omitSignupAllowlist(undefined)).toBeUndefined();
  });

  it('normalizes entries', () => {
    expect(normalizeSignupAllowlist(['', ' A@B.com', 'a@b.com', '@Team.org'])).toEqual([
      'a@b.com',
      'team.org',
    ]);
  });

  it('always admits the admin and otherwise needs an email or domain match', () => {
    expect(isSignupAllowed('ADMIN@example.com', 'admin@example.com', [])).toBe(true);
    expect(isSignupAllowed('x@example.com', 'admin@example.com', [])).toBe(false);
    expect(isSignupAllowed('x@team.org', 'admin@example.com', ['team.org'])).toBe(true);
    expect(isSignupAllowed('x@team.org', 'admin@example.com', ['y@team.org'])).toBe(false);
  });
});
