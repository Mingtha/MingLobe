import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { AiModelModel } from '../models/aiModel';
import { AiProviderModel } from '../models/aiProvider';
import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { getProviderConfigOwnerId, isProviderConfigAdmin } from './providerConfigOwner';

let db: LobeChatDatabase;

beforeAll(async () => {
  db = await getTestDB();
}, 30000);

beforeEach(async () => {
  await db.delete(users);
});

const seedAdminConfig = async () => {
  await new AiProviderModel(db, 'admin').create({ id: 'magpie', name: 'Magpie', source: 'custom' });
  await new AiModelModel(db, 'admin').create({ id: 'codex/gpt-6.1-sol', providerId: 'openai' });
};

describe('site-wide provider config', () => {
  it('lets every account read the admin rows and only the admin rows', async () => {
    await db.insert(users).values([
      { email: 'admin@example.com', id: 'admin', role: 'admin' },
      { email: 'friend@example.com', id: 'friend', role: 'user' },
    ]);
    await seedAdminConfig();
    // A stray row written under a non-admin account stays invisible to everyone
    await new AiModelModel(db, 'friend').create({ id: 'friend-model', providerId: 'openai' });

    for (const userId of ['admin', 'friend']) {
      expect((await new AiProviderModel(db, userId).query()).map((p) => p.id)).toEqual(['magpie']);
      expect((await new AiModelModel(db, userId).query()).map((m) => m.id)).toEqual([
        'codex/gpt-6.1-sol',
      ]);
    }
  });

  it('exposes no config while there is no admin', async () => {
    await db.insert(users).values([{ email: 'admin@example.com', id: 'admin', role: 'admin' }]);
    await seedAdminConfig();
    await db.update(users).set({ role: 'user' });

    expect(await new AiProviderModel(db, 'admin').query()).toEqual([]);
  });

  it('tells the admin apart', async () => {
    await db.insert(users).values([
      { id: 'admin', role: 'admin' },
      { id: 'friend', role: 'user' },
    ]);

    expect(await isProviderConfigAdmin(db, 'admin')).toBe(true);
    expect(await isProviderConfigAdmin(db, 'friend')).toBe(false);
    expect(await isProviderConfigAdmin(db, 'missing')).toBe(false);
    expect(await getProviderConfigOwnerId(db)).toBe('admin');
  });
});
