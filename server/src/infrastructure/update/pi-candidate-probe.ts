import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

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
const requiredFunctions = [
  'createAgentSession',
  'defineTool',
  'createBashToolDefinition',
  'createReadToolDefinition',
  'createWriteToolDefinition',
  'createEditToolDefinition',
] as const;
for (const name of requiredFunctions) {
  if (typeof sdk[name] !== 'function') throw new Error(`pi SDK export missing: ${name}`);
}
for (const name of ['SessionManager', 'SettingsManager', 'ModelRuntime', 'AgentSession', 'DefaultResourceLoader'] as const) {
  if (sdk[name] === undefined) throw new Error(`pi SDK export missing: ${name}`);
}
for (const method of ['create', 'open', 'inMemory']) {
  if (typeof sdk.SessionManager[method as keyof typeof sdk.SessionManager] !== 'function') {
    throw new Error(`pi SessionManager static contract missing: ${method}`);
  }
}
if (typeof sdk.SettingsManager.inMemory !== 'function') {
  throw new Error('pi SettingsManager static contract missing: inMemory');
}
if (typeof sdk.ModelRuntime.create !== 'function') {
  throw new Error('pi ModelRuntime static contract missing: create');
}
const agentSessionMethods = [
  'subscribe',
  'prompt',
  'steer',
  'clearQueue',
  'abort',
  'compact',
  'getActiveToolNames',
  'setActiveToolsByName',
  'setSteeringMode',
  'getSessionStats',
  'setSessionName',
  'exportToHtml',
  'exportToJsonl',
  'getUserMessagesForForking',
  'setModel',
  'dispose',
  'sessionFile',
] as const;
for (const method of agentSessionMethods) {
  if (!Object.getOwnPropertyNames(sdk.AgentSession.prototype).includes(method)) {
    throw new Error(`pi AgentSession contract missing: ${method}`);
  }
}
const sessionManagerMethods = [
  'getSessionDir',
  'getCwd',
  'getLeafId',
  'getEntry',
  'getBranch',
  'buildSessionContext',
  'branch',
  'resetLeaf',
  'createBranchedSession',
] as const;
for (const method of sessionManagerMethods) {
  if (!Object.getOwnPropertyNames(sdk.SessionManager.prototype).includes(method)) {
    throw new Error(`pi SessionManager contract missing: ${method}`);
  }
}
const modelRuntimeMethods = [
  'getModel',
  'getModels',
  'getAuth',
  'refresh',
  'setRuntimeApiKey',
  'registerProvider',
  'completeSimple',
  'login',
  'logout',
] as const;
for (const method of modelRuntimeMethods) {
  if (!Object.getOwnPropertyNames(sdk.ModelRuntime.prototype).includes(method)) {
    throw new Error(`pi ModelRuntime contract missing: ${method}`);
  }
}
for (const method of ['reload', 'getExtensions']) {
  if (!Object.getOwnPropertyNames(sdk.DefaultResourceLoader.prototype).includes(method)) {
    throw new Error(`pi DefaultResourceLoader contract missing: ${method}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'pop-pi-candidate-'));
try {
  const probeAgentDir = join(scratch, 'agent');
  process.env.PI_CODING_AGENT_DIR = probeAgentDir;
  const subagentExtensionPath = join(process.cwd(), 'node_modules', 'pi-subagents', 'index.ts');
  const extensionLoader = new sdk.DefaultResourceLoader({
    cwd: scratch,
    agentDir: probeAgentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [subagentExtensionPath],
  });
  await extensionLoader.reload();
  const extensionResult = extensionLoader.getExtensions();
  if (extensionResult.errors.length > 0) {
    throw new Error(`pi candidate cannot load pi-subagents: ${extensionResult.errors.map((item) => item.error).join('; ')}`);
  }
  const subagentToolNames = extensionResult.extensions
    .find((item) => item.resolvedPath === subagentExtensionPath || item.path === subagentExtensionPath)
    ?.tools.keys();
  if (subagentToolNames === undefined || !new Set(subagentToolNames).has('subagent')) {
    throw new Error('pi candidate did not receive the pi-subagents tool');
  }

  const runtime = await sdk.ModelRuntime.create({
    authPath: join(scratch, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
  });
  if (runtime.getModel('openrouter', 'moonshotai/kimi-k3') === undefined) {
    throw new Error('pi candidate dropped the Pop Agent default model');
  }

  let requestCount = 0;
  let toolResultReturned = false;
  let abortRequestStarted!: () => void;
  const abortStarted = new Promise<void>((resolve) => { abortRequestStarted = resolve; });
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      requestCount += 1;
      if (requestCount === 2) toolResultReturned = body.includes('candidate tool ok');
      if (requestCount === 3) {
        abortRequestStarted();
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunks = requestCount === 1
        ? [
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'candidate_probe', arguments: '{}' } }] }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          ]
        : [
            { choices: [{ delta: { content: 'candidate turn ok' }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
          ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('candidate fake provider did not bind');
  const provider = 'pop-candidate-probe';
  runtime.registerProvider(provider, {
    name: 'Pop candidate probe',
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    api: 'openai-completions',
    models: [{
      id: 'probe', name: 'probe', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000, maxTokens: 1_000,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
    }],
  });
  await runtime.setRuntimeApiKey(provider, 'candidate-probe-key');
  const model = runtime.getModel(provider, 'probe');
  if (model === undefined) throw new Error('candidate custom provider registration failed');
  const typebox = await import(pathToFileURL(join(packageRoot, 'node_modules', 'typebox', 'build', 'index.mjs')).href) as typeof import('typebox');
  let toolRuns = 0;
  const candidateTool = sdk.defineTool({
    name: 'candidate_probe',
    label: 'Candidate probe',
    description: 'Offline candidate validation tool',
    parameters: typebox.Type.Object({}),
    execute: () => {
      toolRuns += 1;
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'candidate tool ok' }],
        details: undefined,
      });
    },
  });
  const { session } = await sdk.createAgentSession({
    cwd: scratch,
    agentDir: join(scratch, 'agent'),
    modelRuntime: runtime,
    model,
    sessionManager: sdk.SessionManager.inMemory(),
    settingsManager: sdk.SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
    customTools: [candidateTool],
  });
  try {
    if (session.sessionManager === undefined || session.agent === undefined) {
      throw new Error('pi AgentSession runtime contract missing: sessionManager/agent');
    }
    session.setSteeringMode('all');
    session.setActiveToolsByName(session.getActiveToolNames());
    await session.prompt('Run the candidate probe tool.');
    if (toolRuns !== 1 || !toolResultReturned || requestCount !== 2) {
      throw new Error(`candidate tool/event turn contract failed: toolRuns=${String(toolRuns)} toolResult=${String(toolResultReturned)} requests=${String(requestCount)}`);
    }
    const pendingAbort = session.prompt('This request must be aborted.');
    await Promise.race([
      abortStarted,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('candidate abort request did not start')), 5_000)),
    ]);
    await session.abort();
    await pendingAbort;
  } finally {
    await session.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, version: expectedVersion })}\n`);
