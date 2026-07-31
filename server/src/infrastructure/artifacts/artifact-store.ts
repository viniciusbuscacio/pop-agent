import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactStore } from '../../application/ports/artifact-store.js';

/**
 * Artifact bytes on disk (popy.spec §6), under
 * `POPY_DATA_DIR/artifacts/<chatId>/<artifactId>`. Grouped by chat so a
 * conversation's whole set goes in one removal. Files are named by their
 * unguessable id, never the original name, so the filesystem layout leaks
 * nothing and two uploads with the same name never collide.
 */
export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  /** Files without a chat live under `_files/` -- a chat id never starts with `_`. */
  private dirOf(chatId: string): string {
    return chatId === '' ? '_files' : chatId;
  }

  write(chatId: string, artifactId: string, bytes: Buffer): void {
    const dir = join(this.root, this.dirOf(chatId));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.pathOf(chatId, artifactId), bytes, { mode: 0o600 });
  }

  read(chatId: string, artifactId: string): Buffer | undefined {
    try {
      return readFileSync(this.pathOf(chatId, artifactId));
    } catch {
      return undefined;
    }
  }

  pathOf(chatId: string, artifactId: string): string {
    return join(this.root, this.dirOf(chatId), artifactId);
  }

  archive(chatId: string, artifactId: string, version: number): void {
    try {
      copyFileSync(this.pathOf(chatId, artifactId), this.pathOfVersion(chatId, artifactId, version));
    } catch {
      // Nothing to archive (a fresh artifact, or bytes already gone) is fine.
    }
  }

  pathOfVersion(chatId: string, artifactId: string, version: number): string {
    return join(this.root, this.dirOf(chatId), `${artifactId}.v${String(version)}`);
  }

  remove(chatId: string, artifactId: string): void {
    safeRemove(this.pathOf(chatId, artifactId));
  }

  removeChat(chatId: string): void {
    safeRemove(join(this.root, this.dirOf(chatId)));
  }
}

function safeRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Already gone is the desired end state.
  }
}
