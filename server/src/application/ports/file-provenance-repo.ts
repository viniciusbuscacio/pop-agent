/**
 * The append-only log of which chat wrote which Files path (docs/specs/Spec-Pop-General.md §6,
 * §14). History, not state: a later rename does not update it, deleting a
 * chat does not erase it, and nothing breaks when an entry points at a name
 * that moved. That immunity is the whole design -- a live file↔chat link
 * would desynchronize; a log cannot.
 */

export interface ProvenanceEntry {
  id: string;
  chatId: string;
  /** Relative to the Files root, as it was at write time. */
  path: string;
  createdAt: string;
}

export interface FileProvenanceRepo {
  record(entry: ProvenanceEntry): void;
  /** The chat that most recently wrote this path, if any -- the dedup check. */
  latestChatFor(path: string): string | undefined;
  /** Every path a chat ever wrote, newest first. */
  listByChat(chatId: string): { path: string; createdAt: string }[];
}
