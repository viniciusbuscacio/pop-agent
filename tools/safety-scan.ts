import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INJECTION_PATTERNS, sanitize } from '../server/src/domain/safety/sanitize.js';

/**
 * False-positive meter for the safety layer (pop-agent.spec §10, Backlog #8).
 *
 * The injection patterns are easy to test in the direction that flatters them:
 * write a payload, watch it match. The question that decides whether they can
 * be trusted is the other one -- how much ordinary technical prose do they
 * flag? A detector that trips on documentation does not merely annoy; since
 * 1.61 a tainted window is also a window the distiller refuses to learn from.
 *
 * So the corpus is the repo's own markdown and the spec: real prose, written
 * by hand, about a system whose vocabulary overlaps the detector's almost
 * completely. `npm run safety:scan` prints every flag with the text that
 * caused it. `docs/injection-tests.md` is excluded -- it is a list of real
 * payloads, and it is supposed to match.
 *
 * Not part of the gate. It is a measurement, and its number is a judgement
 * call about which residual flags are worth their cost.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', '.git', 'dist', 'pack', 'coverage'].includes(entry)) continue;
      walk(full, out);
    } else if (entry.endsWith('.md') || entry === 'pop-agent.spec') {
      if (!full.includes('injection-tests')) out.push(full);
    }
  }
  return out;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const root = process.argv[2] ?? '.';
const corpus = walk(root);
let paragraphs = 0;
let flagged = 0;

for (const file of corpus) {
  for (const block of readFileSync(file, 'utf8').split(/\n\s*\n/)) {
    if (block.trim().length === 0) continue;
    paragraphs += 1;
    const verdict = sanitize(block);
    if (verdict.riskLevel === 'low') continue;
    flagged += 1;
    const folded = fold(block);
    for (const entry of INJECTION_PATTERNS) {
      const match = entry.pattern.exec(folded);
      if (match !== null) {
        console.log(`${entry.level.padEnd(10)} ${entry.label.padEnd(22)} <<${match[0].slice(0, 70)}>>  ${file}`);
      }
    }
  }
}

console.log(
  `\n${String(corpus.length)} files, ${String(paragraphs)} paragraphs, ${String(flagged)} flagged ` +
    `(${((flagged / Math.max(1, paragraphs)) * 100).toFixed(1)}%)`,
);
