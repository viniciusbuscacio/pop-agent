import { hostname } from 'node:os';
import { ChatSession } from '../application/session.js';
import { DEFAULT_PROFILE } from '../application/profiles.js';
import { readEvents } from '../infrastructure/events.js';
import type { Context } from './commands.js';
import { Hands } from '../infrastructure/hands.js';
import { ChatScreen } from './tui/chat-screen.js';

/** Kept next to the package, not read from it: no JSON import at runtime. */
const VERSION = '0.2.0';

const handsReady = (): string =>
  `This machine (${hostname()}) is attached: local tools run here.`;
const handsTaken = (): string =>
  'Another terminal owns this conversation; this one is watching.';

/**
 * Wiring for the interactive screen: the profile, the ports the session needs,
 * and the screen that listens to it (docs/cli.md, step 4).
 *
 * Kept apart from commands.ts because importing this drags in pi-tui, which
 * opens a terminal. The one-shot path and its tests must stay able to run
 * where there is no TTY at all -- in CI, in a pipe, inside the gate.
 */
export async function chat(
  context: Context,
  options: { chatId?: string } = {},
): Promise<number> {
  const profile = context.profiles.get(context.profile);
  if (profile === undefined) {
    const which = context.profile === DEFAULT_PROFILE ? '' : ` --server ${context.profile}`;
    context.terminal.line(`No server configured. Run: popy login <url>${which}`);
    return 1;
  }
  if (!process.stdout.isTTY) {
    // The screen would paint escape codes into a pipe. `popy "question"` is
    // the shape that belongs in a script, so say so rather than misbehave.
    context.terminal.line('The interactive screen needs a terminal. For a script: popy "question"');
    return 1;
  }

  const api = context.api({ url: profile.url, token: profile.token });

  const session = new ChatSession(
    {
      createChat: () => api.createChat(),
      send: (chatId, text) => api.send(chatId, text),
      stop: (chatId) => api.stop(chatId),
      events: async function* () {
        // One ticket, one stream, for as long as the screen is open. Each
        // ticket is spent on use, so a reconnect would need a fresh one --
        // which is why a dropped stream is reported and not retried here.
        const { ticket } = await api.eventTicket();
        yield* readEvents(await api.openEvents(ticket));
      },
    },
    {
      onRun: (state) => screen.onRun(state),
      onIdle: (state) => screen.onIdle(state),
      onTitle: (title) => screen.setTitle(title),
      onStreamEnd: () => screen.onStreamEnd(),
    },
  );

  // The hands channel, alongside the chat and never in front of it: a server
  // that refuses the upgrade leaves the conversation working and the local
  // tools simply absent (docs/cli.md step 3).
  const hands = new Hands({
    url: profile.url,
    token: profile.token,
    version: VERSION,
    onEvent: (event) => {
      if (event.kind === 'attached') screen.say(handsReady());
      if (event.kind === 'claimed' && !event.mine) screen.say(handsTaken());
    },
  });

  const screen = new ChatScreen({
    session,
    server: profile.url,
    onChatOpened: (chatId) => hands.claim(chatId),
  });
  if (options.chatId !== undefined) session.open(options.chatId);

  hands.connect();
  screen.start();
  // Resolves only when the stream ends; the screen exits the process itself
  // on Ctrl+C or /quit.
  await session.listen();
  return 0;
}
