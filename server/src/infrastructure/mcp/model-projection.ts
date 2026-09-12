import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import { envelope } from '../../domain/safety/sanitize.js';

/** Preserve the discovered JSON Schema, including required fields and nested constraints. */
export function mcpParameters(schema: Record<string, unknown>) {
  return Type.Unsafe<Record<string, unknown>>(structuredClone(schema));
}

/** Drop only a structured result already represented identically in a text block. */
export function mcpModelResult(raw: string): string {
  let result: unknown;
  try { result = JSON.parse(raw) as unknown; } catch { return raw; }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return raw;
  const record = result as Record<string, unknown>;
  if (!Object.hasOwn(record, 'structuredContent') || !Array.isArray(record['content'])) return raw;
  const duplicate = record['content'].some((block: unknown) => {
    if (typeof block !== 'object' || block === null) return false;
    const entry = block as Record<string, unknown>;
    if (entry['type'] !== 'text' || typeof entry['text'] !== 'string') return false;
    try { return isDeepStrictEqual(JSON.parse(entry['text']) as unknown, record['structuredContent']); }
    catch { return false; }
  });
  if (!duplicate) return raw;
  const copy = { ...record };
  delete copy['structuredContent'];
  return JSON.stringify(copy);
}

/** MCP-level tool failures must become failed pi tools, with untrusted detail intact. */
export function mcpToolText(raw: string, source: string): string {
  const text = envelope(mcpModelResult(raw), source);
  let result: unknown;
  try { result = JSON.parse(raw) as unknown; } catch { return text; }
  if (typeof result === 'object' && result !== null &&
      (result as Record<string, unknown>)['isError'] === true) throw new Error(text);
  return text;
}
