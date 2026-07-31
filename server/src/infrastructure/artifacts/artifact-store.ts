import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  write(chatId: string, artifactId: string, bytes: Buffer): void {
    const dir = join(this.root, chatId);
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
    return join(this.root, chatId, artifactId);
  }

  remove(chatId: string, artifactId: string): void {
    safeRemove(this.pathOf(chatId, artifactId));
  }

  removeChat(chatId: string): void {
    safeRemove(join(this.root, chatId));
  }
}

function safeRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Already gone is the desired end state.
  }
}
