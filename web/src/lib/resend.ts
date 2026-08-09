import type { MessageDTO } from '@pop-agent/shared';

const FAILED_ANSWER_PREFIX = 'That answer could not be finished.';

/** Finds the user turn owned by one persisted failure marker. */
export function resendSource(
  messages: MessageDTO[],
  failureIndex: number,
): MessageDTO | undefined {
  const failure = messages[failureIndex];
  if (
    failure?.role !== 'system' ||
    (failure.notice?.kind !== 'run-failure' && !failure.content.startsWith(FAILED_ANSWER_PREFIX))
  ) {
    return undefined;
  }
  for (let index = failureIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === 'user') return candidate;
  }
  return undefined;
}
