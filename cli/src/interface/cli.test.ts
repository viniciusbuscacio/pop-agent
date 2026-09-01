import { describe, expect, it } from 'vitest';
import { VERSION } from '../version.js';
import { runCli } from './cli.js';
import type { Terminal } from './commands.js';

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
