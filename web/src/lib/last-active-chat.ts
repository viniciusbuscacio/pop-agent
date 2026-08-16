const STORAGE_KEY = 'pop-agent.lastActiveChat';
const CHAT_PATH = /^\/chat\/[^/?#]+$/;

/** Keeps the desktop return target across Settings navigation and PWA reloads. */
export function rememberLastActiveChat(chatId: string): void {
  if (chatId.length === 0) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, `/chat/${encodeURIComponent(chatId)}`);
  } catch {
    // A storage-restricted device still has the route-state return path.
  }
}

export function lastActiveChatPath(): string | undefined {
  try {
    const path = sessionStorage.getItem(STORAGE_KEY);
    return path !== null && CHAT_PATH.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function forgetLastActiveChat(chatId: string): void {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === `/chat/${encodeURIComponent(chatId)}`) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}
