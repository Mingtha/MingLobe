// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { LobeGoogleAI } from './index';

afterEach(() => vi.unstubAllGlobals());

it('reads all Google catalog pages before returning a snapshot', async () => {
  const fetch = vi
    .fn<(url: string) => Promise<Response>>()
    .mockResolvedValueOnce(
      Response.json({ models: [{ name: 'models/gemini-first' }], nextPageToken: 'page/2' }),
    )
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/gemini-second' }] }));
  vi.stubGlobal('fetch', fetch);

  const models = await new LobeGoogleAI({ apiKey: 'test-key' }).models({ requireComplete: true });
  expect(models.map(({ id }) => id)).toEqual(['gemini-first', 'gemini-second']);
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page/2');
});

it('rejects a Google catalog if the next page cannot be fetched', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ models: [], nextPageToken: 'next' }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })),
  );
  await expect(
    new LobeGoogleAI({ apiKey: 'test-key' }).models({ requireComplete: true }),
  ).rejects.toThrow('503');
});
