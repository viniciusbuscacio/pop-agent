// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDTO } from '@pop-agent/shared';
import { ChatList } from './chat-list';
import { useChatStore } from '../store/chat';

const archiveOthers = vi.fn();
const active: ChatDTO[] = [
  {
    id: 'chat-keep',
    title: 'Keep this chat',
    model: '',
    provider: '',
    archived: false,
    createdAt: '',
    updatedAt: '',
    preview: '',
  },
  {
    id: 'chat-other',
    title: 'File this chat',
    model: '',
    provider: '',
    archived: false,
    createdAt: '',
    updatedAt: '',
    preview: '',
  },
];
let activeList: ChatDTO[];
let archivedList: ChatDTO[];

vi.mock('../services/chats', () => ({
  chatsService: {
    list: (archived = false) =>
      Promise.resolve({ chats: archived ? archivedList : activeList }),
    archiveOthers: (keepChatId: string) => archiveOthers(keepChatId) as Promise<unknown>,
    messages: () => Promise.resolve({ messages: [] }),
  },
}));

vi.mock('../services/health', () => {
  const healthy = { kind: 'ok' as const };
  return {
    healthMonitor: {
      subscribe: () => () => undefined,
      getState: () => healthy,
    },
  };
});

function renderList(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  localStorage.clear();
  activeList = active.map((chat) => ({ ...chat }));
  archivedList = [];
  archiveOthers.mockReset();
  archiveOthers.mockImplementation((keepChatId: string) => {
    const filed = activeList.filter((chat) => chat.id !== keepChatId);
    activeList = activeList.filter((chat) => chat.id === keepChatId);
    archivedList = filed.map((chat) => ({ ...chat, archived: true }));
    return Promise.resolve({ archived: filed.length });
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('archive all other chats', () => {
  it('uses the last open chat when the mobile list has no chat id in its route', async () => {
    localStorage.setItem('pop-agent.lastChat', 'chat-keep');
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('list-menu'));
    const action = screen.getByTestId('list-archive-others');
    expect(action.textContent).toBe('Archive all other chats (1)');
    await userEvent.click(action);

    await waitFor(() => expect(archiveOthers).toHaveBeenCalledWith('chat-keep'));
    expect(window.confirm).toHaveBeenCalledWith(
      'Archive all other chats (1)? “Keep this chat” will remain open.',
    );
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(1));
  });

  it('stays disabled when there is no reliable chat to preserve', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('list-menu'));

    expect(screen.getByTestId('list-archive-others')).toHaveProperty('disabled', true);
    expect(archiveOthers).not.toHaveBeenCalled();
  });
});
