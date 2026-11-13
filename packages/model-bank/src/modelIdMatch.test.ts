import { describe, expect, it } from 'vitest';

import { findModelCard, stripModelIdPrefix } from './modelIdMatch';

const cards = [
  { id: 'gpt-6.1-sol', providerId: 'openai', tag: 'openai' },
  { id: 'gpt-6.1-sol', providerId: 'aihubmix', tag: 'aihubmix' },
  { id: 'claude-opus-5-5', providerId: 'anthropic', tag: 'anthropic' },
  { id: 'anthropic/claude-opus-5-5', providerId: 'openrouter', tag: 'openrouter' },
];

describe('stripModelIdPrefix', () => {
  it('drops everything up to the last slash', () => {
    expect(stripModelIdPrefix('codex/gpt-6.1-sol')).toBe('gpt-6.1-sol');
    expect(stripModelIdPrefix('a/b/c')).toBe('c');
    expect(stripModelIdPrefix('gpt-6.1-sol')).toBe('gpt-6.1-sol');
  });
});

describe('findModelCard', () => {
  it('matches a gateway-prefixed id to the bare card of the same provider', () => {
    expect(findModelCard(cards, 'codex/gpt-6.1-sol', 'openai')?.tag).toBe('openai');
    expect(findModelCard(cards, 'claude/claude-opus-5-5', 'anthropic')?.tag).toBe('anthropic');
  });

  it('falls back to another provider for the bare id', () => {
    expect(findModelCard(cards, 'claude/claude-opus-5-5', 'magpie')?.tag).toBe('anthropic');
  });

  it('prefers an exact id over the prefix-stripped one', () => {
    expect(findModelCard(cards, 'anthropic/claude-opus-5-5', 'openrouter')?.tag).toBe('openrouter');
    expect(findModelCard(cards, 'anthropic/claude-opus-5-5')?.tag).toBe('openrouter');
  });

  it('returns undefined when neither id is known', () => {
    expect(findModelCard(cards, 'codex/unknown-model', 'openai')).toBeUndefined();
    expect(findModelCard(cards, 'unknown-model')).toBeUndefined();
  });
});
