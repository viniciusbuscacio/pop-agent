import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatDTO, MessageDTO, StreamEvent } from '@pop-agent/shared';
import type { Hono } from 'hono';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

let fixture: TestApp;
let app: Hono;
let token: string;

async function api(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.auth !== false) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function newChat(): Promise<ChatDTO> {
  return (await (await api('/v1/chats', { method: 'POST' })).json()) as ChatDTO;
}

beforeEach(async () => {
  fixture = createTestApp();
  app = fixture.app;
  const setup = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  token = ((await setup.json()) as { token: string }).token;
});

describe('chat collection', () => {
  it('needs a session', async () => {
    expect((await api('/v1/chats', { auth: false })).status).toBe(401);
  });

  it('starts empty and grows', async () => {
    expect(((await (await api('/v1/chats')).json()) as { chats: ChatDTO[] }).chats).toEqual([]);

    const created = await newChat();

    expect(created.title).toBe('Chat 1'); // deterministic starter, lowest free N
    const { chats } = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(chats.map((chat) => chat.id)).toEqual([created.id]);
  });

  it('deletes every archived chat in one call, and only those', async () => {
    // The bulk route exists because the archive is where a scheduled task
    // piles up dozens of chats; and it must be registered before
    // '/chats/:id', which would otherwise read "archived" as an id.
    const keep = (await (await api('/v1/chats', { method: 'POST' })).json()) as ChatDTO;
    const one = (await (await api('/v1/chats', { method: 'POST' })).json()) as ChatDTO;
    const two = (await (await api('/v1/chats', { method: 'POST' })).json()) as ChatDTO;
    await api(`/v1/chats/${one.id}`, { method: 'PATCH', body: { archived: true } });
    await api(`/v1/chats/${two.id}`, { method: 'PATCH', body: { archived: true } });

    const response = await api('/v1/chats/archived', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });

    const active = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(active.chats.map((chat) => chat.id)).toEqual([keep.id]);
    const archived = (await (await api('/v1/chats?archived=true')).json()) as {
      chats: ChatDTO[];
    };
    expect(archived.chats).toEqual([]);
  });

  it('separates archived from open chats', async () => {
    const open = await newChat();
    const filed = await newChat();

    await api(`/v1/chats/${filed.id}`, { method: 'PATCH', body: { archived: true } });

    const openList = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    const archivedList = (await (await api('/v1/chats?archived=true')).json()) as {
      chats: ChatDTO[];
    };
    expect(openList.chats.map((chat) => chat.id)).toEqual([open.id]);
    expect(archivedList.chats.map((chat) => chat.id)).toEqual([filed.id]);
  });

  it('renames and re-models', async () => {
    const chat = await newChat();

    const renamed = (await (
      await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { title: 'Groceries' } })
    ).json()) as ChatDTO;
    expect(renamed.title).toBe('Groceries');

    const remodelled = (await (
      await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { model: 'fake/model-2' } })
    ).json()) as ChatDTO;
    expect(remodelled.model).toBe('fake/model-2');
  });

  it('rejects a patch field it does not know', async () => {
    const chat = await newChat();

    const res = await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { colour: 'red' } });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_field');
  });

  it('deletes', async () => {
    const chat = await newChat();

    expect((await api(`/v1/chats/${chat.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`/v1/chats/${chat.id}/messages`)).status).toBe(404);
  });

  it('takes the chat\'s workspace attachments with it (pop-agent.spec §6)', async () => {
    const chat = await newChat();
    const attachments = join(fixture.workspace, 'attachments', chat.id);
    mkdirSync(attachments, { recursive: true });
    writeFileSync(join(attachments, 'photo.png'), 'bytes');

    await api(`/v1/chats/${chat.id}`, { method: 'DELETE' });

    expect(existsSync(attachments)).toBe(false);
  });

  it('stops the run it had in flight before deleting anything', async () => {
    const chat = await newChat();
    // The slow script streams for thirty seconds; the delete must not wait.
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: keep going' } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fixture.runs.liveRun(chat.id)).toBeDefined();

    expect((await api(`/v1/chats/${chat.id}`, { method: 'DELETE' })).status).toBe(204);

    expect(fixture.runs.liveRun(chat.id)).toBeUndefined();
    // And the run unwinds without writing into rows that no longer exist.
    await fixture.runs.whenIdle();
    expect(fixture.chats.get(chat.id)).toBeUndefined();
  });

  it('answers 404 for a chat that does not exist', async () => {
    for (const [path, method] of [
      ['/v1/chats/chat-000000000000/messages', 'GET'],
      ['/v1/chats/chat-000000000000', 'DELETE'],
      ['/v1/chats/chat-000000000000/stop', 'POST'],
    ] as const) {
      const res = await api(path, { method });
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('chat_not_found');
    }
  });
});

describe('sending a message', () => {
  it('accepts with 202 and the ids the client needs', async () => {
    const chat = await newChat();

    const res = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'hello there' },
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string; userMessageId: string };
    expect(body.runId).toMatch(/^run-/);
    expect(body.userMessageId).toMatch(/^message-/);
    await fixture.runs.whenIdle();
  });

  it('stores the exchange and returns it in order', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'hello there' } });
    await fixture.runs.whenIdle();

    const { messages } = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      messages: MessageDTO[];
    };

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.content).toBe('hello there');
    expect(messages[1]?.content).toContain('fake bridge');
  });

  it('persists one follow-up on the server while the first run is active', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });

    const res = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'two' },
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true, message: { chatId: chat.id, text: 'two' } });
    const snapshot = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      queued?: { text: string };
    };
    expect(snapshot.queued?.text).toBe('two');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('refuses a third message without replacing the durable follow-up', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'two' } });

    const third = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'three' },
    });

    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe('queue_exists');
    expect(fixture.queuedMessages.get(chat.id)?.text).toBe('two');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('preserves uploaded attachments and Files references until execution', async () => {
    const chat = await newChat();
    fixture.files.write('reports/context.txt', Buffer.from('server file'));
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: {
        text: 'with files',
        attachments: [
          { name: 'upload.txt', type: 'text/plain', dataUri: 'data:text/plain;base64,dXBsb2Fk' },
        ],
        filePaths: ['reports/context.txt'],
      },
    });

    expect(fixture.queuedMessages.get(chat.id)).toMatchObject({
      text: 'with files',
      attachments: [{ name: 'upload.txt' }],
      filePaths: ['reports/context.txt'],
    });
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();

    const { messages } = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      messages: MessageDTO[];
    };
    const sent = messages.find((message) => message.role === 'user' && message.content === 'with files');
    expect(sent?.attachments.map((attachment) => attachment.name)).toEqual([
      'upload.txt',
      'context.txt',
    ]);
  });

  it('edits and cancels the queued message from any client', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'old text' } });

    const edited = await api(`/v1/chats/${chat.id}/queue`, {
      method: 'PUT',
      body: { text: 'new text' },
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ message: { text: 'new text' } });

    expect((await api(`/v1/chats/${chat.id}/queue`, { method: 'DELETE' })).status).toBe(204);
    expect(fixture.queuedMessages.get(chat.id)).toBeUndefined();
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('consumes the queued message exactly once when the chat becomes free', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'second' } });

    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
    // Reconciliation, SSE and startup may all notice the free chat. Repeating
    // the drain after consumption must remain a no-op.
    fixture.queuedMessages.drainAll();

    const { messages } = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      messages: MessageDTO[];
    };
    expect(messages.filter((message) => message.role === 'user' && message.content === 'second')).toHaveLength(1);
    expect(fixture.queuedMessages.get(chat.id)).toBeUndefined();
  });

  it('broadcasts queue creation, edits and consumption to other devices', async () => {
    const chat = await newChat();
    const events: StreamEvent[] = [];
    const unsubscribe = fixture.hub.subscribe((payload) => events.push(JSON.parse(payload) as StreamEvent));
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'two' } });
    await api(`/v1/chats/${chat.id}/queue`, { method: 'PUT', body: { text: 'edited' } });
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
    unsubscribe();

    const queueEvents = events.filter((event) => event.kind === 'queue');
    expect(queueEvents.map((event) => event.message?.text)).toEqual(['two', 'edited', undefined]);
  });

  it('rejects an empty message', async () => {
    const chat = await newChat();

    expect(
      (await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: '' } })).status,
    ).toBe(400);
  });

  it('names the chat after the first message', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'help me plan the grocery shopping' },
    });
    await fixture.runs.whenIdle();

    const { chats } = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(chats[0]?.title).toBe('Help Plan Grocery Shopping');
    expect(chats[0]?.preview.length).toBeGreaterThan(0);
  });
});

describe('stopping', () => {
  it('reports whether there was anything to stop', async () => {
    const chat = await newChat();

    const idle = await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    expect(await idle.json()).toEqual({ stopped: false });

    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: going' } });
    const running = await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    expect(await running.json()).toEqual({ stopped: true });
    await fixture.runs.whenIdle();
  });
});

describe('the event stream', () => {
  async function ticket(): Promise<string> {
    const res = await api('/v1/events/ticket', { method: 'POST' });
    return ((await res.json()) as { ticket: string }).ticket;
  }

  it('refuses a connection with no ticket', async () => {
    const res = await app.request('/v1/events');

    expect(res.status).toBe(401);
  });

  it('refuses a made-up ticket', async () => {
    expect((await app.request('/v1/events?ticket=not-a-real-ticket')).status).toBe(401);
  });

  it('needs a session to get a ticket', async () => {
    expect((await api('/v1/events/ticket', { method: 'POST', auth: false })).status).toBe(401);
  });

  it('spends the ticket on first use', async () => {
    const issued = await ticket();

    const first = await app.request(`/v1/events?ticket=${issued}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/event-stream');
    await first.body?.cancel();

    expect((await app.request(`/v1/events?ticket=${issued}`)).status).toBe(401);
  });

  it('streams a run to a connected listener', async () => {
    const chat = await newChat();
    const stream = await app.request(`/v1/events?ticket=${await ticket()}`);
    const reader = stream.body!.getReader();

    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'tool: run it' } });

    const kinds = new Set<string>();
    const decoder = new TextDecoder();
    let buffer = '';
    // Read until the run reports it is finished.
    while (!kinds.has('done')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const line of buffer.split('\n')) {
        const match = /^data: (.+)$/.exec(line);
        if (match?.[1] === undefined) continue;
        kinds.add((JSON.parse(match[1]) as StreamEvent).kind);
      }
    }
    await reader.cancel();
    await fixture.runs.whenIdle();

    expect(kinds).toContain('title');
    expect(kinds).toContain('run-status');
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('tool');
    expect(kinds).toContain('delta');
    expect(kinds).toContain('done');
  });
});

describe('models', () => {
  it('offers what the bridge knows', async () => {
    const res = await api('/v1/models');

    expect(await res.json()).toEqual({
      models: [{ id: 'fake/model-1' }, { id: 'fake/model-2' }],
      source: 'engine',
    });
  });
});
