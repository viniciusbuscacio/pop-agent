import type { Chat } from '../../domain/chat/chat.js';
import type { ChatService } from './chat-service.js';
import type { FilesService } from '../files/files-service.js';
import type {
  SessionCommandBridge,
  SessionForkPoint,
  SessionStatsResult,
} from '../ports/session-command-bridge.js';

export type SessionCommandResult =
  | { kind: 'compact' }
  | { kind: 'session'; stats: SessionStatsResult }
  | { kind: 'name'; chat: Chat }
  | { kind: 'export'; path: string }
  | { kind: 'fork'; chat: Chat; draft: string };

export class SessionCommandService {
  constructor(private readonly deps: {
    chats: ChatService;
    files: FilesService;
    bridge: SessionCommandBridge;
    busy: (chatId: string) => boolean;
  }) {}

  async forkPoints(chatId: string): Promise<SessionForkPoint[] | undefined> {
    if (this.deps.chats.get(chatId) === undefined) return undefined;
    const points = await this.deps.bridge.forkPoints(chatId);
    return points.map((point) => ({
      ...point,
      text: this.deps.chats.userMessageAt(chatId, point.userMessageIndex)?.content ?? point.text,
    }));
  }

  async execute(
    chatId: string,
    command: 'compact' | 'session' | 'name' | 'export' | 'fork',
    argument: string,
  ): Promise<SessionCommandResult | undefined> {
    const source = this.deps.chats.get(chatId);
    if (source === undefined) return undefined;
    if (this.deps.busy(chatId)) throw new SessionCommandBusyError();

    if (command === 'compact') {
      await this.deps.bridge.compact(chatId, argument.trim() || undefined);
      this.deps.chats.recordContextCompacted(chatId);
      return { kind: 'compact' };
    }
    if (command === 'session') {
      return { kind: 'session', stats: await this.deps.bridge.sessionStats(chatId) };
    }
    if (command === 'name') {
      const name = argument.trim().slice(0, 120);
      if (name.length === 0) throw new SessionCommandArgumentError('Usage: /name <name>');
      await this.deps.bridge.setSessionName(chatId, name);
      const chat = this.deps.chats.rename(chatId, name);
      if (chat === undefined) return undefined;
      return { kind: 'name', chat };
    }
    if (command === 'export') {
      const format = argument.trim().toLowerCase();
      if (format !== '' && format !== 'html' && format !== 'jsonl') {
        throw new SessionCommandArgumentError('Usage: /export [html|jsonl]');
      }
      const exported = await this.deps.bridge.exportSession(chatId, format === 'jsonl' ? 'jsonl' : 'html');
      const path = this.availablePath(`Exports/${exported.name}`);
      this.deps.files.write(path, exported.bytes);
      return { kind: 'export', path };
    }

    const selection = argument.trim();
    const selected = /^\d+$/.test(selection) ? Number(selection) : 0;
    const points = await this.forkPoints(chatId) ?? [];
    const point = Number.isSafeInteger(selected) && selected > 0 ? points[selected - 1] : undefined;
    if (point === undefined) throw new SessionCommandArgumentError('Usage: /fork <number>');
    const fork = await this.deps.bridge.forkSession(chatId, point.entryId);
    const chat = this.deps.chats.fork(chatId, point.userMessageIndex, fork.sessionFile);
    if (chat === undefined) return undefined;
    return { kind: 'fork', chat, draft: point.text };
  }

  private availablePath(wanted: string): string {
    if (this.deps.files.stat(wanted) === undefined) return wanted;
    const dot = wanted.lastIndexOf('.');
    const stem = dot < 0 ? wanted : wanted.slice(0, dot);
    const extension = dot < 0 ? '' : wanted.slice(dot);
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${stem}-${String(suffix)}${extension}`;
      if (this.deps.files.stat(candidate) === undefined) return candidate;
    }
  }
}

export class SessionCommandBusyError extends Error {}
export class SessionCommandArgumentError extends Error {}
