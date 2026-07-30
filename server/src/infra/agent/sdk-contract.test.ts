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
    },
  );
});
