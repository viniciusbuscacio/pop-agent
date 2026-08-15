const KEY = 'pop-agent.local-connection';

export function selectedLocalConnection(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
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
