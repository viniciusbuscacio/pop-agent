import {
  Editor,
  Markdown,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui';
import type { ChatSession } from '../../application/session.js';
import type { RunState } from '../../application/transcript.js';
import { editorTheme, markdownTheme, paint } from './theme.js';

/**
 * The interactive screen (docs/cli.md, step 4): pi's shape, Popy's head.
 *
 * Everything hard about a terminal -- differential rendering, the multi-line
 * editor with IME, key parsing across terminals, markdown to ANSI, bracketed
 * paste -- comes from `@earendil-works/pi-tui`, published in lockstep with pi
 * itself. What is written here is only the composition: what goes on the
 * screen, in what order, and what the keys mean for Popy. That split is the
 * point. Copying pi's own screen would buy today's look and cost every future
 * pi release; depending on the library buys the releases too.
 *
 * The transcript is append-only. A finished answer becomes a `Markdown`
 * component and stops changing, so the differential renderer has nothing to
 * recompute above the line that is still streaming -- which is what keeps a
 * long conversation from redrawing itself on every token.
 */

const HELP = `  /new      start a fresh conversation
  /stop     interrupt the answer in flight
  /think    show or hide the reasoning
  /help     this
  /quit     leave (or Ctrl+C)`;

export interface ScreenOptions {
  session: ChatSession;
  /** Shown in the header, so two terminals on two servers are told apart. */
  server: string;
  title?: string;
  /**
   * Injected so the screen can be driven without a real terminal. Everything
   * else in this client already takes its I/O as a parameter; the screen was
   * the one piece that reached for the process itself, which made the only
   * question that matters -- what ends up on screen -- unanswerable in a test.
   */
  terminal?: Terminal;
  /** Called instead of exiting, so a test is not killed by /quit. */
  onExit?: () => void;
}

export class ChatScreen {
  private readonly tui: TUI;
  private readonly editor: Editor;
  private readonly header: Text;
  /** The answer being streamed. Replaced by Markdown once it settles. */
  private streaming: Text | undefined;
  private thinkingShown = false;
  private title: string;

  constructor(private readonly options: ScreenOptions) {
    this.tui = new TUI(options.terminal ?? new ProcessTerminal());
    this.title = options.title ?? 'New conversation';
    this.header = new Text('');
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });

    this.tui.addChild(this.header);
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
    this.tui.stop();
    if (this.options.onExit !== undefined) return this.options.onExit();
    process.exit(0);
  }

  /** A finished block of text, appended and never touched again. */
  say(text: string): void {
    this.append(new Text(text));
  }

  private markdown(text: string): void {
    this.append(new Markdown(text, 0, 0, markdownTheme));
  }

  /**
   * Adds to the transcript and puts the editor back underneath it.
   *
   * The TUI only appends -- there is no insert -- so a child added after the
   * editor renders BELOW it. Left alone, that is a screen where you type at
   * the top and your words appear at the bottom, which is exactly what it did
   * (Vinicius, 04/08). The editor is lifted and set down again on every
   * append, and focus is reasserted because removing the focused component
   * drops it.
   */
  private append(component: Component): void {
    this.tui.removeChild(this.editor);
    this.tui.addChild(component);
    this.tui.addChild(this.editor);
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

  /** The run moved: repaint only the line that is growing. */
  onRun(state: RunState): void {
    const body = this.thinkingShown && state.thinking.length > 0
      ? `${paint.dim(state.thinking)}\n\n${state.text}`
      : state.text;
    const tools = state.tools.map((tool) => paint.dim(`  · ${tool.name} ${tool.status}`)).join('\n');
    const shown = [tools, body].filter((part) => part.length > 0).join('\n');
    if (shown.length === 0) return;

    if (this.streaming === undefined) {
      this.streaming = new Text(shown);
      this.append(this.streaming);
      return;
    }
    this.streaming.setText(shown);
    this.tui.requestRender();
  }

  /**
   * The run ended. The streamed plain text is swapped for the same words
   * rendered as markdown -- headings, lists and code blocks only make sense
   * once the text stops arriving mid-token.
   */
  onIdle(state: RunState): void {
    if (this.streaming !== undefined) {
      this.tui.removeChild(this.streaming);
      this.streaming = undefined;
    }
    if (state.status === 'error') {
      this.say(paint.red(`The run failed: ${state.errorCode ?? 'unknown'}`));
      return;
    }
    if (state.text.length > 0) this.markdown(state.text);
  }

  onStreamEnd(): void {
    this.say(paint.red('The connection to the server dropped. Restart popy to reconnect.'));
  }

  private async submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length === 0) return;

    if (text.startsWith('/')) {
      this.command(text);
      return;
    }
    if (this.options.session.busy) {
      this.say(paint.yellow('Still answering. Escape interrupts it.'));
      return;
    }

    this.say(paint.cyan(`> ${text}`));
    try {
      await this.options.session.ask(text);
    } catch (error) {
      this.say(paint.red(error instanceof Error ? error.message : 'That did not send.'));
    }
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
      case '/stop':
        void this.options.session.stop();
        return;
      case '/think':
        this.thinkingShown = !this.thinkingShown;
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
