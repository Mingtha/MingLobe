import type { ChatModelCard } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { type AiProviderModelListItem } from 'model-bank';
import {
  AiModelReasoningConfigSchema,
  AiModelTypeSchema,
  CreateAiModelSchema,
  ModelProvider,
  ToggleAiModelEnableSchema,
  UpdateAiModelSchema,
} from 'model-bank';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AiModelModel } from '@/database/models/aiModel';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { getUserScopedAiProviderModelList } from '@/server/services/aiProviderAccess';
import { resolveProviderConfigAccess } from '@/server/services/providerConfigAdmin';
import { type ProviderConfig } from '@/types/user/settings';

const AI_MODEL_UNIQUE_CONSTRAINT = 'ai_models_id_provider_id_user_id_pk';

const getPostgresErrorField = (error: unknown, field: 'code' | 'constraint') => {
  let current = error;

  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;

    current = (current as { cause?: unknown }).cause;
  }
};

const isDuplicateAiModelError = (error: unknown) =>
  getPostgresErrorField(error, 'code') === '23505' &&
  getPostgresErrorField(error, 'constraint') === AI_MODEL_UNIQUE_CONSTRAINT;

const throwDuplicateAiModelError = (id: string): never => {
  throw new TRPCError({
    code: 'CONFLICT',
    message: `Model "${id}" already exists`,
  });
};

const fetchProviderModelSnapshot = async (
  runtime: Awaited<ReturnType<typeof initModelRuntimeFromDB>>,
) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TRPCError({ code: 'TIMEOUT', message: 'Provider model list request timed out' }));
      controller.abort();
    }, 30_000);
  });
  try {
    const models: ChatModelCard[] | undefined = await Promise.race([
      runtime.models({ requireComplete: true, signal: controller.signal }),
      timeout,
    ]);
    if (
      !Array.isArray(models) ||
      models.some((model) => typeof model?.id !== 'string' || !model.id.trim())
    ) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'Provider returned an invalid model list',
      });
    }
    return models;
  } finally {
    clearTimeout(timer);
  }
};

const aiModelProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  await resolveProviderConfigAccess(ctx.serverDB, ctx.userId, opts);

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const { aiProvider } = await getServerGlobalConfig();

  return opts.next({
    ctx: {
      aiInfraRepos: new AiInfraRepos(
        ctx.serverDB,
        ctx.userId,
        aiProvider as Record<string, ProviderConfig>,
        wsId,
      ),
      aiModelModel: new AiModelModel(ctx.serverDB, ctx.userId, wsId),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiModelRouter = router({
  batchToggleAiModels: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        enabled: z.boolean(),
        id: z.string(),
        models: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.batchToggleAiModels(input.id, input.models, input.enabled);
    }),
  // Explicit CLI batch updates are additive; only a server-fetched catalog can prune.
  batchUpdateAiModels: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(z.object({ id: z.string(), models: z.array(z.any()) }))
    .mutation(async ({ input, ctx }) =>
      ctx.aiModelModel.batchUpdateAiModels(input.id, input.models),
    ),

  // Model deletes are workspace-wide at the model layer (no per-user narrowing),
  // so they are Admin-or-higher in workspace mode, matching the provider
  // settings UI. Per-caller upserts (toggle/update/order) stay member-accessible.
  clearModelsByProvider: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearModelsByProvider(input.providerId);
    }),
  clearRemoteModels: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearRemoteModels(input.providerId);
    }),

  syncProviderModels: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .use(withScopedPermission('ai_model:delete'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ providerId: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input: { providerId: provider } }) => {
      const runtime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        provider,
        ctx.workspaceId ?? undefined,
      );
      const synced = await ctx.aiModelModel.syncRemoteModels(provider, async () => {
        const models = await fetchProviderModelSnapshot(runtime);

        return models.map((model) => ({
          abilities: {
            audio: model.audio,
            files: model.files,
            functionCall: model.functionCall,
            imageOutput: model.imageOutput,
            reasoning: model.reasoning,
            search: model.search,
            video: model.video,
            vision: model.vision,
          },
          contextWindowTokens: model.contextWindowTokens,
          description: model.description,
          displayName: model.displayName,
          enabled: model.enabled ?? false,
          id: model.id,
          parameters: model.parameters,
          pricing: model.pricing,
          releasedAt: model.releasedAt,
          settings:
            provider === ModelProvider.Magpie
              ? { ...model.settings, extendParams: model.settings?.extendParams ?? [] }
              : model.settings,
          type: model.type ?? 'chat',
        }));
      });
      if (synced === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider no longer exists' });
      }
      if (!synced)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A model refresh is already in progress for this provider',
        });
      return synced;
    }),

  createAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:create'))
    .input(CreateAiModelSchema)
    .mutation(async ({ input, ctx }) => {
      const existingModel = await ctx.aiModelModel.findByIdAndProvider(input.id, input.providerId);
      if (existingModel) {
        // A preference-only shell (just a saved reasoning config, hidden from
        // lists — e.g. left after clearing remote models) is not a real
        // duplicate: promote it into the custom model being created. `update`
        // upserts and shallow-merges `config`, preserving the chatConfig.
        if (!AiModelModel.isPreferenceOnlyRow(existingModel)) {
          throwDuplicateAiModelError(input.id);
        }

        // enabled defaults to true, matching the plain create() path
        // (CreateAiModelSchema carries no enabled field)
        await ctx.aiModelModel.update(input.id, input.providerId, {
          ...input,
          enabled: true,
          source: 'custom',
        });
        return input.id;
      }

      try {
        const data = await ctx.aiModelModel.create(input);

        return data?.id;
      } catch (error) {
        if (isDuplicateAiModelError(error)) throwDuplicateAiModelError(input.id);

        throw error;
      }
    }),

  getAiModelById: aiModelProcedure
    .input(z.object({ id: z.string() }))

    .query(async ({ input, ctx }) => {
      return ctx.aiModelModel.findById(input.id);
    }),

  // Personal-scope by design (workspaceId ignored): the user's default reasoning
  // params for a model instance are keyed by userId + providerId + modelId and
  // shared across workspaces. See AiModelModel.getModelReasoningConfig.
  getAiModelReasoningConfig: aiModelProcedure
    .input(z.object({ id: z.string(), providerId: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.aiModelModel.getModelReasoningConfig(input.id, input.providerId);
    }),

  getAiProviderModelList: aiModelProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        id: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        type: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<AiProviderModelListItem[]> => {
      const options = {
        enabled: input.enabled,
        limit: input.limit,
        offset: input.offset,
        type: input.type,
      };

      return getUserScopedAiProviderModelList(ctx.userId, input.id, options, (scopedOptions) =>
        ctx.aiInfraRepos.getAiProviderModelList(input.id, scopedOptions),
      );
    }),

  removeAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ id: z.string(), providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.delete(input.id, input.providerId);
    }),

  toggleModelEnabled: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(ToggleAiModelEnableSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.toggleModelEnabled(input);
    }),

  updateAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        id: z.string(),
        providerId: z.string(),
        value: UpdateAiModelSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.update(input.id, input.providerId, input.value);
    }),

  // Intentionally NOT gated by `ai_model:update`: this writes a personal
  // preference (scoped by userId with workspaceId NULL, see
  // AiModelModel.updateModelReasoningConfig), so workspace members without the
  // shared model-management permission must still be able to save it. Matches
  // the ungated getAiModelReasoningConfig read above.
  updateAiModelReasoningConfig: aiModelProcedure
    .input(
      z.object({
        id: z.string(),
        providerId: z.string(),
        value: AiModelReasoningConfigSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.updateModelReasoningConfig(input.id, input.providerId, input.value);
    }),

  updateAiModelOrder: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        providerId: z.string(),
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
            type: AiModelTypeSchema.optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.updateModelsOrder(input.providerId, input.sortMap);
    }),
});

export type AiModelRouter = typeof aiModelRouter;
