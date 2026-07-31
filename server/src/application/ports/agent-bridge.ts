import type { ToolStatus } from '../../domain/chat/chat.js';

/**
 * The only door to the agent engine (docs/agent-flow.md). pi lives behind this
 * port; so does the scripted fake that Phase 2 runs against. The use cases
 * cannot tell which, which is the point: Phase 3 swaps the adapter and the
 * orchestration below it does not change.
 */

export type AgentEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; status: ToolStatus; detail: string }
  | { kind: 'error'; code: string };

export interface AgentRunRequest {
  chatId: string;
  prompt: string;
  model: string;
  onEvent: (event: AgentEvent) => void;
  /** Aborted when the user presses Stop; the adapter must give up promptly. */
  signal: AbortSignal;
}

/** One model the user can pick. Everything past the id is best-effort. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** Context window, in tokens. */
  context?: number;
  /** US dollars per million tokens. */
  pricing?: { input: number; output: number };
}

export interface AgentBridge {
  /** Resolves when the run is finished, one way or another. */
  run(request: AgentRunRequest): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
}
