import { useCallback, useRef, useState } from 'react';
import type { MessageDTO } from '@pop-agent/shared';
import { ApiError } from '../services/api';
import { t } from '../i18n';

type Payload = Pick<MessageDTO, 'content' | 'attachments'>;
type Send = (chatId: string, text: string, attachments: MessageDTO['attachments']) => Promise<void>;

/** The bubble and context menu share feedback and one in-flight request per chat. */
export function useResendAction(chatId: string, send: Send) {
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Record<string, string>>({});
  const resend = useCallback(async (id: string, source: Payload): Promise<void> => {
    if (inFlight.current.has(chatId)) return;
    inFlight.current.add(chatId);
    setPending(current => ({ ...current, [chatId]: id }));
    setFailure(current => withoutChat(current, chatId));
    try {
      await send(chatId, source.content, source.attachments);
    } catch (error) {
      const text = error instanceof ApiError && error.status >= 400 && error.status < 500
        ? t('chat.resendRejected', { reason: error.message })
        : t('chat.resendUnconfirmed');
      setFailure(current => ({ ...current, [chatId]: text }));
    } finally {
      inFlight.current.delete(chatId);
      setPending(current => withoutChat(current, chatId));
    }
  }, [chatId, send]);
  return {
    resend,
    resendingId: pending[chatId],
    resendError: failure[chatId],
  };
}

function withoutChat(values: Record<string, string>, chatId: string): Record<string, string> {
  const next = { ...values };
  delete next[chatId];
  return next;
}
