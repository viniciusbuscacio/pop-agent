import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePreferenceStore } from './preference-file.js';

describe('FilePreferenceStore', () => {
  it('round-trips UI preferences in its own private file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pop-cli-preferences-'));
    try {
      const path = join(dir, 'nested', 'preferences.json');
      const store = new FilePreferenceStore(path);

      expect(store.read()).toEqual({});
      store.write({ showThinking: false });

      expect(store.read()).toEqual({ showThinking: false });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ showThinking: false });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
