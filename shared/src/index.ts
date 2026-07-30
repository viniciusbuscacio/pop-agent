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
