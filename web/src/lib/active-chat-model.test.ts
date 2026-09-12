import { describe, expect, it } from 'vitest';
import type { ProviderStatusDTO } from '@pop-agent/shared';
import { activeChatModel } from './active-chat-model';

function provider(
  id: string,
  order: number,
  patch: Partial<ProviderStatusDTO> = {},
): ProviderStatusDTO {
  return {
    id,
    name: id,
    authType: 'api-key',
    configured: true,
    source: 'settings',
    defaultModel: `${id}-default`,
    serviceModel: `${id}-default`,
    allowCustomModel: false,
    order,
    enabled: true,
    ...patch,
  };
}

describe('activeChatModel', () => {
  it('reports a usable chat override', () => {
    expect(
      activeChatModel(
        { provider: 'second', model: 'chosen-model' },
        [provider('first', 1), provider('second', 2)],
      ),
    ).toEqual({ currentProvider: 'second', currentModel: 'chosen-model' });
  });

  it('resolves a default chat to the first usable provider', () => {
    expect(
      activeChatModel(
        { provider: '', model: '' },
        [provider('disabled', 1, { enabled: false }), provider('active', 2)],
      ),
    ).toEqual({ currentProvider: 'active', currentModel: 'active-default' });
  });

  it('falls back when the chat override is not usable', () => {
    expect(
      activeChatModel(
        { provider: 'offline', model: 'offline-model' },
        [provider('offline', 1, { configured: false }), provider('active', 2)],
      ),
    ).toEqual({ currentProvider: 'active', currentModel: 'active-default' });
  });
});
