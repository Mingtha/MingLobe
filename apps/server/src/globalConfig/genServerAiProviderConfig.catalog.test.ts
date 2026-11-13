import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { genServerAiProvidersConfig } from './genServerAiProviderConfig';

vi.mock('@/envs/llm', () => ({ getLLMConfig: () => ({}) }));

// Fork: providers start with an empty model list; the admin adds models via "Fetch models"
describe('server provider model catalog', () => {
  afterEach(() => {
    delete process.env.OPENAI_MODEL_LIST;
  });

  it('exposes no builtin models when no model list is configured', async () => {
    const { openai } = await genServerAiProvidersConfig({}, [ModelProvider.OpenAI]);

    expect(openai.serverModelLists).toEqual([]);
  });

  it('treats an empty model list env as unset', async () => {
    process.env.OPENAI_MODEL_LIST = '';

    const { openai } = await genServerAiProvidersConfig({}, [ModelProvider.OpenAI]);

    expect(openai.serverModelLists).toEqual([]);
  });

  it('still honours an explicit model list env', async () => {
    process.env.OPENAI_MODEL_LIST = '-all,+gpt-6.1-sol';

    const { openai } = await genServerAiProvidersConfig({}, [ModelProvider.OpenAI]);

    expect(openai.serverModelLists?.map((m) => m.id)).toEqual(['gpt-6.1-sol']);
  });
});
