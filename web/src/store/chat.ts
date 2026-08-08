import { create } from 'zustand';
import type { AttachmentDTO, ChatDTO, MessageDTO, StreamEvent, ToolCallDTO } from '@pop-agent/shared';
import { ApiError } from '../services/api';
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
  /** One message per chat may wait for the current run to finish. */
  queued: Record<string, { text: string; attachments: AttachmentDTO[]; filePaths?: string[] }>;
  failures: Record<string, string>;

  /** A risky action paused mid-run, waiting for Allow or Deny (pop-agent.spec §10). */
  confirms: Record<string, { runId: string; action: string; detail: string }>;

  loadChats: () => Promise<void>;
  loadArchived: () => Promise<void>;
  createChat: () => Promise<ChatDTO>;
  openChat: (chatId: string) => Promise<void>;
  send: (chatId: string, text: string, attachments?: AttachmentDTO[], filePaths?: string[]) => Promise<void>;
  stop: (chatId: string) => Promise<void>;
  respondConfirm: (chatId: string, runId: string, allow: boolean) => Promise<void>;
  rename: (chatId: string, title: string) => Promise<void>;
  setArchived: (chatId: string, archived: boolean) => Promise<void>;
  setModel: (chatId: string, model: string, provider: string) => Promise<void>;
  remove: (chatId: string) => Promise<void>;
  /** Deletes every archived conversation in one call. */
  removeArchived: () => Promise<void>;
  apply: (event: StreamEvent) => void;
  reset: () => void;
}

/** Runs that have ended, so their stragglers are not mistaken for a new run. */
const finished = new Set<string>();
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

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  archived: [],
  messages: {},
  live: {},
  queued: {},
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
    set((state) => ({ chats: [chat, ...state.chats] }));
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
    const { messages, live } = await chatsService.messages(chatId);
    set((state) => ({
      messages: { ...state.messages, [chatId]: messages },
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
    }));
  },

  async send(chatId, text, attachments = [], filePaths = []) {
    const state = get();
    if (state.live[chatId] !== undefined) {
      // A run is already going: hold this one and send it when the chat frees.
      set((current) => ({
        queued: { ...current.queued, [chatId]: { text, attachments, filePaths } },
      }));
      return;
    }

    const { runId, userMessageId } = await chatsService.send(chatId, text, attachments, filePaths);
    set((current) => {
      const existing = current.live[chatId];
      return {
        messages: {
          ...current.messages,
          [chatId]: [
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
      const strip = <V,>(record: Record<string, V>): Record<string, V> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)));
      return {
        archived: [],
        messages: strip(state.messages),
        live: strip(state.live),
      };
    });
  },

  async remove(chatId) {
    try {
      await chatsService.remove(chatId);
    } catch (error) {
      // 404 means the goal is already true: the chat is gone on the server
      // and only this device still shows it. Deleting on the web never
      // notifies the phone (there is no chat-deleted event on the stream),
      // so a stale list swipes DELETE at a ghost, gets 404, and -- before
      // this -- swallowed it, leaving a chat that could never be deleted
      // (Vinicius, 05/08). Everything else is a real failure and rethrows.
      if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
    }
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== chatId),
      archived: state.archived.filter((chat) => chat.id !== chatId),
      messages: without(state.messages, chatId),
      live: without(state.live, chatId),
    }));
  },

  apply(event) {
    if (event.kind === 'title') {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.chatId ? { ...chat, title: event.title } : chat,
        ),
      }));
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
          stored.push({
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
          });
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

        const waiting = get().queued[chatId];
        if (waiting !== undefined) {
          set((state) => ({ queued: without(state.queued, chatId) }));
          void get().send(chatId, waiting.text, waiting.attachments, waiting.filePaths);
        }
        return;
      }
    }
  },

  reset() {
    finished.clear();
    set({
      chats: [],
      archived: [],
      messages: {},
      live: {},
      queued: {},
      failures: {},
      confirms: {},
    });
  },
}));

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
