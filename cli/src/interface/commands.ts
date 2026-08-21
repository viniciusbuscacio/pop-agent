import { type Profiles, normalizeServerUrl, DEFAULT_PROFILE, type Profile } from '../application/profiles.js';
import type { Preferences } from '../application/preferences.js';
import { Transcript, emptyRun } from '../application/transcript.js';
import { ApiError, type PopAgentApi } from '../infrastructure/api.js';
import { readEvents } from '../infrastructure/events.js';
import type { LocalAccessOptions } from '../infrastructure/local-access.js';
import { VERSION } from '../version.js';

/**
 * What each command does, with the terminal handed in (docs/cli.md, steps 1
 * and 2). Nothing here writes to `process.stdout` directly, so every command
 * is testable against a fake API and a captured output.
 */

export interface Terminal {
  /** A whole line. */
  line(text?: string): void;
  /** A fragment, as it streams. No newline. */
  write(text: string): void;
  /** Reads a secret without echoing it. */
  password(prompt: string): Promise<string>;
}

export interface LocalAccessClient {
  connect(): void;
  close(): void;
  setAccessEnabled?(enabled: boolean): void;
  readonly connectionId: string | undefined;
}

export interface Context {
  profiles: Profiles;
  preferences: Preferences;
  terminal: Terminal;
  profile: string;
  /** Built per command so a fresh token can be stored as soon as it arrives. */
  api: (options: {
    url: string;
    token?: string;
    /** This terminal's local connection, read per call (docs/cli.md, Whose local access). */
    localConnectionId?: () => string | undefined;
  }) => PopAgentApi;
  /** Injected so one-shot commands stay testable without opening a real socket. */
  localAccess: (options: LocalAccessOptions) => LocalAccessClient;
  /** Runs npm without a shell; injected so update tests never modify the machine. */
  installCli: (packageUrl: string) => Promise<number>;
  /** Resolves on SIGINT/SIGTERM; injected so the background command is testable. */
  waitForShutdown: () => Promise<void>;
  /** Tray-only JSON lines arriving on stdin; absent for ordinary interactive commands. */
  watchLocalAccessControl?: (onEnabled: (enabled: boolean) => void) => () => void;
}

export async function login(
  context: Context,
  options: { url: string; password?: string },
): Promise<number> {
  const url = normalizeServerUrl(options.url);
  const password = options.password ?? (await context.terminal.password('Password: '));
  const api = context.api({ url });
  try {
    const { token } = await api.login(password);
    context.profiles.save(context.profile, { url, token });
    context.terminal.line(`Signed in to ${url} as "${context.profile}".`);
    return 0;
  } catch (error) {
    context.terminal.line(describe(error));
    return 1;
  }
}

export async function backgroundLocalAccess(
  context: Context,
  options: { json?: boolean } = {},
): Promise<number> {
  const profile = context.profiles.get(context.profile);
  if (profile === undefined) {
    context.terminal.line('No server configured. Run: pop login <url>');
    return 1;
  }

  const report = (event: Record<string, unknown>, text: string): void => {
    context.terminal.line(options.json === true ? JSON.stringify(event) : text);
  };
  let fatal: () => void = () => undefined;
  const stoppedByServer = new Promise<void>((resolve) => {
    fatal = resolve;
  });
  const localAccess = context.localAccess({
    url: profile.url,
    token: () => context.profiles.get(context.profile)?.token ?? profile.token,
    version: VERSION,
    role: 'background',
    onEvent: (event) => {
      if (event.kind === 'attached') {
        report(event, `Pop Local Access connected (${event.transport}).`);
      } else if (event.kind === 'closed') {
        report(event, 'Pop Local Access disconnected; reconnecting…');
      } else if (event.kind === 'access-policy') {
        report(event, event.enabled ? 'Local file access enabled.' : 'Local file access disabled.');
      } else if (event.kind === 'authentication-required') {
        report(event, 'Pop Local Access needs you to sign in again.');
      } else if (event.kind === 'outdated') {
        report(event, `Pop Local Access requires Pop Agent ${event.minimum} or newer.`);
        fatal();
      }
    },
  });

  // A background process does not make ordinary API calls, so it must create
  // its own authenticated hop to receive sliding session renewal. The socket
  // will reconnect with the newly persisted token when its original lease ends.
  const refresh = context.api({ url: profile.url, token: profile.token });
  const refreshTimer = setInterval(() => {
    void refresh.request<void>('/session/refresh', { method: 'POST' }).catch(() => undefined);
  }, 6 * 60 * 60 * 1_000);
  refreshTimer.unref?.();

  const stopWatching = options.json === true
    ? context.watchLocalAccessControl?.((enabled) => localAccess.setAccessEnabled?.(enabled))
    : undefined;
  localAccess.connect();
  report({ kind: 'starting', server: profile.url }, `Pop Local Access is running for ${profile.url}.`);
  try {
    await Promise.race([context.waitForShutdown(), stoppedByServer]);
  } finally {
    stopWatching?.();
    clearInterval(refreshTimer);
    localAccess.close();
  }
  return 0;
}

export function logout(context: Context): number {
  const gone = context.profiles.forget(context.profile);
  context.terminal.line(gone ? `Signed out of "${context.profile}".` : 'Nothing to sign out of.');
  return 0;
}

export function servers(context: Context): number {
  const list = context.profiles.list();
  if (list.length === 0) {
    context.terminal.line('No servers yet. Run: pop login <url>');
    return 0;
  }
  for (const entry of list) context.terminal.line(`${entry.name}\t${entry.url}`);
  return 0;
}

export async function chats(context: Context): Promise<number> {
  const connected = connect(context);
  if (connected === undefined) return 1;
  try {
    const { chats: list } = await connected.api.chats();
    if (list.length === 0) {
      context.terminal.line('No conversations yet.');
      return 0;
    }
    for (const chat of list) {
      context.terminal.line(`${chat.id}\t${chat.title === '' ? '(untitled)' : chat.title}`);
    }
    return 0;
  } catch (error) {
    context.terminal.line(describe(error));
    return 1;
  }
}

/** Legacy npm-global update path. No chat, local-tools channel or LLM run. */
export async function update(context: Context): Promise<number> {
  const connected = connect(context);
  if (connected === undefined) return 1;

  try {
    const packageUrl = `${connected.profile.url}/cli-latest.tgz`;
    context.terminal.line("Installing this server's latest packed Pop Agent CLI...");
    const code = await context.installCli(packageUrl);
    if (code !== 0) {
      context.terminal.line(`CLI update failed (npm exited with code ${String(code)}).`);
      return 1;
    }
    context.terminal.line("This server's latest packed Pop Agent CLI installed successfully.");
    context.terminal.line('Restart pop to use the installed version.');
    return 0;
  } catch (error) {
    context.terminal.line(describe(error));
    return 1;
  }
}

/**
 * Ask, print, exit (docs/cli.md, "Client shape").
 *
 * The stream is opened BEFORE the message is sent. The other order looks
 * natural and drops the first tokens of every answer: a fast run can emit
 * `delta` before a client that sends first has finished asking for its
 * ticket.
 */
export async function ask(
  context: Context,
  text: string,
  options: { chatId?: string; thinking?: boolean } = {},
): Promise<number> {
  const connected = connect(context);
  if (connected === undefined) return 1;

  let localAccess: LocalAccessClient | undefined;
  try {
    // Unlike the interactive screen, a one-shot command cannot attach in the
    // background: its first and only message must wait until it has an id, or
    // the server truthfully gives that run no local tools at all.
    localAccess = await attachLocalAccess(context, connected.profile);
    const api = context.api({
      url: connected.profile.url,
      token: connected.profile.token,
      localConnectionId: () => localAccess?.connectionId,
    });
    const chatId = options.chatId ?? (await api.createChat()).id;
    const { ticket } = await api.eventTicket();
    const stream = await api.openEvents(ticket);

    const sent = await api.send(chatId, text);
    if (sent.queued === true) {
      context.terminal.line('Message queued behind the current answer.');
      await stream.body?.cancel();
      return 0;
    }
    const transcript = new Transcript(emptyRun(chatId, sent.runId));

    let printed = 0;
    let lastThinking = 0;
    for await (const event of readEvents(stream)) {
      if (!transcript.apply(event)) continue;
      const state = transcript.snapshot();

      if (options.thinking === true && state.thinking.length > lastThinking) {
        context.terminal.write(dim(state.thinking.slice(lastThinking)));
        lastThinking = state.thinking.length;
      }
      // Only what is new: the transcript holds the whole answer, the terminal
      // has already shown everything up to here.
      if (state.text.length > printed) {
        context.terminal.write(state.text.slice(printed));
        printed = state.text.length;
      }
      if (transcript.finished) break;
    }

    const final = transcript.snapshot();
    if (printed > 0) context.terminal.line();
    if (final.status === 'error') {
      context.terminal.line(`The run failed: ${final.errorCode ?? 'unknown'}`);
      return 1;
    }
    return 0;
  } catch (error) {
    context.terminal.line(describe(error));
    return 1;
  } finally {
    localAccess?.close();
  }
}

/** The profile, or a message saying how to make one. */
function connect(context: Context): { api: PopAgentApi; profile: Profile } | undefined {
  const profile = context.profiles.get(context.profile);
  if (profile === undefined) {
    const which = context.profile === DEFAULT_PROFILE ? '' : ` --server ${context.profile}`;
    context.terminal.line(`No server configured. Run: pop login <url>${which}`);
    return undefined;
  }
  // Token renewal is wired into the factory itself (see main): the store has
  // to be the same one this profile came from, and only main knows that.
  return { api: context.api({ url: profile.url, token: profile.token }), profile };
}

/**
 * Opens this process's short-lived local-tools channel and gives the handshake a
 * bounded chance to finish. A server without local access must still answer the
 * question; it just does so with server-side tools, as older versions did.
 */
async function attachLocalAccess(context: Context, profile: Profile): Promise<LocalAccessClient> {
  let ready: () => void = () => undefined;
  const attached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const localAccess = context.localAccess({
    url: profile.url,
    token: profile.token,
    version: VERSION,
    onEvent: (event) => {
      if (event.kind === 'attached' || event.kind === 'closed' || event.kind === 'outdated') ready();
    },
  });
  localAccess.connect();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      attached,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return localAccess;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_session') return 'That session expired. Run: pop login <url>';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** ANSI dim, for thinking. */
function dim(text: string): string {
  return `[2m${text}[22m`;
}
