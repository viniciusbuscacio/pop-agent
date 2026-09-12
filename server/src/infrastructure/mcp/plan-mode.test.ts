import { describe, expect, it } from 'vitest';
import { hasReadOnlyHint, mcpToolName } from './plan-mode.js';

describe('MCP tools in Plan Mode', () => {
  it('admits only an explicit standard read-only hint', () => {
    expect(hasReadOnlyHint({ annotations: { readOnlyHint: true } })).toBe(true);
    expect(hasReadOnlyHint({ annotations: { readOnlyHint: false } })).toBe(false);
    expect(hasReadOnlyHint({})).toBe(false);
    expect(hasReadOnlyHint({ annotations: 'read-only' })).toBe(false);
  });

  it('uses the same sanitized tool identity as normal MCP registration', () => {
    expect(mcpToolName('server-one', 'read/weather')).toBe('mcp_server_one_read_weather');
  });
});
