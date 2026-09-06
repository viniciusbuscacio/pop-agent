import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { userInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { TailscaleCliGateway } from './tailscale-cli-gateway.js';

vi.mock('node:child_process', () => ({
  spawnSync: (_command: string, args: string[]) => ({
    status: 0,
    stdout: args[0] === 'status' ? JSON.stringify({ BackendState: 'NeedsLogin' }) : '1.0.0',
    stderr: '',
  }),
  spawn: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    queueMicrotask(() => {
      // A clean subprocess environment has no ambient USER default. Tailscale
      // then requires the configured non-default operator to be explicit.
      expect(options.env['USER']).toBeUndefined();
      if (!args.includes(`--operator=${userInfo().username}`)) {
        child.emit('close', 1);
        return;
      }
      child.stderr.write('To authenticate, visit: https://login.tailscale.com/a/test123');
      child.emit('close', 0);
    });
    return child;
  },
}));

describe('Tailscale login under the service environment', () => {
  it('preserves the configured operator without inheriting the host environment', async () => {
    await expect(new TailscaleCliGateway(8787).beginLogin()).resolves.toBe(
      'https://login.tailscale.com/a/test123',
    );
  });
});
