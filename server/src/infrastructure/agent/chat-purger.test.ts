import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chat } from '../../domain/chat/chat.js';
import { FsChatPurger } from './chat-purger.js';

const CHAT = 'chat-abcdef123456';

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT,
    title: 'x',
    model: '',
    archived: false,
    piSessionId: '',
    summary: '',
    autoTitle: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

let root: string;
let workspace: string;
let sessions: string;
let forgotten: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-purge-'));
  workspace = join(root, 'workspace');
  sessions = join(root, 'sessions');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  forgotten = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FsChatPurger', () => {
  it('removes the JSONL session, its sidecar folder and the attachments', () => {
    const jsonl = join(sessions, 'session.jsonl');
    const sidecar = join(sessions, 'session');
    const attachments = join(workspace, 'attachments', CHAT);
    writeFileSync(jsonl, '{}');
    mkdirSync(sidecar, { recursive: true });
    writeFileSync(join(sidecar, 'x'), 'y');
    mkdirSync(attachments, { recursive: true });
    writeFileSync(join(attachments, 'note.txt'), 'hi');

    const purger = new FsChatPurger({ workspace, forgetSession: (id) => forgotten.push(id) });
    purger.purge(chat({ piSessionId: jsonl }));

    expect(existsSync(jsonl)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(attachments)).toBe(false);
    expect(forgotten).toEqual([CHAT]);
  });

  it('forgets the session even when there is nothing on disk', () => {
    const purger = new FsChatPurger({ workspace, forgetSession: (id) => forgotten.push(id) });

    expect(() => purger.purge(chat())).not.toThrow();
    expect(forgotten).toEqual([CHAT]);
  });
});
