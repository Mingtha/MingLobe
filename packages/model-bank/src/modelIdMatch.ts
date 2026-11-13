/**
 * Gateway model ids carry a vendor prefix (`codex/gpt-6.1-sol`,
 * `claude/claude-opus-5-5`) while the bank lists the bare id.
 */
export const stripModelIdPrefix = (id: string) => id.slice(id.lastIndexOf('/') + 1);

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
  return bareId === modelId ? undefined : find(bareId);
};
