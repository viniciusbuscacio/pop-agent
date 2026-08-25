import * as sdk from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { LocalConnectionRegistry, type LocalConnection } from '../../application/local-access/local-connection-registry.js';
import { buildLocalTools } from './local-tools.js';

function attachedTerminal(cwd: string): { registry: LocalConnectionRegistry; connection: LocalConnection } {
  const registry = new LocalConnectionRegistry();
  const connection: LocalConnection = {
    id: 'local-1',
    machine: {
      hostname: 'vinicius-mac',
      platform: 'darwin',
      arch: 'arm64',
      cwd,
      clientVersion: '0.2.0',
    },
    send: () => undefined,
    close: () => undefined,
  };
  registry.attach(connection);
  return { registry, connection };
}

describe('local tools', () => {
  it('tells the model the launch directory used for relative paths', () => {
    const cwd = '/Users/vinicius/dev/my-project';
    const { registry, connection } = attachedTerminal(cwd);

    const tools = buildLocalTools(sdk, registry, connection.id);

    expect(tools.map((tool) => tool.name)).toEqual([
      'local_bash',
      'local_read',
      'local_write',
      'local_edit',
    ]);
    for (const tool of tools) {
      expect(tool.description).toContain(`Current working directory: ${cwd}.`);
      expect(tool.description).toContain('Relative paths start there.');
    }
  });

  it('waits for a reconnected tray instead of rebuilding tools on an interactive fallback', () => {
    const { registry, connection: tray } = attachedTerminal('/Users/vinicius');
    tray.role = 'background';
    tray.machine.machineId = 'machine-m1';
    registry.detach(tray.id);
    registry.attach({
      id: 'local-interactive',
      role: 'interactive',
      machine: { ...tray.machine },
      send: () => undefined,
      close: () => undefined,
    });

    expect(registry.connection('machine-m1')?.id).toBe('local-interactive');
    expect(buildLocalTools(sdk, registry, 'machine-m1')).toEqual([]);

    registry.attach({
      id: 'local-reconnected-tray',
      role: 'background',
      machine: { ...tray.machine },
      send: () => undefined,
      close: () => undefined,
    });
    expect(buildLocalTools(sdk, registry, 'machine-m1')).toHaveLength(4);
  });
});
