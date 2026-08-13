import { describe, expect, it } from 'vitest';
import { npmInvocation } from './installer.js';

describe('CLI installer invocation', () => {
  it('runs npm JavaScript through Node on Windows instead of spawning npm.cmd', () => {
    expect(npmInvocation('win32', String.raw`C:\Users\vini\nodejs\node.exe`)).toEqual({
      command: String.raw`C:\Users\vini\nodejs\node.exe`,
      args: [String.raw`C:\Users\vini\nodejs\node_modules\npm\bin\npm-cli.js`],
    });
  });

  it('uses the executable name on Unix platforms', () => {
    expect(npmInvocation('linux', '/usr/bin/node')).toEqual({ command: 'npm', args: [] });
    expect(npmInvocation('darwin', '/opt/node/bin/node')).toEqual({ command: 'npm', args: [] });
  });
});
