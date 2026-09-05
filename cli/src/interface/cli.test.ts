import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../version.js';
import { runCli } from './cli.js';
import { login, type Context, type Terminal } from './commands.js';
import { chat } from './chat.js';
vi.mock('./chat.js', () => ({ chat: vi.fn(async () => 0) }));
vi.mock('./commands.js', async (original) => ({
  ...await original<typeof import('./commands.js')>(), login: vi.fn(async () => 0),
}));

function recordingTerminal(lines: string[]): Terminal {
  return {
    line: (text = '') => lines.push(text),
    write: (text) => lines.push(text),
    password: () => Promise.resolve('unused'),
  };
}

describe('local version command', () => {
  it('prints the installed version for the canonical command before constructing context', async () => {
    const lines: string[] = [];
    let contextConstructions = 0;

    const code = await runCli(['version'], recordingTerminal(lines), () => {
      contextConstructions += 1;
      throw new Error('version must not construct profiles, API, or local access');
    });

    expect(code).toBe(0);
    expect(lines).toEqual([VERSION]);
    expect(contextConstructions).toBe(0);
  });

  it.each(['--version', '-v'])('keeps %s as a side-effect-free compatibility path', async (flag) => {
    const lines: string[] = [];
    let contextConstructions = 0;

    const code = await runCli([flag], recordingTerminal(lines), () => {
      contextConstructions += 1;
      throw new Error('compatibility version paths must not construct context');
    });

    expect(code).toBe(0);
    expect(lines).toEqual([VERSION]);
    expect(contextConstructions).toBe(0);
  });
});

const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
afterEach(() => {
  if (originalTTY) Object.defineProperty(process.stdout, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
  vi.clearAllMocks();
});

describe('login handoff', () => {
  it.each([
    { args: ['login', 'https://pop.example'], tty: true, code: 0, opens: true },
    { args: ['login', 'https://pop.example', '--no-chat'], tty: true, code: 0, opens: false },
    { args: ['login', 'https://pop.example'], tty: false, code: 0, opens: false },
    { args: ['login', 'https://pop.example'], tty: true, code: 1, opens: false },
  ])('handles login $args, tty=$tty, result=$code', async ({ args, tty, code, opens }) => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty });
    vi.mocked(login).mockResolvedValueOnce(code);
    const context = {} as Context;
    expect(await runCli(args, recordingTerminal([]), () => context)).toBe(code);
    expect(login).toHaveBeenCalledWith(context, { url: 'https://pop.example' });
    expect(chat).toHaveBeenCalledTimes(opens ? 1 : 0);
    if (opens) {
      expect(chat).toHaveBeenCalledWith(context, {});
      expect(vi.mocked(login).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(chat).mock.invocationCallOrder[0]!);
    }
  });
});
