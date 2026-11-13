import type { AiProviderListItem } from '@lobechat/types';
import type { EnabledAiModel } from 'model-bank';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

const bankCard = {
  abilities: { functionCall: true, reasoning: true, vision: true },
  contextWindowTokens: 872_000,
  displayName: 'GPT-6.1 Sol',
  id: 'gpt-6.1-sol',
  providerId: 'openai',
  settings: { extendParams: ['gpt6ReasoningEffort', 'textVerbosity'] },
  type: 'chat',
};

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, {});
  vi.spyOn(repo as any, 'getModelBankModels').mockResolvedValue([bankCard]);
  vi.spyOn(repo, 'getAiProviderList').mockResolvedValue([
    { enabled: true, id: 'openai', source: 'builtin' },
  ] as AiProviderListItem[]);
  vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([]);
});

describe('AiInfraRepos gateway alias models', () => {
  // Gateways list bank models under a vendor prefix; the DB row alone carried no
  // abilities or extendParams, so vision and the reasoning-effort control were lost.
  it('lets a prefixed DB-only model inherit its bank card', async () => {
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      // A fetched row's display name falls back to the raw id, which says nothing
      {
        abilities: {},
        displayName: 'codex/gpt-6.1-sol',
        enabled: true,
        id: 'codex/gpt-6.1-sol',
        providerId: 'openai',
        type: 'chat',
      },
    ] as EnabledAiModel[]);

    const [model] = await repo.getEnabledModels();

    expect(model).toMatchObject({
      abilities: { functionCall: true, reasoning: true, vision: true },
      contextWindowTokens: 872_000,
      displayName: 'GPT-6.1 Sol',
      id: 'codex/gpt-6.1-sol',
      providerId: 'openai',
      settings: { extendParams: ['gpt6ReasoningEffort', 'textVerbosity'] },
    });
  });

  it('keeps the values the admin set on the row', async () => {
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      {
        abilities: { vision: false },
        contextWindowTokens: 1000,
        displayName: 'Sol (gateway)',
        enabled: true,
        id: 'codex/gpt-6.1-sol',
        providerId: 'openai',
        type: 'chat',
      },
    ] as EnabledAiModel[]);

    const [model] = await repo.getEnabledModels();

    expect(model).toMatchObject({
      abilities: { vision: false },
      contextWindowTokens: 1000,
      displayName: 'Sol (gateway)',
      settings: { extendParams: ['gpt6ReasoningEffort', 'textVerbosity'] },
    });
  });

  // With no builtin catalog, a fetched bank model is a plain DB row and must still get its card
  it('lets an unprefixed fetched model inherit its bank card', async () => {
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      { abilities: {}, enabled: true, id: 'gpt-6.1-sol', providerId: 'openai', type: 'chat' },
    ] as EnabledAiModel[]);

    const [model] = await repo.getEnabledModels();

    expect(model).toMatchObject({
      displayName: 'GPT-6.1 Sol',
      settings: { extendParams: ['gpt6ReasoningEffort', 'textVerbosity'] },
    });
  });

  it('leaves unprefixed custom models untouched', async () => {
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      { abilities: {}, enabled: true, id: 'my-model', providerId: 'openai', type: 'chat' },
    ] as EnabledAiModel[]);

    const [model] = await repo.getEnabledModels();

    expect(model.abilities).toEqual({});
    expect(model.settings).toBeUndefined();
  });
});
