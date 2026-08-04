import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Profiles, DEFAULT_PROFILE } from './application/profiles.js';
import { PopyApi } from './infrastructure/api.js';
import { FileProfileStore } from './infrastructure/profile-file.js';
import { ask, chats, login, logout, servers, type Context, type Terminal } from './interface/commands.js';

/**
 * Composition root (docs/cli.md, "Layout"). The one place that knows there is
 * a real filesystem, a real terminal and a real network; everything below is
 * handed what it needs and is testable without any of the three.
 */

const USAGE = `popy — a terminal client for your Popy

  popy "question"            ask, print the answer, exit
  popy -p "question"         the same, spelled out for scripts
  popy login <url>           sign in and remember the server
  popy logout                forget this server's token
  popy servers               list the servers you have signed in to
  popy chats                 list conversations

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

  const profiles = new Profiles(new FileProfileStore());
  const context: Context = {
    profiles,
    terminal,
    profile,
    // Every call can hand back a fresher token; storing it here is what keeps
    // a client that runs once a week from being signed out (spec §9).
    api: (options) =>
      new PopyApi({ ...options, onToken: (token) => profiles.refresh(profile, token) }),
  };

  const command = args[0];

  if (prompt !== undefined) {
    return ask(context, prompt, { ...(chatId === undefined ? {} : { chatId }), thinking });
  }

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      terminal.line(USAGE);
      return 0;
    case 'login': {
      const url = args[1];
      if (url === undefined) {
        terminal.line('Which server? Run: popy login <url>');
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
