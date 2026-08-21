const KEY = 'pop-agent.local-machine-selection-v2';
const LEGACY_KEY = 'pop-agent.local-connection';

export function selectedLocalConnection(): string | undefined {
  try {
    // Older builds could automatically persist a machine merely because it was
    // the only one online. That made every ordinary send depend on PLA without
    // an explicit user choice. Drop the old key once; v2 stores only selections
    // made through the visible Server only / computer control.
    localStorage.removeItem(LEGACY_KEY);
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function selectLocalConnection(id: string | undefined): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
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
