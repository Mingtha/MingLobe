import { CURRENT_VERSION } from '@lobechat/const';
import type { ChatModelCard } from '@lobechat/types';
import {
  CHAT_MODEL_IMAGE_GENERATION_PARAMS,
  loadModels,
  MODEL_REASONING_EXTEND_PARAMS,
  MODEL_REASONING_PARAM_LEVELS,
  ModelProvider,
} from 'model-bank';
import { getMagpieCatalogAlias, stripModelIdPrefix } from 'model-bank/modelIdMatch';
import OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import type { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

type ModelSettings = NonNullable<ChatModelCard['settings']>;
type BankModel = Awaited<ReturnType<typeof loadModels>>[number];

/** Controls a model must not offer when Magpie explicitly turns reasoning off. */
const REASONING_PARAMS = new Set<string>([
  ...MODEL_REASONING_EXTEND_PARAMS,
  'enableAdaptiveThinking',
  'enableReasoning',
  'preserveThinking',
  'reasoningBudgetToken',
  'reasoningBudgetToken32k',
  'reasoningBudgetToken80k',
  'thinking',
  'thinkingBudget',
]);

/**
 * One row of magpie's `GET /v1/models`.
 *
 * magpie serves every model the user has as `provider/model`, so an id is not
 * the vendor's own: `workbuddy/kimi-k3-1`, a routing group's `group/<id>` or
 * `auto/<model>`, and, with bare ids turned on, the model's name alone.
 *
 * The specs magpie can rewrite belong to magpie. Its window and reply limit
 * come from the vendor's list or models.dev and then from what the user set;
 * whether it takes images and which reasoning levels it has are the user's to
 * override too. Everything magpie neither lists nor rewrites is read from
 * model-bank.
 */
interface MagpieModelCard {
  context_length?: number;
  context_window?: number;
  /** The user's name for the model, else the vendor's. */
  display_name?: string;
  id: string;
  /** `image` or `video` for a model called on its own route; a chat model has none. */
  kind?: string;
  /** The model's name as magpie's own lists label it, `· provider` and all. */
  magpie_label?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  native_endpoints?: string[];
  object?: string;
  owned_by?: string;
  pricing?: Record<string, unknown>;
  /** A model thinks when it has levels, or says so. */
  reasoning?: boolean;
  reasoning_levels?: string[];
  supported_endpoint_types?: string[];
  supported_parameters?: string[];
  supported_reasoning_levels?: { effort: string }[];
  tool_call?: boolean;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3425';

/**
 * A magpie id reduced to the key model-bank knows the model by, spelt as magpie
 * spells one when it agrees on it (`internal/provider/group.go`'s `sameModel`):
 * lowercased, without the vendor's or the routing group's prefix, a version's
 * dot as a dash, whitespace, `_` and `-` as one dash, a vendor's snapshot date
 * off.
 */
export const magpieModelKey = (id: string): string => {
  let key = id.trim().toLowerCase();

  // A routing group magpie found goes by two ids: `auto/<model>`, the one it
  // hands out, and `group/auto-<slug>`, the one it keeps. The slug carries
  // `auto-` before the model's name, which the model itself never does.
  if (key.startsWith('group/auto-')) key = key.slice('group/auto-'.length);

  key = stripModelIdPrefix(key);

  key = key.replaceAll(/[\s_-]+/gu, '-');

  // A version's dot, or Fireworks' `p` standing for one (`deepseek-v4p1`), as a
  // dash. Only between two digits, so `gpt-4o` keeps its name and `kimi-k3.1`
  // becomes `kimi-k3-1`, the id magpie serves that model under.
  key = key.replaceAll(/(?<=\d)[.p](?=\d)/g, '-');

  key = key.replace(/[-@]\d{8}$/, '');
  key = key.replace(/[-@]\d{6}$/, '');

  return key;
};

/**
 * The model-bank entry for a magpie id, when one is the same model: matched on
 * the name after the provider prefix, so `workbuddy/kimi-k3-1` reaches
 * `kimi-k3.1`.
 *
 * A routing group reaches one too. `auto/kimi-k3.1` is the pool magpie found for
 * the model of that name across the providers serving it, so what model-bank
 * says of `kimi-k3.1` is what the group serves: it takes tool calls, it sees
 * images. Only the id stays the group's, since that is what a request reaches.
 */
const findKnownModel = (
  id: string,
  index: Map<string, BankModel>,
  byId: Map<string, BankModel>,
): BankModel | undefined => {
  const exact = byId.get(id);
  if (exact) return exact;
  const alias = getMagpieCatalogAlias(id);
  if (alias && byId.has(alias)) return byId.get(alias);

  const key = magpieModelKey(id);
  // Then the spellings an id differs from model-bank's by: a vendor's `MMDD`
  // snapshot (`deepseek-v4.1-flash-1017`), a gateway's `-thinking` alias of the
  // same model, and the `-preview` model-bank still carries.
  const candidates = [
    key,
    key.replace(/[-@](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, ''),
    key.replace(/-thinking$/, ''),
    `${key}-preview`,
  ];

  for (const candidate of candidates) {
    const known = index.get(candidate);
    if (known) return known;
  }
};

/**
 * magpie's own fields for one model, laid over model-bank's.
 *
 * Only what magpie can rewrite is written here, since a field this card hands
 * over wins over model-bank's. An omitted field keeps the catalog fallback.
 */
const reasoningLevels = (model: MagpieModelCard) =>
  model.reasoning_levels ?? model.supported_reasoning_levels?.map(({ effort }) => effort);

const fallbackReasoningParam = (model: MagpieModelCard) => {
  const key = magpieModelKey(model.id);
  const levels = reasoningLevels(model);
  if (!levels?.length) return;

  const candidates: (keyof typeof MODEL_REASONING_PARAM_LEVELS)[] = /^deepseek-v4(?:-|$)/.test(key)
    ? ['deepseekV4GAReasoningEffort', 'deepseekV4ReasoningEffort']
    : key.startsWith('gemini-')
      ? ['thinkingLevel5', 'thinkingLevel', 'thinkingLevel3', 'thinkingLevel4', 'thinkingLevel2']
      : /^gpt-6(?:-|$)/.test(key)
        ? ['gpt6ReasoningEffort']
        : [];

  // Only expose a preset if the gateway supports every option it would offer.
  return candidates.find((param) =>
    MODEL_REASONING_PARAM_LEVELS[param].every((level) => levels.includes(level)),
  );
};

const fromMagpie = (model: MagpieModelCard): Partial<ChatModelCard> => {
  const contextWindow = model.context_length ?? model.context_window ?? model.max_input_tokens;

  // Omitted metadata leaves model-bank's fallback intact; explicit false wins.
  const { input, output } = model.modalities ?? {};
  const functionCall = model.tool_call ?? model.supported_parameters?.includes('tools');

  // A model thinks when magpie says so, or when it kept reasoning levels for it.
  // Its `false` is the user switching reasoning off, which must survive rather
  // than fall back to model-bank's answer.
  const levels = reasoningLevels(model);
  const thinks =
    model.reasoning ?? (levels?.length ? true : model.supported_parameters?.includes('reasoning'));

  return {
    displayName: plainName(model),
    ...(functionCall === undefined ? {} : { functionCall }),
    ...(contextWindow ? { contextWindowTokens: contextWindow } : {}),
    ...(model.max_output_tokens ? { maxOutput: model.max_output_tokens } : {}),
    ...(input && {
      audio: input.includes('audio'),
      video: input.includes('video'),
      vision: input.includes('image'),
    }),
    ...(output && { imageOutput: output.includes('image') }),
    ...(thinks === undefined ? {} : { reasoning: thinks }),
  };
};

/** What magpie appends to a routing group's label, which LobeHub says by its tag. */
const ROUTING_GROUP_SUFFIX = ' · routing group';

/**
 * The name magpie gives a model, without the `· routing group` it appends: the
 * tag says that, drawn from the id.
 *
 * A `· provider` suffix stays. Two vendors serving one model are both listed
 * under magpie, so the row alone cannot tell them apart. Without the suffix the
 * picker shows two entries of one name with nothing to choose between them.
 */
const plainName = (model: MagpieModelCard): string | undefined => {
  const label = model.magpie_label;
  if (!label) return model.display_name;

  return label.endsWith(ROUTING_GROUP_SUFFIX)
    ? label.slice(0, -ROUTING_GROUP_SUFFIX.length)
    : label;
};

/**
 * model-bank's settings for one model, limited to the parts magpie leaves unsaid.
 *
 * `reasoning_levels` says a model thinks, not which parameter turns the
 * strength, and that parameter differs by model family (`gpt5_6ReasoningEffort`,
 * `kimiK3ReasoningEffort`, …), so the one this entry names is what puts the
 * choice in the chat settings at all.
 *
 * The reasoning params go when the user turned thinking off in magpie: the
 * card says `reasoning: false`, and offering a strength beside it would let a
 * choice be made for a model the gateway then pushes back up to its lowest
 * thinking level.
 *
 * `disabledParams` hides controls the vendor refuses. It never reaches a
 * request, since magpie drops what an upstream rejects, but the settings page
 * would otherwise offer a slider that does nothing. `searchImpl` and
 * `searchProvider` stay out: magpie's search is its own, not the vendor's
 * way of implementing it.
 */
const knownSettings = (
  model: MagpieModelCard,
  known: BankModel | undefined,
  thinks: boolean | undefined,
): Pick<ChatModelCard, 'settings'> => {
  const fallback = fallbackReasoningParam(model);
  const levels = reasoningLevels(model);
  // The bank describes the vendor API. Do not offer a preset that sends levels this route rejects.
  const restrictLevels = !!levels?.length;
  const extendParams = known?.settings?.extendParams?.filter((param) => {
    if (param === 'urlContext' && model.supported_parameters) {
      return model.supported_parameters.includes('url_context');
    }
    if (
      !restrictLevels ||
      !Object.hasOwn(MODEL_REASONING_PARAM_LEVELS, param) ||
      param === 'reasoningMode'
    ) {
      return true;
    }
    return MODEL_REASONING_PARAM_LEVELS[param as keyof typeof MODEL_REASONING_PARAM_LEVELS].every(
      (level) => levels.includes(level),
    );
  });
  const resolvedParams = extendParams?.some((param) =>
    Object.hasOwn(MODEL_REASONING_PARAM_LEVELS, param),
  )
    ? extendParams
    : [...(extendParams ?? []), ...(fallback ? [fallback] : [])];
  const disabledParams: ModelSettings['disabledParams'] = known?.settings?.disabledParams;

  const usable =
    thinks === false
      ? resolvedParams.filter((param) => !REASONING_PARAMS.has(param))
      : resolvedParams;

  if (!usable?.length && !disabledParams) return {};

  return {
    settings: {
      ...(usable?.length ? { extendParams: usable } : {}),
      ...(disabledParams ? { disabledParams } : {}),
    },
  };
};

/**
 * What magpie serves, as model cards.
 *
 * The gateway's list is the only source: the models come and go with the
 * providers the user turns on there, so nothing is shipped in the card and
 * nothing is kept for a gateway that isn't running. model-bank fills what
 * magpie leaves unsaid, so a model magpie lists without one still takes tool
 * calls as its vendor's entry says. Video models are not imported.
 */
const fetchMagpieModels = async (client: OpenAI): Promise<ChatModelCard[]> => {
  // Refresh holds the catalog lock while the gateway responds; bound the HTTP request.
  const response = await client.models.list({
    maxRetries: 0,
    query: { kind: 'all' },
    signal: AbortSignal.timeout(10_000),
  });
  const rows = response.data as unknown as MagpieModelCard[];
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        typeof row?.id !== 'string' ||
        !row.id.trim() ||
        (row.kind != null && typeof row.kind !== 'string'),
    )
  ) {
    throw new Error('Invalid Magpie model list');
  }

  const bank = await loadModels();
  const chatIndex = new Map<string, BankModel>();
  const imageParams = new Map<string, ChatModelCard['parameters']>();
  for (const model of bank) {
    const key = magpieModelKey(model.id);
    if (model.type === 'image') {
      if (!imageParams.has(key) && model.parameters)
        imageParams.set(key, model.parameters as ChatModelCard['parameters']);
    } else if (model.type === 'chat' && !chatIndex.has(key)) {
      chatIndex.set(key, model);
    }
  }
  const byId = new Map(
    bank.filter(({ type }) => type === 'chat').map((model) => [model.id, model]),
  );
  const resolveImageParameters = (id: string) => {
    const alias = getMagpieCatalogAlias(id);
    const key = magpieModelKey(id);
    return (
      imageParams.get(key) ??
      imageParams.get(`${key}:image`) ??
      (alias ? imageParams.get(magpieModelKey(alias)) : undefined)
    );
  };
  const images = rows.filter(({ id, kind, supported_endpoint_types }) => {
    if (kind && kind !== 'image') return false;
    // The current image picker cannot require a reference image for edit-only models.
    if (supported_endpoint_types?.length) {
      return supported_endpoint_types.includes('image-generation');
    }
    if (kind === 'image') return true;
    const key = magpieModelKey(id);
    return !!resolveImageParameters(id) && !chatIndex.has(key);
  });
  const imageIds = new Set(images.map(({ id }) => id));

  // One persisted card per ID. The native image route wins if Magpie lists it twice.
  const chats = rows
    .filter(({ id, kind }) => (!kind || kind === 'chat') && !imageIds.has(id))
    .map((row) => {
      const known = findKnownModel(row.id, chatIndex, byId);
      const card = fromMagpie(row);
      return {
        audio: known?.abilities?.audio,
        description: known?.description,
        functionCall: known?.abilities?.functionCall,
        ...card,
        ...knownSettings(row, known, card.reasoning),
        id: row.id,
        type: row.kind === 'chat' ? ('chat' as const) : undefined,
      };
    });

  const imageCards = images.map((row): ChatModelCard => {
    const { imageUrl, imageUrls, ...parameters } =
      resolveImageParameters(row.id) ?? CHAT_MODEL_IMAGE_GENERATION_PARAMS;
    const canEdit = row.supported_endpoint_types?.includes('image-edit');
    return {
      displayName: plainName(row) ?? row.id,
      id: row.id,
      parameters: {
        ...parameters,
        ...(canEdit && (imageUrl ? { imageUrl } : { imageUrls: imageUrls ?? { default: [] } })),
      },
      type: 'image',
    };
  });

  // Drop a bare alias only if the list already contains its prefixed equivalent.
  const cards = [...chats, ...imageCards];
  const prefixedNames = new Set(
    cards
      .filter(({ id }) => id.includes('/'))
      .map(({ id, type }) => `${type ?? 'chat'}/${stripModelIdPrefix(id)}`),
  );
  const seen = new Set<string>();
  const unique = cards.filter(({ id, type }) => {
    if (seen.has(id) || (!id.includes('/') && prefixedNames.has(`${type ?? 'chat'}/${id}`)))
      return false;
    seen.add(id);
    return true;
  });

  const routedChats = new Map(
    unique.filter(({ type }) => type !== 'image').map((card) => [card.id, card]),
  );
  const chatCards = await processMultiProviderModelList(
    [...routedChats.values()],
    ModelProvider.Magpie,
  );
  return [
    ...chatCards
      .filter(({ type }) => type === 'chat')
      .map((card) => {
        const routed = routedChats.get(card.id);
        return { ...card, audio: routed?.audio, settings: routed?.settings };
      }),
    ...unique.filter(({ type }) => type === 'image'),
  ];
};

const mapMagpieThinkingLevel = ({ thinkingLevel, ...payload }: ChatStreamPayload) => ({
  ...payload,
  reasoning_effort: payload.reasoning_effort ?? thinkingLevel,
});

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: `${DEFAULT_BASE_URL}/v1`,
  chatCompletion: {
    handlePayload: (payload) =>
      ({
        ...mapMagpieThinkingLevel(payload),
        stream: payload.stream ?? true,
      }) as OpenAI.ChatCompletionCreateParamsStreaming,
    supportsAudioInput: true,
  },
  customClient: {
    // The gateway names the caller by its key (`magpie-<app>`) or else by its
    // User-Agent. The OpenAI SDK builds one from its class name, which a
    // minified build shortens to a single letter, so magpie would count
    // LobeHub's calls under that letter.
    createClient: (options: any) =>
      new OpenAI({
        ...options,
        defaultHeaders: {
          'User-Agent': `lobehub/${CURRENT_VERSION}`,
          ...options?.defaultHeaders,
        },
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MAGPIE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_MAGPIE_RESPONSES === '1',
  },
  models: async ({ client }: { client: OpenAI }) => fetchMagpieModels(client),
  provider: ModelProvider.Magpie,
  responses: { handlePayload: mapMagpieThinkingLevel },
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMagpieAI = createOpenAICompatibleRuntime(params);
