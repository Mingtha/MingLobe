// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { resolveLlmExecutionSite } from '../resolveLlmExecutionSite';

const providerRow = vi.hoisted(() => ({ current: undefined as any }));
const getAiProviderById = vi.hoisted(() => vi.fn(async () => providerRow.current));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn(function (this: any) {
    this.getAiProviderById = getAiProviderById;
  }),
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  resolveRuntimeProvider: (provider: string, sdkType?: string) =>
    ['ollama', 'lmstudio', 'openai'].includes(provider) ? provider : sdkType || 'openai',
}));
const executor = (providers: string[]) => ({
  host: {
    llmExecutor: { capabilities: ['llm_relay@1'], clientId: 'tab-a', providers },
  },
});

const resolve = (provider: string, state?: any) =>
  resolveLlmExecutionSite({ db: {} as any, provider, state, userId: 'user-1' });

describe('resolveLlmExecutionSite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerRow.current = { fetchOnClient: undefined, keyVaults: {} };
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue({
      enableLlmRelay: true,
    } as any);
  });

  it('keeps every call on the server while the relay is off for the user', async () => {
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue({
      enableLlmRelay: false,
    } as any);

    expect(await resolve('ollama', executor(['ollama']))).toEqual({ site: 'server' });
    expect(getAiProviderById).not.toHaveBeenCalled();
  });

  it('never relays the platform provider or a shared-agent visitor run', async () => {
    expect(await resolve('lobehub', executor(['lobehub']))).toEqual({ site: 'server' });
    expect(
      await resolve('ollama', {
        ...executor(['ollama']),
        principal: { actor: { shareVisitor: { visitorUserId: 'v' } } },
      }),
    ).toEqual({ site: 'server' });
  });

  it.each(['ollama', 'magpie', 'my-local-llm'])(
    'keeps %s on the server even if a tab offers to run it',
    async (provider) => {
      expect(await resolve(provider)).toEqual({ site: 'server' });
      expect(await resolve(provider, executor([provider]))).toEqual({ site: 'server' });
    },
  );

  it.each([undefined, 'test-key'])(
    'ignores a saved client preference with API key %s',
    async (apiKey) => {
      providerRow.current = {
        fetchOnClient: true,
        keyVaults: { apiKey, baseURL: 'http://localhost:1234/v1' },
        settings: { sdkType: 'openai' },
      };

      expect(await resolve('my-local-llm', executor(['my-local-llm']))).toEqual({ site: 'server' });
    },
  );
});
