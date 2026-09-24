import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateClientPack, verifyClientBootstrap, type ClientPack } from './client-pack.ts';
import { systemdCommandIdentity } from './install-systemd.ts';
import { stageClients } from './client-release.ts';
const unit = 'pop-agent-service.service';
const override = '/etc/systemd/system/pop-agent-service.service.d/zzzz-pop-client-activation.conf';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const command = (name: string, args: string[]) => execFileSync(name, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (root: string, args: string[]) => command('git', ['-C', root, ...args]);
interface Prepared {
    schema: 1;
    commit: string;
    tree: string;
    clientDigest: string;
    runtime: Record<string, string>;
}
export interface LocalActivationHooks {
    current: () => string;
    idle: () => boolean;
    install: (root: string) => void;
    restore: () => void;
    restart: () => void;
    healthy: () => Promise<void>;
    bootstrap: (pack: ClientPack) => Promise<void>;
    identity: (root: string) => boolean;
}
function safeRoot(value: string): string {
    const root = realpathSync(value);
    if (!/^\/[A-Za-z0-9._+@/-]+$/.test(root) || root === '/')
        throw Error('Unsafe checkout path');
    return root;
}
function receiptPath(root: string): string { return resolve(root, git(root, ['rev-parse', '--git-path', 'pop-client-prepared.json'])); }
function runtimeFiles(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    const visit = (name: string) => {
        const p = join(root, name), stat = lstatSync(p);
        if (stat.isSymbolicLink())
            throw Error(`Runtime symlink not allowed: ${name}`);
        if (stat.isDirectory())
            for (const child of readdirSync(p).sort())
                visit(`${name}/${child}`);
        else if (stat.isFile())
            files[name] = sha(readFileSync(p));
        else
            throw Error(`Invalid runtime file: ${name}`);
    };
    for (const name of ['server/dist', 'shared/dist', 'web/dist'])
        visit(name);
    if (existsSync(join(root, 'vendor')))
        visit('vendor');
    for (const name of ['server/dist/main.js', 'server/dist/manager/main.js', 'web/dist/index.html'])
        if (!files[name])
            throw Error(`Missing runtime file: ${name}`);
    return files;
}
function snapshot(root: string): Prepared {
    if (git(root, ['status', '--porcelain']) !== '')
        throw Error('Local deployment requires a clean committed checkout');
    return { schema: 1, commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), clientDigest: validateClientPack(root).digest, runtime: runtimeFiles(root) };
}
/** Preparation is separate from activation; it cannot touch systemd. */
export async function prepareLocalClients(checkout: string, cache: string): Promise<void> {
    const root = safeRoot(checkout);
    if (git(root, ['status', '--porcelain']) !== '')
        throw Error('Commit the candidate before preparation');
    await stageClients(root, resolve(cache));
    const receipt = snapshot(root), target = receiptPath(root), temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
    renameSync(temporary, target);
}
export function validatePreparedLocal(checkout: string): ClientPack {
    const root = safeRoot(checkout), prepared = JSON.parse(readFileSync(receiptPath(root), 'utf8')) as Prepared;
    if (JSON.stringify(snapshot(root)) !== JSON.stringify(prepared))
        throw Error('Prepared checkout or clients changed');
    const gate = JSON.parse(readFileSync(resolve(root, git(root, ['rev-parse', '--git-path', 'pop-agent-gate-receipt.json'])), 'utf8')) as {
        tree: string;
        node: string;
        completedAt: string;
    };
    const age = Date.now() - Date.parse(gate.completedAt);
    if (gate.tree !== prepared.tree || gate.node !== process.version || !Number.isFinite(age) || age < 0 || age > 86400000)
        throw Error('Missing or expired exact-tree gate receipt');
    return validateClientPack(root);
}
/** The caller owns the host lock. A rejected preflight never invokes mutation hooks. */
export async function activateLocalClients(checkout: string, hooks: LocalActivationHooks): Promise<void> {
    const root = safeRoot(checkout), candidate = validatePreparedLocal(root), previous = safeRoot(hooks.current());
    if (previous === root)
        throw Error('Candidate is already running; use verify');
    const rollback = validateClientPack(previous);
    if (!hooks.idle())
        throw Error('Server has active or queued work; retry when idle');
    if (hooks.current() !== previous || validatePreparedLocal(root).digest !== candidate.digest || validateClientPack(previous).digest !== rollback.digest)
        throw Error('Deployment changed during preflight');
    if (!hooks.idle())
        throw Error('New work arrived before activation');
    let started = false, restartAttempted = false;
    try {
        started = true;
        hooks.install(root);
        if (!hooks.idle())
            throw Error('New work arrived before restart');
        restartAttempted = true;
        hooks.restart();
        await hooks.healthy();
        if (!hooks.identity(root))
            throw Error('Effective service does not match candidate');
        await hooks.bootstrap(candidate);
        if (validatePreparedLocal(root).digest !== candidate.digest)
            throw Error('Candidate changed during activation');
    }
    catch (error) {
        if (started) {
            try {
                if (validateClientPack(previous).digest !== rollback.digest)
                    throw Error('Rollback client pack changed');
                if (restartAttempted && !hooks.idle())
                    throw Error('Rollback deferred: server has active or queued work');
                hooks.restore();
                if (restartAttempted)
                    hooks.restart();
                await hooks.healthy();
                if (!hooks.identity(previous))
                    throw Error('Rollback service identity mismatch');
                await hooks.bootstrap(rollback);
            }
            catch (rollbackError) {
                throw new AggregateError([error, rollbackError], 'Activation and rollback failed; inspect the service before retrying');
            }
        }
        throw error;
    }
}
export function validateLocalServiceTarget(environment: string, dataDir: string, origin: string): void {
    const configuredData = /\bPOP_AGENT_DATA_DIR=([^\s"']+)/.exec(environment)?.[1];
    if (!configuredData || realpathSync(configuredData) !== realpathSync(dataDir))
        throw Error('DATA_DIR differs from the effective service configuration');
    const port = /\bPOP_AGENT_PORT=(\d+)/.exec(environment)?.[1] ?? '8787';
    if (new URL(origin).port !== port)
        throw Error('Origin port differs from the effective service configuration');
    if (new URL(origin).protocol !== 'http:')
        throw Error('Local service activation requires its HTTP origin');
}
async function hostActivate(root: string, dataDir: string, origin: string): Promise<void> {
    const state = join(homedir(), '.local/state/pop-agent');
    mkdirSync(state, { recursive: true, mode: 0o700 });
    const lock = join(state, 'local-activation.lock');
    mkdirSync(lock, { mode: 0o700 });
    try {
        const environment = command('systemctl', ['show', unit, '-p', 'Environment', '--value']);
        validateLocalServiceTarget(environment, dataDir, origin);
        const previousCommand = systemdCommandIdentity(command('systemctl', ['show', unit, '-p', 'ExecStart', '--value']));
        const previousOverride = existsSync(override) ? readFileSync(override) : undefined;
        const require = createRequire(join(root, 'package.json'));
        const Database = require('better-sqlite3') as new (path: string, options: {
            readonly: boolean;
            fileMustExist: boolean;
        }) => {
            prepare(sql: string): {
                get(): {
                    n: number;
                };
            };
            close(): void;
        };
        const db = new Database(join(dataDir, 'pop-agent.db'), { readonly: true, fileMustExist: true });
        const reload = () => command('sudo', ['--', 'systemctl', 'daemon-reload']);
        const current = () => command('systemctl', ['show', unit, '-p', 'WorkingDirectory', '--value']);
        const staged = join(lock, 'candidate.conf');
        const copyOverride = (bytes: Buffer | string) => { writeFileSync(staged, bytes, { mode: 0o600 }); command('sudo', ['--', 'install', '-o', 'root', '-g', 'root', '-m', '0644', staged, override]); reload(); };
        try {
            await activateLocalClients(root, {
                current,
                idle: () => db.prepare('SELECT COUNT(*) AS n FROM chat_run_journal').get().n === 0 && db.prepare('SELECT COUNT(*) AS n FROM queued_messages').get().n === 0,
                install: candidate => {
                    const node = safeRoot(process.execPath);
                    command('sudo', ['--', 'install', '-d', '-o', 'root', '-g', 'root', '-m', '0755', dirname(override)]);
                    copyOverride(`[Service]\nWorkingDirectory=${candidate}\nExecStart=\nExecStart=${node} ${candidate}/server/dist/main.js\n${existsSync(join(candidate, 'server/dist/audio/ffmpeg')) ? `Environment=POP_AGENT_FFMPEG=${candidate}/server/dist/audio/ffmpeg\n` : ''}`);
                },
                restore: () => { if (previousOverride)
                    copyOverride(previousOverride);
                else {
                    command('sudo', ['--', 'rm', '-f', override]);
                    reload();
                } },
                restart: () => { command('sudo', ['--', 'systemctl', 'restart', unit]); },
                identity: candidate => current() === candidate && command('systemctl', ['is-active', unit]) === 'active' && systemdCommandIdentity(command('systemctl', ['show', unit, '-p', 'ExecStart', '--value'])) === (candidate === root ? `${safeRoot(process.execPath)}\n${safeRoot(process.execPath)} ${root}/server/dist/main.js` : previousCommand),
                healthy: async () => {
                    for (let i = 0; i < 30; i++) {
                        try {
                            const response = await fetch(new URL('/healthz', origin), { redirect: 'error', signal: AbortSignal.timeout(2000) });
                            if (response.ok)
                                return;
                        }
                        catch { /* startup retry */ }
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    throw Error('Service health timeout');
                },
                bootstrap: pack => verifyClientBootstrap(origin, pack),
            });
        }
        finally {
            db.close();
        }
    }
    finally {
        rmSync(lock, { recursive: true, force: true });
    }
}
async function main(args: string[]): Promise<void> {
    const [action, checkout, value] = args;
    if (action === '--help' || action === 'help' || !action) {
        console.log('Usage: node tools/local-client-activation.ts prepare CHECKOUT CACHE | verify CHECKOUT [ORIGIN] | activate CHECKOUT DATA_DIR [ORIGIN]\nprepare reuses pinned clients and records runtime identity. activate requires a fresh exact-tree gate, clean candidate, valid rollback, and an idle server.');
        return;
    }
    if (!checkout)
        throw Error('Checkout is required');
    const root = safeRoot(checkout);
    if (action === 'prepare') {
        if (!value)
            throw Error('Cache directory is required');
        await prepareLocalClients(root, value);
        console.log('Client pack and prepared runtime receipt verified');
        return;
    }
    const origin = (action === 'verify' ? value : args[3]) ?? 'http://127.0.0.1:8787';
    const url = new URL(origin);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || !['http:', 'https:'].includes(url.protocol))
        throw Error('Use a credential-free loopback origin');
    if (action === 'verify') {
        const pack = validateClientPack(root);
        await verifyClientBootstrap(origin, pack);
        console.log(`Client bootstrap verified: CLI ${pack.version}, digest ${pack.digest}`);
        return;
    }
    if (action !== 'activate' || !value)
        throw Error('Expected prepare, verify, or activate with DATA_DIR');
    if (process.platform !== 'linux' || process.getuid?.() === 0)
        throw Error('Run activation as the non-root service owner');
    await hostActivate(root, resolve(value), origin);
    console.log('Local activation and client bootstrap verified');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    await main(process.argv.slice(2));
