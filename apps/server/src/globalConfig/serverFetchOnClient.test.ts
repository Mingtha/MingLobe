import { isProviderFetchOnClient } from 'model-bank/modelProviders';
import { describe, expect, it } from 'vitest';

import { getServerFetchOnClientOverride } from './serverFetchOnClient';

describe('getServerFetchOnClientOverride', () => {
  it.each(['magpie', 'ollama', 'lmstudio', 'unsloth'])(
    'advertises the effective server-only policy for %s without a proxy env var',
    (provider) => {
      expect(getServerFetchOnClientOverride(provider)).toBe(false);
      expect(isProviderFetchOnClient(provider, undefined)).toBe(false);
    },
  );

  it('does not need to advertise an override for other providers', () => {
    expect(getServerFetchOnClientOverride('openai')).toBeUndefined();
  });
});
