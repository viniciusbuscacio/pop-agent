import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(action: string, ending = '') {
  const root = mkdtempSync(join(tmpdir(), 'pop-console-test-')); roots.push(root);
  const entry = join(root, 'installer.sh');
  if (action === 'auth') {
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin/sudo'), `#!/bin/bash
if [[ "$1" = -v ]]; then
  stty -echo < /dev/tty
  printf 'Fixture password: ' > /dev/tty
  IFS= read -r password < /dev/tty
  stty echo < /dev/tty
  [[ "$password" = D-secret-password ]] || exit 71
else
  [[ "$1" = -n ]] || exit 72
  printf 'sudo-command-complete\n'
fi
`, { mode: 0o700 });
  }
  writeFileSync(entry, `#!/bin/bash
${action === 'auth' ? 'sudo true' : ''}
printf '%s\n' 'Reading package lists... Done' 'warning: refs/tags/v1 is not a commit!'
printf '%s\n' 'Authorization: Bearer private-test-token' 'https://user:credential@example.test/file?key=secret'
printf '%s\n' '[pop-step] toolchain-download'
sleep 0.5
printf '%s\n' 'Downloading pinned official archive runtime.tar.xz...' 'package details after the key'
${ending || `printf '%s\n' 'Continue the private-network setup in a browser:' '  http://10.0.0.2:8788/setup' 'One-time setup code (valid for 15 minutes): ABCD-EFGH-JKLM'
exit 0`}
`);
  const result = spawnSync('python3', [
    resolve(import.meta.dirname, 'fixtures/install-console-pty.py'),
    resolve(import.meta.dirname, '../deploy/install-console.sh'), entry, root, action,
  ], { encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  const response = JSON.parse(result.stdout) as { output: string; status: number; restored: boolean };
  const dir = join(root, 'pop-agent/install-logs');
  const logPath = join(dir, readdirSync(dir).find(name => name.startsWith('details-'))!);
  return { ...response, log: readFileSync(logPath, 'utf8'), permissions: statSync(logPath).mode & 0o777 };
}

describe.skipIf(process.platform !== 'linux')('interactive installation presentation', () => {
  it('shows concise progress and setup while retaining redacted technical details', () => {
    const result = run('summary');
    expect(result.status).toBe(0);
    expect(result.output).toContain('Press D for detailed logs');
    expect(result.output).not.toContain('Reading package lists');
    expect(result.output).not.toContain('is not a commit');
    expect(result.output).toContain('ABCD-EFGH-JKLM');
    expect(result.output).toContain('popman onboarding-code');
    expect(result.log).toContain('Reading package lists');
    for (const secret of ['private-test-token', 'credential', 'key=secret', 'ABCD-EFGH-JKLM']) expect(result.log).not.toContain(secret);
    expect(result.permissions).toBe(0o600);
    expect(result.restored).toBe(true);
  });
  it('switches with D, replays prior details and streams later output', () => {
    const result = run('details');
    expect(result.status).toBe(0);
    expect(result.output).toContain('Detailed logs enabled');
    expect(result.output).toContain('Reading package lists');
    expect(result.output).toContain('package details after the key');
    expect(result.restored).toBe(true);
  });
  it('keeps password entry separate from the D listener and uses noninteractive sudo afterwards', () => {
    const result = run('auth');
    expect(result.status).toBe(0);
    expect(result.output).toContain('sudo-command-complete');
    expect(result.output).toContain('Detailed logs enabled');
    expect(result.output).not.toContain('D-secret-password');
    expect(result.log).not.toContain('D-secret-password');
    expect(result.restored).toBe(true);
  });
  it('supports verbose output from the beginning', () => {
    const result = run('verbose');
    expect(result.status).toBe(0);
    expect(result.output).toContain('Reading package lists');
    expect(result.output).not.toContain('Detailed logs enabled');
  });
  it('preserves failure codes and the final unterminated error line', () => {
    const result = run('summary', "printf 'E: failed-package-without-newline'; exit 23");
    expect(result.status).toBe(23);
    expect(result.output).toContain('Installation failed');
    expect(result.output).toContain('failed-package-without-newline');
    expect(result.log).toContain('failed-package-without-newline');
    expect(result.log).toContain('exit_code=23');
    expect(result.restored).toBe(true);
  });
  it('restores the terminal and stops the installer on Ctrl+C', () => {
    const result = run('interrupt', 'sleep 30');
    expect(result.status).toBe(130);
    expect(result.output).toContain('Installation interrupted');
    expect(result.log).toContain('event=interrupted');
    expect(result.restored).toBe(true);
  });
});
