import type { Message } from '../../domain/chat/chat.js';
import { isGenericTitle, uniqueTitle } from '../../domain/chat/title.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { EventSink } from '../ports/event-sink.js';

/**
 * Titles and summaries written by the service model (docs/specs/Spec-Pop-General.md §14-§15).
 * A chat keeps its deterministic "Chat N" starter through the first two user
 * turns. Once the third run finishes, one background completion names the
 * conversation and writes the summary Phase 4's memory will read.
 *
 * Everything here fails silently into the status quo: no key, a refused
 * request, or an unparseable answer leaves "Chat N" untouched. A rename by
 * hand turns the whole thing off for that chat, and a successful automatic
 * title makes the chat ineligible for another pass.
 */

/** The one user turn that triggers automatic naming. */
const TITLE_TURN = 3;

/** How much of the conversation the model sees. */
const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 280;

const MAX_TITLE_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 500;
const MAX_ANSWER_TOKENS = 220;

/**
 * Basic scrub before anything leaves the machine: a line that looks like it
 * carries a credential is replaced, not trimmed around.
 */
const SECRET_LINE = /password|token|(?:api[_-]?)?key\s*[=:]/i;

export interface TitleServiceDeps {
  chats: ChatRepo;
  /**
   * One background completion, on whatever provider serves this chat
   * (docs/specs/Spec-Pop-General.md §15, corrected 07/08). A title used to be hard-wired to
   * OpenRouter and a global model id -- so a chat running on Maritaca had its
   * title written by a model that lived somewhere else entirely, if the id
   * existed at all. The provider is now inherited from the chat, and the model
   * is that provider's Service Model. Rejecting is fine: the fallback title
   * stays, which is what happened before whenever there was no key.
   */
  complete: (
    request: { prompt: string; maxTokens: number },
    context: { provider?: string },
  ) => Promise<string>;
  sink: EventSink;
  /** The reason a rewrite was skipped or failed goes to the log, not the user. */
  onFailure?: (message: string) => void;
}

export class TitleService {
  constructor(private readonly deps: TitleServiceDeps) {}

  /** Called after every finished run; decides by itself whether to work. */
  async maybeRetitle(chatId: string): Promise<void> {
    const skip = (reason: string): void => {
      this.deps.onFailure?.(`auto-title ${chatId}: skipped (${reason})`);
    };

    const chat = this.deps.chats.get(chatId);
    if (chat === undefined) return skip('chat-gone');
    if (!chat.autoTitle) return skip('manual-rename');
    if (!isGenericTitle(chat.title)) return skip('already-titled');

    const turns = this.deps.chats.countUserMessages(chatId);
    if (turns !== TITLE_TURN) return skip(`cadence (turn ${String(turns)})`);

    const messages = this.deps.chats.getMessages(chatId, { limit: MAX_MESSAGES });
    if (messages.length === 0) return skip('no-messages');

    let answer: string;
    try {
      answer = await this.deps.complete(
        { prompt: buildTitlePrompt(messages), maxTokens: MAX_ANSWER_TOKENS },
        { provider: chat.provider },
      );
    } catch (error) {
      this.deps.onFailure?.(
        `auto-title failed for ${chatId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return;
    }

    const parsed = parseTitleAnswer(answer);
    if (parsed.title === undefined) {
      this.deps.onFailure?.(`auto-title ${chatId}: unparseable answer`);
    } else if (parsed.title.toLowerCase() === chat.title.toLowerCase()) {
      skip('same-title');
    } else {
      const title = uniqueTitle(
        parsed.title,
        this.deps.chats.titles().filter((entry) => entry.toLowerCase() !== chat.title.toLowerCase()),
      );
      this.deps.chats.rename(chatId, title);
      this.deps.chats.recordTitle({
        chatId,
        title,
        turn: turns,
        source: 'auto',
        createdAt: new Date().toISOString(),
      });
      this.deps.sink.emit({ kind: 'title', chatId, title });
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

  const cleanTitle =
    title === undefined
      ? undefined
      : tidy(title)
          .replace(/[.!?,;:\u2026]+$/, '')
          .slice(0, MAX_TITLE_LENGTH)
          .trim();
  const cleanSummary =
    summary === undefined ? undefined : tidy(summary).slice(0, MAX_SUMMARY_LENGTH).trim();

  return {
    ...(cleanTitle === undefined || cleanTitle.length < 2 ? {} : { title: cleanTitle }),
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
