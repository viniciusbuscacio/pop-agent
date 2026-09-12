import { describe, expect, it, vi } from 'vitest';
import type { ChatDTO } from '@pop-agent/shared';
import { Markdown, Text, type Terminal } from '@earendil-works/pi-tui';
import { markdownTheme } from './theme.js';
import { ChatSession, type SessionPorts } from '../../application/session.js';
import { emptyRun } from '../../application/transcript.js';
import { ApiError } from '../../infrastructure/api.js';
import { ChatScreen } from './chat-screen.js';
import { ModelSelector, safeTerminalText } from './model-selector.js';

/**
 * What ends up on screen, asserted against a terminal that only records.
 *
 * Driving the real thing through a pty proved the loop works but could not
 * answer this: a differential renderer emits a stream of edits, so replaying
 * its output as plain text shows both the old and the new state of a line and
 * a duplicated answer is indistinguishable from a redraw. The recording
 * terminal keeps the frames, and the last one is the screen.
 */

/**
 * The TUI batches: a render is asked for, and painted a frame later. So every
 * assertion waits for the paint rather than for the call that requested it --
 * a zero-delay tick is not enough, which cost an afternoon of "expected '' to
 * contain" before the frame timer was the answer.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

/** Records every write; the joined text is what the screen painted. */
function recorder() {
  const writes: string[] = [];
  // Mutable, so `repaint` can change it: a resize to the same width is not a
  // resize, and the renderer rightly does nothing.
  let width = 80;
  // onResize is captured so a test can force a full repaint: with the
  // geometry now identical, a swap changes nothing and the differential
  // renderer writes nothing, so the diff alone can no longer be read.
  let resize: () => void = () => undefined;
  let input: (data: string) => void = () => undefined;
  const terminal: Terminal = {
    start: (onInput, onResize) => {
      input = onInput;
      resize = onResize;
    },
    stop: () => undefined,
    drainInput: () => Promise.resolve(),
    write: (data) => writes.push(data),
    get columns() {
      return width;
    },
    get rows() {
      return 24;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => undefined,
    hideCursor: () => undefined,
    showCursor: () => undefined,
    clearLine: () => undefined,
    clearFromCursor: () => undefined,
    clearScreen: () => undefined,
    setTitle: () => undefined,
  };
  // Escapes stripped: the assertions are about words, not about cursor moves.
  // eslint-disable-next-line no-control-regex -- stripping SGR escapes is the point
  const plain = (): string => writes.join('').replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
  return {
    terminal,
    plain,
    writes,
    send: (data: string) => input(data),
    repaint: () => {
      width = width === 80 ? 79 : 80;
      resize();
    },
  };
}

const chatDto = (id = 'chat-1'): ChatDTO => ({
  id,
  title: 'Conversation from the web',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  createdAt: '',
  updatedAt: '',
  preview: 'Earlier question',
});

function screenWith(
  terminal: Terminal,
  onExit = vi.fn(),
  options: { thinkingShown?: boolean; onThinkingShownChange?: (shown: boolean) => void } = {},
) {
  const ports: SessionPorts = {
    createChat: vi.fn(() => Promise.resolve(chatDto())),
    listChats: vi.fn(() => Promise.resolve([])),
    loadChat: vi.fn(() => Promise.resolve({ messages: [] })),
    archiveChat: vi.fn(() => Promise.resolve({ ...chatDto(), archived: true })),
    unarchiveChat: vi.fn(() => Promise.resolve({ ...chatDto(), archived: false })),
    patchModel: vi.fn((_chatId, provider, model) => Promise.resolve({ ...chatDto(), provider, model })),
    listProviders: vi.fn(() => Promise.resolve([])),
    listModels: vi.fn(() => Promise.resolve([])),
    recentModels: vi.fn(() => Promise.resolve([])),
    send: vi.fn(() => Promise.resolve({ runId: 'run-1' })),
    stop: vi.fn(() => Promise.resolve()),
    sessionCommand: vi.fn((_chatId, command) => Promise.resolve({ kind: command, message: 'Session details' })),
    forkPoints: vi.fn(() => Promise.resolve([])),
    events: async function* () {
      // Never yields: these tests feed the screen directly.
    },
  };
  const holder: { screen?: ChatScreen } = {};
  const session = new ChatSession(ports, {
    onChatLoaded: (chat, response) => holder.screen?.onChatLoaded(chat, response),
    onRun: () => undefined,
    onIdle: () => undefined,
    onQueued: () => undefined,
    onSteering: () => undefined,
    onExternalUser: () => undefined,
    onArchivedChanged: (archived, source) => holder.screen?.onArchivedChanged(archived, source),
    onModelChanged: (state) => holder.screen?.onModelChanged(state),
    onTitle: () => undefined,
    onStreamEnd: () => undefined,
  });
  const screen = new ChatScreen({
    session,
    server: 'http://pop-agent.test',
    terminal,
    onExit,
    ...options,
  });
  holder.screen = screen;
  return { screen, session, ports, onExit };
}

describe('model selector safety', () => {
  it('strips terminal controls and identifies an unavailable current pair', () => {
    const selector = new ModelSelector({
      choices: [{
        provider: 'safe',
        providerName: 'Provider\u001b]52;c;clipboard\u0007',
        model: 'model\u001b[2J',
      }],
      state: { selected: { provider: 'missing\u001b[31m', model: 'old\u0007model' } },
      failedProviders: ['Broken\u001b[2J'],
    });

    const output = selector.render(120).join('\n');
    expect(output).toContain('Current (unavailable): missing[31m / oldmodel');
    expect(output).toContain('Provider]52;c;clipboard / model[2J');
    expect(output).toContain('Catalog failed: Broken[2J');
    expect(output).not.toContain('\u001b]52');
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u0007');
    expect(safeTerminalText('safe\u009bcontrol')).toBe('safecontrol');
  });
});

describe('ChatScreen', () => {
  it('paints the header and the greeting when it opens', async () => {
    const { terminal, plain } = recorder();
    screenWith(terminal).screen.start();
    await flush();

    expect(plain()).toContain('New conversation');
    expect(plain()).toContain('http://pop-agent.test');
    expect(plain()).toContain('/help');
  });

  it('describes the current new-chat and quit shortcuts in /help', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/help');
    await flush();

    expect(plain()).toContain('Start a fresh conversation');
    expect(plain()).toContain('Archive the current conversation');
    expect(plain()).toContain('Restore this archived conversation');
    expect(plain()).toContain('Leave (or press Ctrl+C twice)');
    expect(plain()).not.toContain('Escape twice');
  });

  it('offers /archive through slash-command autocomplete', async () => {
    const { terminal, send } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    send('/arc');
    await flush();
    send('\t');

    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(editor.getText()).toBe('/archive ');
  });

  it('offers /unarchive through slash-command autocomplete', async () => {
    const { terminal, send } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    send('/unar');
    await flush();
    send('\t');

    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(editor.getText()).toBe('/unarchive ');
  });

  it('lists and autocompletes /model', async () => {
    const { terminal, plain, send } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/help');
    await flush();
    expect(plain()).toContain('Choose this conversation’s model');

    send('/mod');
    await flush();
    send('\t');
    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(editor.getText()).toBe('/model ');
  });

  it('filters and navigates the inline model selector, then applies model ids containing slashes', async () => {
    const { terminal, plain, send } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.listProviders).mockResolvedValue([
      { id: 'openrouter', name: 'OpenRouter', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'base/default', serviceModel: '', allowCustomModel: false, order: 1, enabled: true },
    ]);
    vi.mocked(ports.listModels).mockResolvedValue([{ id: 'alpha/one' }, { id: 'vendor/model-two' }]);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model');
    await vi.waitFor(() => expect(ports.listModels).toHaveBeenCalled());
    await flush();
    expect(plain()).toContain('Model filter:');
    send('model-two');
    await flush();
    expect(plain()).toContain('vendor/model-two');
    send('\r');
    await vi.waitFor(() => expect(ports.patchModel).toHaveBeenCalledWith(
      'chat-1', 'openrouter', 'vendor/model-two',
    ));
  });

  it('lets Escape close only the model selector without stopping the current run', async () => {
    const { terminal, send } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    vi.mocked(ports.listProviders).mockResolvedValue([
      { id: 'openrouter', name: 'OpenRouter', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'base/default', serviceModel: '', allowCustomModel: false, order: 1, enabled: true },
    ]);
    vi.mocked(ports.listModels).mockResolvedValue([{ id: 'vendor/model' }]);
    await session.ask('running');
    screen.start();
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model');
    await vi.waitFor(() => expect(ports.listModels).toHaveBeenCalled());
    await flush();

    send('\u001b');
    await flush();

    expect(ports.stop).not.toHaveBeenCalled();
    expect((screen as unknown as { picker?: unknown }).picker).toBeUndefined();
  });

  it('supports direct explicit/default syntax and rejects extra arguments', async () => {
    const { terminal, plain } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.listProviders).mockResolvedValue([
      { id: 'openrouter', name: 'OpenRouter', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'vendor/model/id', serviceModel: '', allowCustomModel: false, order: 1, enabled: true },
    ]);
    vi.mocked(ports.listModels).mockResolvedValue([{ id: 'vendor/model/id' }]);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model openrouter vendor/model/id');
    await vi.waitFor(() => expect(ports.patchModel).toHaveBeenCalledWith(
      'chat-1', 'openrouter', 'vendor/model/id',
    ));
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model default');
    await vi.waitFor(() => expect(ports.patchModel).toHaveBeenCalledWith('chat-1', '', ''));
    const before = vi.mocked(ports.patchModel).mock.calls.length;
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model too many arguments here');
    await flush();

    expect(ports.patchModel).toHaveBeenCalledTimes(before);
    expect(plain()).toContain('Usage: /model');
  });

  it('restores a dependent draft when the initial model PATCH fails', async () => {
    const { terminal, plain } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.listProviders).mockResolvedValue([
      { id: 'openrouter', name: 'OpenRouter', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'vendor/model', serviceModel: '', allowCustomModel: false, order: 1, enabled: true },
    ]);
    vi.mocked(ports.listModels).mockResolvedValue([{ id: 'vendor/model' }]);
    let rejectPatch: (error: Error) => void = () => undefined;
    vi.mocked(ports.patchModel).mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectPatch = reject; }),
    );
    screen.start();
    await (screen as unknown as { submit(text: string): Promise<void> }).submit(
      '/model openrouter vendor/model',
    );
    await vi.waitFor(() => expect(ports.patchModel).toHaveBeenCalledOnce());
    const editor = (screen as unknown as { editor: { getText(): string; setText(text: string): void } }).editor;
    editor.setText('must remain a draft');
    const asking = (screen as unknown as { submit(text: string): Promise<void> }).submit('must remain a draft');

    rejectPatch(new Error('Model patch failed.'));
    await asking;
    await flush();

    expect(ports.send).not.toHaveBeenCalled();
    expect(editor.getText()).toBe('must remain a draft');
    expect(plain()).not.toContain('> must remain a draft');
    expect(plain()).toContain('Model patch failed.');
  });

  it('keeps a fresh chat lazy when the selector is cancelled and reports partial catalog failure', async () => {
    const { terminal, plain, send } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.listProviders).mockResolvedValue([
      { id: 'good', name: 'Good', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'good/model', serviceModel: '', allowCustomModel: false, order: 1, enabled: true },
      { id: 'bad', name: 'Broken', authType: 'api-key', configured: true, source: 'settings', defaultModel: 'bad/model', serviceModel: '', allowCustomModel: false, order: 2, enabled: true },
    ]);
    vi.mocked(ports.listModels).mockImplementation((provider) => provider === 'bad'
      ? Promise.reject(new Error('down'))
      : Promise.resolve([{ id: 'good/model' }]));
    screen.start();
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/model');
    await vi.waitFor(() => expect(ports.listModels).toHaveBeenCalledTimes(2));
    await flush();

    expect(plain()).toContain('Good / good/model');
    expect(plain()).toContain('Catalog failed: Broken');
    expect(plain()).toContain('run /model to retry');
    send('\u001b');
    expect(ports.createChat).not.toHaveBeenCalled();
  });

  it('runs pi session commands locally instead of sending them as prompts', async () => {
    const { terminal, plain } = recorder();
    const { screen, ports } = screenWith(terminal);
    screen.start();
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/session');
    await flush();
    expect(ports.sessionCommand).toHaveBeenCalledWith('chat-1', 'session', '');
    expect(ports.send).not.toHaveBeenCalled();
    expect(plain()).toContain('Session details');
  });

  it('opens /chats as a keyboard picker and loads the selected conversation', async () => {
    const { terminal, plain, send } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.listChats).mockResolvedValueOnce([chatDto()]);
    vi.mocked(ports.loadChat).mockResolvedValueOnce({
      messages: [
        {
          id: 'stored-user',
          chatId: 'chat-1',
          role: 'user',
          content: 'Earlier question',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
        {
          id: 'stored-assistant',
          chatId: 'chat-1',
          role: 'assistant',
          content: 'Earlier answer',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      ],
    });
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/chats');
    await flush();
    expect(plain()).toContain('Conversation from the web');
    const internals = screen as unknown as {
      tui: { children: unknown[]; hasOverlay(): boolean };
      transcript: unknown;
      picker: unknown;
      editor: unknown;
    };
    expect(internals.tui.hasOverlay()).toBe(false);
    expect(internals.tui.children.indexOf(internals.transcript)).toBeLessThan(
      internals.tui.children.indexOf(internals.picker),
    );
    expect(internals.tui.children.indexOf(internals.picker)).toBeLessThan(
      internals.tui.children.indexOf(internals.editor),
    );

    send('\r');
    await flush();
    expect(ports.loadChat).toHaveBeenCalledWith('chat-1');
    expect(plain()).toContain('Earlier question');
    expect(plain()).toContain('Earlier answer');
  });

  it('keeps the inline picker focused when live chat state changes behind it', async () => {
    const { terminal, send } = recorder();
    const { screen, ports } = screenWith(terminal);
    const second = { ...chatDto('chat-2'), title: 'Second conversation' };
    vi.mocked(ports.listChats).mockResolvedValueOnce([chatDto(), second]);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/chats');
    screen.onExternalUser('arrived while choosing');
    screen.onRun({ ...emptyRun('chat-current', 'run-current'), status: 'running' });
    await flush();
    send('\u001b[B');
    send('\r');
    await flush();

    expect(ports.loadChat).toHaveBeenCalledWith('chat-2');
  });

  it('lets the chat picker consume Escape without stopping the current run', async () => {
    const { terminal, send } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    vi.mocked(ports.listChats).mockResolvedValueOnce([chatDto()]);
    await session.ask('keep running');
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/chats');
    await flush();
    send('\u001b');
    await flush();

    expect(ports.stop).not.toHaveBeenCalled();
    const internals = screen as unknown as { picker?: unknown; tui: { hasOverlay(): boolean } };
    expect(internals.picker).toBeUndefined();
    expect(internals.tui.hasOverlay()).toBe(false);

    send('\u001b');
    expect(ports.stop).toHaveBeenCalledOnce();
    expect(session.currentChatId).toBe('chat-1');
  });

  it('keeps /new as a visually and session-clean conversation', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen, session } = screenWith(terminal);
    await session.ask('old question');
    screen.start();
    screen.setTitle('Old conversation');
    screen.onRun({
      ...emptyRun('chat-1', 'run-1'),
      text: 'old partial answer',
      status: 'running',
    });
    await flush();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/new');
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(session.currentChatId).toBeUndefined();
    expect(session.busy).toBe(false);
    expect(plain()).toContain('New conversation');
    expect(plain()).not.toContain('Old conversation');
    expect(plain()).not.toContain('old partial answer');
    expect(plain()).not.toContain('Working…');
  });

  it('archives the current chat, clears its transcript, and does not create an empty replacement', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-existing');
    screen.start();
    screen.setTitle('Conversation to archive');
    screen.say('old transcript');
    await flush();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/archive');
    await vi.waitFor(() => expect(session.currentChatId).toBeUndefined());
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(ports.archiveChat).toHaveBeenCalledWith('chat-existing');
    expect(ports.createChat).not.toHaveBeenCalled();
    expect(session.busy).toBe(false);
    expect(plain()).toContain('Conversation archived.');
    expect(plain()).toContain('New conversation.');
    expect(plain()).not.toContain('Conversation to archive');
    expect(plain()).not.toContain('old transcript');
  });

  it('says when there is no persisted chat to archive without making a request', async () => {
    const { terminal, plain } = recorder();
    const { screen, ports } = screenWith(terminal);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/archive');
    await flush();

    expect(plain()).toContain('Nothing to archive yet.');
    expect(ports.archiveChat).not.toHaveBeenCalled();
    expect(ports.createChat).not.toHaveBeenCalled();
  });

  it('refuses to archive a busy chat and points to /stop', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    await session.ask('keep running');
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/archive');
    await flush();

    expect(plain()).toContain('The answer is still running. Use /stop first.');
    expect(ports.archiveChat).not.toHaveBeenCalled();
    expect(session.currentChatId).toBe('chat-1');
    expect(session.busy).toBe(true);
  });

  it('shows archive errors without clearing the current chat or transcript', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-existing');
    vi.mocked(ports.archiveChat).mockRejectedValueOnce(new Error('Archive request failed.'));
    screen.start();
    screen.setTitle('Conversation preserved');
    screen.say('transcript preserved');

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/archive');
    await vi.waitFor(() => expect(ports.archiveChat).toHaveBeenCalledOnce());
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(session.currentChatId).toBe('chat-existing');
    expect(plain()).toContain('Conversation preserved');
    expect(plain()).toContain('transcript preserved');
    expect(plain()).toContain('Archive request failed.');
    expect(plain()).not.toContain('New conversation.');
  });

  it('does not let a late archive result alter a newer conversation', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-existing');
    let failArchive: (error: Error) => void = () => undefined;
    vi.mocked(ports.archiveChat).mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        failArchive = reject;
      }),
    );
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/archive');
    await vi.waitFor(() => expect(ports.archiveChat).toHaveBeenCalledOnce());
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/new');
    failArchive(new Error('Late archive failure.'));
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(session.currentChatId).toBeUndefined();
    expect(plain()).toContain('New conversation.');
    expect(plain()).not.toContain('Late archive failure.');
  });

  it('keeps an externally archived transcript visible, blocks sends, and retains the draft', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-existing');
    screen.start();
    screen.say('transcript stays here');
    (session as unknown as { absorb(event: unknown): void }).absorb({
      kind: 'chat-archived-changed', chatId: 'chat-existing', archived: true,
    });
    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    editor.setText('draft that must stay');

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('draft that must stay');
    await flush();

    expect(ports.send).not.toHaveBeenCalled();
    expect(editor.getText()).toBe('draft that must stay');
    expect(plain()).toContain('transcript stays here');
    expect(plain().split('archived elsewhere')).toHaveLength(2);
    expect(plain()).toContain('read-only');
    expect(plain()).toContain('/unarchive');
    expect(plain()).not.toContain('> draft that must stay');
  });

  it('rolls back a server-rejected archived send and preserves its draft', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-archived');
    vi.mocked(ports.send).mockRejectedValueOnce(
      new ApiError('chat_archived', 'This chat is archived.', 409),
    );
    screen.start();
    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    editor.setText('server-race draft');

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('server-race draft');
    await flush();

    expect(session.readOnly).toBe(true);
    expect(editor.getText()).toBe('server-race draft');
    expect(plain()).toContain('This conversation is archived and is now read-only.');
    expect(plain()).toContain('/unarchive');
    expect(plain()).not.toContain('> server-race draft');
  });

  it('does not restore an archived draft after the user moves to a new conversation', async () => {
    const { terminal } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-old');
    let rejectSend: (error: Error) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
    screen.start();

    const sending = (screen as unknown as { submit(text: string): Promise<void> }).submit('old draft');
    await vi.waitFor(() => expect(ports.send).toHaveBeenCalledOnce());
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/new');
    rejectSend(new ApiError('chat_archived', 'Archived.', 409));
    await sending;

    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(session.currentChatId).toBeUndefined();
    expect(editor.getText()).toBe('');
  });

  it('keeps spacing state owned by a newer synchronized turn during rollback', async () => {
    const { terminal } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-archived');
    let rejectSend: (error: Error) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
    screen.start();

    const sending = (screen as unknown as { submit(text: string): Promise<void> }).submit('optimistic');
    await vi.waitFor(() => expect(ports.send).toHaveBeenCalledOnce());
    screen.onExternalUser('newer synchronized turn');
    rejectSend(new ApiError('chat_archived', 'Archived.', 409));
    await sending;

    expect((screen as unknown as { spoken: boolean }).spoken).toBe(true);
  });

  it('unarchives in place and reports that sends are enabled again', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    session.open('chat-archived');
    screen.start();
    screen.say('transcript remains');
    (session as unknown as { absorb(event: unknown): void }).absorb({
      kind: 'chat-archived-changed', chatId: 'chat-archived', archived: true,
    });

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/unarchive');
    await vi.waitFor(() => expect(ports.unarchiveChat).toHaveBeenCalledWith('chat-archived'));
    await flush();

    expect(session.currentChatId).toBe('chat-archived');
    expect(session.readOnly).toBe(false);
    expect(plain()).toContain('transcript remains');
    expect(plain()).toContain('Conversation restored. You can send messages again.');
  });

  it('handles no-current, no-op, and failed unarchive without changing the transcript', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    screen.start();

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/unarchive');
    await flush();
    expect(plain()).toContain('Nothing to restore yet.');
    expect(ports.unarchiveChat).not.toHaveBeenCalled();

    await session.switchTo(chatDto('chat-open'));
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/unarchive');
    await flush();
    expect(plain()).toContain('This conversation is not archived.');
    expect(ports.unarchiveChat).not.toHaveBeenCalled();

    (session as unknown as { absorb(event: unknown): void }).absorb({
      kind: 'chat-archived-changed', chatId: 'chat-open', archived: true,
    });
    screen.say('still selected');
    vi.mocked(ports.unarchiveChat).mockRejectedValueOnce(new Error('Restore request failed.'));
    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/unarchive');
    await vi.waitFor(() => expect(ports.unarchiveChat).toHaveBeenCalledOnce());
    await flush();

    expect(session.currentChatId).toBe('chat-open');
    expect(session.readOnly).toBe(true);
    expect(plain()).toContain('still selected');
    expect(plain()).toContain('Restore request failed.');
  });

  it('stops the current run on every Escape, including two immediate presses', async () => {
    const { terminal, send } = recorder();
    const { screen, session, ports, onExit } = screenWith(terminal);
    await session.ask('keep this conversation');
    screen.start();

    send('\u001b');
    send('\u001b');

    expect(ports.stop).toHaveBeenCalledTimes(2);
    expect(session.currentChatId).toBe('chat-1');
    expect(session.busy).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('clears the editor on the first Ctrl+C without exiting', () => {
    const { terminal, send } = recorder();
    const { screen, onExit } = screenWith(terminal);
    screen.start();
    send('unfinished draft');
    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(editor.getText()).toBe('unfinished draft');

    send('\u0003');

    expect(editor.getText()).toBe('');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('exits on a second immediate Ctrl+C', () => {
    const { terminal, send } = recorder();
    const { screen, onExit } = screenWith(terminal);
    screen.start();
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500);

    send('\u0003');
    send('\u0003');
    clock.mockRestore();

    expect(onExit).toHaveBeenCalledOnce();
  });

  it('does not exit when Ctrl+C presses are more than 500ms apart', () => {
    const { terminal, send } = recorder();
    const { screen, onExit } = screenWith(terminal);
    screen.start();
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_501);

    send('\u0003');
    send('\u0003');
    clock.mockRestore();

    expect(onExit).not.toHaveBeenCalled();
  });

  it('requires a fresh first Ctrl+C after intervening input', () => {
    const { terminal, send } = recorder();
    const { screen, onExit } = screenWith(terminal);
    screen.start();

    send('\u0003');
    send('x');
    send('\u0003');

    const editor = (screen as unknown as { editor: { getText(): string } }).editor;
    expect(editor.getText()).toBe('');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('uses the clean quit path for a double Ctrl+C', async () => {
    const { terminal, plain, send } = recorder();
    const stopped = vi.fn();
    terminal.stop = stopped;
    const { screen, session, onExit } = screenWith(terminal);
    session.open('chat-clean-quit');
    screen.start();

    send('\u0003');
    send('\u0003');
    await flush();

    expect(stopped).toHaveBeenCalledOnce();
    expect(plain()).toContain('Bye!\nTo continue this chat, use:\npop --chat chat-clean-quit');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('replaces the old transcript when a loaded chat is painted', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.say('old conversation only');
    await flush();

    screen.onChatLoaded(chatDto(), {
      messages: [
        {
          id: 'new-user',
          chatId: 'chat-1',
          role: 'user',
          content: 'loaded conversation only',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      ],
    });
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(plain()).toContain('loaded conversation only');
    expect(plain()).not.toContain('old conversation only');
  });

  it('applies /think immediately to reasoning loaded from history', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onChatLoaded(chatDto(), {
      messages: [{
        id: 'stored-assistant',
        chatId: 'chat-1',
        role: 'assistant',
        content: 'Stored answer',
        thinking: 'Stored reasoning',
        tools: [],
        attachments: [],
        createdAt: '',
      }],
    });
    await flush();
    expect(plain()).toContain('Stored reasoning');

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/think');
    await flush();
    writes.length = 0;
    repaint();
    await flush();
    expect(plain()).not.toContain('Stored reasoning');
    expect(plain()).toContain('Stored answer');
  });

  it('prints the command for continuing the current chat in grey when it exits', async () => {
    const { terminal, plain, writes } = recorder();
    const { screen, session, onExit } = screenWith(terminal);
    session.open('chat-bKZpiMZW96e');
    screen.start();

    screen.quit();
    screen.quit();
    await flush();

    expect(plain()).toContain(
      'Bye!\nTo continue this chat, use:\npop --chat chat-bKZpiMZW96e\n',
    );
    expect(plain().split('To continue this chat, use:')).toHaveLength(2);
    expect(writes.join('')).toContain(
      '\u001b[90mBye!\nTo continue this chat, use:\npop --chat chat-bKZpiMZW96e\u001b[39m\n',
    );
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('only says goodbye when a new conversation has no chat id yet', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    screen.quit();
    await flush();

    expect(plain()).toContain('Bye!\n');
    expect(plain()).not.toContain('To continue this chat');
  });

  it('offers the id assigned by the server after the first message', async () => {
    const { terminal, plain } = recorder();
    const { screen, session } = screenWith(terminal);
    screen.start();
    await session.ask('hello');

    screen.quit();
    await flush();

    expect(plain()).toContain('pop --chat chat-1');
  });

  it('keeps one working line below the answer until the run settles', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const waiting = { ...emptyRun('chat-1', 'run-1'), status: 'running' as const };
    screen.onRun(waiting);
    await flush();
    expect(plain()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working…/);

    screen.onRun({ ...waiting, text: 'Now there is an answer.' });
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    const frame = plain();
    const internals = screen as unknown as {
      tui: { children: unknown[] };
      runStatus: unknown;
    };
    expect(internals.tui.children.filter((child) => child === internals.runStatus)).toHaveLength(1);
    expect(frame).toContain('Working…');
    expect(frame.split('Now there is an answer.')).toHaveLength(2);
    expect(frame.lastIndexOf('Now there is an answer.')).toBeLessThan(frame.lastIndexOf('Working…'));
    screen.onIdle({ ...waiting, text: 'Now there is an answer.', status: 'done' });
  });

  it('switches from a static queue status to the animated working line', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const queued = emptyRun('chat-1', 'run-1');
    screen.onRun(queued);
    await flush();
    expect(plain()).toContain('Waiting for a free slot…');
    expect(plain()).not.toContain('Working…');

    screen.onRun({ ...queued, status: 'running' });
    await flush();
    writes.length = 0;
    repaint();
    await flush();
    expect(plain()).not.toContain('Waiting for a free slot…');
    expect(plain()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working…/);
    screen.onIdle({ ...queued, status: 'done' });
  });

  it('keeps local command notices before the answer they helped produce', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const running = {
      ...emptyRun('chat-1', 'run-1'),
      text: 'The repository needs a Windows port.',
      status: 'running' as const,
      tools: [{ name: 'local_bash', status: 'done' as const }],
    };
    screen.onRun(running);
    screen.onLocalRun('go version');
    screen.onIdle({ ...running, status: 'done' });
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    const frame = plain();
    expect(frame).toContain('ran here: go version');
    expect(frame.indexOf('ran here: go version')).toBeLessThan(
      frame.indexOf('The repository needs a Windows port.'),
    );
  });

  it('does not attach an early local command notice to the previous answer', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const previous = {
      ...emptyRun('chat-1', 'run-previous'),
      text: 'Previous answer.',
      status: 'done' as const,
    };
    screen.onIdle(previous);
    screen.onRun(emptyRun('chat-1', 'run-current'));
    screen.onLocalRun('early command');
    screen.onRun({
      ...emptyRun('chat-1', 'run-current'),
      text: 'Current answer.',
      status: 'running',
    });
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    const frame = plain();
    expect(frame.indexOf('Previous answer.')).toBeLessThan(frame.indexOf('ran here: early command'));
    expect(frame.indexOf('ran here: early command')).toBeLessThan(frame.indexOf('Current answer.'));
  });

  it('keeps working after a tool finishes and while the model continues', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const running = {
      ...emptyRun('chat-1', 'run-1'),
      status: 'running' as const,
      tools: [{ name: 'read', status: 'done' as const, detail: 'file.ts' }],
    };
    screen.onRun(running);
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    const frame = plain();
    expect(frame).toContain('· read done');
    expect(frame).toContain('Working…');
    expect(frame.indexOf('· read done')).toBeLessThan(frame.indexOf('Working…'));
    screen.onIdle({ ...running, status: 'done' });
  });

  it('removes the activity indicator when a run ends without content', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onRun({ ...emptyRun('chat-1', 'run-1'), status: 'running' });
    await flush();
    screen.onIdle({ ...emptyRun('chat-1', 'run-1'), status: 'error', errorCode: 'aborted' });
    await flush();

    writes.length = 0;
    repaint();
    await flush();
    expect(plain()).not.toContain('Working…');
    expect(plain()).toContain('aborted');
  });

  it('shows the answer once when the run settles, not twice', async () => {
    // The streamed plain text is swapped for rendered markdown. If the swap
    // leaves the old component behind, the answer is on screen twice -- the
    // exact thing a pty transcript cannot tell apart from a redraw.
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const run = { ...emptyRun('chat-1', 'run-1'), text: 'Forty-two.', status: 'running' as const };
    screen.onRun(run);
    await flush();
    screen.onIdle({ ...run, status: 'done' });
    await flush();

    // A whole frame, not the diff since the swap: if the streamed component
    // were left behind, the answer would be painted twice in it.
    writes.length = 0;
    repaint();
    await flush();
    expect(plain().split('Forty-two.').length - 1).toBe(1);
  });

  it('points to /new when the open conversation was deleted', async () => {
    const { terminal, plain } = recorder();
    const { screen, ports } = screenWith(terminal);
    vi.mocked(ports.send).mockRejectedValueOnce(
      new ApiError('chat_not_found', 'That conversation does not exist.', 404),
    );

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('still there?');
    await flush();

    expect(plain()).toContain(
      'That conversation does not exist. Type /new to start a new conversation',
    );
  });

  it('sends guidance instead of blocking input while an answer is running', async () => {
    const { terminal, plain } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    await session.ask('first');
    vi.mocked(ports.send).mockResolvedValueOnce({
      queued: true,
      message: {
        id: 'queued-1',
        chatId: 'chat-1',
        text: 'change course',
        attachments: [],
        filePaths: [],
        createdAt: '',
        updatedAt: '',
      },
    });

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('change course');
    await flush();

    expect(ports.send).toHaveBeenLastCalledWith('chat-1', 'change course');
    expect(plain()).not.toContain('Still answering');
    expect(plain()).not.toContain('Guiding this answer:');
    expect(plain().split('change course')).toHaveLength(2);
  });

  it('freezes the partial segment before rendering post-steering text', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    screen.onRun({
      ...emptyRun('chat-1', 'run-1'),
      text: 'answer before steering',
      status: 'running',
    });
    screen.onSteering();
    const after = {
      ...emptyRun('chat-1', 'run-1'),
      text: 'answer after steering',
      status: 'running' as const,
    };
    screen.onRun(after);
    screen.onIdle({ ...after, status: 'done' });
    await flush();

    writes.length = 0;
    repaint();
    await flush();
    const frame = plain();
    expect(frame.split('answer before steering')).toHaveLength(2);
    expect(frame.split('answer after steering')).toHaveLength(2);
    expect(frame.indexOf('answer before steering')).toBeLessThan(frame.indexOf('answer after steering'));
  });

  it('shows a user turn synchronized from another client', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onExternalUser('sent from the web');
    await flush();

    expect(plain()).toContain('> sent from the web');
  });

  it('keeps the editor below the transcript, never above it', async () => {
    // The TUI only appends, so a line added after the editor renders BELOW
    // it: you would type at the top and watch your words appear at the
    // bottom. The editor draws horizontal rules around itself, so where the
    // first rule falls relative to the text is where the editor is.
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.say('a line of transcript');
    await flush();

    const frame = plain();
    expect(frame.indexOf('a line of transcript')).toBeGreaterThan(-1);
    expect(frame.indexOf('a line of transcript')).toBeLessThan(frame.lastIndexOf('─'));
  });

  it('does not change height when the streamed answer becomes markdown', async () => {
    // Text pads by default and Markdown here does not, so the swap used to
    // shrink the block by two lines and pull the editor up on every single
    // answer. Same words, same height, or the screen jumps.
    const streamed = new Text('Forty-two.', 0, 0).render(80).length;
    const rendered = new Markdown('Forty-two.', 0, 0, markdownTheme).render(80).length;
    expect(streamed).toBe(rendered);
  });

  it('says why a run failed instead of showing an empty answer', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onIdle({ ...emptyRun('chat-1', 'run-1'), status: 'error', errorCode: 'provider_down' });
    await flush();

    expect(plain()).toContain('provider_down');
  });

  it('repaints the header when the server names the chat', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.setTitle('Naming things');
    await flush();

    expect(plain()).toContain('Naming things');
  });

  it('tears down the TUI before reporting a dropped stream and exits synchronously', () => {
    const { terminal, plain } = recorder();
    const lifecycle: string[] = [];
    const write = terminal.write.bind(terminal);
    terminal.stop = () => lifecycle.push('tui stopped');
    terminal.write = (data) => {
      write(data);
      if (data.includes('connection to the server dropped')) lifecycle.push('drop reported');
    };
    const onExit = vi.fn(() => lifecycle.push('exit'));
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const { screen } = screenWith(terminal, onExit);
    screen.start();

    screen.onStreamEnd();

    expect(lifecycle).toEqual(['tui stopped', 'drop reported', 'exit']);
    expect(plain()).toContain('dropped');
    expect(plain()).toContain('Bye!');
    expect(onExit).toHaveBeenCalledOnce();
    expect(timeout.mock.calls.some(([, delay]) => delay === 60 * 60 * 1_000)).toBe(false);
    timeout.mockRestore();
  });

  it('shows reasoning by default and preserves it after the run settles', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    const run = {
      ...emptyRun('chat-1', 'run-1'),
      thinking: 'weighing the options',
      text: 'Yes.',
      status: 'running' as const,
    };
    screen.onRun(run);
    screen.onIdle({ ...run, status: 'done' });
    await flush();

    writes.length = 0;
    repaint();
    await flush();
    expect(plain()).toContain('weighing the options');
    expect(plain()).toContain('Yes.');
  });

  it('starts hidden from the saved preference and toggles all segments immediately', async () => {
    const changed = vi.fn();
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal, vi.fn(), {
      thinkingShown: false,
      onThinkingShownChange: changed,
    });
    screen.start();
    const first = {
      ...emptyRun('chat-1', 'run-1'),
      thinking: 'reasoning before steering',
      text: 'First.',
      status: 'running' as const,
    };
    screen.onRun(first);
    screen.onSteering();
    const second = { ...first, thinking: 'reasoning after steering', text: 'Second.' };
    screen.onRun(second);
    screen.onIdle({ ...second, status: 'done' });
    await flush();

    writes.length = 0;
    repaint();
    await flush();
    expect(plain()).not.toContain('reasoning before steering');
    expect(plain()).not.toContain('reasoning after steering');

    await (screen as unknown as { submit(text: string): Promise<void> }).submit('/think');
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(plain()).toContain('reasoning before steering');
    expect(plain()).toContain('reasoning after steering');
    expect(changed).toHaveBeenCalledWith(true);
  });
});
