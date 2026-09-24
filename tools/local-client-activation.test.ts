import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clientPackFixture } from './client-pack-fixture.ts';
import { activateLocalClients, validatePreparedLocal, validateLocalServiceTarget, type LocalActivationHooks } from './local-client-activation.ts';
import { createHash } from 'node:crypto';
import { validateClientPack } from './client-pack.ts';
const roots: string[] = [];
const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pop-local-activation-'));
    roots.push(root);
    const put = (name: string, text: string) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); };
    put('.gitignore', 'cli/pack/\nserver/dist/\nshared/dist/\nweb/dist/\n');
    clientPackFixture(root);
    const runtime: Record<string, string> = {};
    for (const name of ['server/dist/main.js', 'server/dist/manager/main.js', 'shared/dist/index.js', 'web/dist/index.html']) {
        put(name, 'built');
        runtime[name] = createHash('sha256').update('built').digest('hex');
    }
    git(root, ['init', '-q']);
    git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    const receipt = { schema: 1, commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), clientDigest: validateClientPack(root).digest, runtime };
    const receiptPath = resolve(root, git(root, ['rev-parse', '--git-path', 'pop-client-prepared.json']));
    writeFileSync(receiptPath, JSON.stringify(receipt));
    writeFileSync(resolve(root, git(root, ['rev-parse', '--git-path', 'pop-agent-gate-receipt.json'])), JSON.stringify({ tree: receipt.tree, node: process.version, completedAt: new Date().toISOString() }));
    return root;
}
afterEach(() => { for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true }); });
function hooks(previous: string) {
    const calls: string[] = [];
    let active = previous;
    const h: LocalActivationHooks = { current: () => active, idle: () => true, install: root => { calls.push('install'); active = root; }, restore: () => { calls.push('restore'); active = previous; }, restart: () => { calls.push('restart'); }, healthy: async () => { }, bootstrap: async () => { calls.push('bootstrap'); }, identity: root => active === root };
    return { h, calls };
}
describe('guarded local activation', () => {
    it('binds idle checks and probes to the effective service configuration', () => {
        const data = fixture(), other = fixture(), environment = `POP_AGENT_DATA_DIR=${data} POP_AGENT_PORT=8787`;
        expect(() => validateLocalServiceTarget(environment, data, 'http://127.0.0.1:8787')).not.toThrow();
        expect(() => validateLocalServiceTarget(environment, other, 'http://127.0.0.1:8787')).toThrow('DATA_DIR differs');
        expect(() => validateLocalServiceTarget(environment, data, 'http://127.0.0.1:9999')).toThrow('Origin port differs');
    });
    it('accepts unchanged prepared runtime and commits', () => { expect(validatePreparedLocal(fixture()).version).toBe('1.0.0'); });
    it.each(['cli/pack/cli-1.0.0.tgz', 'server/dist/main.js'])('rejects %s changed after preparation without service mutation', async (name) => {
        const root = fixture(), previous = fixture(), { h, calls } = hooks(previous);
        writeFileSync(join(root, name), 'changed');
        await expect(activateLocalClients(root, h)).rejects.toThrow();
        expect(calls).toEqual([]);
    });
    it('rejects an incomplete rollback before touching the service', async () => {
        const root = fixture(), previous = fixture(), { h, calls } = hooks(previous);
        rmSync(join(previous, 'cli/pack'), { recursive: true });
        await expect(activateLocalClients(root, h)).rejects.toThrow();
        expect(calls).toEqual([]);
    });
    it('rejects a busy service without mutation', async () => { const root = fixture(), { h, calls } = hooks(fixture()); h.idle = () => false; await expect(activateLocalClients(root, h)).rejects.toThrow('active or queued'); expect(calls).toEqual([]); });
    it('verifies identity and bootstrap on success', async () => { const root = fixture(), { h, calls } = hooks(fixture()); await activateLocalClients(root, h); expect(calls).toEqual(['install', 'restart', 'bootstrap']); });
    it('restores and validates previous clients after bootstrap failure', async () => {
        const root = fixture(), { h, calls } = hooks(fixture());
        let n = 0;
        h.bootstrap = async () => { calls.push('bootstrap'); if (n++ === 0)
            throw Error('manifest 404'); };
        await expect(activateLocalClients(root, h)).rejects.toThrow('manifest 404');
        expect(calls).toEqual(['install', 'restart', 'bootstrap', 'restore', 'restart', 'bootstrap']);
    });
    it('restores the override without restarting if work arrives before the first restart', async () => {
        const root = fixture(), { h, calls } = hooks(fixture());
        let n = 0;
        h.idle = () => ++n < 3;
        await expect(activateLocalClients(root, h)).rejects.toThrow('New work arrived before restart');
        expect(calls).toEqual(['install', 'restore', 'bootstrap']);
    });
    it('does not restart active work during rollback', async () => {
        const root = fixture(), { h, calls } = hooks(fixture());
        let n = 0;
        h.idle = () => ++n < 4;
        h.bootstrap = async () => { throw Error('bootstrap failed'); };
        await expect(activateLocalClients(root, h)).rejects.toThrow('Activation and rollback failed');
        expect(calls).toEqual(['install', 'restart']);
    });
    it('reports rollback failure rather than successful recovery', async () => {
        const root = fixture(), { h } = hooks(fixture());
        h.bootstrap = async () => { throw Error('bootstrap failure'); };
        await expect(activateLocalClients(root, h)).rejects.toThrow('Activation and rollback failed');
    });
    it('rejects an expired gate before mutation', async () => {
        const root = fixture(), { h, calls } = hooks(fixture());
        const p = join(root, '.git/pop-agent-gate-receipt.json');
        const gate = JSON.parse(readFileSync(p, 'utf8'));
        gate.completedAt = '2000-01-01T00:00:00Z';
        writeFileSync(p, JSON.stringify(gate));
        await expect(activateLocalClients(root, h)).rejects.toThrow('gate');
        expect(calls).toEqual([]);
    });
});
