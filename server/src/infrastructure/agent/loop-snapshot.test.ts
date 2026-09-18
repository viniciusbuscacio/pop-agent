import { describe, expect, it } from 'vitest';
import { createLoopSnapshot, LOOP_PAGE_CHARS, type LoopInspectArgs } from './loop-snapshot.js';
import type { LoopEvidence } from './loop-child.js';

const fixture = () => {
  const evidence: LoopEvidence[] = [
    { phase: 'worker', round: 1, kind: 'tool_result', text: 'x'.repeat(90_000), truncated: true, originalChars: 100_000 },
    { phase: 'review', round: 1, kind: 'tool_result', text: 'NEVER RECURSE' },
    { phase: 'worker', round: 1, kind: 'answer', text: 'NOT REVIEW EVIDENCE' },
  ];
  return { evidence, snapshot: createLoopSnapshot({ baseCommit: 'abc', round: 1, diff: '\u0000'.repeat(50_000), inventory: 'file\u0000', evidence }, 'review') };
};

describe('immutable Loop inspection pagination', () => {
  it('reconstructs every character, including continued large entries and escaped page boundaries', async () => {
    const { snapshot, evidence } = fixture();
    const overview = JSON.parse(await snapshot.inspect());
    expect(overview).toMatchObject({ round: 1, rounds: [{ round: 1, entries: 1, truncatedEntries: 1 }] });
    expect(overview.totals.every((entry: { sha256: string }) => entry.sha256.length === 64)).toBe(true);
    evidence[0]!.text = 'mutated after snapshot';
    evidence.push({ phase: 'worker', round: 1, kind: 'tool_result', text: 'late' });
    expect(snapshot.complete()).toBe(false);
    const texts: string[] = [];
    for (const args of [{ section: 'diff' }, { section: 'inventory' }, { section: 'evidence', round: 1 }] as LoopInspectArgs[]) {
      let offset: number | null = 0;
      let text = '';
      while (offset !== null) {
        const raw = await snapshot.inspect({ ...args, offset, limit: 12_000 });
        expect(raw.length).toBeLessThanOrEqual(LOOP_PAGE_CHARS);
        const page = JSON.parse(raw);
        expect(page.snapshotId).toBe(overview.snapshotId);
        expect(page.offset).toBe(offset);
        text += page.text;
        offset = page.nextOffset;
      }
      texts.push(text);
    }
    expect(texts[0]).toBe('\u0000'.repeat(50_000));
    expect(JSON.parse(texts[2]!).text).toBe('x'.repeat(90_000));
    expect(snapshot.serialized).not.toMatch(/NEVER RECURSE|NOT REVIEW EVIDENCE|mutated after snapshot/);
    expect(snapshot.complete()).toBe(true);
  });

  it('does not mistake an end-page or a gap for complete inspection', async () => {
    const { snapshot } = fixture();
    await snapshot.inspect();
    await snapshot.inspect({ section: 'diff', offset: 50_000 });
    await snapshot.inspect({ section: 'inventory' });
    await snapshot.inspect({ section: 'evidence', round: 1, offset: 1 });
    expect(snapshot.complete()).toBe(false);
  });

  it.each([
    { section: 'other' }, { section: 'evidence:1' }, { section: 'evidence' }, { section: 'evidence', round: 0 },
    { section: 'evidence', round: 2 }, { section: 'diff', round: 1 },
    { section: 'diff', offset: -1 }, { section: 'diff', offset: 0.5 }, { section: 'diff', offset: 50_001 },
    { section: 'diff', limit: 0 }, { section: 'diff', limit: 12_001 }, { section: 'diff', limit: Infinity },
    { section: 'overview', offset: 0 }, { extra: true }, null, [],
  ])('rejects invalid arguments without evidence coverage: %j', async (args) => {
    const { snapshot } = fixture();
    await expect(snapshot.inspect(args as LoopInspectArgs)).rejects.toMatchObject({ code: 'invalid_inspection', phase: 'review' });
    expect(snapshot.complete()).toBe(false);
  });
  it('never treats a completely paged snapshot without worker tool results as evidence', async () => {
    const snapshot = createLoopSnapshot({ baseCommit: 'abc', round: 1, diff: '', inventory: '', evidence: [] }, 'review');
    await snapshot.inspect();
    await snapshot.inspect({ section: 'diff' });
    await snapshot.inspect({ section: 'inventory' });
    await snapshot.inspect({ section: 'evidence', round: 1 });
    expect(snapshot.complete()).toBe(false);
  });

});
