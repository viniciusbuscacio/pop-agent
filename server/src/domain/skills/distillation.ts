import type { Message } from '../chat/chat.js';

/**
 * What the background distiller asks and how it reads the answer (pop-agent.spec §8,
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
 * - **English**, matching every skill Pop Agent writes for itself. The conversation
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

/** Opens each skill; the body runs to the next marker. */
const SKILL_MARKER = '=== SKILL ===';
/** Separates the routed fields from the procedure. */
const BODY_MARKER = '--- body ---';
/** The model's way of saying it finished; its absence is how truncation is seen. */
const END_MARKER = '=== END ===';

/**
 * The markers as *read*, which is looser than the markers as written.
 *
 * A live run wrote `--- body` -- the opening dashes, the word, and no closing
 * dashes -- and the exact-match parser dropped a complete, well-formed skill on
 * the floor for it. That is the parser being brittle, not the model being
 * wrong: the line is unmistakable to any reader. The rule is now the one that
 * matters, which is that the line consists of the fence character and the
 * keyword and nothing else, so it can never collide with a line of prose.
 */
const SKILL_LINE = /^=+\s*skill\s*=*$/i;
const BODY_LINE = /^-+\s*body\s*-*$/i;
const END_LINE = /^=+\s*end\s*=*$/i;

export function buildDistillPrompt(
  messages: readonly Message[],
  existing: readonly { slug: string; description: string }[],
  /**
   * The user asked for a skill in so many words. Then the empty answer -- the
   * normal, encouraged outcome below -- stops being available: a request that
   * the distiller quietly decided against is a request the user never finds
   * out was dropped, and there is no screen that could show it.
   */
  requested = false,
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

  const mandate = requested
    ? [
        'IMPORTANT: in this conversation the user explicitly asked for a skill to be written.',
        'That is an instruction, not a hint. Write at least one skill. The "nothing to learn"',
        'answer is not available here -- if the procedure looks thin, write the best skill the',
        'conversation supports rather than none.',
        '',
      ]
    : [];

  return [
    'You are reading a finished conversation between a user and an assistant, looking for',
    'knowledge worth keeping as a reusable skill.',
    '',
    ...mandate,
    '',
    'A skill is PROCEDURAL: how to do something, a workflow that worked, a correction the user',
    'made that should change how the task is done next time. A fact about the user or their',
    'world (their name, their preferences, what they own, what they decided) is NOT a skill --',
    'that is memory, and another part of the system already handles it. Skip facts entirely.',
    '',
    'Rules:',
    '- If the conversation contains nothing procedural and reusable, answer with the end marker',
    '  alone. This is the normal outcome and it is always better than a vague skill.',
    '- If the procedure is incomplete -- you would not be able to follow it yourself -- answer',
    '  with the end marker alone. A half-written skill is worse than none.',
    '- One conversation may yield several skills, one per distinct procedure. Do not merge two',
    `  unrelated procedures into one skill. At most ${String(MAX_CANDIDATES)}.`,
    '- Do not repeat a skill that already exists (listed below). Only propose one that overlaps',
    '  if you would genuinely rewrite it to be better.',
    '- Write every field in English, even when the conversation is in another language.',
    '',
    'The "whenToUse" line is what a router matches a future message against, so write it as the',
    'situations that should bring this skill back, in the words a user would actually type.',
    'Before answering, check it yourself: if the question that opened this conversation would not',
    'match your own whenToUse, rewrite it until it would.',
    '',
    'Answer in exactly this format, and nothing else:',
    '',
    SKILL_MARKER,
    'slug: lowercase-dashed-id',
    'name: Short name',
    'description: One line saying what this skill does',
    'whenToUse: The situations that should bring it back',
    BODY_MARKER,
    'The procedure itself, as markdown. Any characters at all are fine here:',
    'quotes, braces, backticks, shell commands, newlines. Nothing needs escaping.',
    END_MARKER,
    '',
    `Repeat the "${SKILL_MARKER}" block once per skill, then close with "${END_MARKER}" exactly once.`,
    `If there is nothing to learn, answer with "${END_MARKER}" and nothing before it.`,
    '',
    'Skills that already exist:',
    known,
    '',
    'Conversation:',
    transcript,
  ].join('\n');
}

/** What the parse found, and whether the answer was cut off mid-sentence. */
export interface DistillAnswer {
  candidates: SkillCandidate[];
  /**
   * The answer never reached its end marker: the model ran out of budget while
   * writing. Load-bearing -- the caller keeps its watermark and asks again.
   */
  truncated: boolean;
}

/**
 * Reads the answer back.
 *
 * The format is markers and lines, not JSON, and that is the whole point. Two
 * live runs were lost to JSON, in two different ways. The first: a reasoning
 * model spent its budget thinking and the array stopped mid-field, so a whole
 * parse rejected everything and a good skill went in the bin. The second was
 * worse, because it looked like success -- the model wrote a shell command into
 * the body, `--data '{"purge_all":true}'`, without escaping the quotes, and
 * produced a document that was complete, plausible and invalid.
 *
 * Neither is the model being careless. Asking for a markdown procedure *inside*
 * a JSON string means every quote, brace and newline in the payload has to
 * survive an escaping pass, and procedures are made of exactly those
 * characters. So the payload is not escaped at all: the fields are `key: value`
 * lines, the body is everything between the body marker and the next skill, and
 * the only reserved strings are three markers no procedure will contain.
 *
 * Strict about fields: a block missing one is dropped rather than repaired,
 * because a skill with an invented name is worse than one fewer skill. A block
 * still open when the text runs out is dropped too -- that is exactly the case
 * that must not be mistaken for a finished one -- and `truncated` tells the
 * caller to come back for it.
 */
export function parseDistillAnswer(answer: string): DistillAnswer {
  const candidates: SkillCandidate[] = [];
  const taken = new Set<string>();

  let fields: Map<string, string> | undefined;
  let body: string[] | undefined;
  let ended = false;

  const flush = (): void => {
    const open = fields;
    const text = body;
    fields = undefined;
    body = undefined;
    if (open === undefined) return;
    const candidate = toCandidate({
      slug: open.get('slug') ?? '',
      name: open.get('name') ?? '',
      description: open.get('description') ?? '',
      whenToUse: open.get('whenToUse') ?? '',
      body: (text ?? []).join('\n').trim(),
    });
    if (candidate === undefined || taken.has(candidate.slug)) return;
    taken.add(candidate.slug);
    candidates.push(candidate);
  };

  for (const line of answer.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (SKILL_LINE.test(trimmed)) {
      flush();
      fields = new Map();
      continue;
    }
    if (END_LINE.test(trimmed)) {
      flush();
      ended = true;
      break;
    }
    if (fields === undefined) continue; // preamble the model wrapped it in

    if (body !== undefined) {
      body.push(line);
      continue;
    }
    if (BODY_LINE.test(trimmed)) {
      body = [];
      continue;
    }
    const match = /^(slug|name|description|whentouse)\s*:\s*(.*)$/i.exec(trimmed);
    if (match?.[1] !== undefined) {
      fields.set(normaliseKey(match[1]), (match[2] ?? '').trim());
    }
  }

  return { candidates: candidates.slice(0, MAX_CANDIDATES), truncated: !ended };
}

/** `whenToUse` may arrive as `whentouse` or `WhenToUse`; keys match either way. */
function normaliseKey(raw: string): string {
  return raw.toLowerCase() === 'whentouse' ? 'whenToUse' : raw.toLowerCase();
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

/**
 * The secrets that carry no label. `SECRET_LINE` has a word to hold on to; a
 * key pasted bare -- `sk-proj-...`, `ghp_...`, an AWS id -- has none, and a
 * conversation full of pasted keys is exactly the conversation worth
 * distilling. The list is the formats recognizable by shape alone, which is
 * what lets a git hash or a uuid pass: better one clean line stand than a
 * skill gutted by redactions.
 */
const BARE_TOKEN = new RegExp(
  [
    '(?:sk|pk|ghp|gho|ghu|ghs|ghr|glpat|xoxb|xoxp|xoxa|xoxr|xoxs)[-_][A-Za-z0-9][A-Za-z0-9-]{15,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'AKIA[0-9A-Z]{16}',
    'AIza[0-9A-Za-z_-]{35}',
    'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{5,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  ].join('|'),
);

export function scrubCandidate(candidate: SkillCandidate): SkillCandidate {
  return {
    ...candidate,
    body: candidate.body
      .split('\n')
      .map((line) => (SECRET_LINE.test(line) || BARE_TOKEN.test(line) ? '[redacted secret]' : line))
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
