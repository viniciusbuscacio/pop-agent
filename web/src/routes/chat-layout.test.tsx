// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { ChatLayout, NoChatSelected } from './chat-layout';
import { useChatStore } from '../store/chat';

const listeners = new Set<(event: StreamEvent) => void>();

vi.mock('../services/events', () => ({
  eventStream: {
    subscribe: (listener: (event: StreamEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('./chat-list', () => ({ ChatList: () => <div>Chat list</div> }));

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

beforeEach(() => {
  listeners.clear();
  useChatStore.getState().reset();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('no chat selected', () => {
  it('shows the Pop bubble above the empty-state copy', () => {
    render(<NoChatSelected />);

    const title = screen.getByRole('heading', { name: 'Pick up where you left off' });
    const mark = title.previousElementSibling;

    expect(mark?.tagName).toBe('svg');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.classList.contains('h-24')).toBe(true);
    expect(screen.getByText('Choose a conversation on the left, or start a new one.')).toBeTruthy();
  });
});

describe('deleted open conversations', () => {
  it('replaces the invalid chat route with the list', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/chat-open']}>
        <Routes>
          <Route element={<ChatLayout />}>
            <Route path="chat/:chatId" element={<Location />} />
            <Route index element={<Location />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location').textContent).toBe('/chat/chat-open');
    await waitFor(() =>
      expect(sessionStorage.getItem('pop-agent.lastActiveChat')).toBe('/chat/chat-open'),
    );
    for (const listener of listeners) {
      listener({ kind: 'chat-deleted', chatId: 'chat-open' });
    }

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(sessionStorage.getItem('pop-agent.lastActiveChat')).toBeNull();
  });
});

vi.mock('./shell-header', () => ({ ShellFooter: () => <div>Settings footer</div> }));
it('opens the A2A module pane on mobile while retaining Settings navigation', () => {
  render(<MemoryRouter initialEntries={['/a2a']}><Routes><Route element={<ChatLayout />}><Route path="a2a" element={<div>A2A module</div>} /></Route></Routes></MemoryRouter>);
  const main = screen.getByRole('main');
  expect(main.classList.contains('hidden')).toBe(false);
  expect(main.classList.contains('flex')).toBe(true);
  expect(screen.getByText('Settings footer')).toBeTruthy();
});


function renderOpenChat() {
  return render(<MemoryRouter initialEntries={['/chat/chat-open']}><Routes>
    <Route element={<ChatLayout />}><Route path="chat/:chatId" element={<Location />} /><Route index element={<Location />} /></Route>
  </Routes></MemoryRouter>);
}
it('closes the selected pane when an archive event arrives from another client', async () => {
  renderOpenChat();
  act(() => { for (const listener of listeners) listener({ kind: 'chat-archived-changed', chatId: 'chat-open', archived: true }); });
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  expect(sessionStorage.getItem('pop-agent.lastActiveChat')).toBeNull();
});
it('closes an archived selection on list reconciliation without an SSE event', async () => {
  const chat = { id: 'chat-open', title: 'Open', archived: false, pinned: false, model: '', provider: '', createdAt: '', updatedAt: '', preview: '' };
  useChatStore.setState({ chats: [chat], archived: [] });
  renderOpenChat();
  act(() => useChatStore.setState({ chats: [], archived: [{ ...chat, archived: true }] }));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  expect(sessionStorage.getItem('pop-agent.lastActiveChat')).toBeNull();
});
it('allows explicitly viewing an archived chat and ignores other chat archive events', () => {
  useChatStore.setState({ archived: [{ id: 'chat-open', title: 'Archived', archived: true, pinned: false, model: '', provider: '', createdAt: '', updatedAt: '', preview: '' }] });
  renderOpenChat();
  act(() => { for (const listener of listeners) listener({ kind: 'chat-archived-changed', chatId: 'chat-other', archived: true }); });
  expect(screen.getByTestId('location').textContent).toBe('/chat/chat-open');
});
