import { describe, expect, it } from 'vitest';

/**
 * SDK contract check (popy.spec §15): every pi API Popy relies on must
 * exist. This same check runs inside the update gate before a new pi
 * version is accepted — if pi renames or removes something we use, this
 * fails before the update ever activates.
 */
describe('pi sdk contract', () => {
  it(
    'exports the APIs Popy depends on',
    { timeout: 30_000 },
    async () => {
      const sdk = await import('@earendil-works/pi-coding-agent');

      expect(typeof sdk.createAgentSession).toBe('function');
      expect(typeof sdk.defineTool).toBe('function');
      expect(typeof sdk.SessionManager?.create).toBe('function');
      expect(typeof sdk.SessionManager?.open).toBe('function');
      expect(typeof sdk.SessionManager?.inMemory).toBe('function');

      // The bridge drives these three; a rename here is a silent breakage
      // everywhere else, so it fails the gate instead.
      const session = Object.getOwnPropertyNames(sdk.AgentSession.prototype);
      for (const method of ['subscribe', 'prompt', 'abort', 'setModel', 'dispose']) {
        expect(session, `AgentSession.${method}`).toContain(method);
      }
    },
  );
});
