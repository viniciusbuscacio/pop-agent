const KEY = 'pop-agent.local-connection';
const LEGACY_TRANSIENT_PREFIX = 'local-';

export function selectedLocalConnection(): string | undefined {
  try {
    const selected = localStorage.getItem(KEY) ?? undefined;
    // Before stable machine identities, the PWA persisted the server-generated
    // `local-*` transport ID. It becomes invalid whenever PLA reconnects and
    // would otherwise reject every send, including queue edits. Do not guess a
    // replacement machine: clear it so the request safely uses server tools
    // until Settings selects an available stable machine again.
    if (selected?.startsWith(LEGACY_TRANSIENT_PREFIX) === true) {
      localStorage.removeItem(KEY);
      return undefined;
    }
    return selected;
  } catch {
    return undefined;
  }
}

export function selectLocalConnection(id: string | undefined): void {
  try {
    if (id === undefined || id === '') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // Storage denied: the user can still send with server tools only.
  }
}

/** Clears a rejected persisted selector without overwriting a newer user choice. */
export function clearLocalConnection(id: string): void {
  try {
    if (localStorage.getItem(KEY) === id) localStorage.removeItem(KEY);
  } catch {
    // Storage denied already behaves as server-only.
  }
}
