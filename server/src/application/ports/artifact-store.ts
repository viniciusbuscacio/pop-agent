/**
 * Where an artifact's bytes live (popy.spec §6, §14). The record is the repo's
 * job; this is the blob store beside it. Paths are grouped by chat so deleting
 * a conversation is one directory removal.
 */
export interface ArtifactStore {
  /** Writes the bytes for an artifact, creating the chat's directory. */
  write(chatId: string, artifactId: string, bytes: Buffer): void;
  /** Reads an artifact's bytes back, or undefined if they are gone. */
  read(chatId: string, artifactId: string): Buffer | undefined;
  /** The on-disk path, for streaming a download. Never exposed to a client. */
  pathOf(chatId: string, artifactId: string): string;
  /**
   * Snapshots the current latest bytes as a numbered version, before they are
   * overwritten by a new upload/save (popy.spec §14, RF-018). Best-effort.
   */
  archive(chatId: string, artifactId: string, version: number): void;
  /** The on-disk path of a specific archived version. */
  pathOfVersion(chatId: string, artifactId: string, version: number): string;
  /** Removes one artifact's bytes. Best-effort: already gone is success. */
  remove(chatId: string, artifactId: string): void;
  /** Removes a whole chat's directory when the conversation is deleted. */
  removeChat(chatId: string): void;
}
