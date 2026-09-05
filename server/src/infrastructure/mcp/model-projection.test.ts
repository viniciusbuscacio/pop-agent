import { describe, expect, it } from 'vitest';
import { mcpModelResult, mcpParameters } from './model-projection.js';

describe('MCP model projection', () => {
  it('exposes required arguments and nested constraints without mutating discovery', () => {
    const schema = { type: 'object', required: ['query'], properties: { query: { type: 'string' }, language: { enum: ['python', 'csharp'] }, options: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } } } };
    const projected = mcpParameters(schema);
    expect(projected).toEqual(schema);
    expect(projected).not.toBe(schema);
  });
  it('removes an identical compatibility copy while keeping text annotations and metadata', () => {
    const content = [{ type: 'text', text: '{"b":2,"a":1}', annotations: { audience: ['assistant'] } }];
    const result = JSON.parse(mcpModelResult(JSON.stringify({ content, structuredContent: { a: 1, b: 2 }, isError: false, _meta: { trace: 'x' } }))) as unknown;
    expect(result).toEqual({ content, isError: false, _meta: { trace: 'x' } });
  });
  it('preserves distinct structured data, resource blocks and error information', () => {
    const raw = JSON.stringify({ content: [{ type: 'text', text: 'summary' }, { type: 'resource_link', uri: 'https://example.com' }], structuredContent: { detail: 42 }, isError: true });
    expect(mcpModelResult(raw)).toBe(raw);
  });
  it('preserves non-JSON results and structured-only results', () => {
    for (const raw of ['plain text', 'null', '[]', '{"structuredContent":{"value":1}}']) expect(mcpModelResult(raw)).toBe(raw);
  });
});
