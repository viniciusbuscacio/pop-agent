import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { chatsService } from '../services/chats';
import { eventStream } from '../services/events';
import { providersService } from '../services/providers';
import type { ModelChoice } from '../ui/slash-menu';
import { useChatStore } from '../store/chat';
import { ChatMessage } from '../ui/chat-message';
import { Composer } from '../ui/composer';
import { resendSource } from '../lib/resend';

/** One conversation: history, whatever is streaming, and the composer. */
export function ChatPage() {
  const { chatId = '' } = useParams();
  const navigate = useNavigate();

  const chat = useChatStore((state) => state.chats.find((entry) => entry.id === chatId));
  const messages = useChatStore((state) => state.messages[chatId]);
  const live = useChatStore((state) => state.live[chatId]);
  const queued = useChatStore((state) => state.queued[chatId]);
  const failure = useChatStore((state) => state.failures[chatId]);
  const confirm = useChatStore((state) => state.confirms[chatId]);
  const openChat = useChatStore((state) => state.openChat);
  const send = useChatStore((state) => state.send);
  const updateQueued = useChatStore((state) => state.updateQueued);
  const cancelQueued = useChatStore((state) => state.cancelQueued);
  const stop = useChatStore((state) => state.stop);
  const respondConfirm = useChatStore((state) => state.respondConfirm);
  const setModel = useChatStore((state) => state.setModel);
  const createChat = useChatStore((state) => state.createChat);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const [resendingId, setResendingId] = useState<string | undefined>(undefined);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [missed, setMissed] = useState(0);
  // The floating "↓" is the visible half of follow mode being off.
  const [showJump, setShowJump] = useState(false);
  const touchY = useRef<number | undefined>(undefined);

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
    atBottom.current = true;
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

  const streamedLength = (live?.content.length ?? 0) + (live?.thinking.length ?? 0);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    // Polite autoscroll: follow the answer only if the reader was already at
    // the bottom. Somebody who scrolled up to re-read something is not
    // dragged back down.
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
      setMissed(0);
    } else {
      setMissed((count) => count + 1);
      setShowJump(true);
    }
  }, [messages?.length, queued?.id, streamedLength]);

  // "Is the reader at the bottom?" with aw's tolerance: generous enough that
  // a bounce or an address-bar resize keeps follow mode.
  const BOTTOM_TOLERANCE_PX = 40;

  function distanceFromBottom(): number {
    const element = scroller.current;
    if (element === null) return 0;
    return element.scrollHeight - element.scrollTop - element.clientHeight;
  }

  function disarm(): void {
    atBottom.current = false;
    setShowJump(true);
  }

  // Follow mode is disarmed by the READER's hand, never by scrollTop math:
  // programmatic scrolls (the autoscroll itself) move scrollTop too, and
  // mistaking them for the reader is the classic jumpy-scroll bug. A wheel
  // up or a finger dragging content down means "let me read above".
  function onWheel(event: React.WheelEvent): void {
    if (event.deltaY < 0 && distanceFromBottom() > BOTTOM_TOLERANCE_PX) disarm();
  }

  function onTouchStart(event: React.TouchEvent): void {
    touchY.current = event.touches[0]?.clientY;
  }

  function onTouchMove(event: React.TouchEvent): void {
    const start = touchY.current;
    const now = event.touches[0]?.clientY;
    if (start === undefined || now === undefined) return;
    if (now > start + 4 && distanceFromBottom() > BOTTOM_TOLERANCE_PX) disarm();
    touchY.current = now;
  }

  // Reaching the bottom -- by finger, wheel or the jump button -- rearms
  // follow mode. This one MAY come from scrollTop: it only fires when the
  // bottom is actually visible, which is true however we got there.
  function onScroll(): void {
    if (distanceFromBottom() < BOTTOM_TOLERANCE_PX) {
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
    setShowJump(false);
    setMissed(0);
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button
          type="button"
          data-testid="chat-back"
          aria-label={t('common.back')}
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)] md:hidden"
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 truncate font-medium">{chat?.title ?? t('app.loading')}</h1>

      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        data-testid="chat-scroller"
        className="relative flex-1 overflow-y-auto"
      >
        {messages?.length === 0 && live === undefined ? (
          <div
            data-testid="empty-chat-icon"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <img src="/icon.svg" alt="" className="h-24 w-24 select-none" />
          </div>
        ) : null}

        <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4">
          {(messages ?? []).map((message, index, history) => {
            const source = resendSource(history, index);
            const canResend = source !== undefined && live === undefined && queued === undefined;
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
          })}

          {live !== undefined ? (
            live.status === 'queued' ? (
              <p data-testid="run-queued" className="text-sm text-[var(--muted)]">
                {t('chat.waitingTurn')}
              </p>
            ) : (
              <ChatMessage
                streaming
                message={{
                  role: 'assistant',
                  content: live.content,
                  thinking: live.thinking,
                  tools: live.tools,
                  attachments: [],
                }}
              />
            )
          ) : null}

          {queued?.deliveryMode === 'steer' ? (
            <ChatMessage
              message={{
                role: 'user',
                content: queued.text,
                thinking: '',
                tools: [],
                attachments: queued.attachments,
              }}
            />
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
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--input-bg)] p-2 font-mono text-xs whitespace-pre-wrap">
                {confirm.detail}
              </pre>
              <p className="mt-2 text-xs text-[var(--muted)]">{t('chat.confirm.why')}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  data-testid="confirm-allow"
                  onClick={() => void respondConfirm(chatId, confirm.runId, true)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--hover-overlay)]"
                >
                  {t('chat.confirm.allow')}
                </button>
                <button
                  type="button"
                  data-testid="confirm-deny"
                  onClick={() => void respondConfirm(chatId, confirm.runId, false)}
                  className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-fg)]"
                >
                  {t('chat.confirm.deny')}
                </button>
              </div>
            </div>
          ) : null}

          {failure !== undefined ? (
            <p data-testid="run-error" role="alert" className="text-sm text-[var(--danger)]">
              {failure === 'aborted'
                ? t('chat.stopped')
                : failure === 'interrupted'
                  ? t('chat.interrupted')
                  : t('chat.failed')}
            </p>
          ) : null}
        </div>
      </div>

      {showJump ? (
        <button
          type="button"
          data-testid="jump-to-latest"
          onClick={jumpToLatest}
          aria-label={t('chat.jumpToLatest')}
          className="mx-auto mb-2 flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3.5 py-1.5 text-sm shadow-lg"
        >
          <span aria-hidden="true">↓</span>
          {missed > 0 ? (
            <span data-testid="jump-to-latest-badge" className="text-xs text-[var(--accent)]">
              {t('chat.newMessages')}
            </span>
          ) : null}
        </button>
      ) : null}

      {unconfigured ? (
        <p
          data-testid="no-provider"
          className="mx-auto mb-1 max-w-3xl px-4 text-center text-xs text-[var(--muted)]"
        >
          {t('chat.noProvider')}{' '}
          <Link to="/settings" className="text-[var(--accent)] underline underline-offset-2">
            {t('chat.noProviderLink')}
          </Link>
        </p>
      ) : null}

      <Composer
        chatId={chatId}
        busy={live !== undefined}
        {...(queued === undefined ? {} : { queuedMessage: queued })}
        onSend={(text, attachments, filePaths, delivery) =>
          send(chatId, text, attachments, filePaths, delivery)
        }
        onUpdateQueued={(text, attachments, filePaths) =>
          updateQueued(chatId, text, attachments, filePaths)
        }
        onCancelQueued={() => cancelQueued(chatId)}
        onStop={() => void stop(chatId)}
        onNewChat={() => {
          void createChat().then((created) => navigate(`/chat/${created.id}`));
        }}
        models={models}
        activeProvider={chat?.provider ?? ''}
        activeModel={chat?.model ?? ''}
        onSetModel={(model, provider) => void setModel(chatId, model, provider)}
        modelPickerRequest={modelPickerRequest}
      />

    </>
  );
}
