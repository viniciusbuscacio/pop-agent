import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function block(path: string): string {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('# BEGIN INSTALL JOURNAL')[1]!.split('# END INSTALL JOURNAL')[0]!;
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pop-install-journal-')); roots.push(root);
  const script = join(root, 'test.sh');
  return { root, script, env: { ...process.env, HOME: root, XDG_STATE_HOME: root } };
}
describe('installer journal', () => {
  it('keeps both standalone entry points on the same journal contract', () => {
    expect(block('../server-install.sh')).toBe(block('../deploy/bootstrap-server.sh'));
  });
  it('preserves failure status and logs phases without raw terminal secrets', () => {
    const f = fixture();
    writeFileSync(f.script, '#!/bin/sh\nset -eu\n# BEGIN INSTALL JOURNAL' + block('../server-install.sh') + `
trap 'install_log_finish $?' EXIT
install_phase manifest-download
printf '%s\n' 'Authorization: Bearer fake-private-token' 'One-time setup code: ABCD-EFGH-JKLM'
printf '%s\n' 'password=secret-test-value' >&2
exit 23
`);
    const result = spawnSync('sh', [f.script], { env: f.env, encoding: 'utf8' });
    expect(result.status).toBe(23);
    const dir = join(f.root, 'pop-agent/install-logs');
    const path = join(dir, readdirSync(dir)[0]!);
    const log = readFileSync(path, 'utf8');
    expect(log).toContain('phase=manifest-download');
    expect(log).toContain('exit_code=23');
    expect(log).toContain('duration_seconds=');
    for (const secret of ['fake-private-token', 'ABCD-EFGH-JKLM', 'secret-test-value']) expect(log).not.toContain(secret);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(result.stderr).toContain(path);
  });
  it('carries runtime events over an inherited descriptor and does not log child output', () => {
    const f = fixture();
    const nodeScript = join(f.root, 'child.mjs');
    writeFileSync(nodeScript, `import { installEvent } from ${JSON.stringify(new URL('./install-journal.ts', import.meta.url).href)};
installEvent('release-identity', { version: '1.2.3', commit: 'abcdef' });
console.log('secret-child-output');
`);
    writeFileSync(f.script, '#!/bin/sh\nset -eu\n# BEGIN INSTALL JOURNAL' + block('../deploy/bootstrap-server.sh') + `
trap 'install_log_finish $?' EXIT
"$TEST_NODE" "$TEST_SCRIPT"
`);
    const result = spawnSync('sh', [f.script], { env: { ...f.env, TEST_NODE: process.execPath, TEST_SCRIPT: nodeScript }, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const dir = join(f.root, 'pop-agent/install-logs');
    const log = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
    expect(log).toContain('event=release-identity version=1.2.3 commit=abcdef');
    expect(log).toContain('exit_code=0');
    expect(log).not.toContain('secret-child-output');
  });
  it('refuses a symlink log directory without overwriting its target', () => {
    const f = fixture();
    writeFileSync(f.script, '#!/bin/sh\n# BEGIN INSTALL JOURNAL' + block('../server-install.sh'));
    spawnSync('sh', [f.script], { env: f.env });
    const dir = join(f.root, 'pop-agent/install-logs');
    rmSync(dir, { recursive: true }); symlinkSync(f.root, dir);
    const result = spawnSync('sh', [f.script], { env: f.env, encoding: 'utf8' });
    expect(result.stderr).toContain('logging could not be initialized');
    expect(readdirSync(f.root).some((file) => file.endsWith('.log'))).toBe(false);
  });
});
