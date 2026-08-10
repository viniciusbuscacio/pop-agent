import { DEFAULT_CHAT_TITLE, type Chat, type ChatSummary, type Message } from '../../domain/chat/chat.js';
import { nextChatTitle } from '../../domain/chat/title.js';
import { newChatId } from '../../domain/ids.js';
import type { ChatPurger } from '../ports/chat-purger.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';

/** Everything about conversations that does not involve running the agent. */

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;
const MAX_TITLE_LENGTH = 120;

export interface ChatDeps {
  chats: ChatRepo;
  clock: Clock;
  /** Removes a deleted chat's on-disk remains (JSONL, attachments). */
  purger?: ChatPurger;
  /**
   * Stops whatever the chat has in flight before it is deleted. Structural on
   * purpose: the run service is a sibling use case, not something this one
   * should depend on by name.
   */
  runs?: { discardChat(chatId: string): boolean };
}

export class ChatService {
  constructor(private readonly deps: ChatDeps) {}

  create(): Chat {
    const now = new Date(this.deps.clock.now()).toISOString();
    // The deterministic starter (pop-agent.spec §14): "Chat N", lowest free N
    // among the living chats, so a brand-new sidebar is already readable.
    const starter = nextChatTitle(this.deps.chats.list({ archived: false }).map((c) => c.title));
    return this.deps.chats.create({
      id: newChatId(),
      title: starter,
      model: '',
      provider: '',
      archived: false,
      pinned: false,
      piSessionId: '',
      summary: '',
      autoTitle: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  list(options: { archived: boolean }): ChatSummary[] {
    return this.deps.chats.list(options);
  }

  get(id: string): Chat | undefined {
    return this.deps.chats.get(id);
  }

  rename(id: string, title: string): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;

    const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
    // An empty rename means "undo my title", not "leave it blank".
    const chosen = trimmed.length > 0 ? trimmed : DEFAULT_CHAT_TITLE;
    this.deps.chats.rename(id, chosen);
    // A name chosen by hand is not the machine's to improve on.
    this.deps.chats.setAutoTitle(id, false);
    this.deps.chats.recordTitle({
      chatId: id,
      title: chosen,
      turn: this.deps.chats.countUserMessages(id),
      source: 'manual',
      createdAt: new Date().toISOString(),
    });
    return this.deps.chats.get(id);
  }

  setArchived(id: string, archived: boolean): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;
    this.deps.chats.setArchived(id, archived);
    return this.deps.chats.get(id);
  }

  setPinned(id: string, pinned: boolean): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;
    this.deps.chats.setPinned(id, pinned);
    return this.deps.chats.get(id);
  }

  /** Archives every open conversation except the active one and pinned chats. */
  archiveOthers(keepChatId: string): number | undefined {
    const keep = this.deps.chats.get(keepChatId);
    if (keep === undefined || keep.archived) return undefined;
    return this.deps.chats.archiveOthers(keepChatId);
  }

  /** Permanently deletes every open conversation except the active one and pinned chats. */
  deleteOthers(keepChatId: string): number | undefined {
    const keep = this.deps.chats.get(keepChatId);
    if (keep === undefined || keep.archived) return undefined;

    let deleted = 0;
    for (const chat of this.deps.chats.list({ archived: false })) {
      if (chat.id !== keepChatId && !chat.pinned && this.delete(chat.id)) deleted += 1;
    }
    return deleted;
  }

  setModel(id: string, model: string, provider: string): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;
    this.deps.chats.setModel(id, model, provider);
    this.deps.chats.recordRecentModel({ provider, model, usedAt: new Date(this.deps.clock.now()).toISOString() });
    return this.deps.chats.get(id);
  }

  recentModels(): { provider: string; model: string; usedAt: string }[] {
    return this.deps.chats.recentModels(10);
  }

  /**
   * Deleting a conversation kills its work first (pop-agent.spec §6). The order
   * matters and is the whole point: abort, then delete, then purge. A run
   * still streaming into rows that are about to disappear would keep a pi
   * process group alive, keep spending the user's credit, and end by failing
   * a foreign key -- so the run is stopped and its queued siblings dropped
   * before a single row goes.
   */
  delete(id: string): boolean {
    const chat = this.deps.chats.get(id);
    if (chat === undefined) return false;
    this.deps.runs?.discardChat(id);
    // Read the chat before the rows go, so the purger still knows where pi
    // kept the session (pop-agent.spec §6): SQLite by cascade, the rest by hand.
    this.deps.chats.delete(id);
    this.deps.purger?.purge(chat);
    return true;
  }

  /**
   * Deletes every archived conversation, each through {@link delete} so the
   * order that matters there (abort, delete, purge) holds for all of them.
   * One endpoint rather than a client loop, because the archive is where a
   * frequent task quietly piles up dozens of chats, and dozens of round
   * trips is how a "delete all" ends half done on a flaky connection.
   */
  deleteArchived(): number {
    let deleted = 0;
    for (const chat of this.deps.chats.list({ archived: true })) {
      if (this.delete(chat.id)) deleted += 1;
    }
    return deleted;
  }

  getMessages(chatId: string, options: { before?: string; limit?: number }): Message[] | undefined {
    if (this.deps.chats.get(chatId) === undefined) return undefined;

    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    return this.deps.chats.getMessages(chatId, {
      limit,
      ...(options.before === undefined ? {} : { before: options.before }),
    });
  }
}
