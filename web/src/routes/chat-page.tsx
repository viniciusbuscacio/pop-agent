import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable } from '../ui/controls';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ProviderStatusDTO, QueuedMessageDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { chatsService } from '../services/chats';
import { eventStream } from '../services/events';
import { providersService } from '../services/providers';
import type { ModelChoice } from '../ui/slash-menu';
import { useChatStore } from '../store/chat';
import { ChatMessage } from '../ui/chat-message';
import { PopBubbleMark } from '../ui/pop-bubble-mark';
import { Composer } from '../ui/composer';
import { RunStatusLine } from '../ui/run-status-line';
import { resendSource } from '../lib/resend';
import { shouldResumeFollowing } from '../lib/chat-follow';
import { activeChatModel } from '../lib/active-chat-model';

const NO_PENDING_MESSAGES: QueuedMessageDTO[] = [];

/** One conversation: history, whatever is streaming, and the composer. */
export function ChatPage() {
  const { chatId = '' } = useParams();
  const navigate = useNavigate();

  const chat = useChatStore((state) => state.chats.find((entry) => entry.id === chatId));
  const messages = useChatStore((state) => state.messages[chatId]);
  const live = useChatStore((state) => state.live[chatId]);
  const pending = useChatStore((state) => state.pending[chatId]) ?? NO_PENDING_MESSAGES;
  const failure = useChatStore((state) => state.failures[chatId]);
  const confirm = useChatStore((state) => state.confirms[chatId]);
  const openChat = useChatStore((state) => state.openChat);
  const send = useChatStore((state) => state.send);
  const updateQueued = useChatStore((state) => state.updateQueued);
  const cancelQueued = useChatStore((state) => state.cancelQueued);
  const stop = useChatStore((state) => state.stop);
  const respondConfirm = useChatStore((state) => state.respondConfirm);
  const setModel = useChatStore((state) => state.setModel);
  const setExecutionMode = useChatStore((state) => state.setExecutionMode);
  const createChat = useChatStore((state) => state.createChat);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const [resendingId, setResendingId] = useState<string | undefined>(undefined);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const [editingPendingId, setEditingPendingId] = useState<string | undefined>(undefined);
  const editRequest = pending.find((message) => message.id === editingPendingId);
  const [queueActionError, setQueueActionError] = useState(false);
  const currentModel = activeChatModel(chat, providers);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const [missed, setMissed] = useState(0);
  // The floating "↓" is the visible half of follow mode being off.
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    // Remembered per device, so the Chats segment reopens where you were.
    try {
      localStorage.setItem('pop-agent.lastChat', chatId);
    } catch {
      // storage denied; the segment just falls back to the list
    }
    // On mount and on every chat change, the stored history replaces whatever
    // was on screen: a reload mid-run must not show the answer twice.
    void openChat(chatId);
    setMissed(0);
    setShowJump(false);
    setEditingPendingId(undefined);
    setQueueActionError(false);
    atBottom.current = true;
    lastScrollTop.current = 0;
  }, [chatId, openChat]);

  useEffect(() => {
    // Whatever arrived while the phone had the app suspended was never
    // delivered; the stored history is the only way to catch up.
    return eventStream.onResume(() => {
      void openChat(chatId);
    });
  }, [chatId, openChat]);

  useEffect(() => {
    // The pickable pairs (pop-agent.spec §15): every provider that has a catalog
    // contributes its models, labelled with the provider when there are
    // several. A failed provider just contributes nothing.
    void (async () => {
      try {
        const [{ providers }, recentResponse] = await Promise.all([
          providersService.list(),
          chatsService.recentModels().catch(() => ({ models: [] })), 
        ]);
        setProviders(providers);
        setUnconfigured(providers.every((entry) => !entry.configured));
        const perProvider = await Promise.all(
          providers.map(async (entry) => {
            try {
              const catalog = await chatsService.models(entry.id);
              return { entry, models: catalog.models };
            } catch {
              return { entry, models: [] };
            }
          }),
        );
        const withModels = perProvider.filter(({ models: list }) => list.length > 0);
        const several = withModels.length > 1;
        const catalog = withModels.flatMap(({ entry, models: list }) =>
          list.map((model) => ({
            provider: entry.id,
            model: model.id,
            label: several ? `${entry.name} · ${model.id}` : model.id,
          })),
        );
        const catalogByKey = new Map(catalog.map((choice) => [`${choice.provider}||${choice.model}`, choice]));
        const recent = recentResponse.models.map((entry) =>
          catalogByKey.get(`${entry.provider}||${entry.model}`) ?? {
            provider: entry.provider,
            model: entry.model,
            label: `${entry.provider} · ${entry.model}`,
          },
        );
        const recentKeys = new Set(recent.map((choice) => `${choice.provider}||${choice.model}`));
        setModels([
          ...recent,
          ...catalog.filter((choice) => !recentKeys.has(`${choice.provider}||${choice.model}`)),
        ]);
      } catch {
        setModels([]);
        setUnconfigured(false);
      }
    })();
  }, []);

  // A live fragment changes several times a second. Keep the settled subtree
  // byte-for-byte stable until history or resend availability actually changes,
  // so React never even revisits old Markdown while the answer grows.
  const idle = live === undefined;
  const settledTranscript = useMemo(
    () =>
      (messages ?? []).map((message, index, history) => {
        const source = resendSource(history, index);
        const canResend = source !== undefined && idle && pending.length === 0;
        return (
          <ChatMessage
            key={message.id}
            message={message}
            resending={resendingId === message.id}
            {...(!canResend
              ? {}
              : {
                  onResend: () => {
                    setResendingId(message.id);
                    void send(chatId, source.content, source.attachments)
                      .catch(() => undefined)
                      .finally(() => setResendingId(undefined));
                  },
                })}
            {...(message.notice === undefined
              ? {}
              : { onChangeModel: () => setModelPickerRequest((request) => request + 1) })}
          />
        );
      }),
    [chatId, idle, messages, pending.length, resendingId, send],
  );
  const streamedLength = (live?.content.length ?? 0) + (live?.thinking.length ?? 0);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    // Polite autoscroll: follow the answer only if the reader was already at
    // the bottom. Somebody who scrolled up to re-read something is not
    // dragged back down.
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
      lastScrollTop.current = element.scrollTop;
      setMissed(0);
    } else {
      setMissed((count) => count + 1);
      setShowJump(true);
    }
  }, [messages?.length, pending.length, pending[0]?.id, streamedLength]);

  // "Is the reader at the bottom?" with aw's tolerance: generous enough that
  // a bounce or an address-bar resize keeps follow mode.
  const BOTTOM_TOLERANCE_PX = 40;

  function distanceFromBottom(): number {
    const element = scroller.current;
    if (element === null) return 0;
    return element.scrollHeight - element.scrollTop - element.clientHeight;
  }

  function disarm(): void {
    const element = scroller.current;
    if (element !== null) lastScrollTop.current = element.scrollTop;
    atBottom.current = false;
    setShowJump(true);
  }

  // Mouse/trackpad intent can update the visible control immediately.
  function onWheel(event: React.WheelEvent): void {
    if (event.deltaY < 0) disarm();
  }

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    let startY: number | undefined;

    const onTouchStart = (event: TouchEvent): void => {
      startY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent): void => {
      const now = event.touches[0]?.clientY;
      if (startY === undefined || now === undefined || now <= startY + 4) return;

      // This listener must stay passive: it records intent without taking
      // ownership of Safari's native pan gesture. React state is left alone
      // until scroll/streaming updates the floating control.
      lastScrollTop.current = element.scrollTop;
      atBottom.current = false;
    };
    const onTouchEnd = (): void => {
      startY = undefined;
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [chatId]);

  // scroll events alone do not reveal intent: inserting the run-status line or
  // resizing Safari can reduce scrollTop too. Wheel and passive touch listeners
  // suspend following; scrolling toward and reaching the end resumes it.
  function onScroll(): void {
    const element = scroller.current;
    if (element === null) return;
    const previous = lastScrollTop.current;
    const current = element.scrollTop;
    const distance = distanceFromBottom();
    lastScrollTop.current = current;

    if (!atBottom.current && shouldResumeFollowing(previous, current, distance, BOTTOM_TOLERANCE_PX)) {
      atBottom.current = true;
      setShowJump(false);
      setMissed(0);
    }
  }

  function jumpToLatest(): void {
    const element = scroller.current;
    if (element === null) return;
    atBottom.current = true;
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
    setShowJump(false);
    setMissed(0);
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <Pressable
          type="button"
          data-testid="chat-back"
          aria-label={t('common.back')}
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)] md:hidden"
        >
          ←
        </Pressable>
        <h1 className="min-w-0 flex-1 truncate font-medium">{chat?.title ?? t('app.loading')}</h1>

      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div
          ref={scroller}
          onScroll={onScroll}
          onWheel={onWheel}
          data-testid="chat-scroller"
          className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
        >
          {messages?.length === 0 && live === undefined && pending.length === 0 ? (
          <div
            data-testid="empty-chat-icon"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <PopBubbleMark className="h-24 w-24 select-none text-[var(--muted)] opacity-25" />
          </div>
        ) : null}

        <div data-testid="chat-transcript" className="mx-auto flex w-full min-w-0 flex-col gap-5 p-4 md:w-[90%]">
          {settledTranscript}

          {live?.status === 'running' ? (
            <ChatMessage
              message={{
                role: 'assistant',
                content: live.content,
                thinking: live.thinking,
                tools: live.tools,
                attachments: [],
              }}
            />
          ) : null}

          {pending.map((message, index) => (
            <div
              key={message.id}
              className="flex flex-col items-end gap-1"
              data-testid={index === 0 && message.deliveryMode === 'steer' ? 'message-sending' : 'message-waiting'}
            >
              <span className="pr-1 text-xs text-[var(--muted)]">
                {message.deliveryMode === 'follow_up'
                  ? t('chat.queuedLabel')
                  : index === 0
                    ? t('chat.sending')
                    : t('chat.waiting')}
              </span>
              <ChatMessage
                message={{
                  role: 'user',
                  content: message.text,
                  thinking: '',
                  tools: [],
                  attachments: message.attachments,
                }}
              />
              <div className="flex gap-2 pr-1 text-xs">
                <Pressable
                  type="button"
                  onClick={() => {
                    setQueueActionError(false);
                    setEditingPendingId(message.id);
                  }}
                  className="text-[var(--accent)]"
                >
                  {t('common.edit')}
                </Pressable>
                <Pressable
                  type="button"
                  onClick={() => {
                    setQueueActionError(false);
                    void cancelQueued(chatId, message.id)
                      .then(() => {
                        if (editingPendingId === message.id) setEditingPendingId(undefined);
                      })
                      .catch(() => setQueueActionError(true));
                  }}
                  className="text-[var(--danger)]"
                >
                  {t('common.cancel')}
                </Pressable>
              </div>
            </div>
          ))}

          {queueActionError ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {t('chat.queueCancelFailed')}
            </p>
          ) : null}

          {confirm !== undefined ? (
            <div
              data-testid="confirm-card"
              role="alertdialog"
              className="rounded-lg border border-[var(--danger)] bg-[var(--panel-bg)] p-3"
            >
              <p className="text-sm font-medium text-[var(--screen-fg)]">
                {t('chat.confirm.title', { action: confirm.action })}
              </p>
              <pre className="mt-2 max-w-full overflow-x-auto rounded bg-[var(--input-bg)] p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                {confirm.detail}
              </pre>
              <p className="mt-2 text-xs text-[var(--muted)]">{t('chat.confirm.why')}</p>
              <div className="mt-3 flex gap-2">
                <Pressable
                  type="button"
                  data-testid="confirm-allow"
                  onClick={() => void respondConfirm(chatId, confirm.runId, true)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--hover-overlay)]"
                >
                  {t('chat.confirm.allow')}
                </Pressable>
                <Pressable
                  type="button"
                  data-testid="confirm-deny"
                  onClick={() => void respondConfirm(chatId, confirm.runId, false)}
                  className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-fg)]"
                >
                  {t('chat.confirm.deny')}
                </Pressable>
              </div>
            </div>
          ) : null}

          {failure !== undefined && failure !== 'aborted' && failure !== 'interrupted' ? (
            <p data-testid="run-error" role="alert" className="text-sm text-[var(--danger)]">
              {t('chat.failed')}
            </p>
          ) : null}
          </div>
        </div>

        {showJump ? (
          <Pressable
            type="button"
            data-testid="jump-to-latest"
            onClick={jumpToLatest}
            aria-label={t('chat.jumpToLatest')}
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3.5 py-1.5 text-sm shadow-lg"
          >
            <span aria-hidden="true">↓</span>
            {missed > 0 ? (
              <span data-testid="jump-to-latest-badge" className="text-xs text-[var(--accent)]">
                {t('chat.newMessages')}
              </span>
            ) : null}
          </Pressable>
        ) : null}
      </div>

      {unconfigured ? (
        <p
          data-testid="no-provider"
          className="mx-auto mb-1 w-full px-4 text-center text-xs text-[var(--muted)] md:w-[90%]"
        >
          {t('chat.noProvider')}{' '}
          <Link to="/settings" className="text-[var(--accent)] underline underline-offset-2">
            {t('chat.noProviderLink')}
          </Link>
        </p>
      ) : null}

      <div data-testid="run-status-slot" className="h-7 shrink-0">
        {live === undefined ? null : (
          <RunStatusLine status={confirm === undefined ? live.status : 'approval'} />
        )}
      </div>

      <Composer
        chatId={chatId}
        busy={live !== undefined}
        {...(editRequest === undefined ? {} : { editRequest })}
        onSend={(text, attachments, filePaths, delivery, executionMode) => {
          // Sending is an explicit return to the live conversation. Re-arm
          // following before the request so the user's bubble and the first
          // streamed chunk both stay visible, even if the reader was above.
          jumpToLatest();
          return send(chatId, text, attachments, filePaths, delivery, executionMode);
        }}
        onUpdateQueued={(messageId, text, attachments, filePaths) =>
          updateQueued(chatId, messageId, text, attachments, filePaths)
        }
        onEditingDone={() => setEditingPendingId(undefined)}
        onStop={() => void stop(chatId)}
        onNewChat={() => {
          void createChat().then((created) => navigate(`/chat/${created.id}`));
        }}
        models={models}
        activeProvider={chat?.provider ?? ''}
        activeModel={chat?.model ?? ''}
        currentProvider={currentModel?.currentProvider ?? ''}
        currentModel={currentModel?.currentModel ?? ''}
        executionMode={chat?.executionMode ?? 'normal'}
        onSetExecutionMode={(executionMode) => setExecutionMode(chatId, executionMode)}
        onSetModel={(model, provider) => void setModel(chatId, model, provider)}
        modelPickerRequest={modelPickerRequest}
      />

    </>
  );
}
