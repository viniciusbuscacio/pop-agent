import { DEFAULT_CHAT_TITLE, type Chat, type ChatSummary, type Message } from '../../domain/chat/chat.js';
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
}

export class ChatService {
  constructor(private readonly deps: ChatDeps) {}

  create(): Chat {
    const now = new Date(this.deps.clock.now()).toISOString();
    return this.deps.chats.create({
      id: newChatId(),
      title: DEFAULT_CHAT_TITLE,
      model: '',
      provider: '',
      archived: false,
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
    this.deps.chats.rename(id, trimmed.length > 0 ? trimmed : DEFAULT_CHAT_TITLE);
    // A name chosen by hand is not the machine's to improve on.
    this.deps.chats.setAutoTitle(id, false);
    return this.deps.chats.get(id);
  }

  setArchived(id: string, archived: boolean): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;
    this.deps.chats.setArchived(id, archived);
    return this.deps.chats.get(id);
  }

  setModel(id: string, model: string, provider: string): Chat | undefined {
    if (this.deps.chats.get(id) === undefined) return undefined;
    this.deps.chats.setModel(id, model, provider);
    return this.deps.chats.get(id);
  }

  delete(id: string): boolean {
    const chat = this.deps.chats.get(id);
    if (chat === undefined) return false;
    // Read the chat before the rows go, so the purger still knows where pi
    // kept the session (popy.spec §6): SQLite by cascade, the rest by hand.
    this.deps.chats.delete(id);
    this.deps.purger?.purge(chat);
    return true;
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
