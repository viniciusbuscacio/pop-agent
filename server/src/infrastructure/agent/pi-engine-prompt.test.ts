import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, autoSkillsInstruction, buildPlanToolNames } from './pi-engine.js';

describe('Pop Agent system prompt', () => {
  it('treats a committed clean checkout as part of completing a self-change', () => {
    expect(SYSTEM_PROMPT).toContain("the work is not delivered until you review the diff");
    expect(SYSTEM_PROMPT).toContain('run the repository gate');
    expect(SYSTEM_PROMPT).toContain('commit only the related files');
    expect(SYSTEM_PROMPT).toContain('verify the resulting git status');
    expect(SYSTEM_PROMPT).toContain('After a timeout or resumed turn, inspect the real repository state');
  });

  it('uses a fail-closed read-only tool catalogue in Plan Mode', () => {
    const tools = buildPlanToolNames(['mcp_weather_forecast']);
    expect(tools).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'local_read']));
    expect(tools).toContain('mcp_weather_forecast');
    expect(tools).not.toEqual(expect.arrayContaining(['bash', 'write', 'edit', 'notes_write', 'delete_file']));
  });

  it('describes explicit skill requests truthfully for both states', () => {
    expect(autoSkillsInstruction(false)).toContain('disabled');
    expect(autoSkillsInstruction(true)).toContain('activated automatically');
    expect(autoSkillsInstruction(true)).toContain('independent review');
  });
});
