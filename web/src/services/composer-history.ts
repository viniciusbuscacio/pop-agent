const STORAGE_PREFIX = 'pop-agent.composerHistory.';
export const COMPOSER_HISTORY_LIMIT = 100;

function storageKey(chatId: string): string {
  return `${STORAGE_PREFIX}${chatId}`;
}

export function readComposerHistory(chatId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(chatId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .slice(-COMPOSER_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function appendComposerHistory(chatId: string, text: string): string[] {
  if (text.length === 0) return readComposerHistory(chatId);

  const entries = [...readComposerHistory(chatId), text].slice(-COMPOSER_HISTORY_LIMIT);
  // localStorage is commonly limited to several megabytes. A hundred ordinary
  // prompts are small, but large pasted inputs can hit the device quota. Keep
  // dropping the oldest entry until the newest history fits.
  for (let start = 0; start < entries.length; start += 1) {
    const retained = entries.slice(start);
    try {
      localStorage.setItem(storageKey(chatId), JSON.stringify(retained));
      return retained;
    } catch {
      // Try a smaller suffix. If storage is denied entirely, leave it alone.
    }
  }
  return entries;
}
