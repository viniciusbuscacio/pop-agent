import type { SendMessageResponse, StreamEvent } from '@pop-agent/shared';
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
  send(chatId: string, text: string): Promise<SendMessageResponse>;
  stop(chatId: string): Promise<void>;
  /** Yields until the connection ends. Reconnection is the caller's business. */
  events(): AsyncIterable<StreamEvent>;
}

export interface SessionListener {
  /** The run moved: redraw. */
  onRun(state: RunState): void;
  /** A run ended, cleanly or not. */
  onIdle(state: RunState): void;
  /** The server accepted this behind a run another client already started. */
  onQueued(text: string): void;
  /** The chat gained a title, which the header shows. */
  onTitle(title: string): void;
  /** The stream died. The screen says so; it does not pretend to be live. */
  onStreamEnd(): void;
}

export class ChatSession {
  private transcript: Transcript | undefined;
  private chatId: string | undefined;
  private reading = false;

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
    const chatId = this.chatId ?? (await this.ports.createChat()).id;
    this.chatId = chatId;
    const response = await this.ports.send(chatId, text);
    if (response.queued === true) {
      this.listener.onQueued(response.message.text);
      return;
    }
    this.transcript = new Transcript(emptyRun(chatId, response.runId));
    this.listener.onRun(this.transcript.snapshot());
  }

  async stop(): Promise<void> {
    if (this.chatId === undefined || !this.busy) return;
    await this.ports.stop(this.chatId);
  }

  private absorb(event: StreamEvent): void {
    const transcript = this.transcript;
    if (transcript === undefined) return;
    if (!transcript.apply(event)) return;

    const state = transcript.snapshot();
    if (event.kind === 'title') {
      this.listener.onTitle(event.title);
      return;
    }
    this.listener.onRun(state);
    if (transcript.finished) this.listener.onIdle(state);
  }
}
