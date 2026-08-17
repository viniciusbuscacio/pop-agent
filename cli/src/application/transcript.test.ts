import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { Transcript, emptyRun } from './transcript.js';

const CHAT = 'chat-1';
const RUN = 'run-1';

function fold(events: StreamEvent[]) {
  const transcript = new Transcript(emptyRun(CHAT, RUN));
  for (const event of events) transcript.apply(event);
  return transcript;
}

const delta = (text: string, seq: number): StreamEvent => ({
  kind: 'delta',
  chatId: CHAT,
  runId: RUN,
  seq,
  text,
});

describe('Transcript', () => {
  it('builds the answer out of its fragments', () => {
    expect(fold([delta('Hello', 0), delta(', world', 1)]).snapshot().text).toBe('Hello, world');
  });

  it('drops a fragment it has already seen', () => {
    // A client that reattaches seeds itself from the live snapshot and then
    // keeps receiving from the stream, so the overlap arrives twice.
    expect(fold([delta('a', 0), delta('b', 1), delta('b', 1)]).snapshot().text).toBe('ab');
  });

  it('ignores another run on the same connection', () => {
    // Pop Agent has one user and the hub sends everything to everyone, so a
    // terminal watching one answer really does see another chat go past.
    const transcript = fold([
      delta('mine', 0),
      { kind: 'delta', chatId: CHAT, runId: 'run-2', seq: 0, text: 'theirs' },
      { kind: 'delta', chatId: 'chat-2', runId: RUN, seq: 1, text: 'elsewhere' },
    ]);
    expect(transcript.snapshot().text).toBe('mine');
  });

  it('starts a fresh visible segment when pi consumes steering', () => {
    const transcript = fold([
      delta('before', 0),
      {
        kind: 'steering-delivered',
        chatId: CHAT,
        runId: RUN,
        seq: 0,
        assistant: {
          id: 'assistant-before',
          chatId: CHAT,
          role: 'assistant',
          content: 'before',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
        user: {
          id: 'user-steering',
          chatId: CHAT,
          role: 'user',
          content: 'change course',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
      delta('after', 1),
    ]);

    expect(transcript.snapshot()).toMatchObject({
      runId: RUN,
      text: 'after',
      thinking: '',
      tools: [],
      status: 'running',
    });
  });

  it('follows a run from queued to running to done', () => {
    const transcript = fold([
      { kind: 'run-status', chatId: CHAT, runId: RUN, status: 'queued' },
    ]);
    expect(transcript.snapshot().status).toBe('queued');
    expect(transcript.finished).toBe(false);

    transcript.apply({ kind: 'run-status', chatId: CHAT, runId: RUN, status: 'running' });
    expect(transcript.snapshot().status).toBe('running');

    transcript.apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'message-1' });
    expect(transcript.finished).toBe(true);
  });

  it('remembers why a run failed', () => {
    const transcript = fold([{ kind: 'error', chatId: CHAT, runId: RUN, code: 'provider_down' }]);
    expect(transcript.snapshot().errorCode).toBe('provider_down');
    expect(transcript.finished).toBe(true);
  });

  it('takes the title, which belongs to the chat and carries no run', () => {
    expect(fold([{ kind: 'title', chatId: CHAT, title: 'Naming things' }]).snapshot().title).toBe(
      'Naming things',
    );
  });

  it('advances a tool in place instead of listing it twice', () => {
    const transcript = fold([
      { kind: 'tool', chatId: CHAT, runId: RUN, seq: 0, name: 'bash', status: 'start' },
      { kind: 'tool', chatId: CHAT, runId: RUN, seq: 1, name: 'bash', status: 'done' },
    ]);
    expect(transcript.snapshot().tools).toEqual([{ name: 'bash', status: 'done' }]);
  });

  it('keeps two calls to the same tool apart', () => {
    // A second `start` is a second call, not an update to the first.
    const transcript = fold([
      { kind: 'tool', chatId: CHAT, runId: RUN, seq: 0, name: 'bash', status: 'start' },
      { kind: 'tool', chatId: CHAT, runId: RUN, seq: 1, name: 'bash', status: 'done' },
      { kind: 'tool', chatId: CHAT, runId: RUN, seq: 2, name: 'bash', status: 'start' },
    ]);
    expect(transcript.snapshot().tools).toHaveLength(2);
  });

  it('says nothing changed when nothing did, so a screen need not repaint', () => {
    const transcript = new Transcript(emptyRun(CHAT, RUN));
    expect(transcript.apply(delta('a', 0))).toBe(true);
    expect(transcript.apply(delta('a', 0))).toBe(false);
    expect(transcript.apply({ kind: 'chat-pin-changed', chatId: CHAT, pinned: true })).toBe(false);
    expect(transcript.apply({ kind: 'chat-archived-changed', chatId: CHAT, archived: true })).toBe(false);
    expect(transcript.apply({
      kind: 'chat-model-changed', chatId: CHAT, provider: 'fake', model: 'fake/model-2',
    })).toBe(false);
  });
});
