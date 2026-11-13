// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from './index';

const Runtime = createOpenAICompatibleRuntime({
  baseURL: 'https://api.test.com/v1',
  provider: 'custom-embedding',
});

describe('openaiCompatible embeddings', () => {
  // Gemini's OpenAI-compatible endpoint rejects unknown fields with
  // 400 `Unknown name "user"`, so the request body must not carry it.
  it('does not send the user field in the embeddings request', async () => {
    const instance = new Runtime({ apiKey: 'test' });
    const create = vi
      .spyOn(instance['client'].embeddings, 'create')
      .mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] } as any);

    const result = await instance.embeddings(
      { dimensions: 1024, input: ['hello'], model: 'gemini-embedding-2' },
      { user: 'user_123' },
    );

    expect(result).toEqual([[0.1, 0.2]]);
    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty('user');
    expect(body).toMatchObject({
      dimensions: 1024,
      encoding_format: 'float',
      input: ['hello'],
      model: 'gemini-embedding-2',
    });
  });
});
