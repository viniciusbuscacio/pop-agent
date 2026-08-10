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

describe('chat transcript', () => {
  it('appears after an empty chat loads and disappears with the first message', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());
    const emptyIcon = screen.getByTestId('empty-chat-icon');
    expect(emptyIcon.querySelector('svg')).toBeTruthy();
    expect(emptyIcon.querySelector('rect')).toBeNull();

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

  it('shows pending steering as an ordinary user message after the live answer', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    useChatStore.setState({
      live: {
        [chat.id]: {
          runId: 'run-1',
          status: 'running',
          seq: 1,
          content: 'Answer in progress',
          thinking: '',
          tools: [],
        },
      },
      queued: {
        [chat.id]: {
          id: 'steer-1',
          chatId: chat.id,
          text: 'Change course',
          deliveryMode: 'steer',
          attachments: [],
          filePaths: [],
          createdAt: '',
          updatedAt: '',
        },
      },
    });

    await waitFor(() => expect(screen.getAllByTestId('chat-message')).toHaveLength(2));
    expect(screen.getByTestId('message-sending').textContent).toContain('Sending:');
    expect(screen.getAllByTestId('chat-message').map((message) => message.textContent)).toEqual([
      'Answer in progress',
      'Change course',
    ]);
  });
});
