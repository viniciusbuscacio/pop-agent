// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDTO, MessageDTO } from '@pop-agent/shared';
import { ChatPage } from './chat-page';
import { useChatStore } from '../store/chat';
import { syncQueue } from '../services/sync-queue';

vi.mock('../services/api', () => ({
  apiRequest: vi.fn(async (path: string) => {
    if (path === '/sync') return { epoch: 'chat-page-test', revisions: {} };
    throw new Error(`Unexpected request: ${path}`);
  }),
}));

const listMessages = vi.hoisted(() => vi.fn());
const listModels = vi.hoisted(() => vi.fn());
const listProviders = vi.hoisted(() => vi.fn());
const runSessionCommand = vi.hoisted(() => vi.fn());

vi.mock('../services/chats', () => ({
  chatsService: {
    messages: (...args: unknown[]) => listMessages(...args) as Promise<unknown>,
    recentModels: () => Promise.resolve({ models: [] }),
    models: (provider: string) => listModels(provider) as Promise<unknown>,
    command: (...args: unknown[]) => runSessionCommand(...args) as Promise<unknown>,
  },
}));

vi.mock('../services/providers', () => ({
  providersService: {
    list: () => listProviders() as Promise<unknown>,
  },
}));

vi.mock('../services/events', () => ({
  eventStream: {
    onResume: () => () => undefined,
  },
}));

vi.mock('../ui/composer', () => ({
  Composer: ({
    onSend,
    onShowSystemMessage,
    onCommand,
    locked,
  }: {
    onSend: (text: string, attachments: []) => Promise<void>;
    onShowSystemMessage: (message: string) => void;
    onCommand: (command: 'compact', argument: string) => Promise<void>;
    locked?: boolean;
  }) => (
    <>
      <output data-testid="composer-locked">{locked ? 'locked' : 'unlocked'}</output>
      <button type="button" data-testid="composer" onClick={() => void onSend('New message', [])}>
        Send
      </button>
      <button
        type="button"
        data-testid="composer-system-message"
        onClick={() => onShowSystemMessage('Provider: openai-codex · Model: gpt-5.6-sol')}
      >
        Show model
      </button>
      <button
        type="button"
        data-testid="composer-compact"
        onClick={() => void onCommand('compact', '')}
      >
        Compact
      </button>
    </>
  ),
}));

const chatMessageRender = vi.hoisted(() => vi.fn());
vi.mock('../ui/chat-message', () => ({
  ChatMessage: ({ message }: { message: MessageDTO }) => {
    chatMessageRender(message);
    return <div data-testid="chat-message">{message.content}</div>;
  },
}));

const realOpenChat = useChatStore.getState().openChat;

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
  chatMessageRender.mockClear();
  listMessages.mockReset();
  listMessages.mockResolvedValue({ messages: [] });
  listModels.mockReset();
  listModels.mockResolvedValue({ models: [] });
  listProviders.mockReset();
  listProviders.mockResolvedValue({ providers: [] });
  runSessionCommand.mockReset();
  runSessionCommand.mockResolvedValue({ kind: 'compact', message: 'Context compacted.' });
  useChatStore.getState().reset();
  useChatStore.setState({ chats: [chat], openChat: realOpenChat });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  syncQueue.stop();
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

  it('adds local command output to the transcript as a system message', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    fireEvent.click(screen.getByTestId('composer-system-message'));

    await waitFor(() =>
      expect(screen.getByText('Provider: openai-codex · Model: gpt-5.6-sol')).toBeTruthy(),
    );
    expect(screen.queryByTestId('empty-chat-icon')).toBeNull();
    expect(chatMessageRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'system', content: expect.stringContaining('openai-codex') }),
    );
  });

  it('keeps command output between the same messages as history grows and refreshes', async () => {
    const message = (id: string): MessageDTO => ({
      id, chatId: chat.id, role: 'user', content: id, thinking: '', tools: [], attachments: [], createdAt: '',
    });
    useChatStore.setState({ openChat: vi.fn(async () => undefined), messages: { [chat.id]: [message('before')] } });
    renderPage();
    fireEvent.click(screen.getByTestId('composer-system-message'));
    const output = 'Provider: openai-codex · Model: gpt-5.6-sol';
    const contents = () => screen.getAllByTestId('chat-message').map((row) => row.textContent);
    act(() => useChatStore.setState({ messages: { [chat.id]: [message('before'), message('after')] } }));
    expect(contents()).toEqual(['before', output, 'after']);
    fireEvent.click(screen.getByTestId('composer-system-message'));
    act(() => useChatStore.setState({ messages: { [chat.id]: [message('older'), message('before'), message('after'), message('latest')] } }));
    expect(contents()).toEqual(['older', 'before', output, 'after', output, 'latest']);
  });

  it('keeps a command in an empty conversation before later streaming and settled answers', async () => {
    renderPage();
    await screen.findByTestId('empty-chat-icon');
    fireEvent.click(screen.getByTestId('composer-system-message'));
    act(() => useChatStore.setState({ live: { [chat.id]: {
      runId: 'later-run', status: 'running', seq: 1, content: 'Streaming answer', thinking: '', tools: [],
    } } }));
    expect(screen.getAllByTestId('chat-message').map((row) => row.textContent)).toEqual([
      'Provider: openai-codex · Model: gpt-5.6-sol', 'Streaming answer',
    ]);
    act(() => useChatStore.setState({ live: {}, messages: { [chat.id]: [{
      id: 'answer', chatId: chat.id, role: 'assistant', content: 'Finished answer', thinking: '', tools: [], attachments: [], createdAt: '',
    }] } }));
    expect(screen.getAllByTestId('chat-message').map((row) => row.textContent)).toEqual([
      'Provider: openai-codex · Model: gpt-5.6-sol', 'Finished answer',
    ]);
  });

  it('shows compact progress in the working slot, then puts completion in the timeline', async () => {
    let finish!: (value: { kind: 'compact'; message: string }) => void;
    runSessionCommand.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    fireEvent.click(screen.getByTestId('composer-compact'));

    const progress = await screen.findByTestId('compact-progress');
    expect(progress.textContent).toContain('Compacting context…');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
    expect(screen.getByTestId('run-status-slot').contains(progress)).toBe(true);
    expect(screen.getByTestId('composer-locked').textContent).toBe('locked');

    listMessages.mockResolvedValue({
      messages: [{
        id: 'message-compacted',
        chatId: chat.id,
        role: 'system',
        content: 'Context compacted.',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: '2026-08-17T00:00:00.000Z',
        notice: { kind: 'context-compacted' },
      }],
    });
    finish({ kind: 'compact', message: 'Context compacted.' });
    await waitFor(() => expect(screen.queryByTestId('compact-progress')).toBeNull());
    expect(screen.getByTestId('composer-locked').textContent).toBe('unlocked');
    expect(chatMessageRender).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: 'system',
        content: 'Context compacted.',
        notice: { kind: 'context-compacted' },
      }),
    );
    expect(screen.queryByTestId('empty-chat-icon')).toBeNull();
  });

  it('does not revisit settled rows when only the live answer grows', async () => {
    const settled: MessageDTO = {
      id: 'message-settled',
      chatId: chat.id,
      role: 'assistant',
      content: 'Historical Markdown',
      thinking: '',
      tools: [],
      attachments: [],
      createdAt: '',
    };
    useChatStore.setState({
      openChat: vi.fn(async () => undefined),
      messages: { [chat.id]: [settled] },
      live: {
        [chat.id]: {
          runId: 'run-1',
          status: 'running',
          seq: 1,
          content: 'First fragment',
          thinking: '',
          tools: [],
        },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('chat-message')).toHaveLength(2));
    chatMessageRender.mockClear();

    useChatStore.setState((state) => ({
      live: {
        ...state.live,
        [chat.id]: { ...state.live[chat.id]!, seq: 2, content: 'First fragment, then another' },
      },
    }));

    await waitFor(() => expect(screen.getAllByTestId('chat-message')[1]?.textContent).toContain('another'));
    expect(chatMessageRender).toHaveBeenCalledTimes(1);
    expect(chatMessageRender).toHaveBeenCalledWith(expect.objectContaining({ content: 'First fragment, then another' }));
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

    // Adding the run-status line outside the transcript reduces the scroller's
    // height. Safari may report that layout adjustment as a smaller scrollTop;
    // it is not reader intent and must not suspend following.
    scroller.scrollTop = 960;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId('jump-to-latest')).toBeNull();

    useChatStore.setState((state) => ({
      live: {
        ...state.live,
        [chat.id]: { ...state.live[chat.id]!, content: 'A longer streaming chunk' },
      },
    }));
    await waitFor(() => expect(scroller.scrollTop).toBe(1_000));
    expect(send).toHaveBeenCalledWith(chat.id, 'New message', [], undefined, undefined, undefined);
  });

  it('contains horizontal overflow without changing native vertical touch scrolling', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    const scroller = screen.getByTestId('chat-scroller');
    expect(scroller.parentElement?.className).toContain('min-w-0');
    expect(scroller.parentElement?.className).toContain('overflow-x-hidden');
    expect(scroller.className).toContain('overflow-x-hidden');
    expect(scroller.className).toContain('overflow-y-auto');
    const transcript = screen.getByTestId('chat-transcript');
    expect(transcript.className).toContain('w-full');
    expect(transcript.className).toContain('md:w-[95%]');
    expect(transcript.className).not.toContain('max-w-3xl');
    expect(transcript.className).toContain('min-w-0');
    expect(scroller.style.touchAction).toBe('pan-y');
  });

  it('shows the jump control at the right whenever scrolling leaves the latest messages', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    const scroller = screen.getByTestId('chat-scroller');
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1_000, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollTop: { value: 500, writable: true, configurable: true },
    });

    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);

    const jump = screen.getByTestId('jump-to-latest');
    expect(jump.className).toContain('right-4');
    expect(jump.className).toContain('size-9');
    expect(jump.className).not.toContain('left-1/2');
    expect(jump.textContent).toBe('↓');
    expect(jump.getAttribute('aria-label')).toBe('Jump to the latest messages');

    scroller.scrollTop = 500;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId('jump-to-latest')).toBeNull();
  });

  it('stops following and shows the jump control when an iOS reading gesture scrolls', async () => {
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
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    expect(screen.getByTestId('jump-to-latest')).toBeTruthy();

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
    expect(scroller.scrollTop).toBe(400);
  });

  it('reserves the run-status height before, during and after an answer', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('empty-chat-icon')).toBeTruthy());

    const slot = screen.getByTestId('run-status-slot');
    const composer = screen.getByTestId('composer');
    expect(slot.className).toContain('h-7');
    expect(screen.queryByTestId('run-status-line')).toBeNull();
    expect(slot.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

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
    expect(status.textContent).toContain('Working…');
    expect(slot.contains(status)).toBe(true);
    expect(screen.getByTestId('chat-scroller').contains(status)).toBe(false);

    useChatStore.setState({ live: {} });
    await waitFor(() => expect(screen.queryByTestId('run-status-line')).toBeNull());
    expect(screen.getByTestId('run-status-slot')).toBe(slot);
    expect(slot.className).toContain('h-7');
  });

  it('loads model catalogues only for configured providers', async () => {
    listProviders.mockResolvedValue({
      providers: [
        { id: 'openrouter', name: 'OpenRouter', configured: true },
        { id: 'anthropic', name: 'Anthropic', configured: false },
      ],
    });

    renderPage();

    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openrouter'));
    expect(listModels).not.toHaveBeenCalledWith('anthropic');
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
