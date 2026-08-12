import { create } from 'zustand';
import type {
  AttachmentDTO,
  ChatDTO,
  MessageDelivery,
  MessageDTO,
  QueuedMessageDTO,
  StreamEvent,
  ToolCallDTO,
} from '@pop-agent/shared';
import { ApiError } from '../services/api';
import { chatCache } from '../services/chat-cache';
import { chatsService } from '../services/chats';

/**
 * Everything the chat UI reads. The interesting part is what happens between a
 * message being sent and its answer being stored.
 *
 * A **live buffer** per chat accumulates the fragments of the run in flight.
 * `done` promotes it to a message and clears it. Events are matched by runId,
 * so a reply from a run the user already stopped -- or from the previous
 * question in the same chat -- cannot bleed into the current one.
 *
 * A run started elsewhere (another tab, the phone) is **adopted**: with no
 * buffer of its own for that chat, the store starts one. That is what makes
 * two windows show the same answer arriving. Runs that already ended are
 * remembered briefly so their late events are ignored rather than adopted.
 */

export interface LiveRun {
  runId: string;
  status: 'queued' | 'running';
  /** Sequence of the last fragment folded in; older fragments are dropped. */
  seq: number;
  content: string;
  thinking: string;
  tools: ToolCallDTO[];
}

interface ChatState {
  chats: ChatDTO[];
  archived: ChatDTO[];
  messages: Record<string, MessageDTO[]>;
  live: Record<string, LiveRun>;
  /** Server-owned pending-input FIFO for each chat. */
  pending: Record<string, QueuedMessageDTO[]>;
  failures: Record<string, string>;

  /** A risky action paused mid-run, waiting for Allow or Deny (pop-agent.spec §10). */
  confirms: Record<string, { runId: string; action: string; detail: string }>;

  loadChats: () => Promise<void>;
  loadArchived: () => Promise<void>;
  createChat: () => Promise<ChatDTO>;
  openChat: (chatId: string) => Promise<void>;
  send: (
    chatId: string,
    text: string,
    attachments?: AttachmentDTO[],
    filePaths?: string[],
    delivery?: MessageDelivery,
  ) => Promise<void>;
  updateQueued: (chatId: string, messageId: string, text: string, attachments?: AttachmentDTO[], filePaths?: string[]) => Promise<void>;
  cancelQueued: (chatId: string, messageId: string) => Promise<void>;
  stop: (chatId: string) => Promise<void>;
  respondConfirm: (chatId: string, runId: string, allow: boolean) => Promise<void>;
  rename: (chatId: string, title: string) => Promise<void>;
  setArchived: (chatId: string, archived: boolean) => Promise<void>;
  setPinned: (chatId: string, pinned: boolean) => Promise<void>;
  archiveOthers: (keepChatId: string) => Promise<number>;
  deleteOthers: (keepChatId: string) => Promise<number>;
  setModel: (chatId: string, model: string, provider: string) => Promise<void>;
  remove: (chatId: string) => Promise<void>;
  /** Deletes every archived conversation in one call. */
  removeArchived: () => Promise<void>;
  apply: (event: StreamEvent) => void;
  reset: () => void;
}

/** Runs that have ended, so their stragglers are not mistaken for a new run. */
const finished = new Set<string>();
/** Legacy v0.2 queue keys, read once and migrated to the server on open. */
const QUEUED_STORAGE_PREFIX = 'pop-agent.queued.';
const FINISHED_MEMORY = 50;

function remember(runId: string): void {
  finished.add(runId);
  if (finished.size > FINISHED_MEMORY) {
    const oldest = finished.values().next().value;
    if (oldest !== undefined) finished.delete(oldest);
  }
}

function emptyRun(runId: string, status: LiveRun['status']): LiveRun {
  return { runId, status, seq: 0, content: '', thinking: '', tools: [] };
}

/** Mirrors the server's pinned-first, newest-first sidebar ordering. */
function upsertChat(chats: ChatDTO[], chat: ChatDTO): ChatDTO[] {
  return [...chats.filter((entry) => entry.id !== chat.id), chat].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated !== 0 ? updated : right.id.localeCompare(left.id);
  });
}

/** Updates and reorders whichever open or archived list already owns the chat. */
function setChatPinned(chats: ChatDTO[], chatId: string, pinned: boolean): ChatDTO[] {
  const chat = chats.find((entry) => entry.id === chatId);
  return chat === undefined ? chats : upsertChat(chats, { ...chat, pinned });
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  archived: [],
  messages: {},
  live: {},
  pending: {},
  failures: {},
  confirms: {},

  async loadChats() {
    const { chats } = await chatsService.list(false);
    set({ chats });
  },

  async loadArchived() {
    const { chats } = await chatsService.list(true);
    set({ archived: chats });
  },

  async createChat() {
    const chat = await chatsService.create();
    // SSE can beat the POST response, so creation is an upsert rather than an
    // append. The initiating client and every other client use the same path.
    set((state) => ({ chats: upsertChat(state.chats, chat) }));
    return chat;
  },

  /**
   * Reconciliation: the stored history replaces whatever this client had, so a
   * reload in the middle of a run cannot end up with the same answer twice --
   * once from the buffer and once from the database.
   *
   * If the server says a run is in flight, its snapshot replaces the local
   * buffer: a client that mounted mid-run starts from everything already
   * streamed instead of a blank bubble (aw's partial-reply buffer). Fragments
   * older than the snapshot's `seq` are dropped in {@link apply}.
   */
  async openChat(chatId) {
    // Stale-while-revalidate: paint the cached tail first after a cold launch,
    // then let the server response below reconcile history and all live state.
    const cachedRequest = chatCache.get(chatId);
    const serverRequest = chatsService.messages(chatId);
    const cached = await cachedRequest;
    if (cached !== undefined && get().messages[chatId] === undefined) {
      set((state) => ({ messages: { ...state.messages, [chatId]: cached } }));
    }

    const { messages, live, queued, pending: snapshot } = await serverRequest;
    const pending = snapshot ?? (queued === undefined ? [] : [queued]);
    const legacy = readQueuedMessage(chatId);
    // Another upgraded tab may already have uploaded this exact legacy row.
    // Delete only that duplicate. If the server slot contains different text,
    // keep the older local row until the slot frees instead of silently eating
    // what this device had queued before the upgrade.
    if (legacy !== undefined && pending.some((item) => sameQueuedPayload(legacy, item))) {
      deleteQueuedMessage(chatId);
    }
    set((state) => ({
      messages: sameMessages(state.messages[chatId], messages)
        ? state.messages
        : { ...state.messages, [chatId]: messages },
      // The server is authoritative about what is in flight. It reports a run:
      // adopt its snapshot (a client that mounted mid-run starts from all that
      // already streamed). It reports none: drop any run this tab still
      // believed was alive -- otherwise a run the server ended while we were
      // disconnected (a restart, a crash) leaves the composer showing Stop
      // forever. The reloaded history already carries the interruption mark.
      live:
        live !== undefined && !finished.has(live.runId)
          ? { ...state.live, [chatId]: live }
          : without(state.live, chatId),
      pending:
        pending.length === 0
          ? without(state.pending, chatId)
          : { ...state.pending, [chatId]: pending },
    }));
    void chatCache.put(chatId, messages);
    // One-time upgrade path from the former localStorage queue. The ordinary
    // send endpoint decides atomically whether this starts now or occupies the
    // server slot, then the old browser copy can be removed.
    if (pending.length === 0 && legacy !== undefined) {
      try {
        await get().send(chatId, legacy.text, legacy.attachments, legacy.filePaths);
        deleteQueuedMessage(chatId);
      } catch {
        // Keep the old copy for the next reconnect; losing it is worse than
        // delaying migration while the server is unavailable.
      }
    }
  },

  async send(chatId, text, attachments = [], filePaths = [], delivery = 'steer') {
    // The server owns the race: this tab may believe the chat is idle while a
    // phone has just started a run. POST either starts now or appends to the
    // durable FIFO, never returning a transient run_in_progress to the client.
    const response = await chatsService.send(chatId, text, attachments, filePaths, delivery);
    if (response.queued === true) {
      deleteQueuedMessage(chatId);
      set((current) => ({
        pending: {
          ...current.pending,
          [chatId]: upsertPending(current.pending[chatId] ?? [], response.message),
        },
        failures: without(current.failures, chatId),
      }));
      return;
    }
    const { runId, userMessageId } = response;
    set((current) => {
      const existing = current.live[chatId];
      return {
        messages: {
          ...current.messages,
          [chatId]: (current.messages[chatId] ?? []).some((message) => message.id === userMessageId)
            ? (current.messages[chatId] ?? [])
            : [
                ...(current.messages[chatId] ?? []),
                {
                  id: userMessageId,
                  chatId,
                  role: 'user',
                  content: text,
                  thinking: '',
                  tools: [],
                  attachments,
                  createdAt: new Date().toISOString(),
                },
              ],
        },
        // The stream can beat this response; if it already opened a buffer for
        // this very run, keep what it collected.
        live: {
          ...current.live,
          [chatId]: existing?.runId === runId ? existing : emptyRun(runId, 'running'),
        },
        failures: without(current.failures, chatId),
      };
    });
  },

  async updateQueued(chatId, messageId, text, attachments = [], filePaths = []) {
    const { message } = await chatsService.updateQueue(chatId, messageId, text, attachments, filePaths);
    set((state) => ({
      pending: {
        ...state.pending,
        [chatId]: upsertPending(state.pending[chatId] ?? [], message),
      },
    }));
  },

  async cancelQueued(chatId, messageId) {
    await chatsService.cancelQueue(chatId, messageId);
    set((state) => ({ pending: removePending(state.pending, chatId, messageId) }));
  },

  async stop(chatId) {
    // Do not rely exclusively on SSE for the terminal event. On a sleeping
    // phone (or while the connection is reconnecting), the POST can succeed
    // but its error event may never reach this tab; the composer would then
    // remain stuck showing Stop forever.
    const runId = get().live[chatId]?.runId;
    if (runId === undefined) return;

    let stopped = false;
    try {
      ({ stopped } = await chatsService.stop(chatId));
    } catch {
      // The request itself failed -- offline, or the server is down. The user
      // asked to stop all the same, so reconcile locally below rather than
      // leave the run spinning.
    }

    // Whatever the backend said, once we asked to stop, this tab must not keep
    // showing the run as alive. `stopped: true` means a live run was aborted
    // (pi killed its process group). `stopped: false` means there was nothing
    // to abort -- the run had already died on a restart or a crash while we
    // were disconnected. Either way, finish it locally now that the backend
    // call has returned, so Stop always does something and the interruption is
    // marked. If the SSE terminal event already won the race this is a no-op.
    const current = get().live[chatId];
    if (current?.runId === runId) {
      get().apply({ kind: 'error', chatId, runId, code: stopped ? 'aborted' : 'interrupted' });
    }
  },

  async respondConfirm(chatId, runId, allow) {
    // Clear the card at once: a second tap must not fire a second answer.
    set((state) => ({ confirms: without(state.confirms, chatId) }));
    await chatsService.confirm(chatId, runId, allow);
  },

  async rename(chatId, title) {
    const updated = await chatsService.patch(chatId, { title });
    set((state) => ({ chats: state.chats.map((chat) => (chat.id === chatId ? updated : chat)) }));
  },

  async setArchived(chatId, archived) {
    await chatsService.patch(chatId, { archived });
    // The chat leaves one list and joins the other, so refresh both.
    await Promise.all([get().loadChats(), get().loadArchived()]);
  },

  async setPinned(chatId, pinned) {
    const updated = await chatsService.patch(chatId, { pinned });
    // SSE may beat the PATCH response. Both paths are idempotent and use the
    // same pinned-first ordering, so the initiating device needs no refetch.
    set((state) => ({
      chats: setChatPinned(state.chats, chatId, updated.pinned),
      archived: setChatPinned(state.archived, chatId, updated.pinned),
    }));
  },

  async archiveOthers(keepChatId) {
    const { archived } = await chatsService.archiveOthers(keepChatId);
    // Reload rather than moving the local snapshot: another device may have
    // created or archived a chat since this sidebar last came to the front.
    await Promise.all([get().loadChats(), get().loadArchived()]);
    return archived;
  },

  async deleteOthers(keepChatId) {
    const candidates = get().chats
      .filter((chat) => chat.id !== keepChatId && !chat.pinned)
      .map((chat) => chat.id);
    const { deleted } = await chatsService.deleteOthers(keepChatId);
    await Promise.all([get().loadChats(), get().loadArchived()]);
    // Drop local run/history remnants only after the canonical lists arrive;
    // another device may have pinned a chat since this sidebar last refreshed.
    const alive = new Set([...get().chats, ...get().archived].map((chat) => chat.id));
    for (const id of candidates) {
      if (!alive.has(id)) {
        deleteQueuedMessage(id);
        void chatCache.remove(id);
      }
    }
    set((state) => {
      const strip = <V,>(record: Record<string, V>): Record<string, V> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => alive.has(id)));
      return {
        messages: strip(state.messages),
        live: strip(state.live),
        pending: strip(state.pending),
      };
    });
    return deleted;
  },

  async setModel(chatId, model, provider) {
    // The pair is the identity (pop-agent.spec §15): they always travel together.
    const updated = await chatsService.patch(chatId, { model, provider });
    set((state) => ({ chats: state.chats.map((chat) => (chat.id === chatId ? updated : chat)) }));
  },

  async removeArchived() {
    await chatsService.removeArchived();
    set((state) => {
      // Every archived chat's local leftovers go with it.
      const gone = new Set(state.archived.map((chat) => chat.id));
      for (const id of gone) {
        deleteQueuedMessage(id);
        void chatCache.remove(id);
      }
      const strip = <V,>(record: Record<string, V>): Record<string, V> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)));
      return {
        archived: [],
        messages: strip(state.messages),
        live: strip(state.live),
        pending: strip(state.pending),
      };
    });
  },

  async remove(chatId) {
    try {
      await chatsService.remove(chatId);
    } catch (error) {
      // 404 means the goal is already true: the chat is gone on the server
      // and only this device still shows it. Deleting on the web never
      // may not have notified a sleeping phone, so a stale list can swipe
      // DELETE at a ghost and get 404; without this fallback it would remain
      // in the list as a conversation that could never be deleted
      // (Vinicius, 05/08). Everything else is a real failure and rethrows.
      if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
    }
    deleteQueuedMessage(chatId);
    void chatCache.remove(chatId);
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== chatId),
      archived: state.archived.filter((chat) => chat.id !== chatId),
      messages: without(state.messages, chatId),
      live: without(state.live, chatId),
      pending: without(state.pending, chatId),
      failures: without(state.failures, chatId),
      confirms: without(state.confirms, chatId),
    }));
  },

  apply(event) {
    if (event.kind === 'chat-created') {
      set((state) => ({
        chats: upsertChat(state.chats, event.chat),
        archived: state.archived.filter((chat) => chat.id !== event.chatId),
      }));
      return;
    }
    if (event.kind === 'chat-deleted') {
      deleteQueuedMessage(event.chatId);
      void chatCache.remove(event.chatId);
      set((state) => ({
        chats: state.chats.filter((chat) => chat.id !== event.chatId),
        archived: state.archived.filter((chat) => chat.id !== event.chatId),
        messages: without(state.messages, event.chatId),
        live: without(state.live, event.chatId),
        pending: without(state.pending, event.chatId),
        failures: without(state.failures, event.chatId),
        confirms: without(state.confirms, event.chatId),
      }));
      return;
    }
    if (event.kind === 'chat-pin-changed') {
      set((state) => ({
        chats: setChatPinned(state.chats, event.chatId, event.pinned),
        archived: setChatPinned(state.archived, event.chatId, event.pinned),
      }));
      return;
    }
    if (event.kind === 'title') {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.chatId ? { ...chat, title: event.title } : chat,
        ),
      }));
      return;
    }
    if (event.kind === 'run-started') {
      set((state) => {
        const known = state.messages[event.chatId] ?? [];
        const current = state.live[event.chatId];
        return {
          messages: known.some((message) => message.id === event.user.id)
            ? state.messages
            : { ...state.messages, [event.chatId]: [...known, event.user] },
          live: {
            ...state.live,
            [event.chatId]:
              current?.runId === event.runId ? current : emptyRun(event.runId, 'queued'),
          },
          failures: without(state.failures, event.chatId),
        };
      });
      return;
    }
    if (event.kind === 'confirm') {
      set((state) => ({
        confirms: {
          ...state.confirms,
          [event.chatId]: { runId: event.runId, action: event.action, detail: event.detail },
        },
      }));
      return;
    }
    if (event.kind === 'steering-delivered') {
      set((state) => {
        const known = state.messages[event.chatId] ?? [];
        const additions = [event.assistant, event.user].filter(
          (message): message is MessageDTO =>
            message !== undefined && !known.some((item) => item.id === message.id),
        );
        return {
          messages:
            additions.length === 0
              ? state.messages
              : { ...state.messages, [event.chatId]: [...known, ...additions] },
          live: {
            ...state.live,
            [event.chatId]: { ...emptyRun(event.runId, 'running'), seq: event.seq },
          },
          failures: without(state.failures, event.chatId),
        };
      });
      return;
    }
    if (event.kind === 'system-message') {
      set((state) => {
        const known = state.messages[event.chatId] ?? [];
        return known.some((message) => message.id === event.message.id)
          ? state
          : {
              messages: {
                ...state.messages,
                [event.chatId]: [...known, event.message],
              },
            };
      });
      return;
    }
    if (event.kind === 'queue') {
      set((state) => {
        const pending = applyQueueChange(state.pending, event);
        if (event.started === undefined) return { pending };

        const known = state.messages[event.chatId] ?? [];
        const messages = known.some((message) => message.id === event.started?.userMessageId)
          ? state.messages
          : {
              ...state.messages,
              [event.chatId]: [
                ...known,
                {
                  id: event.started.userMessageId,
                  chatId: event.chatId,
                  role: 'user' as const,
                  content: event.started.text,
                  thinking: '',
                  tools: [],
                  attachments: event.started.attachments,
                  createdAt: event.started.createdAt,
                },
              ],
            };
        const current = state.live[event.chatId];
        return {
          pending,
          messages,
          live: {
            ...state.live,
            [event.chatId]:
              current?.runId === event.started.runId
                ? current
                : emptyRun(event.started.runId, 'running'),
          },
          failures: without(state.failures, event.chatId),
        };
      });
      return;
    }
    if (event.kind === 'update') return;

    const { chatId, runId } = event;
    const current = get().live[chatId];

    // Anything from a run this client is not following is dropped, unless
    // there is no run to follow and this one is still alive.
    if (current === undefined) {
      if (finished.has(runId) || event.kind === 'done' || event.kind === 'error') return;
      set((state) => ({ live: { ...state.live, [chatId]: emptyRun(runId, 'running') } }));
    } else if (current.runId !== runId) {
      return;
    }

    const live = get().live[chatId];
    if (live === undefined) return;

    // A fragment the live snapshot already contains (the client seeded from
    // the server mid-run) must not be folded in a second time.
    if (
      (event.kind === 'delta' || event.kind === 'thinking' || event.kind === 'tool') &&
      event.seq <= live.seq
    ) {
      return;
    }

    switch (event.kind) {
      case 'run-status':
        set((state) => ({ live: { ...state.live, [chatId]: { ...live, status: event.status } } }));
        return;

      case 'delta':
        set((state) => ({
          live: {
            ...state.live,
            [chatId]: { ...live, seq: event.seq, content: live.content + event.text },
          },
        }));
        return;

      case 'thinking':
        set((state) => ({
          live: {
            ...state.live,
            [chatId]: { ...live, seq: event.seq, thinking: live.thinking + event.text },
          },
        }));
        return;

      case 'tool':
        set((state) => ({
          live: {
            ...state.live,
            [chatId]: { ...live, seq: event.seq, tools: mergeTool(live.tools, event) },
          },
        }));
        return;

      case 'done':
      case 'error': {
        remember(runId);
        // A run that ended takes its pending confirm card with it.
        if (get().confirms[chatId]?.runId === runId) {
          set((state) => ({ confirms: without(state.confirms, chatId) }));
        }
        const answered = live.content.length > 0 || live.thinking.length > 0 || live.tools.length > 0;
        const messageId = event.kind === 'done' ? event.messageId : `local-${runId}`;

        // The server persists the same mark (a system message on failure,
        // the answer on success); this local copy makes it visible without
        // waiting for a reload, and the next openChat replaces it with the
        // stored truth.
        const stored: MessageDTO[] = answered
          ? [
              {
                id: messageId,
                chatId,
                role: 'assistant',
                content: live.content,
                thinking: live.thinking,
                tools: live.tools,
                attachments: [],
                createdAt: new Date().toISOString(),
              },
            ]
          : [];
        if (event.kind === 'error') {
          stored.push(
            event.message ?? {
              id: `local-${runId}-error`,
              chatId,
              role: 'system',
              content:
                event.code === 'aborted'
                  ? 'You stopped this answer.'
                  : event.code === 'interrupted'
                    ? 'This answer was interrupted — the server may have restarted.'
                    : `That answer could not be finished. (${event.code})`,
              thinking: '',
              tools: [],
              attachments: [],
              createdAt: new Date().toISOString(),
            },
          );
        }

        set((state) => ({
          messages:
            stored.length > 0
              ? {
                  ...state.messages,
                  [chatId]: [...(state.messages[chatId] ?? []), ...stored],
                }
              : state.messages,
          live: without(state.live, chatId),
          failures:
            event.kind === 'error'
              ? { ...state.failures, [chatId]: event.code }
              : without(state.failures, chatId),
        }));

        return;
      }
    }
  },

  reset() {
    finished.clear();
    clearQueuedMessages();
    set({
      chats: [],
      archived: [],
      messages: {},
      live: {},
      pending: {},
      failures: {},
      confirms: {},
    });
  },
}));

function sameMessages(current: MessageDTO[] | undefined, fresh: MessageDTO[]): boolean {
  if (current === undefined || current.length !== fresh.length) return false;
  return current.every((message, index) => message.id === fresh[index]?.id);
}

function upsertPending(items: QueuedMessageDTO[], message: QueuedMessageDTO): QueuedMessageDTO[] {
  const index = items.findIndex((item) => item.id === message.id);
  if (index < 0) return [...items, message];
  return items.map((item, at) => (at === index ? message : item));
}

function removePending(
  pending: Record<string, QueuedMessageDTO[]>,
  chatId: string,
  messageId: string,
): Record<string, QueuedMessageDTO[]> {
  const items = (pending[chatId] ?? []).filter((item) => item.id !== messageId);
  return items.length === 0 ? without(pending, chatId) : { ...pending, [chatId]: items };
}

function applyQueueChange(
  pending: Record<string, QueuedMessageDTO[]>,
  event: Extract<StreamEvent, { kind: 'queue' }>,
): Record<string, QueuedMessageDTO[]> {
  if (event.change?.kind === 'upsert') {
    return {
      ...pending,
      [event.chatId]: upsertPending(pending[event.chatId] ?? [], event.change.message),
    };
  }
  if (event.change?.kind === 'remove') return removePending(pending, event.chatId, event.change.id);
  // Compatibility with servers that only broadcast the current head.
  return event.message === undefined
    ? without(pending, event.chatId)
    : { ...pending, [event.chatId]: [event.message] };
}

interface LegacyQueuedMessage {
  text: string;
  attachments: AttachmentDTO[];
  filePaths: string[];
}

/** Reads the former client queue only long enough to migrate it to the server. */
function readQueuedMessage(chatId: string): LegacyQueuedMessage | undefined {
  try {
    const raw = localStorage.getItem(`${QUEUED_STORAGE_PREFIX}${chatId}`);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as unknown;
    if (!isQueuedMessage(value)) {
      deleteQueuedMessage(chatId);
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function deleteQueuedMessage(chatId: string): void {
  try {
    localStorage.removeItem(`${QUEUED_STORAGE_PREFIX}${chatId}`);
  } catch {
    // An unavailable store has nothing useful to remove.
  }
}

function clearQueuedMessages(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(QUEUED_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Same: reset the in-memory truth even when storage is unavailable.
  }
}

function isQueuedMessage(value: unknown): value is LegacyQueuedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LegacyQueuedMessage>;
  if (
    typeof candidate.text !== 'string' ||
    !Array.isArray(candidate.attachments) ||
    !candidate.attachments.every(
      (attachment) =>
        typeof attachment.name === 'string' &&
        typeof attachment.type === 'string' &&
        typeof attachment.dataUri === 'string',
    )
  ) {
    return false;
  }
  if (candidate.filePaths === undefined) candidate.filePaths = [];
  return (
    Array.isArray(candidate.filePaths) &&
    candidate.filePaths.every((path) => typeof path === 'string')
  );
}

function sameQueuedPayload(legacy: LegacyQueuedMessage, queued: QueuedMessageDTO): boolean {
  return (
    legacy.text === queued.text &&
    JSON.stringify(legacy.attachments) === JSON.stringify(queued.attachments) &&
    JSON.stringify(legacy.filePaths) === JSON.stringify(queued.filePaths)
  );
}

/** Tool events arrive in pieces; output lines append to the call in progress. */
function mergeTool(
  tools: ToolCallDTO[],
  event: { name: string; status: ToolCallDTO['status']; detail?: string },
): ToolCallDTO[] {
  const detail = event.detail ?? '';
  const last = tools[tools.length - 1];
  const finished = last?.status === 'done' || last?.status === 'error';

  if (event.status === 'start' || last === undefined || last.name !== event.name || finished) {
    return [...tools, { name: event.name, status: event.status, detail }];
  }

  // Same fold the server applies before storing: one record per call, details
  // in the order they arrived.
  return [...tools.slice(0, -1), { ...last, status: event.status, detail: last.detail + detail }];
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest: Record<string, T> = {};
  for (const [name, value] of Object.entries(record)) {
    if (name !== key) rest[name] = value;
  }
  return rest;
}
