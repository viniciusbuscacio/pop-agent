import type {
  AgentBridge,
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  ModelInfo,
} from '../../application/ports/agent-bridge.js';

/**
 * A scripted stand-in for pi (Phase 2). It exists so the entire chat -- the
 * streaming UI, the run registry, the queue, persistence, Stop -- can be built
 * and tested end to end without spending a single token, and so the failure
 * paths can be triggered on demand instead of hoped for.
 *
 * The script is chosen by a prefix on the prompt, which makes every scenario
 * reachable by typing:
 *
 * | prompt starts with | what it stages                                      |
 * |--------------------|-----------------------------------------------------|
 * | `think:`           | five thinking events, then a short answer            |
 * | `tool:`            | thinking, a bash tool streaming six output lines, answer |
 * | `error:`           | a few words, then a provider failure                 |
 * | `slow:`            | sixty words over thirty seconds (for Stop and queue) |
 * | anything else      | a fifteen-fragment answer that echoes the prompt      |
 *
 * Every wait honours the abort signal, so Stop is instant rather than
 * "instant once the current sleep finishes".
 */

const DEFAULT_STEP_MS = 80;
const TOOL_STEP_MS = 150;
const SLOW_STEP_MS = 500;

export class FakeAgentBridge implements AgentBridge {
  /** Overridable so tests do not spend real seconds on the slow script. */
  constructor(private readonly speed = 1) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const { prompt, onEvent, signal } = request;

    try {
      if (prompt.startsWith('think:')) await this.think(prompt, onEvent, signal);
      else if (prompt.startsWith('tool:')) await this.tool(onEvent, signal);
      else if (prompt.startsWith('error:')) await this.fail(onEvent, signal);
      else if (prompt.startsWith('slow:')) await this.slow(onEvent, signal);
      else await this.answer(prompt, onEvent, signal);
    } catch (error) {
      // The only throw in here is the abort; anything else is a real bug and
      // should surface as a failed run rather than a silent success.
      onEvent({ kind: 'error', code: error instanceof AbortError ? 'aborted' : 'operation_error' });
    }

    // Honest accounting: the smoke asserts that a run books its usage, and a
    // fake that costs nothing books exactly that.
    return {
      usage: {
        provider: 'fake',
        model: request.model.length > 0 ? request.model : 'fake/model-1',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
      },
    };
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([{ id: 'fake/model-1' }, { id: 'fake/model-2' }]);
  }

  private async answer(
    prompt: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const words = [
      'Here', 'is', 'a', 'staged', 'reply', 'from', 'the', 'fake', 'bridge.',
      `You said: "${prompt.slice(0, 60)}".`,
      'No', 'model', 'was', 'contacted', 'to', 'produce', 'this.',
    ];
    for (const [index, word] of words.entries()) {
      await sleep(DEFAULT_STEP_MS / this.speed, signal);
      onEvent({ kind: 'delta', text: index === 0 ? word : ` ${word}` });
    }
  }

  private async think(
    prompt: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const thoughts = [
      'Reading the question.',
      'Considering what is actually being asked.',
      'Weighing two ways to answer it.',
      'Picking the shorter one.',
      'Writing it out.',
    ];
    for (const thought of thoughts) {
      await sleep(DEFAULT_STEP_MS / this.speed, signal);
      onEvent({ kind: 'thinking', text: `${thought} ` });
    }
    await this.answer(prompt.slice('think:'.length).trim(), onEvent, signal);
  }

  private async tool(
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    await sleep(DEFAULT_STEP_MS / this.speed, signal);
    onEvent({ kind: 'thinking', text: 'This needs a shell. ' });

    await sleep(DEFAULT_STEP_MS / this.speed, signal);
    onEvent({ kind: 'tool', name: 'bash', status: 'start', detail: 'echo hello\n' });

    for (let line = 1; line <= 6; line += 1) {
      await sleep(TOOL_STEP_MS / this.speed, signal);
      onEvent({ kind: 'tool', name: 'bash', status: 'output', detail: `line ${String(line)}\n` });
    }

    await sleep(DEFAULT_STEP_MS / this.speed, signal);
    onEvent({ kind: 'tool', name: 'bash', status: 'done', detail: 'exit 0' });

    for (const [index, word] of ['The', 'command', 'ran', 'fine.'].entries()) {
      await sleep(DEFAULT_STEP_MS / this.speed, signal);
      onEvent({ kind: 'delta', text: index === 0 ? word : ` ${word}` });
    }
  }

  private async fail(onEvent: (event: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    for (const [index, word] of ['Starting', 'to', 'answer…'].entries()) {
      await sleep(DEFAULT_STEP_MS / this.speed, signal);
      onEvent({ kind: 'delta', text: index === 0 ? word : ` ${word}` });
    }
    await sleep(DEFAULT_STEP_MS / this.speed, signal);
    onEvent({ kind: 'error', code: 'provider_error' });
  }

  private async slow(onEvent: (event: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    for (let word = 1; word <= 60; word += 1) {
      await sleep(SLOW_STEP_MS / this.speed, signal);
      onEvent({ kind: 'delta', text: `word-${String(word)} ` });
    }
  }
}

class AbortError extends Error {
  constructor() {
    super('run aborted');
    this.name = 'AbortError';
  }
}

/** A wait that gives up the moment the run is aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new AbortError());
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
