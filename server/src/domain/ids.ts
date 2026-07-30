import { randomBytes } from 'node:crypto';

/**
 * Identifiers (popy.spec §6). A readable prefix plus random hex: the prefix
 * makes a stray id in a log immediately legible, and the entropy means ids can
 * appear in URLs without being guessable.
 *
 * From a CSPRNG rather than a counter or a timestamp, so nothing about the
 * install (how many chats exist, when one was made) leaks through an id.
 */

export function newChatId(): string {
  return `chat-${randomHex(6)}`;
}

export function newMessageId(): string {
  return `msg-${randomHex(8)}`;
}

export function newRunId(): string {
  return `run-${randomHex(8)}`;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
