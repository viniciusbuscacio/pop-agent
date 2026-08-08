import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '../ports/event-sink.js';
import { newMessageId } from '../../domain/ids.js';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import type { CompletionRequest } from '../ports/provider-gateway.js';
import { ChatService } from './chat-service.js';
import { TitleService, buildTitlePrompt, parseTitleAnswer, scrub } from './title-service.js';

const CHAT = 'chat-title-test';
const T0 = '2026-07-31T00:00:00.000Z';

class ScriptedGateway {
  answer = 'TITLE: Kimi pricing\nSUMMARY: The user asked what Kimi K3 costs.';
  failure: string | undefined;
  requests: CompletionRequest[] = [];

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  complete(request: CompletionRequest): Promise<{ text: string }> {
    this.requests.push(request);
    if (this.failure !== undefined) return Promise.reject(new Error(this.failure));
    return Promise.resolve({ text: this.answer });
  }
}

let db: Database.Database;
let chats: SqliteChatRepo;
let gateway: ScriptedGateway;
let events: RunEvent[];
let apiKey: string | undefined;
let service: TitleService;

function seedTurns(userTurns: number): void {
  for (let turn = 0; turn < userTurns; turn += 1) {
    for (const role of ['user', 'assistant'] as const) {
      chats.appendMessage({
        id: newMessageId(),
        chatId: CHAT,
        role,
        content: role === 'user' ? `question ${String(turn + 1)}` : `answer ${String(turn + 1)}`,
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: T0,
      });
    }
  }
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  chats.create({
    id: CHAT,
    title: 'Question 1',
    model: '',
    provider: '',
    archived: false,
    piSessionId: '',
    summary: '',
    autoTitle: true,
    createdAt: T0,
    updatedAt: T0,
  });

  gateway = new ScriptedGateway();
  events = [];
  apiKey = 'sk-service';
  // The title now asks the provider service for a background completion; the
  // scripted gateway stands in for whatever provider that resolver picked, so
  // the assertions about what was sent are unchanged.
  service = new TitleService({
    chats,
    complete: (request) =>
      apiKey === undefined
        ? Promise.reject(new Error('No provider is configured for background work.'))
        : gateway.complete({ apiKey, model: 'moonshotai/kimi-k3', ...request }).then((answer) => answer.text),
    sink: { emit: (event) => events.push(event) },
  });
});

describe('when the title job runs', () => {
  it('does nothing before the third user turn', async () => {
    seedTurns(2);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(0);
    expect(chats.get(CHAT)?.title).toBe('Question 1');
  });

  it('renames at the third user turn and stores the summary', async () => {
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]?.model).toBe('moonshotai/kimi-k3');
    expect(chats.get(CHAT)?.title).toBe('Kimi pricing');
    expect(chats.get(CHAT)?.summary).toBe('The user asked what Kimi K3 costs.');
    expect(events).toEqual([{ kind: 'title', chatId: CHAT, title: 'Kimi pricing' }]);
  });

  it('runs again every tenth turn after the third', async () => {
    seedTurns(13);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(1);
  });

  it('rests between the scheduled turns', async () => {
    seedTurns(7);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(0);
  });

  it('stays away from a chat renamed by hand', async () => {
    // The manual rename flows through ChatService, which turns auto off.
    const manual = new ChatService({ chats, clock: { now: () => Date.parse(T0) } });
    manual.rename(CHAT, 'My own name');
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(0);
    expect(chats.get(CHAT)?.title).toBe('My own name');
  });

  it('does not call anyone without a key', async () => {
    apiKey = undefined;
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(0);
  });

  it('keeps the title it had when the provider fails', async () => {
    const failures: string[] = [];
    service = new TitleService({
      chats,
      complete: (request) =>
        apiKey === undefined
          ? Promise.reject(new Error('No provider is configured for background work.'))
          : gateway.complete({ apiKey, model: 'moonshotai/kimi-k3', ...request }).then((answer) => answer.text),
      sink: { emit: (event) => events.push(event) },
      onFailure: (message) => failures.push(message),
    });
    gateway.failure = 'rate limited';
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(chats.get(CHAT)?.title).toBe('Question 1');
    expect(events).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('falls back to a deterministic title when a generic chat has no key', async () => {
    chats.rename(CHAT, 'Chat 7'); // the starter name nobody chose
    apiKey = undefined;
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(gateway.requests).toHaveLength(0);
    expect(chats.get(CHAT)?.title).toBe('Question 1 2'.slice(0, 0) || 'Question 1'); // from the first user words
    expect(chats.get(CHAT)?.title).not.toBe('Chat 7');
  });

  it('names a colliding title uniquely, case-insensitive', async () => {
    chats.create({
      id: 'chat-other',
      title: 'kimi pricing',
      model: '',
      provider: '',
      archived: false,
      piSessionId: '',
      summary: '',
      autoTitle: true,
      createdAt: T0,
      updatedAt: T0,
    });
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(chats.get(CHAT)?.title).toBe('Kimi pricing 2');
  });

  it('records every auto-title in the forensic log', async () => {
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    const rows = db
      .prepare('SELECT title, turn, source FROM chat_titles WHERE chat_id = ?')
      .all(CHAT) as { title: string; turn: number; source: string }[];
    expect(rows).toEqual([{ title: 'Kimi pricing', turn: 3, source: 'auto' }]);
  });

  it('logs the reason of every skip', async () => {
    const failures: string[] = [];
    service = new TitleService({
      chats,
      complete: (request) =>
        apiKey === undefined
          ? Promise.reject(new Error('No provider is configured for background work.'))
          : gateway.complete({ apiKey, model: 'moonshotai/kimi-k3', ...request }).then((answer) => answer.text),
      sink: { emit: (event) => events.push(event) },
      onFailure: (message) => failures.push(message),
    });
    seedTurns(2); // below the cadence

    await service.maybeRetitle(CHAT);
    expect(failures[0]).toContain('cadence');

    failures.length = 0;
    seedTurns(1); // turn 3 now
    gateway.answer = `TITLE: Question 1\nSUMMARY: same as before`;
    await service.maybeRetitle(CHAT);
    expect(failures[0]).toContain('same-title');
  });

  it('keeps the title when the answer has no usable one', async () => {
    gateway.answer = '   ';
    seedTurns(3);

    await service.maybeRetitle(CHAT);

    expect(chats.get(CHAT)?.title).toBe('Question 1');
  });
});

describe('what the model is sent', () => {
  it('never includes a line that smells of a credential', async () => {
    seedTurns(2);
    chats.appendMessage({
      id: newMessageId(),
      chatId: CHAT,
      role: 'user',
      content: 'here is my password: hunter2\nand the plan for tomorrow',
      thinking: '',
      tools: [],
      attachments: [],
      createdAt: T0,
    });

    await service.maybeRetitle(CHAT);

    const prompt = gateway.requests[0]?.prompt ?? '';
    expect(prompt).not.toContain('hunter2');
    expect(prompt).toContain('[redacted]');
    expect(prompt).toContain('the plan for tomorrow');
  });

  it('clips each message instead of sending essays', () => {
    const prompt = buildTitlePrompt([
      {
        id: 'm1',
        chatId: CHAT,
        role: 'user',
        content: 'x'.repeat(1_000),
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: T0,
      },
    ]);

    expect(prompt).not.toContain('x'.repeat(300));
  });
});

describe('parsing the answer', () => {
  it('reads the two labelled lines', () => {
    expect(parseTitleAnswer('TITLE: Trip to Recife\nSUMMARY: Planning flights.')).toEqual({
      title: 'Trip to Recife',
      summary: 'Planning flights.',
    });
  });

  it('survives decoration and stray prose', () => {
    const answer = 'Sure! Here you go:\n**Title:** "Grocery list"\n*Summary:* Weekly shopping.';

    expect(parseTitleAnswer(answer)).toEqual({
      title: 'Grocery list',
      summary: 'Weekly shopping.',
    });
  });

  it('takes the first line when the model skipped the labels', () => {
    expect(parseTitleAnswer('Grocery list')).toEqual({ title: 'Grocery list' });
  });

  it('sheds trailing punctuation and refuses near-empty titles', () => {
    expect(parseTitleAnswer('TITLE: Kimi pricing!\nSUMMARY: x').title).toBe('Kimi pricing');
    expect(parseTitleAnswer('TITLE: "Costs."\nSUMMARY: x').title).toBe('Costs');
    expect(parseTitleAnswer('TITLE: a\nSUMMARY: x').title).toBeUndefined();
    expect(parseTitleAnswer('TITLE: !\nSUMMARY: x').title).toBeUndefined();
  });

  it('caps a runaway title', () => {
    const { title } = parseTitleAnswer(`TITLE: ${'word '.repeat(40)}`);

    expect(title !== undefined && title.length <= 60).toBe(true);
  });
});

describe('the scrubber', () => {
  it('redacts exactly the suspicious lines', () => {
    const text = 'safe line\napi_key=abc123\nanother safe line\nmy token here';

    expect(scrub(text)).toBe('safe line\n[redacted]\nanother safe line\n[redacted]');
  });
});
