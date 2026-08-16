import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, PROVIDER_ID } from './pi-engine.js';

/**
 * SDK contract check (pop-agent.spec §15): every pi API Pop Agent relies on must
 * exist. This same check runs inside the update gate before a new pi
 * version is accepted — if pi renames or removes something we use, this
 * fails before the update ever activates.
 */
describe('pi sdk contract', () => {
  it(
    'exports the APIs Pop Agent depends on',
    { timeout: 30_000 },
    async () => {
      const sdk = await import('@earendil-works/pi-coding-agent');

      expect(typeof sdk.createAgentSession).toBe('function');
      expect(typeof sdk.defineTool).toBe('function');
      expect(typeof sdk.SessionManager?.create).toBe('function');
      expect(typeof sdk.SessionManager?.open).toBe('function');
      expect(typeof sdk.SessionManager?.inMemory).toBe('function');

      // The bridge drives these; a rename here is a silent breakage everywhere
      // else, so it fails the gate instead.
      const session = Object.getOwnPropertyNames(sdk.AgentSession.prototype);
      for (const method of [
        'subscribe',
        'prompt',
        'steer',
        'clearQueue',
        'abort',
        'compact',
        'getSessionStats',
        'setSessionName',
        'exportToHtml',
        'exportToJsonl',
        'getUserMessagesForForking',
        'setModel',
        'dispose',
        // Where pi keeps the conversation. Pop Agent stores the path, never reads
        // the file, and hands it back when the chat wakes up again.
        'sessionFile',
      ]) {
        expect(session, `AgentSession.${method}`).toContain(method);
      }

      const manager = Object.getOwnPropertyNames(sdk.SessionManager.prototype);
      expect(manager).toContain('createBranchedSession');

      // The model runtime is how the key and the catalog stay Pop Agent's own
      // rather than whatever ~/.pi happens to hold (docs/agent-flow.md §8).
      expect(typeof sdk.ModelRuntime?.create).toBe('function');
      const runtime = Object.getOwnPropertyNames(sdk.ModelRuntime.prototype);
      for (const method of ['getModel', 'getModels', 'setRuntimeApiKey']) {
        expect(runtime, `ModelRuntime.${method}`).toContain(method);
      }
    },
  );

  it(
    'still ships the default model in its built-in catalog',
    { timeout: 30_000 },
    async () => {
      // Offline on purpose: no auth file, no models.json, no network. If this
      // stops resolving, a pi release dropped the row Pop Agent defaults to and the
      // first thing a user would see is a chat that cannot answer.
      const sdk = await import('@earendil-works/pi-coding-agent');
      const runtime = await sdk.ModelRuntime.create({
        authPath: join(mkdtempSync(join(tmpdir(), 'pop-sdk-')), 'auth.json'),
        modelsPath: null,
        allowModelNetwork: false,
      });

      const model = runtime.getModel(PROVIDER_ID, DEFAULT_MODEL_ID);
      expect(model?.id).toBe(DEFAULT_MODEL_ID);
      expect(model?.cost.input).toBeGreaterThan(0);
      expect(model?.cost.output).toBeGreaterThan(0);
    },
  );
});
