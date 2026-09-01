import { DEFAULT_PROFILE } from '../application/profiles.js';
import { chat } from './chat.js';
import {
  ask,
  backgroundLocalAccess,
  chats,
  login,
  logout,
  servers,
  update,
  type Context,
  type Terminal,
} from './commands.js';
import { VERSION } from '../version.js';

const USAGE = `pop — a terminal client for your Pop Agent

  pop                       open the interactive screen
  pop "question"            ask, print the answer, exit
  pop -p "question"         the same, spelled out for scripts
  pop login <url>           sign in and remember the server
  pop logout                forget this server's token
  pop servers               list the servers you have signed in to
  pop chats                 list conversations
  pop update                update this CLI from the selected server
  pop local-access          keep this computer connected in the background
  pop version               print this installed CLI version and exit

  --server <name>            use a saved server other than "${DEFAULT_PROFILE}"
  --chat <id>                continue an existing conversation
  --thinking                 show the reasoning as it streams
`;

type ContextFactory = (profile: string, terminal: Terminal) => Context;

export async function runCli(
  argv: string[],
  terminal: Terminal,
  createContext: ContextFactory,
): Promise<number> {
  const args = [...argv];
  const profile = takeOption(args, '--server') ?? DEFAULT_PROFILE;
  const chatId = takeOption(args, '--chat');
  const thinking = takeFlag(args, '--thinking');
  const statusJson = takeFlag(args, '--status-json');
  const prompt = takeOption(args, '-p');
  const command = args[0];

  if (command === 'version' || command === '--version' || command === '-v') {
    // Keep this before context construction so version inspection never reads a
    // profile or constructs API/local-access infrastructure.
    terminal.line(VERSION);
    return 0;
  }

  const context = createContext(profile, terminal);
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
    case 'local-access':
      return backgroundLocalAccess(context, { json: statusJson });
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
