import { randomUUID } from 'node:crypto';

import { toast } from '@lobehub/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as I18nextModule from 'i18next';
import { t } from 'i18next';
import type { AiProviderModelListItem } from 'model-bank';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';

import { useAiInfraStore as useStore } from '../../store';
import { initialAIModelState } from './initialState';
import { aiModelListResource } from './projection';

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nextModule>();
  return {
    ...actual,
    t: vi.fn((key: string) => key),
  };
});

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

/**
 * The provider model list is a replica (`aiModelListMap[providerId]`): it paints
 * from the persisted copy on the first frame, the network only confirms, and a
 * write revalidates the loaded entries. Read the rows through the selectors;
 * the fetch hook only orchestrates fetching.
 */
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const model = (id: string, displayName = id): AiProviderModelListItem =>
  ({
    abilities: {},
    displayName,
    enabled: true,
    id,
    source: 'builtin',
    type: 'chat',
  }) as AiProviderModelListItem;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_STORAGE_KEY = aiModelListResource.storageKey('test-provider');

describe('AiModelAction', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useScope(`ai-model-user-${randomUUID()}:personal`);

    // Reset store to initial state
    act(() => {
      useStore.setState({
        ...initialAIModelState,
        activeAiProvider: 'test-provider',
        refreshAiProviderRuntimeState: vi.fn(),
      });
    });
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        aiModelListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  describe('batchToggleAiModels', () => {
    it('should toggle multiple models and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1', 'model-2'], true);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', ['model-1', 'model-2'], true);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1'], true);
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearModelsByProvider', () => {
    it('should clear all models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'clearModelsByProvider')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.clearModelsByProvider('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('clearRemoteModels', () => {
    it('should clear remote models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'clearRemoteModels')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.clearRemoteModels('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('createNewAiModel', () => {
    it('should create new model and refresh list', async () => {
      const params = {
        displayName: 'New Model',
        enabled: true,
        id: 'new-model',
        providerId: 'test-provider',
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'createAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.createNewAiModel(params);
      });

      expect(serviceSpy).toHaveBeenCalledWith(params);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('fetchRemoteModelList', () => {
    it.each(['magpie', 'openai', 'custom-gateway'])(
      'syncs %s on the server and refreshes cached lists even when another provider is active',
      async (provider) => {
        const { result } = renderHook(() => useStore());
        const refresh = vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue(undefined);
        const sync = vi.spyOn(aiModelService, 'syncProviderModels').mockResolvedValue({
          duplicateIds: [],
          removedCount: 0,
        });
        await act(async () => result.current.fetchRemoteModelList(provider));
        expect(sync).toHaveBeenCalledWith(provider);
        expect(refresh).toHaveBeenCalledOnce();
        expect(toast.warning).not.toHaveBeenCalled();
      },
    );

    it('shows duplicate ID warnings returned by the server after a successful sync', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'syncProviderModels').mockResolvedValue({
        duplicateIds: ['one', 'two', 'three', 'four'],
        removedCount: 5,
      });
      await act(async () => result.current.fetchRemoteModelList('openai'));
      expect(t).toHaveBeenCalledWith('providerModels.list.fetcher.duplicatesRemovedWithMore', {
        count: 5,
        ids: 'one, two, three',
        ns: 'modelProvider',
        remainingCount: 1,
      });
      expect(toast.warning).toHaveBeenCalledOnce();
    });

    it('propagates failures without refreshing or claiming success', async () => {
      const { result } = renderHook(() => useStore());
      const refresh = vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue(undefined);
      vi.spyOn(aiModelService, 'syncProviderModels').mockRejectedValue(
        new Error('model fetch failed'),
      );
      await expect(result.current.fetchRemoteModelList('openai')).rejects.toThrow(
        'model fetch failed',
      );
      expect(refresh).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });
  });

  describe('internal_toggleAiModelLoading', () => {
    it('should add model id to loading list when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
      });

      expect(result.current.aiModelLoadingIds).toContain('model-1');
    });

    it('should remove model id from loading list when loading is false', () => {
      act(() => {
        useStore.setState({ aiModelLoadingIds: ['model-1', 'model-2'] });
      });

      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).not.toContain('model-1');
      expect(result.current.aiModelLoadingIds).toContain('model-2');
    });

    it('should handle multiple loading states', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
        result.current.internal_toggleAiModelLoading('model-2', true);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-1', 'model-2']);

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-2']);
    });
  });

  describe('refreshAiModelList', () => {
    it('revalidates the aiModelList replica and triggers runtime state refresh', async () => {
      const { result } = renderHook(() => useStore());
      const refreshRuntimeSpy = vi
        .spyOn(result.current, 'refreshAiProviderRuntimeState')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.refreshAiModelList();
      });

      // `revalidate()` goes through the app's scoped `mutate` with a predicate
      // that matches this replica's sync keys (all entries of the active scope).
      expect(mutate).toHaveBeenCalled();
      const match = vi.mocked(mutate).mock.calls.at(-1)![0] as (key: unknown) => boolean;
      expect(typeof match).toBe('function');

      const activeScope = aiModelListResource.scope.get();
      expect(
        match([
          'replica:sync',
          aiModelListResource.name,
          aiModelListResource.version,
          activeScope,
          'test-provider',
          'test-provider',
        ]),
      ).toBe(true);
      // A key from another resource / scope is not swept in.
      expect(match(['replica:sync', 'aiProviderList', 1, activeScope, 'openai', 'openai'])).toBe(
        false,
      );

      expect(refreshRuntimeSpy).toHaveBeenCalled();
    });
  });

  describe('removeAiModel', () => {
    it('should delete model and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'deleteAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.removeAiModel('model-1', 'test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith({ id: 'model-1', providerId: 'test-provider' });
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toggleModelEnabled', () => {
    it('should toggle model enabled state with loading indicators', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      expect(serviceSpy).toHaveBeenCalledWith({
        enabled: true,
        id: 'model-1',
        providerId: 'test-provider',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', false);
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should handle service errors and throw without clearing loading state', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue(undefined);
      vi.spyOn(aiModelService, 'toggleModelEnabled').mockRejectedValue(new Error('Service error'));

      await expect(async () => {
        await act(async () => {
          await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
        });
      }).rejects.toThrow('Service error');

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      // Loading state is not cleared when error occurs since there's no try-finally
      expect(toggleLoadingSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateAiModelsConfig', () => {
    it('should update model config and refresh list', async () => {
      const updateData = {
        displayName: 'Updated Model',
        enabled: true,
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateAiModelsConfig('model-1', 'test-provider', updateData);
      });

      expect(serviceSpy).toHaveBeenCalledWith('model-1', 'test-provider', updateData);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('updateAiModelsSort', () => {
    it('should update model sort order and refresh list', async () => {
      const sortMap = [
        { id: 'model-1', sort: 1 },
        { id: 'model-2', sort: 2 },
      ];

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModelOrder')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAiModelsSort('test-provider', sortMap);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', sortMap);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('useFetchAiProviderModels', () => {
    it('paints the persisted list before the network answers', async () => {
      await aiModelListResource.storage!.set(
        { queryKey: LIST_STORAGE_KEY, scope },
        { data: [model('db-1', 'Cached')], updatedAt: 1 },
      );
      vi.spyOn(aiModelService, 'getAiProviderModelList').mockImplementation(pending);

      const sync = renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), {
        wrapper,
      });

      await waitFor(() =>
        expect(useStore.getState().aiModelListMap['test-provider']?.[0]?.displayName).toBe(
          'Cached',
        ),
      );

      expect(sync.result.current.isHydrated).toBe(true);
      expect(sync.result.current.isValidating).toBe(true);
    });

    it('replaces the replica with the server response and persists it', async () => {
      const serverModels = [model('srv-1', 'Server')];
      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(serverModels);

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), { wrapper });

      await waitFor(() =>
        expect(useStore.getState().aiModelListMap['test-provider']?.[0]?.displayName).toBe(
          'Server',
        ),
      );
      expect(aiModelService.getAiProviderModelList).toHaveBeenCalledWith('test-provider');

      // The confirmed value is persisted, so a later visit hydrates it.
      await waitFor(async () =>
        expect(
          (await aiModelListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope }))?.data,
        ).toEqual(serverModels),
      );
    });

    it('reports isLoading until the provider list lands, then exposes data', async () => {
      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue([
        model('srv-1', 'Server'),
      ]);

      const sync = renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), {
        wrapper,
      });

      await waitFor(() => expect(sync.result.current.data?.[0]?.id).toBe('srv-1'));
      expect(sync.result.current.isLoading).toBe(false);
    });

    it('keeps each provider in its own replica entry', async () => {
      vi.spyOn(aiModelService, 'getAiProviderModelList').mockImplementation(async (id: string) => [
        model(`${id}-model`, id),
      ]);

      renderHook(() => useStore.getState().useFetchAiProviderModels('provider-a'), { wrapper });
      renderHook(() => useStore.getState().useFetchAiProviderModels('provider-b'), { wrapper });

      await waitFor(() =>
        expect(useStore.getState().aiModelListMap['provider-b']?.[0]?.id).toBe('provider-b-model'),
      );
      expect(useStore.getState().aiModelListMap['provider-a']?.[0]?.id).toBe('provider-a-model');
    });
  });
});
