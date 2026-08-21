import { describe, expect, it, vi } from 'vitest';
import type { ChatDTO } from '@pop-agent/shared';
import { Markdown, Text, type Terminal } from '@earendil-works/pi-tui';
import { markdownTheme } from './theme.js';
import { ChatSession, type SessionPorts } from '../../application/session.js';
import { emptyRun } from '../../application/transcript.js';
import { ApiError } from '../../infrastructure/api.js';
import { ChatScreen } from './chat-screen.js';

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
    createChat: vi.fn(() => Promise.resolve({ id: 'chat-1' })),
    listChats: vi.fn(() => Promise.resolve([])),
    loadChat: vi.fn(() => Promise.resolve({ messages: [] })),
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

describe('ChatScreen', () => {
  it('paints the header and the greeting when it opens', async () => {
    const { terminal, plain } = recorder();
    screenWith(terminal).screen.start();
    await flush();

    expect(plain()).toContain('New conversation');
    expect(plain()).toContain('http://pop-agent.test');
    expect(plain()).toContain('/help');
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

  it('lets the chat picker consume Escape without stopping or arming the screen shortcut', async () => {
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

  it('starts a visually and session-clean conversation on double Escape', async () => {
    const { terminal, plain, writes, send, repaint } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    await session.ask('old question');
    screen.start();
    screen.setTitle('Old conversation');
    screen.onRun({
      ...emptyRun('chat-1', 'run-1'),
      text: 'old partial answer',
      status: 'running',
    });
    await flush();

    send('\u001b');
    expect(ports.stop).toHaveBeenCalledOnce();
    send('\u001b');
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(session.currentChatId).toBeUndefined();
    expect(session.busy).toBe(false);
    expect(ports.stop).toHaveBeenCalledOnce();
    expect(plain()).toContain('New conversation');
    expect(plain()).not.toContain('Old conversation');
    expect(plain()).not.toContain('old partial answer');
    expect(plain()).not.toContain('Working…');
  });

  it('stops immediately on a single Escape without starting a new conversation', async () => {
    const { terminal, send } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    await session.ask('keep this conversation');
    screen.start();

    send('\u001b');

    expect(ports.stop).toHaveBeenCalledOnce();
    expect(session.currentChatId).toBe('chat-1');
    expect(session.busy).toBe(true);
  });

  it('does not start a new conversation when Escape presses are spaced apart', async () => {
    const { terminal, send } = recorder();
    const { screen, session, ports } = screenWith(terminal);
    await session.ask('keep this conversation');
    screen.start();
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000);

    send('\u001b');
    send('\u001b');
    clock.mockRestore();

    expect(ports.stop).toHaveBeenCalledTimes(2);
    expect(session.currentChatId).toBe('chat-1');
    expect(session.busy).toBe(true);
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

  it('reports a dropped stream and immediately exits through the /quit path', async () => {
    const { terminal, plain } = recorder();
    const { screen, onExit } = screenWith(terminal);
    screen.start();
    screen.onStreamEnd();
    await flush();

    expect(plain()).toContain('dropped');
    expect(plain()).toContain('Bye!');
    expect(onExit).toHaveBeenCalledOnce();
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
