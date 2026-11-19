// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { aiModels, aiProviders, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'aimcov-user';
const providerId = 'aimcov-provider';
const model = new AiModelModel(serverDB, userId);

const findRow = async (id: string) =>
  serverDB.query.aiModels.findFirst({
    where: and(
      eq(aiModels.id, id),
      eq(aiModels.providerId, providerId),
      eq(aiModels.userId, userId),
    ),
  });

const cleanup = async () => {
  // ai_models cascades from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('AiModelModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId, role: 'admin' });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('does not fetch a deleted custom provider or recreate its catalog', async () => {
    let fetched = false;
    const result = await model.syncRemoteModels('deleted-provider', async () => {
      fetched = true;
      return [{ id: 'missing', type: 'chat' }];
    });
    expect(result).toBeUndefined();
    expect(fetched).toBe(false);
  });

  it('reconciles a full remote snapshot without touching custom models or other providers', async () => {
    await serverDB.insert(aiProviders).values({ id: providerId, source: 'custom', userId });
    const remote = { providerId, source: 'remote', userId } as const;
    await serverDB.insert(aiModels).values([
      { ...remote, enabled: true, id: 'retained', type: 'chat' },
      { ...remote, id: 'stale', type: 'chat' },
      { ...remote, id: 'stale-image', type: 'image' },
      { ...remote, config: { chatConfig: { enableReasoning: true } }, id: 'stale-with-preference' },
      { ...remote, id: 'custom', source: 'custom', type: 'chat' },
      { ...remote, id: 'other-provider', providerId: 'other' },
    ]);

    await model.syncRemoteModels(providerId, async () => [
      { enabled: false, id: 'retained', parameters: { prompt: { default: '' } }, type: 'image' },
      { id: 'custom', type: 'image' },
      {
        abilities: { functionCall: false },
        id: 'new',
        settings: { extendParams: ['thinkingLevel5'] },
        type: 'chat',
      },
    ]);

    expect(await findRow('retained')).toMatchObject({ enabled: true, type: 'image' });
    expect(await findRow('new')).toMatchObject({
      abilities: { functionCall: false },
      source: 'remote',
      type: 'chat',
    });
    expect(await findRow('stale')).toBeUndefined();
    expect(await findRow('stale-image')).toBeUndefined();
    expect(await findRow('custom')).toMatchObject({ source: 'custom', type: 'image' });
    expect(await findRow('stale-with-preference')).toMatchObject({
      config: { chatConfig: { enableReasoning: true } },
      source: null,
    });

    await model.syncRemoteModels(providerId, async () => [{ id: 'retained', type: 'chat' }]);
    expect(await findRow('retained')).toMatchObject({
      enabled: true,
      parameters: { prompt: { default: '' } },
      type: 'image',
    });
    await expect(
      model.syncRemoteModels(providerId, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await findRow('retained')).toBeDefined();
    await model.syncRemoteModels(providerId, async () => []);
    expect(await findRow('retained')).toBeUndefined();
    expect(await findRow('custom')).toMatchObject({ source: 'custom', type: 'image' });
    expect(
      await serverDB.query.aiModels.findFirst({ where: eq(aiModels.id, 'other-provider') }),
    ).toMatchObject({ source: 'remote' });
  });

  describe('getAllModelReasoningConfigs', () => {
    it('skips rows whose chatConfig key is present but null', async () => {
      await serverDB.insert(aiModels).values([
        {
          config: { chatConfig: null } as any,
          id: 'aimcov-null-chat-config',
          providerId,
          userId,
        },
        {
          config: { chatConfig: { enableReasoning: true } } as any,
          id: 'aimcov-with-chat-config',
          providerId,
          userId,
        },
      ]);

      const configs = await model.getAllModelReasoningConfigs();

      expect(configs).toEqual({
        [`${providerId}/aimcov-with-chat-config`]: { enableReasoning: true },
      });
    });
  });

  describe('toggleModelEnabled', () => {
    it('leaves the column default type when neither the input nor a builtin card has one', async () => {
      await model.toggleModelEnabled({
        enabled: true,
        id: 'aimcov-unknown-custom-model',
        providerId,
      });

      const row = await findRow('aimcov-unknown-custom-model');
      expect(row).toMatchObject({ enabled: true, type: 'chat' });
    });
  });

  describe('batchUpdateAiModels', () => {
    it('writes provided parameters and optional internal fields on insert', async () => {
      const [inserted] = await model.batchUpdateAiModels(providerId, [
        {
          config: { deploymentName: 'aimcov-deployment' },
          description: 'aimcov description',
          enabled: false,
          id: 'aimcov-batch-model',
          organization: 'aimcov-org',
          parameters: { temperature: { default: 0.5 } },
          settings: { searchImpl: 'params' },
          sort: 7,
          source: 'remote',
        } as any,
      ]);

      expect(inserted).toMatchObject({
        config: { deploymentName: 'aimcov-deployment' },
        description: 'aimcov description',
        enabled: false,
        id: 'aimcov-batch-model',
        organization: 'aimcov-org',
        parameters: { temperature: { default: 0.5 } },
        settings: { searchImpl: 'params' },
        sort: 7,
        source: 'remote',
      });
      expect(await findRow('aimcov-batch-model')).toMatchObject({
        organization: 'aimcov-org',
        parameters: { temperature: { default: 0.5 } },
        sort: 7,
      });
    });

    it('stores an explicitly empty parameter set as null instead of the column default', async () => {
      const [inserted] = await model.batchUpdateAiModels(providerId, [
        { id: 'aimcov-empty-params', parameters: { temperature: null } } as any,
      ]);

      expect(inserted.parameters).toBeNull();
      expect((await findRow('aimcov-empty-params'))?.parameters).toBeNull();
    });
  });
});
