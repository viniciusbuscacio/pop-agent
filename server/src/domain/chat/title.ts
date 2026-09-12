import { DEFAULT_CHAT_TITLE } from './chat.js';

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
