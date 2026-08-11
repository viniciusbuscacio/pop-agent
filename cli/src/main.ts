#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Profiles, DEFAULT_PROFILE } from './application/profiles.js';
import { PopAgentApi } from './infrastructure/api.js';
import { FileProfileStore } from './infrastructure/profile-file.js';
import { LocalAccess } from './infrastructure/local-access.js';
import { installCli } from './infrastructure/installer.js';
import { ask, chats, login, logout, servers, update, type Context, type Terminal } from './interface/commands.js';
import { chat } from './interface/chat.js';
import { managedLocalAccess } from './interface/managed-local-access.js';
import { VERSION } from './version.js';

/**
 * Composition root (docs/cli.md, "Layout"). The one place that knows there is
 * a real filesystem, a real terminal and a real network; everything below is
 * handed what it needs and is testable without any of the three.
 */

const USAGE = `pop — a terminal client for your Pop Agent

  pop                       open the interactive screen
  pop "question"            ask, print the answer, exit
  pop -p "question"         the same, spelled out for scripts
  pop login <url>           sign in and remember the server
  pop logout                forget this server's token
  pop servers               list the servers you have signed in to
  pop chats                 list conversations
  pop update                update this CLI from the selected server

  --version                  print this installed CLI version and exit
  --server <name>            use a saved server other than "${DEFAULT_PROFILE}"
  --chat <id>                continue an existing conversation
  --thinking                 show the reasoning as it streams
`;

export async function run(argv: string[], terminal: Terminal): Promise<number> {
  const args = [...argv];
  const profile = takeOption(args, '--server') ?? DEFAULT_PROFILE;
  const chatId = takeOption(args, '--chat');
  const thinking = takeFlag(args, '--thinking');
  const prompt = takeOption(args, '-p');
  const command = args[0];

  if (command === '--version' || command === '-v') {
    // Keep this before profile and API construction: desktop managers use it
    // for local discovery, so it must remain a side-effect-free inspection.
    terminal.line(VERSION);
    return 0;
  }
  if (command === '--managed-local-access') {
    // Native managers start this hidden mode and provide its one-shot config
    // over stdin. Keep it before profiles/TUI/chat construction.
    return managedLocalAccess(terminal);
  }

  const profiles = new Profiles(new FileProfileStore());
  const context: Context = {
    profiles,
    terminal,
    profile,
    // Every call can hand back a fresher token; storing it here is what keeps
    // a client that runs once a week from being signed out (spec §9).
    api: (options) =>
      new PopAgentApi({ ...options, onToken: (token) => profiles.refresh(profile, token) }),
    localAccess: (options) => new LocalAccess(options),
    installCli,
  };

  if (prompt !== undefined) {
    return ask(context, prompt, { ...(chatId === undefined ? {} : { chatId }), thinking });
  }

  switch (command) {
    case undefined:
      // A bare `pop` opens the screen; `--help` is how you ask for the list.
      return chat(context, chatId === undefined ? {} : { chatId });
    case '--help':
    case '-h':
      terminal.line(USAGE);
      return 0;
    case 'login': {
      const url = args[1];
      if (url === undefined) {
        terminal.line('Which server? Run: pop login <url>');
        return 1;
      }
      return login(context, { url });
    }
    case 'logout':
      return logout(context);
    case 'servers':
      return servers(context);
    case 'chats':
      return chats(context);
    case 'update':
      return update(context);
    default:
      // A bare argument is the question, which is what pi and Claude Code do
      // and what the hand expects (docs/cli.md).
      return ask(context, args.join(' '), {
        ...(chatId === undefined ? {} : { chatId }),
        thinking,
      });
  }
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

/** The real terminal. Kept here so `run` can be driven by a fake in tests. */
const realTerminal: Terminal = {
  line: (text = '') => process.stdout.write(`${text}\n`),
  write: (text) => process.stdout.write(text),
  password: async (prompt) => {
    // The prompt is written by hand and readline's output is thrown away, so
    // the keystrokes never echo: a password must not survive in a scrollback
    // or in a screen share. readline still does the line editing.
    const swallow = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    process.stdout.write(prompt);
    const rl = createInterface({ input: process.stdin, output: swallow, terminal: true });
    try {
      return await rl.question('');
    } finally {
      rl.close();
      process.stdout.write('\n');
    }
  },
};

// `import.meta.main` is not in Node 22, and comparing argv[1] would break when
// the bin is a symlink from npm. Running main is the package's only job.
run(process.argv.slice(2), realTerminal)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stdout.write(`${error instanceof Error ? error.message : 'Something went wrong.'}\n`);
    process.exitCode = 1;
  });
