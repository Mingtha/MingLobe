/**
 * Gateway model ids carry a vendor prefix (`codex/gpt-6.1-sol`,
 * `claude/claude-opus-5-5`) while the bank lists the bare id.
 */
export const stripModelIdPrefix = (id: string) => id.slice(id.lastIndexOf('/') + 1);

const MAGPIE_CATALOG_ALIASES: Readonly<Record<string, string>> = {
  // https://api-docs.deepseek.com/quick_start/pricing
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek-v4.1-flash-1017': 'deepseek-flash',
  'deepseek-v4-1-flash': 'deepseek-flash',
  'deepseek-v4-1-flash-1017': 'deepseek-flash',
  'claude-opus-4-6-thinking': 'claude-opus-4-6',
  'gemini-3-pro-image': 'gemini-3-pro-image-preview:image',
};

export const getMagpieCatalogAlias = (modelId: string): string | undefined => {
  const id = modelId.toLowerCase();
  const bareId = id.startsWith('group/auto-')
    ? id.slice('group/auto-'.length)
    : stripModelIdPrefix(id);
  return Object.hasOwn(MAGPIE_CATALOG_ALIASES, bareId) ? MAGPIE_CATALOG_ALIASES[bareId] : undefined;
};

/**
 * Find a model's bank card: exact id (same provider first, then any provider),
 * then the same lookup with the gateway prefix stripped. Exact matches always
 * win, so ids that legitimately contain `/` (aggregators) behave as before.
 */
export const findModelCard = <T extends { id: string; providerId?: string }>(
  cards: readonly T[],
  modelId: string,
  providerId?: string,
): T | undefined => {
  const find = (id: string) =>
    (providerId
      ? cards.find((card) => card.id === id && card.providerId === providerId)
      : undefined) ?? cards.find((card) => card.id === id);

  const exact = find(modelId);
  if (exact) return exact;

  const bareId = stripModelIdPrefix(modelId);
  const bare = bareId === modelId ? undefined : find(bareId);
  if (bare) return bare;
  const alias = providerId === 'magpie' ? getMagpieCatalogAlias(modelId) : undefined;
  return alias ? find(alias) : undefined;
};
