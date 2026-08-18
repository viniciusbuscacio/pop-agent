/** Structured API error body. Codes are stable (docs/specs/Spec-Pop-General.md §13). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    status: number;
  };
}

/** 423 from the credential routes: how long the progressive lockout still runs. */
export interface LockedError extends ApiError {
  retryAfterSeconds: number;
}

/**
 * Response header carrying a refreshed session token. The API renews a token
 * that is over a day old; the client swaps whatever it stored when it sees
 * this (docs/specs/Spec-Pop-General.md §9).
 */
export const SESSION_TOKEN_HEADER = 'x-pop-agent-token';

/**
 * Which client sent a request (docs/specs/Spec-Pop-General.md §13). Set once in each client's API
 * layer, so every call carries it -- including the ones nobody has written
 * yet -- and recorded on the message so the history remembers where each turn
 * happened, not just where this one is.
 *
 * Deliberately NOT called `source`: that name is already two other things in
 * Pop Agent (an artifact is `agent`/`upload`, a chat title is `auto`/`manual`).
 *
 * A client with a token can forge this, and on a single-user install that
 * means the owner lying to himself. It is context, never a security decision.
 */
export const CLIENT_HEADER = 'x-pop-agent-client';
export const CLIENT_PLATFORM_HEADER = 'x-pop-agent-client-platform';
/** Additive SSE schema understood by this client; absent means legacy v1. */
export const EVENT_STREAM_VERSION_HEADER = 'x-pop-agent-event-version';
export const EVENT_STREAM_VERSION = 2;

/**
 * The terminal that typed this message, named by the id its local-tools channel
 * gave it on attach (docs/cli.md, Whose local access).
 *
 * On the message and not on the chat: local access belongs to whoever is typing,
 * so a laptop that is shut is never reachable through a message sent from the
 * phone, and a conversation answered from two machines stays legible when it
 * is read back later.
 *
 * An explicit unknown or unavailable enabled id is rejected before a run
 * starts. A known computer whose synchronized permission is Off safely receives
 * server tools only, as does a request with no selection.
 */
export const LOCAL_CONNECTION_HEADER = 'x-pop-agent-local-connection';

export interface LocalConnectionDTO {
  id: string;
  role: 'interactive' | 'background';
  machine: {
    machineId?: string;
    hostname: string;
    platform: string;
    arch: string;
    clientVersion: string;
  };
}

export interface LocalConnectionsResponse {
  connections: LocalConnectionDTO[];
}

export interface LocalMachineAccessDTO {
  machineId: string;
  hostname: string;
  platform: string;
  arch: string;
  clientVersion: string;
  enabled: boolean;
  connected: boolean;
}

export interface LocalMachinesResponse {
  machines: LocalMachineAccessDTO[];
}

/**
 * The oldest `pop` this server will talk to (docs/cli.md, Version
 * compatibility).
 *
 * Set BY HAND, and moved only when the wire changes in a way an older client
 * cannot survive -- the REST shapes, the StreamEvent shapes, local access
 * frames. Most releases do not touch it, which is the point: a version number
 * that rises every release blocks clients that were working fine.
 *
 * It lives here and nowhere else. There is no endpoint for a client to
 * consult beforehand and no copy shipped inside the client: the client learns
 * the answer by attaching and being told, so the two can never disagree.
 */
export const MIN_CLIENT_VERSION = '0.2.6';

/**
 * Compares two `major.minor.patch` strings. Negative when `a` is older.
 *
 * Deliberately not semver-complete: Pop Agent's own versions have no pre-release
 * or build metadata, and a dependency to compare three integers would be a
 * dependency to keep.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] =>
    value
      .split('.')
      .slice(0, 3)
      .map((piece) => Number.parseInt(piece, 10))
      .map((piece) => (Number.isFinite(piece) ? piece : 0));
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The command that installs this server's own client (docs/cli.md). */
export function installCommand(origin: string, version: string): string {
  // The version is in the FILENAME because npm caches by URL: without it an
  // update silently reinstalls whatever was fetched the first time.
  return `npm i -g ${origin.replace(/\/$/, '')}/cli-${version}.tgz`;
}

/**
 * `web` is a browser tab; `pwa` is the same app installed and running
 * standalone. `mobile` is absent on purpose -- it is a shape of screen, not a
 * client, and lives in the platform instead, or "PWA on an iPhone" would be
 * two answers at once.
 */
export const CLIENT_KINDS = ['web', 'pwa', 'cli', 'api', 'task'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export function isClientKind(value: string): value is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(value);
}
