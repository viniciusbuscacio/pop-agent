/**
 * Types shared between server and web. The web app never redefines a
 * server type — it imports from here (popy.spec §3, §13).
 */

/** Structured API error body. Codes are stable (popy.spec §13). */
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
 * this (popy.spec §9).
 */
export const SESSION_TOKEN_HEADER = 'x-popy-token';

/** `GET /v1/auth/state` — decides between the setup wizard and the login screen. */
export interface AuthStateResponse {
  setupDone: boolean;
}

/** `POST /v1/setup` — first run only. */
export interface SetupRequest {
  password: string;
}

/** The only moment the recovery key exists in the clear. */
export interface SetupResponse {
  recoveryKey: string;
  token: string;
}

/** `POST /v1/login` — vault-style: password only, no user name. */
export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
}

/** `POST /v1/auth/recover` — the recovery key is spent and replaced. */
export interface RecoverRequest {
  recoveryKey: string;
  newPassword: string;
}

export interface RecoverResponse {
  token: string;
  /** A fresh key: the one just used no longer works. */
  recoveryKey: string;
}

/** `POST /v1/auth/change-password` — other devices drop, this one stays. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  token: string;
}

/** `POST /v1/auth/sign-out-others` — every other session ends. */
export interface SignOutOthersResponse {
  token: string;
}

/** Body of `POST /v1/chats/:id/messages` (docs/agent-flow.md). */
export interface SendMessageRequest {
  text: string;
}

/** 202 response of `POST /v1/chats/:id/messages`: the run has started. */
export interface SendMessageResponse {
  runId: string;
  userMessageId: string;
}

/** Events delivered over the single SSE channel `GET /v1/events`. */
export type StreamEvent =
  | { kind: 'delta'; chatId: string; runId: string; text: string }
  | { kind: 'thinking'; chatId: string; runId: string; text: string }
  | {
      kind: 'tool';
      chatId: string;
      runId: string;
      name: string;
      status: 'start' | 'output' | 'done' | 'error';
      detail?: string;
    }
  | { kind: 'done'; chatId: string; runId: string; messageId: string }
  | { kind: 'error'; chatId: string; runId: string; code: string }
  | { kind: 'title'; chatId: string; title: string }
  | { kind: 'update'; status: 'available' | 'installing' | 'done' | 'error' };
