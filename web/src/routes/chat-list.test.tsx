// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2aAgentDTO, ChatDTO, McpServerDTO } from '@pop-agent/shared';
import { ChatList } from './chat-list';
import { useA2aStore } from '../store/a2a';
import { useChatStore } from '../store/chat';
import { useMcpStore } from '../store/mcp';

const archiveOthers = vi.fn();
const deleteOthers = vi.fn();
const patch = vi.fn();
const active: ChatDTO[] = [
  {
    id: 'chat-keep',
    title: 'Keep this chat',
    model: '',
    provider: '',
    archived: false,
    pinned: false,
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
    pinned: false,
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
    deleteOthers: (keepChatId: string) => deleteOthers(keepChatId) as Promise<unknown>,
    patch: (chatId: string, body: { archived?: boolean; pinned?: boolean }) =>
      patch(chatId, body) as Promise<unknown>,
    messages: () => Promise.resolve({ messages: [] }),
  },
}));

vi.mock('../services/a2a', () => ({
  a2aService: {
    list: () => Promise.resolve({ agents: useA2aStore.getState().agents ?? [] }),
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderList(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatList />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  useA2aStore.setState({ agents: undefined, tasksByAgent: {} });
  useMcpStore.setState({ servers: undefined, error: undefined });
  localStorage.clear();
  activeList = active.map((chat) => ({ ...chat }));
  archivedList = [];
  archiveOthers.mockReset();
  deleteOthers.mockReset();
  patch.mockReset();
  patch.mockImplementation(
    (chatId: string, body: { archived?: boolean; pinned?: boolean }) => {
      const current = [...activeList, ...archivedList].find((chat) => chat.id === chatId);
      if (current === undefined) return Promise.resolve(undefined);
      const updated = { ...current, ...body };
      if (body.archived === true) {
        activeList = activeList.filter((chat) => chat.id !== chatId);
        archivedList = [updated, ...archivedList.filter((chat) => chat.id !== chatId)];
      } else if (body.archived === false) {
        archivedList = archivedList.filter((chat) => chat.id !== chatId);
        activeList = [updated, ...activeList.filter((chat) => chat.id !== chatId)];
      } else {
        activeList = activeList
          .map((chat) => (chat.id === chatId ? updated : chat))
          .sort((left, right) => Number(right.pinned) - Number(left.pinned));
      }
      return Promise.resolve(updated);
    },
  );
  archiveOthers.mockImplementation((keepChatId: string) => {
    const filed = activeList.filter((chat) => chat.id !== keepChatId && !chat.pinned);
    activeList = activeList.filter((chat) => chat.id === keepChatId || chat.pinned);
    archivedList = filed.map((chat) => ({ ...chat, archived: true }));
    return Promise.resolve({ archived: filed.length });
  });
  deleteOthers.mockImplementation((keepChatId: string) => {
    const deleted = activeList.filter((chat) => chat.id !== keepChatId && !chat.pinned);
    activeList = activeList.filter((chat) => chat.id === keepChatId || chat.pinned);
    return Promise.resolve({ deleted: deleted.length });
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('A2A explorer controls', () => {
  it('shows its list, search and new-agent action in the shared sidebar', async () => {
    const remote: A2aAgentDTO = {
      id: 'agent-1',
      name: 'Research agent',
      description: 'Finds sources',
      baseUrl: 'https://agent.example',
      agentCardPath: '.well-known/agent-card.json',
      authKind: 'none',
      authHeader: '',
      entraTenantId: '',
      entraClientId: '',
      entraScope: '',
      hasCredential: false,
      enabled: true,
      timeoutMs: 60000,
      status: 'connected',
      lastError: '',
      protocolVersion: '0.3.0',
      agentVersion: '1.0.0',
      interfaces: [],
      skills: [],
      createdAt: '',
      updatedAt: '',
    };
    useA2aStore.setState({ agents: [remote] });
    renderList('/a2a');

    expect(screen.getByTestId('shell-new-a2a').textContent).toBe('New A2A agent');
    expect(screen.getByTestId('list-filter').getAttribute('placeholder')).toBe('Search A2A agents');
    expect(screen.getByText('Research agent')).toBeTruthy();
    await userEvent.type(screen.getByTestId('list-filter'), 'missing');
    expect(screen.queryByText('Research agent')).toBeNull();

    await userEvent.click(screen.getByTestId('shell-new-a2a'));
    expect(screen.getByTestId('location').textContent).toBe('/a2a/new');
  });
});

describe('MCP explorer controls', () => {
  it('shows disabled instead of the stale connection result in the sidebar', () => {
    const disabledServer: McpServerDTO = {
      id: 'mcp-learn',
      name: 'Microsoft Learn',
      description: '',
      transport: 'streamable-http',
      endpoint: 'https://learn.microsoft.com/api/mcp',
      command: '',
      args: [],
      authKind: 'none',
      authHeader: '',
      hasCredential: false,
      enabled: false,
      timeoutMs: 60000,
      status: 'connected',
      lastError: '',
      capabilities: [],
    };
    useMcpStore.setState({ servers: [disabledServer], error: undefined });

    renderList('/mcp');

    expect(screen.getByText('Microsoft Learn')).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();
    expect(screen.queryByText('connected')).toBeNull();
  });
});

describe('archive one chat', () => {
  it('clears the detail route after archiving the open chat', async () => {
    renderList('/chat/chat-other');
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId('chat-menu')[1]!);
    await userEvent.click(screen.getByTestId('chat-archive'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('chat-other', { archived: true }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(screen.queryByText('File this chat')).toBeNull();
  });
});

describe('compact conversation search', () => {
  it('keeps search and menu on the same rem-based square at every font scale', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    const searchClass = screen.getByTestId('chat-search-toggle').className;
    const menuClass = screen.getByTestId('list-menu').className;
    expect(searchClass).toContain('h-[2.375rem]');
    expect(searchClass).toContain('w-[2.375rem]');
    expect(menuClass).toContain('h-[2.375rem]');
    expect(menuClass).toContain('w-[2.375rem]');
  });

  it('keeps the field hidden until the search button opens and focuses it', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    const toggle = screen.getByTestId('chat-search-toggle');
    expect(screen.queryByTestId('chat-filter')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(toggle);

    const input = screen.getByTestId('chat-filter');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(input.className).not.toContain('focus:border-[var(--accent)]');
  });

  it('clears the filter when the search button closes the field', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    const toggle = screen.getByTestId('chat-search-toggle');
    await userEvent.click(toggle);
    await userEvent.type(screen.getByTestId('chat-filter'), 'File');
    expect(screen.getAllByTestId('chat-row')).toHaveLength(1);
    expect(screen.getByText('File this chat')).toBeTruthy();

    await userEvent.click(toggle);

    expect(screen.queryByTestId('chat-filter')).toBeNull();
    expect(screen.getAllByTestId('chat-row')).toHaveLength(2);
  });

  it('closes and clears the search with Escape', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('chat-search-toggle'));
    const input = screen.getByTestId('chat-filter');
    await userEvent.type(input, 'File');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('chat-filter')).toBeNull();
    expect(screen.getAllByTestId('chat-row')).toHaveLength(2);
  });
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

  it('changes to except active and pinned, and leaves the pinned chat open', async () => {
    localStorage.setItem('pop-agent.lastChat', 'chat-keep');
    activeList[1] = { ...activeList[1]!, pinned: true };
    activeList.push({ ...active[1]!, id: 'chat-disposable', title: 'Disposable', pinned: false });
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(3));

    await userEvent.click(screen.getByTestId('list-menu'));
    const action = screen.getByTestId('list-archive-others');
    expect(action.textContent).toBe('Archive all except active and pinned (1)');
    await userEvent.click(action);

    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));
    expect(screen.getByText('File this chat')).toBeTruthy();
  });

  it('stays disabled when there is no reliable chat to preserve', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('list-menu'));

    expect(screen.getByTestId('list-archive-others')).toHaveProperty('disabled', true);
    expect(archiveOthers).not.toHaveBeenCalled();
  });
});

describe('delete all other chats', () => {
  it('shows a confirmation dialog and permanently deletes only unpinned inactive chats', async () => {
    localStorage.setItem('pop-agent.lastChat', 'chat-keep');
    activeList[1] = { ...activeList[1]!, pinned: true };
    activeList.push({ ...active[1]!, id: 'chat-disposable', title: 'Disposable', pinned: false });
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(3));

    await userEvent.click(screen.getByTestId('list-menu'));
    const action = screen.getByTestId('list-delete-others');
    expect(action.textContent).toBe('Delete all except active and pinned (1)');
    await userEvent.click(action);

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Conversations to delete permanently: 1.');
    expect(deleteOthers).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('confirm-delete-others'));

    await waitFor(() => expect(deleteOthers).toHaveBeenCalledWith('chat-keep'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByTestId('chat-row')).toHaveLength(2);
    expect(screen.getByText('File this chat')).toBeTruthy();
    expect(screen.queryByText('Disposable')).toBeNull();
  });
});

describe('pinned chats', () => {
  it('shows no icon when unpinned and a neutral hollow pin when pinned', async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByTestId('chat-row')).toHaveLength(2));

    expect(screen.queryByTestId('chat-pin')).toBeNull();
    await userEvent.click(screen.getAllByTestId('chat-menu')[1]!);
    await userEvent.click(screen.getByTestId('chat-pin-menu'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('chat-other', { pinned: true }));
    await waitFor(() => expect(screen.getAllByTestId('chat-row')[0]?.textContent).toContain('File this chat'));
    const pinButton = screen.getByTestId('chat-pin');
    expect(pinButton.getAttribute('aria-label')).toBe('Unpin this chat');
    expect(pinButton.getAttribute('aria-pressed')).toBe('true');
    expect(pinButton.className).toContain('text-[var(--muted)]');
    expect(pinButton.querySelector('svg')?.getAttribute('fill')).toBe('none');
  });
});

it.each([true, false])('offers background actions below chats, populated=%s', async populated => {
  if (!populated) activeList = [];
  renderList();
  await waitFor(() => expect(useChatStore.getState().chats).toHaveLength(populated ? 2 : 0));
  const background = screen.getByTestId('chat-list-background');
  expect(fireEvent.contextMenu(background, { clientX: 140, clientY: 600 })).toBe(false);
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['New chat', 'Refresh']);
  fireEvent.click(screen.getByTestId('context-refresh'));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByTestId('location').textContent).toBe('/');
});
