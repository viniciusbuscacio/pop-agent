import { createHash } from 'node:crypto';
import { LoopError } from '../../application/loop/loop-failure.js';
import type { LoopPhase } from '../../application/loop/pop-loop.js';
import type { LoopEvidence } from './loop-child.js';

export const LOOP_PAGE_CHARS = 32_000;
export interface LoopInspectArgs { section?: 'overview' | 'diff' | 'inventory' | 'evidence'; round?: number; offset?: number; limit?: number }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Immutable captured strings. Cursors are UTF-16 character offsets, including inside a JSONL entry. */
export function createLoopSnapshot(input: { baseCommit: string; round: number; diff: string; inventory: string; evidence: readonly LoopEvidence[] }, phase: LoopPhase) {
  const sections = new Map<string, string>([['diff', input.diff], ['inventory', input.inventory]]);
  const rounds: Array<{ round: number; entries: number; toolResults: number; truncatedEntries: number; chars: number; sha256: string }> = [];
  for (let round = 1; round <= input.round; round++) {
    const entries = input.evidence.filter((entry) => entry.phase === 'worker' && entry.kind !== 'answer' && entry.round === round);
    const text = entries.map((entry) => JSON.stringify(entry)).join('\n');
    sections.set(`evidence:${round}`, text);
    rounds.push({ round, entries: entries.length, toolResults: entries.filter((entry) => entry.kind === 'tool_result').length, truncatedEntries: entries.filter((entry) => entry.truncated).length,
      chars: text.length, sha256: hash(text) });
  }
  const totals = [...sections].map(([section, text]) => ({ section, chars: text.length, sha256: hash(text) }));
  const overview = { baseCommit: input.baseCommit, round: input.round, totals, rounds,
    totalChars: totals.reduce((sum, entry) => sum + entry.chars, 0),
    pagination: 'Read diff, inventory, and evidence for each round. Zero-based UTF-16 offsets; concatenate text pages before parsing JSONL. Entries may continue across pages. nextOffset=null means complete. Logs are capped; truncated or missing validation is not proof of completion.' };
  const serialized = JSON.stringify({ overview, sections: Object.fromEntries(sections) });
  const snapshotId = hash(serialized);
  let overviewRead = false;
  const coverage = new Map<string, Array<[number, number]>>();
  return {
    serialized,
    inspect: async (raw: LoopInspectArgs = {}): Promise<string> => {
      const invalid = (): never => { throw new LoopError('invalid_inspection', phase); };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['section', 'round', 'offset', 'limit'].includes(key))) invalid();
      const { section = 'overview', round, offset = 0, limit = 12_000 } = raw;
      if (!['overview', 'diff', 'inventory', 'evidence'].includes(section)) invalid();
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 12_000) invalid();
      if (section === 'overview') {
        if (round !== undefined || raw.offset !== undefined || raw.limit !== undefined) invalid();
        overviewRead = true;
        return JSON.stringify({ snapshotId, ...overview });
      }
      if (section === 'evidence' ? !Number.isSafeInteger(round) || Number(round) < 1 || Number(round) > input.round : round !== undefined) invalid();
      const key = section === 'evidence' ? `evidence:${String(round)}` : section;
      const text = sections.get(key);
      if (text === undefined || offset > text.length) return invalid();
      let end = Math.min(text.length, offset + limit);
      const page = (): string => JSON.stringify({ snapshotId, section, ...(round === undefined ? {} : { round }), offset,
        nextOffset: end < text.length ? end : null, totalChars: text.length, sha256: hash(text), text: text.slice(offset, end) });
      let result = page();
      while (result.length > LOOP_PAGE_CHARS) { end = offset + Math.floor((end - offset) / 2); result = page(); }
      const ranges = coverage.get(key) ?? [];
      ranges.push([offset, end]); coverage.set(key, ranges);
      return result;
    },
    complete: (): boolean => overviewRead && rounds.every((round) => round.toolResults > 0) && [...sections].every(([key, text]) => {
      const ranges = coverage.get(key);
      if (!ranges) return false;
      let end = 0;
      for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) { if (from > end) return false; end = Math.max(end, to); }
      return end === text.length;
    }),
  };
}
