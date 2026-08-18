import type {
  Attachment,
  ExecutionMode,
  Message,
  ToolRecord,
} from '../../domain/chat/chat.js';

export type RunJournalState = 'queued' | 'running';

/** Durable projection of one admitted run, independent from pi's JSONL session. */
export interface RunJournalEntry {
  runId: string;
  chatId: string;
  userMessageId: string;
  state: RunJournalState;
  prompt: string;
  model: string;
  provider: string;
  attachments: Attachment[];
  notify: boolean;
  localConnectionId?: string;
  executionMode: ExecutionMode;
  seq: number;
  content: string;
  thinking: string;
  tools: ToolRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface RunProjection {
  seq: number;
  content: string;
  thinking: string;
  tools: ToolRecord[];
}

/**
 * Transactional persistence boundary for a chat run. Implementations commit
 * product messages and journal transitions together so a crash cannot expose
 * a fragment over SSE that does not exist on disk or settle an answer twice.
 */
export interface RunJournalRepo {
  list(): RunJournalEntry[];

  /** Atomically stores the admitted user turn, journal row, chat touch and queue consumption. */
  admit(
    entry: RunJournalEntry,
    user: Message,
    consumedQueuedMessageId?: string,
  ): Message;

  /** Must commit before any bridge call because tools may have side effects. */
  markRunning(runId: string, at: string): boolean;

  /** Stores the complete current segment before its corresponding SSE fragment. */
  saveProjection(runId: string, projection: RunProjection, at: string): boolean;

  /**
   * Atomically stores a steering boundary, consumes its durable FIFO row and
   * resets the journal projection for the next assistant segment.
   */
  commitSteeringSegment(
    runId: string,
    steeringId: string,
    messages: Message[],
    at: string,
  ): boolean;

  /** Atomically appends terminal product history and removes the journal. */
  settle(runId: string, messages: Message[], at: string): boolean;
}
