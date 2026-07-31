import type { Message } from '../../domain/chat/chat.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { EventSink } from '../ports/event-sink.js';
import type { ProviderGateway } from '../ports/provider-gateway.js';

/**
 * Titles and summaries written by the service model (popy.spec §14-§15, aw's
 * concept ported). The word-picking fallback names a chat at its first
 * message; this replaces that name once the conversation has a shape -- at the
 * user's third turn, then every tenth -- and writes the summary Phase 4's
 * memory will read.
 *
 * Everything here fails silently into the status quo: no key, a refused
 * request, an unparseable answer -- the chat keeps the title it had. A rename
 * by hand turns the whole thing off for that chat.
 */

/** User turns that trigger a rewrite: the 3rd, then every 10th after it. */
const FIRST_TURN = 3;
const EVERY = 10;

/** How much of the conversation the model sees. */
const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 280;

const MAX_TITLE_LENGTH = 60;
const MAX_SUMMARY_LENGTH = 500;
const MAX_ANSWER_TOKENS = 220;

/**
 * Basic scrub before anything leaves the machine: a line that looks like it
 * carries a credential is replaced, not trimmed around.
 */
const SECRET_LINE = /password|token|(?:api[_-]?)?key\s*[=:]/i;

export interface TitleServiceDeps {
  chats: ChatRepo;
  gateway: ProviderGateway;
  /** No key, no call: the fallback title simply stays. */
  apiKey: () => string | undefined;
  serviceModel: () => string;
  sink: EventSink;
  /** The reason a rewrite was skipped or failed goes to the log, not the user. */
  onFailure?: (message: string) => void;
}

export class TitleService {
  constructor(private readonly deps: TitleServiceDeps) {}

  /** Called after every finished run; decides by itself whether to work. */
  async maybeRetitle(chatId: string): Promise<void> {
    const chat = this.deps.chats.get(chatId);
    if (chat === undefined || !chat.autoTitle) return;

    const turns = this.deps.chats.countUserMessages(chatId);
    if (turns < FIRST_TURN || (turns - FIRST_TURN) % EVERY !== 0) return;

    const apiKey = this.deps.apiKey();
    if (apiKey === undefined) return;

    const messages = this.deps.chats.getMessages(chatId, { limit: MAX_MESSAGES });
    if (messages.length === 0) return;

    let answer: string;
    try {
      answer = await this.deps.gateway.complete({
        apiKey,
        model: this.deps.serviceModel(),
        prompt: buildTitlePrompt(messages),
        maxTokens: MAX_ANSWER_TOKENS,
      });
    } catch (error) {
      this.deps.onFailure?.(
        `auto-title failed for ${chatId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return;
    }

    const parsed = parseTitleAnswer(answer);
    if (parsed.title !== undefined) {
      this.deps.chats.rename(chatId, parsed.title);
      this.deps.sink.emit({ kind: 'title', chatId, title: parsed.title });
    }
    if (parsed.summary !== undefined) {
      this.deps.chats.setSummary(chatId, parsed.summary);
    }
  }
}

/** Exported for the tests: what the service model is actually asked. */
export function buildTitlePrompt(messages: Message[]): string {
  const transcript = messages
    .filter((message) => message.content.length > 0)
    .map((message) => `${message.role}: ${scrub(clip(message.content))}`)
    .join('\n');

  return [
    'You are naming a conversation between a user and an assistant.',
    'Answer with exactly two lines and nothing else:',
    'TITLE: a short name for the conversation, at most six words, no quotes',
    'SUMMARY: one or two sentences saying what the conversation is about',
    'Write both in the language the conversation itself is written in.',
    '',
    'Conversation:',
    transcript,
  ].join('\n');
}

/**
 * Tolerant on purpose: models decorate. Lines are matched case-insensitively,
 * quotes and markdown emphasis are shed, and an answer with no TITLE line
 * falls back to its first non-empty line.
 */
export function parseTitleAnswer(answer: string): { title?: string; summary?: string } {
  const lines = answer
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let title = valueOf(lines, /^[*_#\s]*title[*_\s]*[:-]\s*(.+)$/i);
  const summary = valueOf(lines, /^[*_#\s]*summary[*_\s]*[:-]\s*(.+)$/i);

  if (title === undefined && summary === undefined && lines.length > 0) {
    // No labels at all: a model that just answered with a name.
    title = lines[0];
  }

  const cleanTitle = title === undefined ? undefined : tidy(title).slice(0, MAX_TITLE_LENGTH).trim();
  const cleanSummary =
    summary === undefined ? undefined : tidy(summary).slice(0, MAX_SUMMARY_LENGTH).trim();

  return {
    ...(cleanTitle === undefined || cleanTitle.length === 0 ? {} : { title: cleanTitle }),
    ...(cleanSummary === undefined || cleanSummary.length === 0 ? {} : { summary: cleanSummary }),
  };
}

function valueOf(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function tidy(text: string): string {
  return text.replace(/^["'“”*_`\s]+|["'“”*_`\s]+$/g, '');
}

function clip(text: string): string {
  return text.length <= MAX_CHARS_PER_MESSAGE ? text : `${text.slice(0, MAX_CHARS_PER_MESSAGE)}…`;
}

/** Exported for the tests: no line that smells of a credential leaves. */
export function scrub(text: string): string {
  return text
    .split('\n')
    .map((line) => (SECRET_LINE.test(line) ? '[redacted]' : line))
    .join('\n');
}
