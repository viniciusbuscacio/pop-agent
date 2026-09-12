import type { ChatDTO, ProviderStatusDTO } from '@pop-agent/shared';

export interface ActiveChatModel {
  currentProvider: string;
  currentModel: string;
}

/**
 * Resolve the pair a chat currently selects from the provider status already
 * loaded by the chat page. A usable chat override wins; otherwise the first
 * enabled, configured provider in the priority list does, matching the server's
 * normal (non-failover) resolution rule.
 */
export function activeChatModel(
  chat: Pick<ChatDTO, 'provider' | 'model'> | undefined,
  providers: ProviderStatusDTO[],
): ActiveChatModel | undefined {
  const ordered = [...providers].sort((left, right) => left.order - right.order);
  const usable = (provider: ProviderStatusDTO): boolean => provider.enabled && provider.configured;
  const override =
    chat?.provider === undefined || chat.provider.length === 0
      ? undefined
      : ordered.find((provider) => provider.id === chat.provider && usable(provider));
  const selected = override ?? ordered.find(usable) ?? ordered[0];
  if (selected === undefined) return undefined;

  return {
    currentProvider: selected.id,
    currentModel:
      override !== undefined && chat !== undefined && chat.model.length > 0
        ? chat.model
        : selected.defaultModel,
  };
}
