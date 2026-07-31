import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Chat } from '../../domain/chat/chat.js';
import type { ChatPurger } from '../../application/ports/chat-purger.js';

/**
 * Deletes a chat's on-disk remains (popy.spec §6): pi's JSONL session file and
 * the chat's attachment folder in the workspace. Best-effort by design -- a
 * file already gone is the goal, not an error -- and it disposes any live pi
 * session first so nothing rewrites the file after it is removed.
 */
export interface FsChatPurgerDeps {
  workspace: string;
  /** Drops (and disposes) any cached pi session for the chat. */
  forgetSession: (chatId: string) => void;
}

export class FsChatPurger implements ChatPurger {
  constructor(private readonly deps: FsChatPurgerDeps) {}

  purge(chat: Chat): void {
    this.deps.forgetSession(chat.id);

    if (chat.piSessionId.length > 0) {
      // pi keeps a JSONL and a sibling directory of the same base name.
      remove(chat.piSessionId);
      remove(chat.piSessionId.replace(/\.jsonl$/, ''));
    }

    remove(join(this.deps.workspace, 'attachments', chat.id));
  }
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Already gone, or never existed: that is the desired end state.
  }
}
