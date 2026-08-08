import { DEFAULT_CHAT_TITLE } from './chat.js';

/**
 * Titling a conversation without asking a model (pop-agent.spec §14, aw's
 * FallbackChatTitle ported).
 *
 * Phase 3 replaces this with an LLM-written title once a provider exists, but
 * the fallback stays: it is what runs when the provider is down, out of
 * credit, or simply not configured yet, and "New chat" repeated twenty times
 * is a useless sidebar.
 */

const STOP_WORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'please', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would', 'you', 'your',
  // Portuguese
  'a', 'as', 'ao', 'aos', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'ela', 'ele', 'em',
  'essa', 'esse', 'esta', 'este', 'eu', 'foi', 'isso', 'já', 'la', 'lo', 'mas', 'me', 'meu',
  'minha', 'na', 'nas', 'no', 'nos', 'não', 'o', 'os', 'ou', 'para', 'pelo', 'por', 'porque',
  'qual', 'quando', 'que', 'quem', 'se', 'sem', 'ser', 'seu', 'sua', 'só', 'também', 'te', 'tem',
  'um', 'uma', 'voce', 'você',
]);

const MAX_WORDS = 4;
const MAX_LENGTH = 60;

/**
 * Builds a title from the first thing the user said, then makes it unique
 * against the titles already in use.
 */
export function fallbackTitle(text: string, taken: readonly string[] = []): string {
  const words = text
    .replace(/[`*_~#>[\]()]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => word.length > 0);

  const meaningful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  // If the message was nothing but stop-words ("what is it?"), those words are
  // all there is to describe it -- better than falling back to nothing.
  const chosen = (meaningful.length > 0 ? meaningful : words).slice(0, MAX_WORDS);
  if (chosen.length === 0) return uniqueTitle('New chat', taken);

  const title = chosen.map(titleCase).join(' ').slice(0, MAX_LENGTH).trim();
  return uniqueTitle(title, taken);
}

function titleCase(word: string): string {
  const [first = '', ...rest] = [...word];
  return `${first.toUpperCase()}${rest.join('')}`;
}

/** "Groceries", then "Groceries 2", "Groceries 3"... (case-insensitive). */
export function uniqueTitle(title: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!lower.has(title.toLowerCase())) return title;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${title} ${String(suffix)}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return title;
}

/** The deterministic starter: "Chat N" with the lowest N not in use. */
export function nextChatTitle(taken: readonly string[]): string {
  const lower = new Set(taken.map((entry) => entry.toLowerCase()));
  for (let n = 1; n < 10000; n += 1) {
    const candidate = `Chat ${String(n)}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return 'Chat';
}

/** A title nobody chose yet: the default or a starter "Chat N". */
export function isGenericTitle(title: string): boolean {
  return title === DEFAULT_CHAT_TITLE || /^chat \d+$/i.test(title);
}
