// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDTO, MessageDTO } from '@pop-agent/shared';
import { ChatPage } from './chat-page';
import { useChatStore } from '../store/chat';

vi.mock('../services/chats', () => ({
  chatsService: {
    messages: () => Promise.resolve({ messages: [] }),
    recentModels: () => Promise.resolve({ models: [] }),
  },
}));

vi.mock('../services/providers', () => ({
  providersService: {
    list: () => Promise.resolve({ providers: [] }),
  },
}));

vi.mock('../services/events', () => ({
  eventStream: {
    onResume: () => () => undefined,
  },
}));

vi.mock('../ui/composer', () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock('../ui/chat-message', () => ({
  ChatMessage: ({ message }: { message: MessageDTO }) => (
    <div data-testid="chat-message">{message.content}</div>
  ),
}));

const chat: ChatDTO = {
  id: 'chat-empty',
  title: 'New chat',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  createdAt: '',
  updatedAt: '',
  preview: '',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/chat/${chat.id}`]}>
      <Routes>
        <Route path="/chat/:chatId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  useChatStore.setState({ chats: [chat] });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('empty chat icon', () => {
  it('appears after an empty chat loads and disappears with the first message', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());
    expect(screen.getByTestId('empty-chat-icon').querySelector('img')?.getAttribute('src')).toBe(
      '/icon.svg',
    );

    useChatStore.setState((state) => ({
      messages: {
        ...state.messages,
        [chat.id]: [
          {
            id: 'message-1',
            chatId: chat.id,
            role: 'user',
            content: 'Hello',
            thinking: '',
            tools: [],
            attachments: [],
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }));

    await waitFor(() => expect(screen.queryByTestId('empty-chat-icon')).toBeNull());
    expect(screen.getByTestId('chat-message').textContent).toBe('Hello');
  });
});
