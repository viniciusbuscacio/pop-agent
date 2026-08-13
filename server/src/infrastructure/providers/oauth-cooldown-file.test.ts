import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileOAuthCooldownStore } from './oauth-cooldown-file.js';

describe('FileOAuthCooldownStore', () => {
  it('survives a new store instance and clears one provider only', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pop-oauth-cooldown-')), 'cooldowns.json');
    const first = new FileOAuthCooldownStore(path);
    first.set('github-copilot', 123_000);
    first.set('openai-codex', 456_000);

    const afterRestart = new FileOAuthCooldownStore(path);
    expect(afterRestart.get('github-copilot')).toBe(123_000);
    expect(afterRestart.get('openai-codex')).toBe(456_000);

    afterRestart.set('github-copilot', undefined);
    expect(new FileOAuthCooldownStore(path).get('github-copilot')).toBeUndefined();
    expect(new FileOAuthCooldownStore(path).get('openai-codex')).toBe(456_000);
  });

  it('ignores a corrupt file and never stores secrets', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pop-oauth-cooldown-')), 'cooldowns.json');
    writeFileSync(path, '{broken', 'utf8');
    const store = new FileOAuthCooldownStore(path);

    expect(store.get('github-copilot')).toBeUndefined();
    store.set('github-copilot', 789_000);

    const raw = readFileSync(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      cooldowns: { 'github-copilot': 789_000 },
    });
    expect(raw).not.toMatch(/token|credential|secret/i);
  });
});
