import type { AIChatModelCard } from '../../types';

export const gemini4HydrogenChatModel: AIChatModelCard = {
  abilities: {
    audio: true,
    functionCall: true,
    reasoning: true,
    search: true,
    structuredOutput: true,
    video: true,
    vision: true,
  },
  // https://ai.google.dev/gemini-api/docs/models/gemini-4-hydrogen
  contextWindowTokens: 1_048_576,
  description: 'Gemini 4 Hydrogen is optimized for everyday coding and agentic workflows.',
  displayName: 'Gemini 4 Hydrogen',
  family: 'gemini',
  generation: 'gemini-4',
  id: 'gemini-4-hydrogen',
  isOfficial: true,
  maxOutput: 65_536,
  settings: {
    extendParams: ['thinkingLevel5', 'urlContext'],
    searchImpl: 'params',
    searchProvider: 'google',
  },
  type: 'chat',
};
