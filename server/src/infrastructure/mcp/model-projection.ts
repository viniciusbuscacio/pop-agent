import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';

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
