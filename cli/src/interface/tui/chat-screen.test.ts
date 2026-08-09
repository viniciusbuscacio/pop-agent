import { describe, expect, it, vi } from 'vitest';
import { Markdown, Text, type Terminal } from '@earendil-works/pi-tui';
import { markdownTheme } from './theme.js';
import { ChatSession, type SessionPorts } from '../../application/session.js';
import { emptyRun } from '../../application/transcript.js';
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
  const terminal: Terminal = {
    start: (_onInput, onResize) => {
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
    repaint: () => {
      width = 79;
      resize();
    },
  };
}

function screenWith(terminal: Terminal, onExit = vi.fn()) {
  const ports: SessionPorts = {
    createChat: vi.fn(() => Promise.resolve({ id: 'chat-1' })),
    send: vi.fn(() => Promise.resolve({ runId: 'run-1' })),
    stop: vi.fn(() => Promise.resolve()),
    events: async function* () {
      // Never yields: these tests feed the screen directly.
    },
  };
  const session = new ChatSession(ports, {
    onRun: () => undefined,
    onIdle: () => undefined,
    onQueued: () => undefined,
    onSteering: () => undefined,
    onExternalUser: () => undefined,
    onTitle: () => undefined,
    onStreamEnd: () => undefined,
  });
  const screen = new ChatScreen({ session, server: 'http://pop-agent.test', terminal, onExit });
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

  it('animates a dim square while waiting and promotes it into the answer', async () => {
    const { terminal, plain, writes, repaint } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();

    const waiting = { ...emptyRun('chat-1', 'run-1'), status: 'running' as const };
    screen.onRun(waiting);
    await flush();
    expect(plain()).toMatch(/[◰◳◲◱] Thinking…/);

    screen.onRun({ ...waiting, text: 'Now there is an answer.' });
    await flush();
    writes.length = 0;
    repaint();
    await flush();

    expect(plain()).not.toContain('Thinking…');
    expect(plain().split('Now there is an answer.')).toHaveLength(2);
    screen.onIdle({ ...waiting, text: 'Now there is an answer.', status: 'done' });
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
    expect(plain()).not.toContain('Thinking…');
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

  it('does not pretend to be live once the stream is gone', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onStreamEnd();
    await flush();

    expect(plain()).toContain('dropped');
  });

  it('keeps the reasoning hidden until asked', async () => {
    const { terminal, plain } = recorder();
    const { screen } = screenWith(terminal);
    screen.start();
    screen.onRun({
      ...emptyRun('chat-1', 'run-1'),
      thinking: 'weighing the options',
      text: 'Yes.',
      status: 'running',
    });
    await flush();

    expect(plain()).not.toContain('weighing the options');
    expect(plain()).toContain('Yes.');
  });
});
