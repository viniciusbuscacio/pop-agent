import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, expectedVersion] = process.argv.slice(2);
if (root === undefined || expectedVersion === undefined) throw new Error('candidate probe arguments missing');
const packageRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  version?: string;
  exports?: { '.'?: { import?: string } };
};
if (packageJson.version !== expectedVersion) throw new Error('candidate package version mismatch');
const exportedEntry = packageJson.exports?.['.']?.import;
if (exportedEntry === undefined || !exportedEntry.startsWith('./')) {
  throw new Error('candidate package has no safe ESM entry');
}
const entry = join(packageRoot, exportedEntry);
const sdk = await import(pathToFileURL(entry).href) as typeof import('@earendil-works/pi-coding-agent');
if (typeof sdk.createAgentSession !== 'function') throw new Error('pi SDK export missing: createAgentSession');
if (typeof sdk.defineTool !== 'function') throw new Error('pi SDK export missing: defineTool');
if (sdk.SessionManager === undefined) throw new Error('pi SDK export missing: SessionManager');
if (sdk.SettingsManager === undefined) throw new Error('pi SDK export missing: SettingsManager');
if (sdk.ModelRuntime === undefined) throw new Error('pi SDK export missing: ModelRuntime');
if (sdk.AgentSession === undefined) throw new Error('pi SDK export missing: AgentSession');
for (const method of ['subscribe', 'prompt', 'steer', 'clearQueue', 'abort', 'compact', 'setModel', 'dispose', 'sessionFile']) {
  if (!Object.getOwnPropertyNames(sdk.AgentSession.prototype).includes(method)) {
    throw new Error(`pi AgentSession contract missing: ${method}`);
  }
}
for (const method of ['getModel', 'getModels', 'setRuntimeApiKey', 'registerProvider']) {
  if (!Object.getOwnPropertyNames(sdk.ModelRuntime.prototype).includes(method)) {
    throw new Error(`pi ModelRuntime contract missing: ${method}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'pop-pi-candidate-'));
try {
  const runtime = await sdk.ModelRuntime.create({
    authPath: join(scratch, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const model = runtime.getModel('openrouter', 'moonshotai/kimi-k3');
  if (model === undefined) throw new Error('pi candidate dropped the Pop Agent default model');
  const { session } = await sdk.createAgentSession({
    cwd: scratch,
    agentDir: join(scratch, 'agent'),
    modelRuntime: runtime,
    model,
    sessionManager: sdk.SessionManager.inMemory(),
    settingsManager: sdk.SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
    tools: [],
  });
  await session.dispose();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, version: expectedVersion })}\n`);
