/**
 * Where `pop` remembers which server it talks to (docs/cli.md, "Client
 * shape"). One entry per server: a URL and a session token.
 *
 * The token is the client's only secret and it is a full-access credential,
 * so the file is written 0600 and the directory 0700 -- the same care
 * `POP_AGENT_DATA_DIR` takes on the server. A laptop is shared with more processes
 * than a server is, not fewer.
 *
 * Pure over an injected filesystem so a test never touches a real home
 * directory, and so `pop` can be exercised without a server at all.
 */

export interface Profile {
  /** Base URL, no trailing slash: `https://pop-agent.example` or `http://127.0.0.1:8787`. */
  url: string;
  token: string;
}

export interface ProfileStore {
  read(): Record<string, Profile>;
  write(profiles: Record<string, Profile>): void;
}

/** The profile a bare `pop` uses when `--server` is absent. */
export const DEFAULT_PROFILE = 'default';

export class Profiles {
  constructor(private readonly store: ProfileStore) {}

  get(name = DEFAULT_PROFILE): Profile | undefined {
    return this.store.read()[name];
  }

  list(): { name: string; url: string }[] {
    return Object.entries(this.store.read())
      .map(([name, profile]) => ({ name, url: profile.url }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  save(name: string, profile: Profile): void {
    this.store.write({ ...this.store.read(), [name]: profile });
  }

  /**
   * Replaces only the token, leaving the URL alone. This is what a renewed
   * `x-pop-agent-token` lands in: the server hands one back when the current token
   * is a day old, and a client that ignored it would be signed out on a
   * schedule (spec §9).
   */
  refresh(name: string, token: string): void {
    const profiles = this.store.read();
    const existing = profiles[name];
    if (existing === undefined) return;
    this.store.write({ ...profiles, [name]: { ...existing, token } });
  }

  forget(name: string): boolean {
    const profiles = this.store.read();
    if (profiles[name] === undefined) return false;
    // Rebuilt without the key rather than destructured: the discard binding a
    // rest-spread needs is exactly what the unused-vars rule forbids.
    this.store.write(
      Object.fromEntries(Object.entries(profiles).filter(([key]) => key !== name)),
    );
    return true;
  }
}

/** Trailing slashes only ever produce `//v1/...` later. */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
