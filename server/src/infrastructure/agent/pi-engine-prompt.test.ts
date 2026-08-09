import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './pi-engine.js';

describe('Pop Agent system prompt', () => {
  it('treats a committed clean checkout as part of completing a self-change', () => {
    expect(SYSTEM_PROMPT).toContain("the work is not delivered until you review the diff");
    expect(SYSTEM_PROMPT).toContain('run the repository gate');
    expect(SYSTEM_PROMPT).toContain('commit only the related files');
    expect(SYSTEM_PROMPT).toContain('verify the resulting git status');
    expect(SYSTEM_PROMPT).toContain('After a timeout or resumed turn, inspect the real repository state');
  });
});
