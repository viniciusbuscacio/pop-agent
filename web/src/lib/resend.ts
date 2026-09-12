import type { MessageDTO } from '@pop-agent/shared';

const FAILED_ANSWER_PREFIX = 'That answer could not be finished.';

function retryable(message: MessageDTO | undefined): boolean {
  return message?.role === 'system' && (message.notice?.kind === 'run-failure'
    || message.content.startsWith(FAILED_ANSWER_PREFIX)
    || message.content === 'You stopped this answer.');
}

/** Retry from the interrupted user bubble or its persisted stop/failure marker. */
export function resendSource(
  messages: MessageDTO[],
  failureIndex: number,
): MessageDTO | undefined {
  const selected = messages[failureIndex];
  if (selected?.role === 'user') {
    for (let index = failureIndex + 1; index < messages.length; index += 1) {
      if (messages[index]?.role === 'user') break;
      if (retryable(messages[index])) return selected;
    }
    return undefined;
  }
  if (!retryable(selected)) return undefined;
  for (let index = failureIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === 'user') return candidate;
  }
  return undefined;
}
