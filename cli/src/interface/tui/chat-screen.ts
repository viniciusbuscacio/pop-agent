import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Markdown,
  matchesKey,
  SelectList,
  Spacer,
  ProcessTerminal,
  Text,
  TUI,
  type Component,
  type OverlayHandle,
  type SlashCommand,
  type Terminal,
} from '@earendil-works/pi-tui';
import type { ChatDTO, MessageDTO, MessagesResponse } from '@pop-agent/shared';
import type { ChatSession } from '../../application/session.js';
import type { RunState } from '../../application/transcript.js';
import { ApiError } from '../../infrastructure/api.js';
import { editorTheme, markdownTheme, paint, selectListTheme } from './theme.js';

/**
 * The interactive screen (docs/cli.md, step 4): pi's shape, Pop Agent's head.
 *
 * Everything hard about a terminal -- differential rendering, the multi-line
 * editor with IME, key parsing across terminals, markdown to ANSI, bracketed
 * paste -- comes from `@earendil-works/pi-tui`, published in lockstep with pi
 * itself. What is written here is only the composition: what goes on the
 * screen, in what order, and what the keys mean for Pop Agent. That split is the
 * point. Copying pi's own screen would buy today's look and cost every future
 * pi release; depending on the library buys the releases too.
 *
 * The transcript is append-only. A finished answer becomes a `Markdown`
 * component and stops changing, so the differential renderer has nothing to
 * recompute above the line that is still streaming -- which is what keeps a
 * long conversation from redrawing itself on every token.
 */

/**
 * The commands, in one list.
 *
 * They feed two things that used to be written twice and would have drifted:
 * the `/help` text, and the autocomplete menu the editor pops when you type a
 * slash. That menu is pi-tui's, and not registering a provider is why typing
 * `/` showed nothing at all -- the commands worked, they were just
 * undiscoverable (Vinicius, 04/08).
 */
const COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'Start a fresh conversation' },
  { name: 'chats', description: 'Switch to an open conversation' },
  { name: 'stop', description: 'Interrupt the answer in flight' },
  { name: 'think', description: 'Show or hide the reasoning' },
  { name: 'help', description: 'List these commands' },
  { name: 'quit', description: 'Leave (or Ctrl+C)' },
];

const HELP = COMMANDS.map(
  (command) => `  /${command.name.padEnd(8)}${command.description ?? ''}`,
).join('\n');

/** One fixed-width monochrome Braille glyph, rotated without adding terminal lines. */
const WORKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const WORKING_FRAME_MS = 140;
const DISCONNECT_QUIT_MS = 60 * 60 * 1_000;

export interface ScreenOptions {
  session: ChatSession;
  /** Shown in the header, so two terminals on two servers are told apart. */
  server: string;
  title?: string;
  /** Device preference, visible by default just like the web client. */
  thinkingShown?: boolean;
  /** Persists `/think` without coupling the screen to the filesystem. */
  onThinkingShownChange?: (shown: boolean) => void;
  /**
   * Injected so the screen can be driven without a real terminal. Everything
   * else in this client already takes its I/O as a parameter; the screen was
   * the one piece that reached for the process itself, which made the only
   * question that matters -- what ends up on screen -- unanswerable in a test.
   */
  terminal?: Terminal;
  /** Called instead of exiting, so a test is not killed by /quit. */
  onExit?: () => void;
  /**
   * Told which chat this screen is on, once it has one. The hands are claimed
   * per chat and a chat does not exist until the first message creates it, so
   * this fires after the ask rather than at start-up.
   */
  onChatOpened?: (chatId: string) => void;
}

type AssistantContent = Pick<RunState, 'text' | 'thinking' | 'tools'>;

/** One assistant segment that can change while streaming and survive settlement. */
class AssistantSegment extends Container {
  private content: AssistantContent;
  private settled = false;

  constructor(content: AssistantContent, private thinkingShown: boolean, settled = false) {
    super();
    this.content = content;
    this.settled = settled;
    this.rebuild();
  }

  update(content: AssistantContent): void {
    this.content = content;
    this.rebuild();
  }

  settle(content: AssistantContent = this.content): void {
    this.content = content;
    this.settled = true;
    this.rebuild();
  }

  setThinkingShown(shown: boolean): void {
    this.thinkingShown = shown;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    let hasBlock = false;
    const add = (component: Component): void => {
      if (hasBlock) this.addChild(new Spacer(1));
      this.addChild(component);
      hasBlock = true;
    };

    if (this.thinkingShown && this.content.thinking.trim().length > 0) {
      add(new Markdown(this.content.thinking, 0, 0, markdownTheme, {
        color: paint.dim,
        italic: true,
      }));
    }
    if (this.content.tools.length > 0) {
      add(new Text(
        this.content.tools.map((tool) => paint.dim(`  · ${tool.name} ${tool.status}`)).join('\n'),
        0,
        0,
      ));
    }
    if (this.content.text.length > 0) {
      add(this.settled
        ? new Markdown(this.content.text, 0, 0, markdownTheme)
        : new Text(this.content.text, 0, 0));
    }
  }
}

export class ChatScreen {
  private readonly tui: TUI;
  private readonly editor: Editor;
  private readonly header: Text;
  /** Replaceable history; the header and editor survive a chat switch. */
  private readonly transcript = new Container();
  /** The chat picker is a focus-capturing pi-tui overlay. */
  private picker: OverlayHandle | undefined;
  /** Prevents repeated /chats submissions from racing before the list arrives. */
  private pickerOpening = false;
  /** Current assistant segment; earlier steering segments remain in history. */
  private streaming: AssistantSegment | undefined;
  /** Every visible segment, including stored history, so `/think` redraws all. */
  private assistantSegments: AssistantSegment[] = [];
  /** Run-level state kept immediately above the editor, separate from output. */
  private runStatus: Text | undefined;
  private runStatusKind: RunState['status'] | undefined;
  private runStatusTimer: ReturnType<typeof setInterval> | undefined;
  private disconnectQuitTimer: ReturnType<typeof setTimeout> | undefined;
  private workingFrame = 0;
  private thinkingShown: boolean;
  /** Whether anything has been asked yet, so the first turn has no gap above. */
  private spoken = false;
  private title: string;

  constructor(private readonly options: ScreenOptions) {
    this.tui = new TUI(options.terminal ?? new ProcessTerminal());
    this.title = options.title ?? 'New conversation';
    this.thinkingShown = options.thinkingShown ?? true;
    this.header = new Text('', 0, 0);
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
    // Typing `/` now opens the menu, with Tab completing. The base path is the
    // launch directory, which is what pi-tui completes files against -- worth
    // knowing that until the local-tools channel lands (step 3) those files are on
    // THIS machine and the agent's tools still run on the server.
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(COMMANDS, process.cwd()));

    this.tui.addChild(this.header);
    this.tui.addChild(this.transcript);
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);
    this.paintHeader();

    this.editor.onSubmit = (text: string) => {
      void this.submit(text);
    };

    // Raw mode swallows SIGINT, so Ctrl+C has to be caught by hand or the
    // screen becomes a room with no door. Both keys are CONSUMED: an escape
    // that also reached the editor would clear what the user was typing while
    // interrupting the run, which is two surprises for one keypress.
    this.tui.addInputListener((data: string) => {
      if (matchesKey(data, 'ctrl+c')) {
        this.quit();
        return { consume: true };
      }
      // An overlay owns Escape before the screen does. Let SelectList receive
      // it so cancelling /chats never also interrupts the current answer.
      if (matchesKey(data, 'escape') && this.picker !== undefined) return undefined;
      // Escape stops the run, not the program: the run is what a person wants
      // to interrupt, and Ctrl+C is already the way out.
      if (matchesKey(data, 'escape')) {
        void this.options.session.stop();
        return { consume: true };
      }
      return undefined;
    });
  }

  start(): void {
    this.tui.start();
    this.say(paint.dim('Ask anything. /help for commands.'));
  }

  quit(): void {
    this.clearRunStatus(false);
    if (this.disconnectQuitTimer !== undefined) clearTimeout(this.disconnectQuitTimer);
    this.disconnectQuitTimer = undefined;
    this.tui.stop();
    if (this.options.onExit !== undefined) return this.options.onExit();
    process.exit(0);
  }

  /**
   * A finished block of text, appended and never touched again.
   *
   * `Text` pads by default -- a blank line above AND below -- while
   * `Markdown` here does not, so a streamed answer occupied three lines and
   * the same words rendered afterwards occupied one. Every answer that
   * finished therefore shrank its block by two and pulled the editor up with
   * it, which is what "the line I type jumps" was (Vinicius, 04/08). The two
   * have to be the same shape, so nothing pads.
   */
  say(text: string): void {
    this.append(new Text(text, 0, 0));
  }

  /** Adds a component to the replaceable history above the fixed editor. */
  private append(component: Component): void {
    // History lives in its own container. That keeps the fixed tail below it
    // and, unlike the former root-level append, lets a chat switch replace the
    // transcript without rebuilding the header, editor or TUI.
    this.transcript.addChild(component);
    this.tui.setFocus(this.editor);
    this.tui.requestRender();
  }

  private paintHeader(): void {
    this.header.setText(`${paint.bold(this.title)}  ${paint.dim(this.options.server)}`);
    this.tui.requestRender();
  }

  setTitle(title: string): void {
    this.title = title;
    this.paintHeader();
  }

  /** Replace the visible transcript with the authoritative server history. */
  onChatLoaded(chat: ChatDTO, response: MessagesResponse): void {
    this.clearRunStatus(false);
    this.streaming = undefined;
    this.assistantSegments = [];
    this.transcript.clear();
    this.spoken = false;
    this.setTitle(chat.title.length === 0 ? 'Untitled conversation' : chat.title);

    if (response.messages.length === 0) {
      this.say(paint.dim('No messages yet.'));
    } else {
      for (const message of response.messages) this.showStoredMessage(message);
    }
    this.tui.setFocus(this.editor);
    // Switching conversations is a genuine replacement, including terminal
    // scrollback from the old one; force one clean frame rather than replaying
    // a long differential deletion line by line.
    this.tui.requestRender(true);
  }

  /** Render one persisted turn in the same visual language as live output. */
  private showStoredMessage(message: MessageDTO): void {
    if (message.role === 'user') {
      this.showUser(message.content);
      if (message.attachments.length > 0) {
        this.say(paint.dim(`  attachments: ${message.attachments.map((entry) => entry.name).join(', ')}`));
      }
      return;
    }

    if (message.role === 'system') {
      if (this.spoken) this.append(new Spacer(1));
      this.spoken = true;
      this.say(paint.red(message.content));
      return;
    }

    // A history page can technically begin with an assistant turn when older
    // messages are outside the server's 50-message window.
    this.spoken = true;
    const segment = new AssistantSegment(
      { text: message.content, thinking: message.thinking, tools: message.tools },
      this.thinkingShown,
      true,
    );
    this.assistantSegments.push(segment);
    this.append(segment);
  }

  /** Fetch and display the server's canonical list of open conversations. */
  private async openChatPicker(): Promise<void> {
    if (this.picker !== undefined || this.pickerOpening) return;
    this.pickerOpening = true;

    try {
      const chats = await this.options.session.listChats();
      if (chats.length === 0) {
        this.say(paint.dim('No open conversations.'));
        return;
      }

      const byId = new Map(chats.map((chat) => [chat.id, chat]));
      const list = new SelectList(
        chats.map((chat) => ({
          value: chat.id,
          label: `${chat.pinned ? '◆ ' : ''}${chat.title.length === 0 ? '(untitled)' : chat.title}`,
          ...(chat.preview.length === 0
            ? {}
            : { description: chat.preview.replace(/\s+/g, ' ').trim() }),
        })),
        8,
        selectListTheme,
      );
      const current = chats.findIndex((chat) => chat.id === this.options.session.currentChatId);
      if (current >= 0) list.setSelectedIndex(current);

      const close = (): void => {
        this.picker?.hide();
        this.picker = undefined;
        this.tui.setFocus(this.editor);
      };
      list.onCancel = close;
      list.onSelect = (item) => {
        const selected = byId.get(item.value);
        close();
        if (selected === undefined) return;
        void this.options.session.switchTo(selected).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'That conversation did not load.';
          this.say(paint.red(message));
        });
      };

      this.picker = this.tui.showOverlay(list, {
        width: '80%',
        maxHeight: '70%',
        anchor: 'center',
        margin: 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The conversations did not load.';
      this.say(paint.red(message));
    } finally {
      this.pickerOpening = false;
    }
  }

  /** The run moved: repaint its output and its independent lifecycle line. */
  onRun(state: RunState): void {
    const hasOutput = state.text.length > 0 || state.thinking.length > 0 || state.tools.length > 0;
    if (hasOutput) {
      if (this.streaming === undefined) {
        this.streaming = new AssistantSegment(state, this.thinkingShown);
        this.assistantSegments.push(this.streaming);
        this.append(this.streaming);
      } else {
        this.streaming.update(state);
        this.tui.requestRender();
      }
    }

    this.setRunStatus(state.status);
  }

  /** Finalize the live segment in place, preserving its reasoning and position. */
  onIdle(state: RunState): void {
    this.clearRunStatus(true);
    const hasOutput = state.text.length > 0 || state.thinking.length > 0 || state.tools.length > 0;
    if (this.streaming !== undefined) {
      this.streaming.settle(state);
      this.streaming = undefined;
      this.tui.requestRender();
    } else if (hasOutput) {
      const segment = new AssistantSegment(state, this.thinkingShown, true);
      this.assistantSegments.push(segment);
      this.append(segment);
    }
    if (state.status === 'error') {
      this.say(paint.red(`The run failed: ${state.errorCode ?? 'unknown'}`));
    }
  }

  onQueued(_text: string): void {
    // submit() already rendered this as a user turn. The queue acknowledgment
    // must stay silent or the same guidance appears twice in the transcript.
  }

  /** A user turn arrived from the web, PWA, or another terminal. */
  onExternalUser(text: string): void {
    this.showUser(text);
  }

  /**
   * Pi consumed a steering message. Freeze the Text component exactly where
   * it is and let the next delta create a new one below the user's guidance.
   * Removing and re-appending it as Markdown would put the old answer AFTER
   * the guidance: this TUI is append-only and deliberately has no insertion.
   */
  onSteering(): void {
    this.streaming?.settle();
    this.streaming = undefined;
    this.tui.requestRender();
  }

  onStreamEnd(): void {
    this.clearRunStatus(true);
    this.say(paint.red('The connection to the server dropped. Restart pop to reconnect.'));
    // A dead interactive terminal can otherwise remain open indefinitely.
    // Give the user an hour to read/copy anything before doing the same clean
    // shutdown as `/quit`; unref keeps this safety timer from prolonging a
    // process that is already able to end on its own.
    if (this.disconnectQuitTimer !== undefined) return;
    this.disconnectQuitTimer = setTimeout(() => this.quit(), DISCONNECT_QUIT_MS);
    this.disconnectQuitTimer.unref();
  }

  private setRunStatus(status: RunState['status']): void {
    if (status === 'done' || status === 'error') {
      this.clearRunStatus(true);
      return;
    }
    if (this.runStatusKind === status && this.runStatus !== undefined) return;

    this.clearRunStatus(false);
    this.runStatusKind = status;
    this.workingFrame = 0;
    this.runStatus = new Text(this.runStatusText(), 0, 0);
    this.tui.removeChild(this.editor);
    this.tui.addChild(this.runStatus);
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);
    this.tui.requestRender();

    if (status === 'running') {
      this.runStatusTimer = setInterval(() => {
        if (this.runStatus === undefined) return;
        this.workingFrame = (this.workingFrame + 1) % WORKING_FRAMES.length;
        this.runStatus.setText(this.runStatusText());
        this.tui.requestRender();
      }, WORKING_FRAME_MS);
      this.runStatusTimer.unref();
    }
  }

  private clearRunStatus(render: boolean): void {
    if (this.runStatusTimer !== undefined) clearInterval(this.runStatusTimer);
    this.runStatusTimer = undefined;
    if (this.runStatus !== undefined) this.tui.removeChild(this.runStatus);
    this.runStatus = undefined;
    this.runStatusKind = undefined;
    if (render) this.tui.requestRender();
  }

  private runStatusText(): string {
    if (this.runStatusKind === 'queued') return paint.dim('Waiting for a free slot…');
    return paint.dim(`${WORKING_FRAMES[this.workingFrame]} Working…`);
  }

  private async submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length === 0) return;

    if (text.startsWith('/')) {
      this.command(text);
      return;
    }
    // Sending while busy is intentional: the server appends to the durable
    // steering FIFO and feeds its head into pi. Blocking here made the server
    // feature unreachable.

    this.showUser(text);
    try {
      await this.options.session.ask(text);
      const chatId = this.options.session.currentChatId;
      if (chatId !== undefined) this.options.onChatOpened?.(chatId);
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'chat_not_found'
          ? `${error.message} Type /new to start a new conversation`
          : error instanceof Error
            ? error.message
            : 'That did not send.';
      this.say(paint.red(message));
    }
  }

  /**
   * One user bubble, local or synchronized. A blank line belongs between
   * turns, never between a question and its answer.
   */
  private showUser(text: string): void {
    // Spacer, not an empty Text: `Text` trims, so whitespace-only content
    // renders zero lines and the separator silently is not there.
    if (this.spoken) this.append(new Spacer(1));
    this.spoken = true;
    this.say(paint.cyan(`> ${text}`));
  }

  private command(text: string): void {
    const [name] = text.split(/\s+/);
    switch (name) {
      case '/quit':
      case '/exit':
        this.quit();
        return;
      case '/help':
        this.say(HELP);
        return;
      case '/chats':
        void this.openChatPicker();
        return;
      case '/stop':
        void this.options.session.stop();
        return;
      case '/think':
        this.thinkingShown = !this.thinkingShown;
        for (const segment of this.assistantSegments) segment.setThinkingShown(this.thinkingShown);
        this.options.onThinkingShownChange?.(this.thinkingShown);
        this.say(paint.dim(this.thinkingShown ? 'Reasoning shown.' : 'Reasoning hidden.'));
        return;
      case '/new':
        this.options.session.open(undefined);
        this.setTitle('New conversation');
        this.say(paint.dim('New conversation.'));
        return;
      default:
        this.say(paint.yellow(`No such command: ${name ?? text}`));
    }
  }
}
