import type { Message } from '../chat/chat.js';

/**
 * What the background distiller asks and how it reads the answer (popy.spec §8,
 * auto-skill fase c). Pure on purpose: the prompt and the parse are the two
 * places this feature is most likely to be wrong, and both are cheap to test
 * when they do not need a provider, a clock or a disk.
 *
 * The prompt carries the whole policy, because the policy is not enforceable
 * anywhere else:
 *
 * - **Procedures only.** A fact about the user is memory, not a skill (§8, the
 *   permanent boundary). Without the line the two systems duplicate each other
 *   and the router fills with things it cannot act on.
 * - **Nothing, when there is nothing.** The empty answer is a first-class
 *   outcome, not a failure. A distiller that must produce a skill per
 *   conversation produces noise per conversation.
 * - **The description is the routing signal**, so it is written in the words
 *   the user would type. The self-check is folded into the prompt rather than
 *   spent as a second call: the model can compare its own description against
 *   the question that opened the conversation in the same pass.
 * - **English**, matching every skill Popy writes for itself. The conversation
 *   it was distilled from can be in any language, and the router's semantic leg
 *   is multilingual, so this costs no recall.
 */

/** A skill the model proposes; not yet checked against the vault. */
export interface SkillCandidate {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}

/** How much of the window the model sees. A tick is one small call, not a batch. */
const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 1_200;

const MAX_NAME = 120;
const MAX_LINE = 500;
const MAX_BODY = 8_000;
/** Enough for a handful of skills; the cap is what keeps a tick's cost bounded. */
export const MAX_CANDIDATES = 5;

export function buildDistillPrompt(
  messages: readonly Message[],
  existing: readonly { slug: string; description: string }[],
): string {
  const transcript = messages
    .slice(-MAX_MESSAGES)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => `${message.role}: ${clip(message.content.trim())}`)
    .join('\n');

  const known =
    existing.length === 0
      ? '(none yet)'
      : existing.map((skill) => `- ${skill.slug}: ${skill.description}`).join('\n');

  return [
    'You are reading a finished conversation between a user and an assistant, looking for',
    'knowledge worth keeping as a reusable skill.',
    '',
    'A skill is PROCEDURAL: how to do something, a workflow that worked, a correction the user',
    'made that should change how the task is done next time. A fact about the user or their',
    'world (their name, their preferences, what they own, what they decided) is NOT a skill --',
    'that is memory, and another part of the system already handles it. Skip facts entirely.',
    '',
    'Rules:',
    '- If the conversation contains nothing procedural and reusable, answer with an empty array.',
    '  This is the normal outcome and it is always better than a vague skill.',
    '- If the procedure is incomplete -- you would not be able to follow it yourself -- answer',
    '  with an empty array. A half-written skill is worse than none.',
    '- One conversation may yield several skills, one per distinct procedure. Do not merge two',
    `  unrelated procedures into one skill. At most ${String(MAX_CANDIDATES)}.`,
    '- Do not repeat a skill that already exists (listed below). Only propose one that overlaps',
    '  if you would genuinely rewrite it to be better.',
    '- Write every field in English, even when the conversation is in another language.',
    '',
    'The "whenToUse" field is what a router matches a future message against, so write it as the',
    'situations that should bring this skill back, in the words a user would actually type.',
    'Before answering, check it yourself: if the question that opened this conversation would not',
    'match your own whenToUse, rewrite it until it would.',
    '',
    'Answer with a JSON array and nothing else -- no prose, no code fence. Each entry:',
    '{"slug": "lowercase-dashed-id", "name": "Short name", "description": "One line saying what',
    'this skill does", "whenToUse": "The situations that should bring it back", "body": "The',
    'procedure itself, as markdown"}',
    '',
    'Skills that already exist:',
    known,
    '',
    'Conversation:',
    transcript,
  ].join('\n');
}

/**
 * Reads the answer back. Tolerant in the one way that matters -- the array is
 * located inside whatever the model wrapped it in -- and strict about
 * everything after: a candidate missing any field is dropped rather than
 * repaired, because a skill with an invented name is worse than one fewer
 * skill. A malformed answer yields an empty list, which the caller treats as
 * "nothing here", not as an error: a model that cannot produce JSON will not
 * produce it on retry either, and the watermark should move past that
 * conversation.
 */
export function parseDistillAnswer(answer: string): SkillCandidate[] {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const candidates: SkillCandidate[] = [];
  const taken = new Set<string>();
  for (const entry of parsed) {
    const candidate = toCandidate(entry);
    if (candidate === undefined || taken.has(candidate.slug)) continue;
    taken.add(candidate.slug);
    candidates.push(candidate);
    if (candidates.length === MAX_CANDIDATES) break;
  }
  return candidates;
}

/** The text a candidate is routed on; the same shape the router embeds. */
export function candidateRoutingText(candidate: SkillCandidate): string {
  return `${candidate.name}. ${candidate.description}. ${candidate.whenToUse}`;
}

/**
 * A line that smells of a credential is replaced, not trimmed around -- the
 * same rule `skill_write` applies in fase (b), for the same reason: a skill
 * body is distilled from a conversation, conversations contain pasted keys, and
 * this text is going to be replayed into future prompts. Whole line, because a
 * key is worth nothing without the name beside it and guessing where the value
 * starts is how a scrubber leaks half a token.
 */
const SECRET_LINE = /password|token|(?:api[_-]?)?key\s*[=:]/i;

export function scrubCandidate(candidate: SkillCandidate): SkillCandidate {
  return {
    ...candidate,
    body: candidate.body
      .split('\n')
      .map((line) => (SECRET_LINE.test(line) ? '[redacted secret]' : line))
      .join('\n'),
  };
}

function toCandidate(entry: unknown): SkillCandidate | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const record = entry as Record<string, unknown>;

  const slug = slugify(read(record, 'slug'));
  const name = read(record, 'name').slice(0, MAX_NAME);
  const description = read(record, 'description').slice(0, MAX_LINE);
  const whenToUse = read(record, 'whenToUse').slice(0, MAX_LINE);
  const body = read(record, 'body').slice(0, MAX_BODY);

  if (slug.length === 0 || name.length === 0 || description.length === 0 || body.length === 0) {
    return undefined;
  }
  // An empty whenToUse falls back to the description, exactly as the vault does
  // for an Agent Skills file that only carries the standard's two fields.
  return { slug, name, description, whenToUse: whenToUse.length > 0 ? whenToUse : description, body };
}

function read(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The vault's slug rule, applied rather than checked: models write "Deploy the
 * Blog" and "deploy_blog" about as often as they write the id that was asked
 * for, and rejecting the candidate over its punctuation would throw away the
 * procedure with it.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 49);
}

function clip(text: string): string {
  return text.length <= MAX_CHARS_PER_MESSAGE ? text : `${text.slice(0, MAX_CHARS_PER_MESSAGE)}…`;
}
