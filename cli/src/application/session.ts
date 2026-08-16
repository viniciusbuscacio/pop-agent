import type {
  ChatDTO,
  MessagesResponse,
  SendMessageResponse,
  SessionCommandName,
  SessionCommandResponse,
  SessionForkPointDTO,
  StreamEvent,
} from '@pop-agent/shared';
import { Transcript, emptyRun, type RunState } from './transcript.js';

/**
 * One conversation, driven over one long-lived stream (docs/cli.md, step 4).
 *
 * The one-shot path opens a stream per question and closes it with the
 * answer. A screen that stays open cannot: it has to keep receiving while the
 * user reads and types, so the stream is opened once and every run folds into
 * whichever transcript is current.
 *
 * Deliberately unaware of the terminal. It reports state through callbacks,
 * which is what lets the screen be swapped -- and what lets this be tested
 * with no TUI at all.
 */

export interface SessionPorts {
  createChat(): Promise<{ id: string }>;
  listChats(): Promise<ChatDTO[]>;
  loadChat(chatId: string): Promise<MessagesResponse>;
  send(chatId: string, text: string): Promise<SendMessageResponse>;
  stop(chatId: string): Promise<void>;
  sessionCommand?(chatId: string, command: SessionCommandName, argument: string): Promise<SessionCommandResponse>;
  forkPoints?(chatId: string): Promise<SessionForkPointDTO[]>;
  /** Yields until the connection ends. Reconnection is the caller's business. */
  events(): AsyncIterable<StreamEvent>;
}

export interface SessionListener {
  /** Stored history replaced the visible conversation after a chat switch. */
  onChatLoaded(chat: ChatDTO, response: MessagesResponse): void;
  /** The run moved: redraw. */
  onRun(state: RunState): void;
  /** A run ended, cleanly or not. */
  onIdle(state: RunState): void;
  /** The server accepted this as guidance for the run already in flight. */
  onQueued(text: string): void;
  /** Pi consumed that guidance and started a new visible assistant segment. */
  onSteering(): void;
  /** Another client persisted a user turn in the chat this screen is watching. */
  onExternalUser(text: string): void;
  /** The chat gained a title, which the header shows. */
  onTitle(title: string): void;
  /** The stream died. The screen says so; it does not pretend to be live. */
  onStreamEnd(): void;
}

export class ChatSession {
  private transcript: Transcript | undefined;
  private chatId: string | undefined;
  private reading = false;
  /** Requests whose run-started event may race their HTTP response. */
  private readonly pendingSends: { text: string }[] = [];
  /** Own responses that arrived before their run-started event. */
  private readonly ownRunIds = new Set<string>();
  /** Durable turns already echoed locally but not consumed by pi yet. */
  private readonly ownQueuedTexts: string[] = [];
  /** Persisted messages already painted by the latest history load. */
  private shownMessageIds = new Set<string>();
  /** Events for the destination chat that arrive while its snapshot is loading. */
  private loading: { chatId: string; events: StreamEvent[] } | undefined;

  constructor(
    private readonly ports: SessionPorts,
    private readonly listener: SessionListener,
  ) {}

  get currentChatId(): string | undefined {
    return this.chatId;
  }

  get busy(): boolean {
    return this.transcript !== undefined && !this.transcript.finished;
  }

  /** Opens on an existing chat, or on a new one at the first message. */
  open(chatId: string | undefined): void {
    this.chatId = chatId;
  }

  /** The canonical open-chat list, already ordered by the server like the web. */
  listChats(): Promise<ChatDTO[]> {
    return this.ports.listChats();
  }

  /**
   * Replaces the current conversation with a server snapshot.
   *
   * The SSE channel is global and remains live during the request. Events for
   * the destination are buffered, then replayed over the snapshot; its seq
   * makes overlapping fragments harmless. A failed load leaves the old chat
   * selected and replays anything that was temporarily held for it.
   */
  async switchTo(chat: ChatDTO): Promise<void> {
    const loading = { chatId: chat.id, events: [] as StreamEvent[] };
    this.loading = loading;

    let response: MessagesResponse;
    try {
      response = await this.ports.loadChat(chat.id);
    } catch (error) {
      if (this.loading === loading) {
        this.loading = undefined;
        for (const event of loading.events) this.absorb(event);
      }
      throw error;
    }
    // A later selection superseded this request. Its snapshot owns the screen.
    if (this.loading !== loading) return;

    this.chatId = chat.id;
    this.shownMessageIds = new Set(response.messages.map((message) => message.id));
    this.transcript = response.live === undefined
      ? undefined
      : new Transcript(
          {
            runId: response.live.runId,
            chatId: chat.id,
            text: response.live.content,
            thinking: response.live.thinking,
            tools: response.live.tools,
            status: response.live.status,
          },
          response.live.seq,
        );
    this.listener.onChatLoaded(chat, response);
    if (this.transcript !== undefined) this.listener.onRun(this.transcript.snapshot());

    this.loading = undefined;
    for (const event of loading.events) this.absorb(event);
  }

  /**
   * Starts reading the stream. Called once; the loop lives as long as the
   * screen does. A stream that ends is reported rather than reopened -- the
   * client says the connection dropped instead of quietly missing an answer.
   */
  async listen(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      for await (const event of this.ports.events()) this.absorb(event);
    } finally {
      this.reading = false;
      this.listener.onStreamEnd();
    }
  }

  async ask(text: string): Promise<void> {
    const pending = { text };
    this.pendingSends.push(pending);
    try {
      const chatId = this.chatId ?? (await this.ports.createChat()).id;
      this.chatId = chatId;
      const response = await this.ports.send(chatId, text);
      if (response.queued === true) {
        this.ownQueuedTexts.push(response.message.text);
        this.listener.onQueued(response.message.text);
        return;
      }
      // The SSE event can beat this response. Preserve the buffer it already
      // opened; otherwise remember the id so that a later event is recognized
      // as our own turn rather than printed a second time.
      if (this.transcript?.snapshot().runId !== response.runId) {
        this.ownRunIds.add(response.runId);
        this.transcript = new Transcript(emptyRun(chatId, response.runId));
        this.listener.onRun(this.transcript.snapshot());
      }
    } finally {
      const index = this.pendingSends.indexOf(pending);
      if (index >= 0) this.pendingSends.splice(index, 1);
    }
  }

  async stop(): Promise<void> {
    if (this.chatId === undefined || !this.busy) return;
    await this.ports.stop(this.chatId);
  }

  async command(command: SessionCommandName, argument: string): Promise<SessionCommandResponse> {
    const chatId = this.chatId ?? (await this.ports.createChat()).id;
    this.chatId = chatId;
    if (this.ports.sessionCommand === undefined) throw new Error('Session commands are unavailable.');
    const result = await this.ports.sessionCommand(chatId, command, argument);
    if (result.kind === 'fork' && result.chat !== undefined) await this.switchTo(result.chat);
    return result;
  }

  async forkPoints(): Promise<SessionForkPointDTO[]> {
    if (this.chatId === undefined || this.ports.forkPoints === undefined) return [];
    return this.ports.forkPoints(this.chatId);
  }

  private absorb(event: StreamEvent): void {
    const loading = this.loading;
    if (loading !== undefined && 'chatId' in event && event.chatId === loading.chatId) {
      loading.events.push(event);
      return;
    }

    if (event.kind === 'run-started') {
      if (event.chatId !== this.chatId) return;
      const queuedIndex = this.ownQueuedTexts.indexOf(event.user.content);
      const own =
        this.ownRunIds.delete(event.runId) ||
        this.pendingSends.some((pending) => pending.text === event.user.content) ||
        queuedIndex >= 0;
      if (queuedIndex >= 0) this.ownQueuedTexts.splice(queuedIndex, 1);
      const alreadyShown = this.shownMessageIds.has(event.user.id);
      this.shownMessageIds.add(event.user.id);
      if (!own && !alreadyShown) this.listener.onExternalUser(event.user.content);
      if (this.transcript?.snapshot().runId !== event.runId) {
        this.transcript = new Transcript(emptyRun(event.chatId, event.runId));
        this.listener.onRun(this.transcript.snapshot());
      }
      return;
    }

    if (event.kind === 'steering-delivered') {
      const queuedIndex = this.ownQueuedTexts.indexOf(event.user.content);
      if (queuedIndex >= 0) this.ownQueuedTexts.splice(queuedIndex, 1);
    }

    const transcript = this.transcript;
    if (transcript === undefined) return;
    if (!transcript.apply(event)) return;

    const state = transcript.snapshot();
    if (event.kind === 'title') {
      this.listener.onTitle(event.title);
      return;
    }
    if (event.kind === 'steering-delivered') this.listener.onSteering();
    this.listener.onRun(state);
    if (transcript.finished) this.listener.onIdle(state);
  }
}
