import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  LOCAL_CONNECTION_HEADER,
  type ChatDTO,
  type MessageDTO,
  type StreamEvent,
} from '@pop-agent/shared';
import type { Hono } from 'hono';
import { MAX_PENDING_MESSAGES_PER_CHAT } from '../../application/chat/queued-message-service.js';
import { createTestApp, setupTestSession, type TestApp } from '../../testing/app-fixture.js';
import { attachmentSizeViolation, base64DecodedByteLength } from './chat-routes.js';

const PASSWORD = 'correct horse battery';

let fixture: TestApp;
let app: Hono;
let token: string;

async function api(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
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
  token = await setupTestSession(app, PASSWORD);
});

it('warms transcript and queued attachment metadata without downloading bodies', async () => {
  const chat = await newChat();
  const attachment = { name: 'note.txt', type: 'text/plain', dataUri: 'data:text/plain;base64,aGVsbG8=' };
  await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: attached', attachments: [attachment] } });
  fixture.queuedMessages.enqueue(chat.id, { text: 'later', attachments: [attachment], filePaths: [], deliveryMode: 'follow_up' });
  const metadata = await (await api(`/v1/chats/${chat.id}/messages?attachments=metadata`)).json() as { messages: MessageDTO[]; pending: { attachments: typeof attachment[] }[] };
  expect(metadata.messages[0]?.attachments).toEqual([{ ...attachment, dataUri: '' }]);
  expect(metadata.pending[0]?.attachments).toEqual([{ ...attachment, dataUri: '' }]);
  const full = await (await api(`/v1/chats/${chat.id}/messages`)).json() as { messages: MessageDTO[] };
  expect(full.messages[0]?.attachments).toEqual([attachment]);
  fixture.runs.stopRun(chat.id);
});

describe('pi session commands', () => {
  it('runs compact, session, name and export through the bridge', async () => {
    const chat = await newChat();
    const events: StreamEvent[] = [];
    const unsubscribe = fixture.hub.subscribe((payload) => events.push(JSON.parse(payload) as StreamEvent));

    expect((await api(`/v1/chats/${chat.id}/commands`, { method: 'POST', body: { command: 'compact' } })).status).toBe(200);
    const history = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as { messages: MessageDTO[] };
    expect(history.messages).toContainEqual(expect.objectContaining({
      role: 'system',
      content: 'Context compacted.',
      notice: { kind: 'context-compacted' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'system-message',
      chatId: chat.id,
      message: expect.objectContaining({ notice: { kind: 'context-compacted' } }),
    }));
    unsubscribe();
    const session = await api(`/v1/chats/${chat.id}/commands`, { method: 'POST', body: { command: 'session' } });
    expect(((await session.json()) as { message: string }).message).toContain('Tokens: 0');

    const named = await api(`/v1/chats/${chat.id}/commands`, {
      method: 'POST', body: { command: 'name', argument: 'Project Atlas' },
    });
    expect(((await named.json()) as { chat: ChatDTO }).chat.title).toBe('Project Atlas');

    const exported = await api(`/v1/chats/${chat.id}/commands`, {
      method: 'POST', body: { command: 'export', argument: 'html' },
    });
    const path = ((await exported.json()) as { path: string }).path;
    expect(path).toBe('Exports/fake-session.html');
    expect(fixture.files.read(path)?.toString()).toContain('<html>');
  });

  it('lists fork points and validates command arguments', async () => {
    const chat = await newChat();
    const points = await api(`/v1/chats/${chat.id}/fork-points`);
    expect(await points.json()).toEqual({ points: [] });
    const invalid = await api(`/v1/chats/${chat.id}/commands`, {
      method: 'POST', body: { command: 'fork' },
    });
    expect(invalid.status).toBe(400);
  });
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

  it('broadcasts durable chat changes and deletion to connected clients', async () => {
    const events: StreamEvent[] = [];
    const unsubscribe = fixture.hub.subscribe((payload) => events.push(JSON.parse(payload) as StreamEvent));

    const created = await newChat();
    expect((await api(`/v1/chats/${created.id}`, { method: 'PATCH', body: { executionMode: 'plan' } })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, { method: 'PATCH', body: { pinned: true } })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, { method: 'PATCH', body: { pinned: false } })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, { method: 'PATCH', body: { archived: true } })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, { method: 'PATCH', body: { archived: false } })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, {
      method: 'PATCH', body: { provider: 'fake', model: 'fake/model-2' },
    })).status).toBe(200);
    expect((await api(`/v1/chats/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    unsubscribe();

    expect(events).toEqual([
      { kind: 'chat-created', chatId: created.id, chat: created },
      { kind: 'chat-execution-mode-changed', chatId: created.id, executionMode: 'plan' },
      { kind: 'chat-pin-changed', chatId: created.id, pinned: true },
      { kind: 'chat-pin-changed', chatId: created.id, pinned: false },
      { kind: 'chat-archived-changed', chatId: created.id, archived: true },
      { kind: 'chat-archived-changed', chatId: created.id, archived: false },
      {
        kind: 'chat-model-changed', chatId: created.id,
        provider: 'fake', model: 'fake/model-2',
      },
      { kind: 'chat-deleted', chatId: created.id },
    ]);
  });

  it('archives every open chat except the active one and pinned chats', async () => {
    const keep = await newChat();
    const pinned = await newChat();
    const one = await newChat();
    const two = await newChat();
    const alreadyFiled = await newChat();
    await api(`/v1/chats/${pinned.id}`, { method: 'PATCH', body: { pinned: true } });
    await api(`/v1/chats/${alreadyFiled.id}`, { method: 'PATCH', body: { archived: true } });
    const events: StreamEvent[] = [];
    const unsubscribe = fixture.hub.subscribe((payload) => events.push(JSON.parse(payload) as StreamEvent));

    const response = await api('/v1/chats/archive-others', {
      method: 'POST',
      body: { keepChatId: keep.id },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ archived: 2 });
    const active = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(new Set(active.chats.map((chat) => chat.id))).toEqual(new Set([keep.id, pinned.id]));
    expect(active.chats[0]?.id).toBe(pinned.id);
    const archived = (await (await api('/v1/chats?archived=true')).json()) as {
      chats: ChatDTO[];
    };
    expect(new Set(archived.chats.map((chat) => chat.id))).toEqual(
      new Set([one.id, two.id, alreadyFiled.id]),
    );
    unsubscribe();
    expect(events).toEqual(expect.arrayContaining([
      { kind: 'chat-archived-changed', chatId: one.id, archived: true },
      { kind: 'chat-archived-changed', chatId: two.id, archived: true },
    ]));
    expect(events).toHaveLength(2);
  });

  it('refuses to archive a live chat without partially applying the PATCH', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'slow: still answering' },
    });

    const response = await api(`/v1/chats/${chat.id}`, {
      method: 'PATCH',
      body: { archived: true, title: 'Must not be applied' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'chat_busy' } });
    expect(fixture.chats.get(chat.id)).toMatchObject({ archived: false, title: chat.title });
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('refuses to archive a chat with durable pending input', async () => {
    const chat = await newChat();
    expect(fixture.queuedMessages.enqueue(chat.id, {
      text: 'waiting input',
      attachments: [],
      filePaths: [],
    }).ok).toBe(true);

    const response = await api(`/v1/chats/${chat.id}`, {
      method: 'PATCH',
      body: { archived: true },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'chat_busy' } });
    expect(fixture.chats.get(chat.id)?.archived).toBe(false);
    expect(fixture.queuedMessages.list(chat.id)).toHaveLength(1);
  });

  it('refuses archive-others atomically when any candidate is busy', async () => {
    const keep = await newChat();
    const idleCandidate = await newChat();
    const busyCandidate = await newChat();
    expect(fixture.queuedMessages.enqueue(busyCandidate.id, {
      text: 'waiting input',
      attachments: [],
      filePaths: [],
    }).ok).toBe(true);

    const response = await api('/v1/chats/archive-others', {
      method: 'POST',
      body: { keepChatId: keep.id },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'chat_busy' } });
    expect(fixture.chats.get(idleCandidate.id)?.archived).toBe(false);
    expect(fixture.chats.get(busyCandidate.id)?.archived).toBe(false);
  });

  it('deletes every open chat except the active one and pinned chats', async () => {
    const keep = await newChat();
    const pinned = await newChat();
    const one = await newChat();
    const two = await newChat();
    const archived = await newChat();
    await api(`/v1/chats/${pinned.id}`, { method: 'PATCH', body: { pinned: true } });
    await api(`/v1/chats/${archived.id}`, { method: 'PATCH', body: { archived: true } });

    const response = await api('/v1/chats/delete-others', {
      method: 'POST',
      body: { keepChatId: keep.id },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });
    const active = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(new Set(active.chats.map((chat) => chat.id))).toEqual(new Set([keep.id, pinned.id]));
    expect((await api(`/v1/chats/${one.id}/messages`)).status).toBe(404);
    expect((await api(`/v1/chats/${two.id}/messages`)).status).toBe(404);
    const filed = (await (await api('/v1/chats?archived=true')).json()) as { chats: ChatDTO[] };
    expect(filed.chats.map((chat) => chat.id)).toEqual([archived.id]);
  });

  it('refuses to archive others without a valid open chat to keep', async () => {
    const filed = await newChat();
    await api(`/v1/chats/${filed.id}`, { method: 'PATCH', body: { archived: true } });

    expect(
      (await api('/v1/chats/archive-others', {
        method: 'POST',
        body: { keepChatId: filed.id },
      })).status,
    ).toBe(404);
    expect(
      (await api('/v1/chats/archive-others', {
        method: 'POST',
        body: { keepChatId: 'chat-does-not-exist' },
      })).status,
    ).toBe(404);
    expect(
      (await api('/v1/chats/archive-others', { method: 'POST', body: {} })).status,
    ).toBe(400);
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

  it('renames, pins, synchronizes execution mode and re-models', async () => {
    const chat = await newChat();

    const renamed = (await (
      await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { title: 'Groceries' } })
    ).json()) as ChatDTO;
    expect(renamed.title).toBe('Groceries');

    const pinned = (await (
      await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { pinned: true } })
    ).json()) as ChatDTO;
    expect(pinned.pinned).toBe(true);

    const planned = (await (
      await api(`/v1/chats/${chat.id}`, { method: 'PATCH', body: { executionMode: 'plan' } })
    ).json()) as ChatDTO;
    expect(planned.executionMode).toBe('plan');

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

  it('takes the chat\'s workspace attachments with it (docs/specs/Spec-Pop-General.md §6)', async () => {
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
  it('refuses archived chats without persisting or queueing the input', async () => {
    const chat = await newChat();
    expect((await api(`/v1/chats/${chat.id}`, {
      method: 'PATCH',
      body: { archived: true },
    })).status).toBe(200);

    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'must not be accepted' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'chat_archived',
        message: 'Restore this conversation before sending another message.',
        status: 409,
      },
    });
    expect(fixture.chats.getMessages(chat.id, { limit: 10 })).toEqual([]);
    expect(fixture.queuedMessages.list(chat.id)).toEqual([]);
    expect(fixture.runs.liveRun(chat.id)).toBeUndefined();
  });

  it('rejects and diagnoses an unknown local selector before creating a run', async () => {
    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'hello' },
      headers: {
        [LOCAL_CONNECTION_HEADER]: 'machine-gone',
        [CLIENT_HEADER]: 'pwa',
        [CLIENT_PLATFORM_HEADER]: 'windows',
      },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'local_connection_unknown' } });
    expect(fixture.runs.liveRun(chat.id)).toBeUndefined();
    expect(fixture.rejectedLocalSelections).toEqual([{
      selector: 'machine-gone', reason: 'unknown', clientKind: 'pwa', clientPlatform: 'windows',
    }]);
  });

  it('distinguishes an enabled stable machine that is temporarily offline', async () => {
    const machine = {
      machineId: 'machine-offline',
      hostname: 'm1', platform: 'win32', arch: 'x64', cwd: 'C:\\Users\\vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-before-restart', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled(machine.machineId, true);
    fixture.localConnections.detach('local-before-restart');

    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'keep local routing' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId },
    });

    expect(response.status).toBe(202);
    expect(fixture.rejectedLocalSelections).toEqual([]);
    await fixture.runs.whenIdle();
    const history = await (await api(`/v1/chats/${chat.id}/messages`)).json() as { messages: MessageDTO[] };
    expect(history.messages.some(message => message.role === 'assistant')).toBe(true);
  });

  it('accepts a stable machine selection after the tray reconnects with a new connection ID', async () => {
    const machine = {
      machineId: 'machine-m1',
      hostname: 'm1', platform: 'darwin', arch: 'arm64', cwd: '/Users/vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-before-restart', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled('machine-m1', true);
    fixture.localConnections.detach('local-before-restart');
    fixture.localConnections.attach({
      id: 'local-after-restart', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });

    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'slow: use the selected Mac' },
      headers: { [LOCAL_CONNECTION_HEADER]: 'machine-m1', [CLIENT_HEADER]: 'pwa' },
    });

    expect(response.status).toBe(202);
    expect(fixture.runs.canSteer(chat.id, 'machine-m1')).toBe(true);
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('accepts conversation without using an interactive fallback when a macOS machine has only an interactive CLI', async () => {
    const machine = {
      machineId: 'machine-interactive-only',
      hostname: 'm1', platform: 'darwin', arch: 'arm64', cwd: '/Users/vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-interactive-only', role: 'interactive', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled(machine.machineId, true);

    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'do not use the terminal' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });

    expect(response.status).toBe(202);
    expect(fixture.localConnections.executionConnection(machine.machineId)).toBeUndefined();
    await fixture.runs.whenIdle();
  });

  it('pins a PWA selection to background when interactive and tray transports coexist', async () => {
    const machine = {
      machineId: 'machine-two-roles',
      hostname: 'm1', platform: 'win32', arch: 'x64', cwd: 'C:\\Users\\vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-interactive', role: 'interactive', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localConnections.attach({
      id: 'local-background', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled(machine.machineId, true);

    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'slow: use the tray' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });

    expect(response.status).toBe(202);
    expect(fixture.runs.canSteer(chat.id, machine.machineId)).toBe(true);
    expect(fixture.localConnections.executionConnection(machine.machineId)?.id).toBe('local-background');
    fixture.localConnections.detach('local-background');
    expect(fixture.localConnections.connectionById('local-background')).toBeUndefined();
    expect(fixture.localConnections.connection(machine.machineId)?.id).toBe('local-interactive');
    expect(fixture.localConnections.executionConnection(machine.machineId)).toBeUndefined();
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('keeps direct interactive local access for CLI-originated messages', async () => {
    const machine = {
      machineId: 'machine-cli',
      hostname: 'm1', platform: 'win32', arch: 'x64', cwd: 'C:\\Users\\vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-cli', role: 'interactive', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled(machine.machineId, true);

    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'slow: use this CLI' },
      headers: { [LOCAL_CONNECTION_HEADER]: 'local-cli', [CLIENT_HEADER]: 'cli' },
    });

    expect(response.status).toBe(202);
    expect(fixture.runs.canSteer(chat.id, 'local-cli')).toBe(true);
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('updates a queued message through the reconnected tray selected by stable machine ID', async () => {
    const machine = {
      machineId: 'machine-queue',
      hostname: 'm1', platform: 'darwin', arch: 'arm64', cwd: '/Users/vini', clientVersion: '0.2.34',
    };
    fixture.localConnections.attach({
      id: 'local-queue-old', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });
    fixture.localAccessPolicy.setEnabled(machine.machineId, true);

    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'slow: keep running' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });
    const queued = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST', body: { text: 'queued before reconnect', delivery: 'follow_up' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });
    const queuedBody = (await queued.json()) as { message: { id: string } };

    fixture.localConnections.detach('local-queue-old');
    const offline = await api(`/v1/chats/${chat.id}/queue/${queuedBody.message.id}`, {
      method: 'PUT', body: { text: 'must not become server-only' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });
    expect(offline.status).toBe(200);
    expect(fixture.queuedMessages.list(chat.id)[0]?.text).toBe('must not become server-only');
    expect(fixture.queuedMessages.list(chat.id)[0]?.localConnectionId).toBe(machine.machineId);

    fixture.localConnections.attach({
      id: 'local-queue-new', role: 'background', machine,
      send: () => undefined, close: () => undefined,
    });
    const updated = await api(`/v1/chats/${chat.id}/queue/${queuedBody.message.id}`, {
      method: 'PUT', body: { text: 'queued after reconnect' },
      headers: { [LOCAL_CONNECTION_HEADER]: machine.machineId, [CLIENT_HEADER]: 'pwa' },
    });

    expect(updated.status).toBe(200);
    expect(fixture.queuedMessages.list(chat.id)[0]?.localConnectionId).toBe(machine.machineId);
    expect(fixture.localConnections.executionConnection(machine.machineId)?.id).toBe('local-queue-new');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('continues server-only when a previously selected computer is disabled', async () => {
    fixture.localConnections.attach({
      id: 'local-disabled',
      role: 'background',
      machine: {
        machineId: 'machine-disabled', hostname: 'm1', platform: 'darwin', arch: 'arm64',
        cwd: '/Users/vini', clientVersion: '0.2.34',
      },
      send: () => undefined,
      close: () => undefined,
    });
    const chat = await newChat();
    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'server only' },
      headers: { [LOCAL_CONNECTION_HEADER]: 'machine-disabled' },
    });
    expect(response.status).toBe(202);
    expect(fixture.runs.canSteer(chat.id, 'machine-disabled')).toBe(false);
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('never lends a background local connection to a PWA that did not select it', async () => {
    fixture.localConnections.attach({
      id: 'local-managed',
      role: 'interactive',
      machine: {
        hostname: 'Mac', platform: 'darwin', arch: 'arm64', cwd: '/Users/vini', clientVersion: '0.2.15',
      },
      send: () => undefined,
      close: () => undefined,
    });

    const chat = await newChat();
    expect((await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'slow: pwa' },
      headers: { [CLIENT_HEADER]: 'pwa' },
    })).status).toBe(202);
    expect(fixture.runs.canSteer(chat.id, undefined)).toBe(true);
    expect(fixture.runs.canSteer(chat.id, 'local-managed')).toBe(false);
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

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
    expect(await res.json()).toMatchObject({
      queued: true,
      message: { chatId: chat.id, text: 'two', deliveryMode: 'steer' },
    });
    const snapshot = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      queued?: { text: string };
    };
    expect(snapshot.queued?.text).toBe('two');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('keeps Plan Mode behind a live normal turn as a tool-policy barrier', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: normal' } });

    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'plan next', executionMode: 'plan' },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      queued: true,
      message: { text: 'plan next', executionMode: 'plan' },
    });
    expect(fixture.runs.canSteer(chat.id, undefined, 'plan')).toBe(false);
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('keeps /queue delivery waiting for the active run to finish', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });

    const response = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'later', delivery: 'follow_up' },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      queued: true,
      message: { text: 'later', deliveryMode: 'follow_up' },
    });
    expect(fixture.queuedMessages.get(chat.id)?.deliveryMode).toBe('follow_up');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
  });

  it('accepts multiple pending messages without replacing the FIFO head', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'two' } });

    const third = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'three' },
    });

    expect(third.status).toBe(202);
    expect(await third.json()).toMatchObject({
      queued: true,
      message: { text: 'three' },
      head: { text: 'two' },
    });
    expect(fixture.queuedMessages.get(chat.id)?.text).toBe('two');
    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();

    const transcript = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      messages: MessageDTO[];
    };
    expect(
      transcript.messages
        .filter((message) => message.role === 'user' && ['two', 'three'].includes(message.content))
        .map((message) => message.content),
    ).toEqual(['two', 'three']);
  });

  it('returns the complete FIFO and edits or cancels an exact pending item', async () => {
    const chat = await newChat();
    const first = fixture.queuedMessages.enqueue(chat.id, {
      text: 'first pending',
      attachments: [],
      filePaths: [],
    });
    const second = fixture.queuedMessages.enqueue(chat.id, {
      text: 'second pending',
      attachments: [],
      filePaths: [],
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const snapshot = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      pending: { id: string; text: string }[];
      queued: { id: string; text: string };
    };
    expect(snapshot.pending.map((message) => message.text)).toEqual([
      'first pending',
      'second pending',
    ]);
    expect(snapshot.queued.id).toBe(first.message.id);

    const updated = await api(`/v1/chats/${chat.id}/queue/${second.message.id}`, {
      method: 'PUT',
      body: { text: 'edited second' },
    });
    expect(updated.status).toBe(200);
    expect(fixture.queuedMessages.list(chat.id).map((message) => message.text)).toEqual([
      'first pending',
      'edited second',
    ]);

    const removed = await api(`/v1/chats/${chat.id}/queue/${second.message.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect(fixture.queuedMessages.list(chat.id).map((message) => message.text)).toEqual([
      'first pending',
    ]);
  });

  it('keeps a defensive 1,024-item cap for broken clients', { timeout: 15_000 }, async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });
    const pendingIds: string[] = [];
    for (let index = 0; index < MAX_PENDING_MESSAGES_PER_CHAT; index += 1) {
      const queued = fixture.queuedMessages.enqueue(chat.id, {
        text: `pending ${String(index)}`,
        attachments: [],
        filePaths: [],
      });
      expect(queued.ok).toBe(true);
      if (queued.ok) pendingIds.push(queued.message.id);
    }

    const overflow = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'one too many' },
    });
    expect(overflow.status).toBe(409);
    expect(((await overflow.json()) as { error: { code: string } }).error.code).toBe('queue_full');

    for (const messageId of pendingIds) {
      expect(fixture.queuedMessages.cancel(chat.id, messageId).ok).toBe(true);
    }
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

  it('rejects an attachment over the per-file limit before the global body ceiling', { timeout: 15_000 }, async () => {
    const chat = await newChat();
    const twentySixMiB = Buffer.alloc(26 * 1024 * 1024).toString('base64');
    const res = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: {
        text: 'one oversized file',
        attachments: [
          { name: 'large.bin', type: 'application/octet-stream', dataUri: `data:application/octet-stream;base64,${twentySixMiB}` },
        ],
      },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_field');
  });

  it('calculates decoded and aggregate attachment limits without allocating a 100 MiB request', () => {
    expect(base64DecodedByteLength(8, 1)).toBe(5);
    expect(attachmentSizeViolation([25 * 1024 * 1024])).toBeUndefined();
    expect(attachmentSizeViolation([25 * 1024 * 1024 + 1])).toBe('per-file');
    expect(attachmentSizeViolation(Array.from({ length: 5 }, () => 21 * 1024 * 1024)))
      .toBe('aggregate');
  });

  it('applies the eight-item cap across uploads and Files references together', async () => {
    const chat = await newChat();
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      name: `upload-${String(index)}.txt`,
      type: 'text/plain',
      dataUri: 'data:text/plain;base64,eA==',
    }));
    const res = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: {
        text: 'too many combined',
        attachments,
        filePaths: ['a', 'b', 'c', 'd'],
      },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_field');
  });

  it('accepts attachment-only queued input and keeps attachment-only edits valid', async () => {
    const chat = await newChat();
    fixture.files.write('reports/context.txt', Buffer.from('server file'));
    await api(`/v1/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'slow: one' } });

    const queued = await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: {
        text: '',
        delivery: 'follow_up',
        attachments: [
          { name: 'upload.txt', type: 'text/plain', dataUri: 'data:text/plain;base64,dXBsb2Fk' },
        ],
      },
    });
    expect(queued.status).toBe(202);
    const messageId = ((await queued.json()) as { message: { id: string } }).message.id;
    expect(fixture.queuedMessages.get(chat.id)).toMatchObject({
      id: messageId,
      text: '',
      attachments: [{ name: 'upload.txt' }],
    });

    const updated = await api(`/v1/chats/${chat.id}/queue/${messageId}`, {
      method: 'PUT',
      body: { text: '', filePaths: ['reports/context.txt'] },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      message: { id: messageId, text: '', attachments: [], filePaths: ['reports/context.txt'] },
    });

    await api(`/v1/chats/${chat.id}/stop`, { method: 'POST' });
    await fixture.runs.whenIdle();
    const { messages } = (await (await api(`/v1/chats/${chat.id}/messages`)).json()) as {
      messages: MessageDTO[];
    };
    expect(messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '',
      attachments: [expect.objectContaining({ name: 'context.txt' })],
    }));
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

  it('rejects a truly empty message', async () => {
    const chat = await newChat();

    for (const { body, code } of [
      { body: {}, code: 'missing_field' },
      { body: { text: '' }, code: 'invalid_field' },
      { body: { text: '   ' }, code: 'invalid_field' },
    ]) {
      const response = await api(`/v1/chats/${chat.id}/messages`, {
        method: 'POST',
        body,
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
  });

  it('keeps the starter title after the first message', async () => {
    const chat = await newChat();
    await api(`/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      body: { text: 'help me plan the grocery shopping' },
    });
    await fixture.runs.whenIdle();

    const { chats } = (await (await api('/v1/chats')).json()) as { chats: ChatDTO[] };
    expect(chats[0]?.title).toBe('Chat 1');
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

  it('stops delivering as soon as the ticket-bound session is revoked', async () => {
    const stream = await app.request(`/v1/events?ticket=${await ticket()}`);
    const reader = stream.body!.getReader();

    fixture.auth.signOutOthers();
    fixture.hub.emit({ kind: 'local-machines-changed' });

    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('revoked SSE stream stayed open')), 500)),
    ]);
    expect(result.done).toBe(true);
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

    expect(kinds).not.toContain('title');
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
