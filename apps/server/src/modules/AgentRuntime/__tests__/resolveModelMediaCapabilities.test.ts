import type { LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveModelMediaCapabilities } from '../resolveModelMediaCapabilities';

const builtinModels = [
  { abilities: { vision: true }, id: 'gpt-6.1-sol', providerId: 'openai', type: 'chat' },
] as LobeDefaultAiModelListItem[];

describe('resolveModelMediaCapabilities', () => {
  // Gateways expose bank models under a vendor prefix; without the bare-id
  // fallback the server treated them as unable to see images.
  it('reads the bank abilities of a gateway-prefixed model id', () => {
    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'codex/gpt-6.1-sol',
        provider: 'openai',
      }),
    ).toEqual({ vision: true });
  });

  it('keeps non-empty user abilities authoritative', () => {
    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'codex/gpt-6.1-sol',
        provider: 'openai',
        userAbilities: { vision: false },
      }),
    ).toEqual({ audio: false, video: false, vision: false });
  });
});
