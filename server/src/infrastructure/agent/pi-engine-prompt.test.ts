import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, autoSkillsInstruction, buildPlanToolNames } from './pi-engine.js';
import { A2A_TOOL_NAMES } from './a2a-tools.js';

describe('Pop Agent system prompt', () => {
  it('reads the normative specs and implementation before a self-change', () => {
    const specRule = 'start with docs/specs/Spec-Pop-General.md';
    const deliveryRule = "the work is not delivered until you review the diff";
    expect(SYSTEM_PROMPT).toContain(specRule);
    expect(SYSTEM_PROMPT).toContain('read the focused specifications relevant to the request');
    expect(SYSTEM_PROMPT).toContain('inspect the current code and tests');
    expect(SYSTEM_PROMPT.indexOf(specRule)).toBeLessThan(SYSTEM_PROMPT.indexOf(deliveryRule));
  });

  it('treats a committed clean checkout as part of completing a self-change', () => {
    expect(SYSTEM_PROMPT).toContain("the work is not delivered until you review the diff");
    expect(SYSTEM_PROMPT).toContain('run checks appropriate to the change');
    expect(SYSTEM_PROMPT).toContain('commit only the related files');
    expect(SYSTEM_PROMPT).toContain('verify the resulting git status');
    expect(SYSTEM_PROMPT).toContain('After a timeout or resumed turn, inspect the real repository state');
  });

  it('uses a fail-closed read-only tool catalogue in Plan Mode', () => {
    const tools = buildPlanToolNames(['mcp_weather_forecast']);
    expect(tools).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'local_read']));
    expect(tools).toContain('mcp_weather_forecast');
    expect(tools).not.toEqual(
      expect.arrayContaining(['bash', 'write', 'edit', 'notes_write', 'delete_file', 'delegate_worker']),
    );
    for (const a2aTool of A2A_TOOL_NAMES) expect(tools).not.toContain(a2aTool);
  });

  it('describes explicit skill requests truthfully for both states', () => {
    expect(autoSkillsInstruction(false)).toContain('disabled');
    expect(autoSkillsInstruction(true)).toContain('not guaranteed');
    expect(autoSkillsInstruction(false)).toContain('Explicit owner creation or editing is still available');
    expect(SYSTEM_PROMPT).toContain('Do not create skills unsolicited');
    expect(buildPlanToolNames([])).toContain('skill_read');
    expect(buildPlanToolNames([])).not.toContain('skill_write');
    expect(autoSkillsInstruction(true)).toContain('independent review');
  });
});
