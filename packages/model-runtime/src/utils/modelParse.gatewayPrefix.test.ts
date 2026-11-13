import { describe, expect, it } from 'vitest';

import { MODEL_LIST_CONFIGS, processModelList, processMultiProviderModelList } from './modelParse';

// Gateways list models as `<vendor>/<bank id>`; the fetched card must come from the bare id's bank card
describe('fetched gateway-prefixed model ids', () => {
  it('fills an OpenAI-style alias from the bare bank card', async () => {
    const [card] = await processMultiProviderModelList([{ id: 'codex/gpt-6.1-sol' }], 'openai');

    expect(card).toMatchObject({
      displayName: 'GPT-6.1 Sol',
      functionCall: true,
      id: 'codex/gpt-6.1-sol',
      reasoning: true,
      vision: true,
    });
  });

  it('fills an Anthropic-style alias from the bare bank card', async () => {
    const [card] = await processModelList(
      [{ id: 'claude/claude-opus-5-5' }],
      MODEL_LIST_CONFIGS.anthropic,
      'anthropic',
    );

    expect(card).toMatchObject({ functionCall: true, reasoning: true, vision: true });
  });
});
