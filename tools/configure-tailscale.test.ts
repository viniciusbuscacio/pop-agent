import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function fixture(): { env: NodeJS.ProcessEnv; log: string } {
  const root = mkdtempSync(join(tmpdir(), 'pop-tailscale-test-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const log = join(root, 'tailscale.log');
  mkdirSync(bin);
  executable(join(bin, 'id'), '#!/bin/sh\nprintf "1000\\n"\n');
  executable(join(bin, 'curl'), '#!/bin/sh\n[ "${FAKE_HEALTHY:-1}" = 1 ]\n');
  executable(join(bin, 'tailscale'), `#!/bin/sh
printf '%s\n' "$*" >> "$TAILSCALE_TEST_LOG"
if [ "$1" = status ] && [ "\${FAKE_TAILSCALE_UP:-1}" != 1 ]; then exit 1; fi
if [ "$1 $2" = 'serve status' ]; then printf 'https://pop.example.ts.net\n'; fi
`);
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TAILSCALE_TEST_LOG: log,
    },
  };
}

function run(env: NodeJS.ProcessEnv, args: string[] = []) {
  return spawnSync(resolve(import.meta.dirname, '../deploy/configure-tailscale.sh'), args, { encoding: 'utf8', env });
}

describe('Tailscale Serve helper', () => {
  it('checks local health and the existing tailnet before configuring HTTPS Serve', () => {
    const input = fixture();
    const result = run(input.env, ['--port', '9123']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(input.log, 'utf8').trim().split('\n')).toEqual([
      'status',
      'serve --bg http://127.0.0.1:9123',
      'serve status',
    ]);
    expect(result.stdout).toContain('Pop Agent remains bound to loopback');
  });

  it('does not configure Serve when health or Tailscale authentication fails', () => {
    const unhealthy = fixture();
    const unhealthyResult = run({ ...unhealthy.env, FAKE_HEALTHY: '0' });
    expect(unhealthyResult.status).not.toBe(0);
    expect(unhealthyResult.stderr).toContain('is not healthy');
    expect(() => readFileSync(unhealthy.log, 'utf8')).toThrow();

    const signedOut = fixture();
    const signedOutResult = run({ ...signedOut.env, FAKE_TAILSCALE_UP: '0' });
    expect(signedOutResult.status).not.toBe(0);
    expect(signedOutResult.stderr).toContain('not authenticated');
    expect(readFileSync(signedOut.log, 'utf8').trim()).toBe('status');
  });
});
