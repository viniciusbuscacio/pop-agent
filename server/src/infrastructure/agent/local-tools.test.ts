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
});
