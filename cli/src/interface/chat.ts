import { hostname } from 'node:os';
import { ChatSession } from '../application/session.js';
import { DEFAULT_PROFILE } from '../application/profiles.js';
import { readEvents } from '../infrastructure/events.js';
import type { Context } from './commands.js';
import { ChatScreen } from './tui/chat-screen.js';
import { VERSION } from '../version.js';

const localAccessReady = (): string =>
  `This machine (${hostname()}) is attached: local tools run here.`;
const localAccessReconnecting = (): string =>
  'Local tools disconnected; reconnecting in the background…';
const behindLine = (client: string, server: string, install: string): string =>
  `  pop ${client} · server ${server} · update: ${install}`;
const outdatedLines = (client: string, minimum: string, install: string): string[] => [
  `This pop is ${client}; the server needs ${minimum} or newer, so the local tools are off.`,
  `  ${install}`,
];
const ranHere = (command: string): string =>
  `  ran here: ${command.length > 70 ? `${command.slice(0, 70)}…` : command}`;

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
    context.terminal.line(`No server configured. Run: pop login <url>${which}`);
    return 1;
  }
  if (!process.stdout.isTTY) {
    // The screen would paint escape codes into a pipe. `pop "question"` is
    // the shape that belongs in a script, so say so rather than misbehave.
    context.terminal.line('The interactive screen needs a terminal. For a script: pop "question"');
    return 1;
  }


  // The local-tools channel, alongside the chat and never in front of it: a server
  // that refuses the upgrade leaves the conversation working and the local
  // tools simply absent (docs/cli.md step 3).
  const localAccess = context.localAccess({
    url: profile.url,
    token: profile.token,
    version: VERSION,
    onEvent: (event) => {
      if (event.kind === 'attached') screen.say(localAccessReady());
      if (event.kind === 'closed') screen.say(localAccessReconnecting());
      // Behind but talking: one line, said once, and never a question. A
      // prompt on every launch is answered `n` on reflex, and the reflex is
      // then what answers the one that mattered (docs/cli.md).
      if (event.kind === 'behind') screen.say(behindLine(VERSION, event.server, event.install));
      // Refused: the conversation still works over REST, only local access is
      // gone, so this says what is missing instead of killing the screen.
      if (event.kind === 'outdated') {
        for (const line of outdatedLines(VERSION, event.minimum, event.install)) screen.say(line);
      }
      // Said out loud, because it happened on YOUR machine and nothing else
      // on screen would show it.
      if (event.kind === 'ran') screen.say(ranHere(event.command));
    },
  });

  // Every message this terminal sends names the connection above, which is
  // what gives its run the local tools. Read per call: the socket may attach
  // after this line and drop before the last request (docs/cli.md, Whose
  // local connections).
  const api = context.api({
    url: profile.url,
    token: profile.token,
    localConnectionId: () => localAccess.connectionId,
  });

  const session = new ChatSession(
    {
      createChat: () => api.createChat(),
      listChats: async () => (await api.chats()).chats,
      loadChat: (chatId) => api.messages(chatId),
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
      onChatLoaded: (opened, response) => screen.onChatLoaded(opened, response),
      onRun: (state) => screen.onRun(state),
      onIdle: (state) => screen.onIdle(state),
      onQueued: (text) => screen.onQueued(text),
      onSteering: () => screen.onSteering(),
      onExternalUser: (text) => screen.onExternalUser(text),
      onTitle: (title) => screen.setTitle(title),
      onStreamEnd: () => screen.onStreamEnd(),
    },
  );

  const screen = new ChatScreen({
    session,
    server: profile.url,
    thinkingShown: context.preferences.showThinking,
    onThinkingShownChange: (shown) => context.preferences.setShowThinking(shown),
  });
  if (options.chatId !== undefined) session.open(options.chatId);

  localAccess.connect();
  screen.start();
  // Resolves only when the stream ends; the screen exits the process itself
  // on Ctrl+C or /quit.
  await session.listen();
  return 0;
}
