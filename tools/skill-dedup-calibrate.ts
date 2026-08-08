/**
 * What cosine and vocabulary actually separate "the same skill again" from
 * "a different skill" (pop-agent.spec §8). The distiller's dedup bars come from this
 * measurement; before it they were guessed, and the guess filed a good
 * "Restart Pop Agent service" skill as a revision of `self-change` at 0.9017.
 *
 * Two labelled sets, both real:
 *
 * - POSITIVES, below: the nine auto-skills the broken vector index let through
 *   on 07-08/08, every one a re-distillation of the same "propose an
 *   evidence-backed improvement" procedure. Ground truth for "same skill", and
 *   worth more than a hand-written set precisely because a model produced them
 *   without trying to make them alike.
 * - NEGATIVES: every pair of distinct skills in the live vault, which is where
 *   the hard cases are (`brainstorm` against `planning`, `self-change` against
 *   `self-server`).
 *
 * Out of the gate: it loads the embedder and reads the running instance's
 * vault. Run it when a bar is in question.
 *
 *   npx tsx tools/skill-dedup-calibrate.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEDUP_MIN_OVERLAP,
  DEDUP_THRESHOLD,
} from '../server/src/application/skills/skill-distiller.js';
import { vocabularyOverlap } from '../server/src/domain/skills/skill-router.js';
import { TransformersEmbedder } from '../server/src/infrastructure/embeddings/transformers-embedder.js';

const HOME = process.env['HOME'] ?? '.';
const DATA_DIR = process.env['POP_AGENT_DATA_DIR'] ?? join(HOME, '.pop-agent');

/** Nine re-distillations of one procedure, verbatim from the vault they filled. */
const SAME_SKILL: string[] = [
  "Propose an evidence-backed improvement from user history. Extract a concrete, actionable product or behavior improvement from the user's recent interactions and add it to the improvements list, with evidence-backed reasoning.. when I ask you to propose a product or behavior improvement based on my recent conversations, or when I want to keep a running improvements.md with real evidence from our history",
  "Propose a new improvement from conversation evidence. Extract and document a single actionable improvement from recent user interactions, ensuring it's new and properly cited before writing to improvements.md.. propose a new improvement\", \"find something to improve\", \"look for repeated issues in my chat history",
  "Extract and register one evidence-backed improvement proposal. How to find, document, and record a single actionable improvement from recent user interactions, ensuring it's new and properly cited.. propose an improvement based on evidence\", \"document a product behavior change from our recent chat\", \"find something to improve from my recent interactions",
  "Propose an actionable product or behavior improvement from recent interactions. Systematically extract and document a single concrete improvement from the user's recent chat history, only if it's new and backed by real evidence.. propose an improvement based on recent chat\", \"find a product improvement from my recent conversations\", \"what should we change based on our last chats",
  "Extract a new, evidence-backed improvement from recent chat history. Systematically search for one concrete, unproposed improvement in the user's recent conversations and document it if it's new.. propor melhoria baseada em evidência\", \"encontrar melhorias no meu histórico recente\", \"verificar o que já foi proposto em melhorias.md",
  "Extract a single actionable improvement from chat history. Systematically search for and document one concrete improvement from recent user interactions, only if it’s new and properly evidenced.. propose an improvement from my recent chat history\", \"find a product or behavior improvement in our past chats\", \"what can we improve based on our last conversation",
  "Propose a concrete improvement from recent interactions. Systematically extract and document a single actionable product or behavior improvement from the user's recent chat history, only if it's new and evidence-backed.. propose an improvement from my recent chats\", \"find an improvement in our recent conversations\", \"suggest a product change based on what went wrong recently",
  "Propose a new evidence-backed improvement from recent conversations. Systematically extracts and documents a single actionable product or behavior improvement from the user's recent chat history, only if it's new and properly evidenced, and appends it to bestpractices.md or improvements list.. when I ask you to \"propose an evidence-based improvement\" or \"suggest a product behavior improvement based on my recent conversations",
  "Write evidence-based improvement proposals. Extract and document a concrete product or behavior improvement from recent user interactions, following a strict evidence-based workflow.. propose a product improvement\", \"write an improvement in best-practices.md\", \"add a suggestion to improvements.md"
];

interface Item {
  label: string;
  text: string;
}

/** name. description. whenToUse -- the routing text, as the router builds it. */
function routingTextOf(markdown: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (match === null) return undefined;
  const front = match[1]!;
  const field = (key: string): string => {
    const hit = new RegExp('^' + key + ':\\s*(.*)$', 'm').exec(front);
    return hit === null ? '' : hit[1]!.trim().replace(/^["']|["']$/g, '');
  };
  const name = field('name');
  if (name === '') return undefined;
  const description = field('description');
  return `${name}. ${description}. ${field('whenToUse') || description}`;
}

function collect(dir: string): Item[] {
  const items: Item[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return items;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      const isDir = statSync(path).isDirectory();
      if (!isDir && !entry.endsWith('.md')) continue;
      const markdown = readFileSync(isDir ? join(path, 'SKILL.md') : path, 'utf8');
      const text = routingTextOf(markdown);
      if (text !== undefined) items.push({ label: entry.replace(/\.md$/, ''), text });
    } catch {
      /* not a skill */
    }
  }
  return items;
}

function dot(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += a[index]! * b[index]!;
  return total;
}

function report(name: string, values: number[]): void {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  console.log(
    `${name.padEnd(20)} n=${String(values.length).padStart(4)}  min=${sorted[0]!.toFixed(3)}` +
      `  p50=${at(0.5).toFixed(3)}  max=${sorted[sorted.length - 1]!.toFixed(3)}`,
  );
}

async function main(): Promise<void> {
  const vault = collect(join(DATA_DIR, 'skills')).concat(collect(join(DATA_DIR, 'skills/auto')));
  if (vault.length < 2) {
    console.log(`no vault at ${DATA_DIR}/skills -- nothing to measure against.`);
    return;
  }
  console.log(`same-skill set: ${String(SAME_SKILL.length)} · vault: ${String(vault.length)}\n`);

  const embedder = new TransformersEmbedder({ cacheDir: join(DATA_DIR, 'models') });
  const vectors = await embedder.embed([...SAME_SKILL, ...vault.map((item) => item.text)], 'passage');
  const positives = vectors.slice(0, SAME_SKILL.length);
  const negatives = vectors.slice(SAME_SKILL.length);

  const same: { cos: number; voc: number }[] = [];
  for (let i = 0; i < SAME_SKILL.length; i += 1) {
    for (let j = i + 1; j < SAME_SKILL.length; j += 1) {
      same.push({
        cos: dot(positives[i]!, positives[j]!),
        voc: vocabularyOverlap(SAME_SKILL[i]!, SAME_SKILL[j]!),
      });
    }
  }

  const different: { cos: number; voc: number; pair: string }[] = [];
  for (let i = 0; i < vault.length; i += 1) {
    for (let j = i + 1; j < vault.length; j += 1) {
      different.push({
        cos: dot(negatives[i]!, negatives[j]!),
        voc: vocabularyOverlap(vault[i]!.text, vault[j]!.text),
        pair: `${vault[i]!.label} / ${vault[j]!.label}`,
      });
    }
  }

  report('SAME cosine', same.map((entry) => entry.cos));
  report('DIFFERENT cosine', different.map((entry) => entry.cos));
  report('SAME vocabulary', same.map((entry) => entry.voc));
  report('DIFFERENT vocabulary', different.map((entry) => entry.voc));

  console.log('\nclosest DIFFERENT pairs by cosine -- what a cosine-only bar must exclude:');
  for (const entry of [...different].sort((a, b) => b.cos - a.cos).slice(0, 5)) {
    console.log(`  cos=${entry.cos.toFixed(4)} voc=${entry.voc.toFixed(3)}  ${entry.pair}`);
  }

  console.log('\nDIFFERENT pairs that clear both bars in use -- each one is a wrong merge:');
  const wrong = different
    .filter((entry) => entry.cos >= DEDUP_THRESHOLD && entry.voc >= DEDUP_MIN_OVERLAP)
    .sort((a, b) => b.cos - a.cos);
  if (wrong.length === 0) console.log('  (none)');
  for (const entry of wrong) {
    console.log(`  cos=${entry.cos.toFixed(4)} voc=${entry.voc.toFixed(3)}  ${entry.pair}`);
  }

  console.log('\ncos   voc     caught      wrongly merged');
  for (const cos of [0.86, 0.88, 0.9, 0.92, 0.94]) {
    for (const voc of [0, 0.15, 0.2, 0.25, 0.3]) {
      const caught = same.filter((entry) => entry.cos >= cos && entry.voc >= voc).length;
      const merged = different.filter((entry) => entry.cos >= cos && entry.voc >= voc).length;
      const live = cos === DEDUP_THRESHOLD && voc === DEDUP_MIN_OVERLAP ? '   <= in use' : '';
      console.log(
        `${cos.toFixed(2)}  ${voc.toFixed(2)}   ${String(caught).padStart(3)}/${String(same.length).padEnd(4)}` +
          `  ${String(merged).padStart(4)}/${String(different.length).padEnd(5)}${live}`,
      );
    }
  }
}

void main();
