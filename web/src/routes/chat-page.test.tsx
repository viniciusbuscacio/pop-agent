// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  Composer: ({ onSend }: { onSend: (text: string, attachments: []) => Promise<void> }) => (
    <button type="button" data-testid="composer" onClick={() => void onSend('New message', [])}>
      Send
    </button>
  ),
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

  it.each([
    ['aborted', 'You stopped this answer.'],
    ['interrupted', 'This answer was interrupted — the server may have restarted.'],
  ])('shows a persisted %s notice only once', async (failure, content) => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    useChatStore.setState({
      messages: {
        [chat.id]: [
          {
            id: `message-${failure}`,
            chatId: chat.id,
            role: 'system',
            content,
            thinking: '',
            tools: [],
            attachments: [],
            createdAt: new Date().toISOString(),
          },
        ],
      },
      failures: { [chat.id]: failure },
    });

    await waitFor(() => expect(screen.getAllByText(content)).toHaveLength(1));
    expect(screen.queryByTestId('run-error')).toBeNull();
  });

  it('keeps the separate alert for other run failures', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    useChatStore.setState({ failures: { [chat.id]: 'provider_error' } });

    expect((await screen.findByTestId('run-error')).textContent).toBe(
      'That answer could not be finished.',
    );
  });

  it('returns to the bottom when the reader sends a new message', async () => {
    const send = vi.fn(async () => undefined);
    useChatStore.setState({ send });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    const scroller = screen.getByTestId('chat-scroller');
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1_000, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollTop: { value: 500, writable: true, configurable: true },
    });

    fireEvent.touchStart(scroller, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(scroller, { touches: [{ clientY: 110 }] });
    useChatStore.setState({
      live: {
        [chat.id]: {
          runId: 'run-1',
          status: 'running',
          seq: 1,
          content: 'Streaming chunk',
          thinking: '',
          tools: [],
        },
      },
    });
    await waitFor(() => expect(screen.getByTestId('jump-to-latest')).toBeTruthy());

    scroller.scrollTop = 200;
    fireEvent.click(screen.getByTestId('composer'));

    expect(scroller.scrollTop).toBe(1_000);
    await waitFor(() => expect(screen.queryByTestId('jump-to-latest')).toBeNull());
    expect(send).toHaveBeenCalledWith(chat.id, 'New message', [], undefined, undefined);
  });

  it('stops following as soon as an iOS reading gesture starts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    const scroller = screen.getByTestId('chat-scroller');
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1_000, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollTop: { value: 500, writable: true, configurable: true },
    });

    expect(scroller.style.touchAction).toBe('pan-y');
    fireEvent.touchStart(scroller, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(scroller, { touches: [{ clientY: 110 }] });
    expect(screen.queryByTestId('jump-to-latest')).toBeNull();

    useChatStore.setState({
      live: {
        [chat.id]: {
          runId: 'run-1',
          status: 'running',
          seq: 1,
          content: 'Streaming chunk',
          thinking: '',
          tools: [],
        },
      },
    });

    await waitFor(() => expect(screen.getByTestId('jump-to-latest')).toBeTruthy());
    expect(scroller.scrollTop).toBe(500);
  });

  it('keeps the run status outside the transcript immediately above the composer', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    useChatStore.setState({
      live: {
        [chat.id]: {
          runId: 'run-1',
          status: 'running',
          seq: 2,
          content: 'Partial answer',
          thinking: '',
          tools: [{ name: 'read', status: 'done', detail: 'file.ts' }],
        },
      },
    });

    const status = await screen.findByTestId('run-status-line');
    const composer = screen.getByTestId('composer');
    expect(status.textContent).toContain('Working…');
    expect(screen.getByTestId('chat-scroller').contains(status)).toBe(false);
    expect(status.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
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
      pending: {
        [chat.id]: [
          {
            id: 'steer-1',
            chatId: chat.id,
            text: 'Change course',
            deliveryMode: 'steer',
            attachments: [],
            filePaths: [],
            createdAt: '',
            updatedAt: '',
          },
          {
            id: 'steer-2',
            chatId: chat.id,
            text: 'Then summarize',
            deliveryMode: 'steer',
            attachments: [],
            filePaths: [],
            createdAt: '',
            updatedAt: '',
          },
        ],
      },
    });

    await waitFor(() => expect(screen.getAllByTestId('chat-message')).toHaveLength(3));
    expect(screen.getByTestId('message-sending').textContent).toContain('Sending:');
    expect(screen.getByTestId('message-waiting').textContent).toContain('Waiting:');
    expect(screen.getAllByTestId('chat-message').map((message) => message.textContent)).toEqual([
      'Answer in progress',
      'Change course',
      'Then summarize',
    ]);
  });
});
