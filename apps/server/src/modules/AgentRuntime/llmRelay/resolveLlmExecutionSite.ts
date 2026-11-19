import type { AgentState } from '@lobechat/agent-runtime';

import type { LobeChatDatabase } from '@/database/type';

import type { ClientLlmUnavailableReason } from './errors';

export type LlmExecutionSite =
  | { site: 'server' }
  | {
      /** Channel to dispatch on when the executor listens on another run's; see `AgentRunLlmExecutor`. */
      channelOperationId?: string;
      preferredClientId: string;
      runtimeProvider: string;
      site: 'client';
    }
  | { reason: ClientLlmUnavailableReason; site: 'unavailable' };

export interface ResolveLlmExecutionSiteParams {
  db: LobeChatDatabase;
  provider: string;
  state?: Pick<AgentState, 'host' | 'principal'>;
  userId: string;
  workspaceId?: string;
}

const SERVER: LlmExecutionSite = { site: 'server' };

export interface ResolveProviderRelayParams {
  db: LobeChatDatabase;
  provider: string;
  userId: string;
  workspaceId?: string;
}

/** This fork does not resolve providers through the requesting device. */
export const resolveProviderRelay = async (
  _params: ResolveProviderRelayParams,
): Promise<{ runtimeProvider: string } | undefined> => undefined;

export const resolveLlmExecutionSite = async (
  _params: ResolveLlmExecutionSiteParams,
): Promise<LlmExecutionSite> => SERVER;
