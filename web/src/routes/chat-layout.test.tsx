// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
