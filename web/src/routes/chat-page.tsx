import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { chatsService } from '../services/chats';
import { eventStream } from '../services/events';
import { providersService } from '../services/providers';
import { useChatStore } from '../store/chat';
import { useThinkingStore } from '../store/thinking';
import { ChatMessage } from '../ui/chat-message';
import { Composer } from '../ui/composer';

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
  const stop = useChatStore((state) => state.stop);
  const respondConfirm = useChatStore((state) => state.respondConfirm);
  const setModel = useChatStore((state) => state.setModel);
  const showThinking = useThinkingStore((state) => state.show);
  const toggleThinking = useThinkingStore((state) => state.toggle);

  const [models, setModels] = useState<string[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [missed, setMissed] = useState(0);

  useEffect(() => {
    // On mount and on every chat change, the stored history replaces whatever
    // was on screen: a reload mid-run must not show the answer twice.
    void openChat(chatId);
    setMissed(0);
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
    void chatsService
      .models()
      .then(({ models: available }) => setModels(available.map((model) => model.id)))
      .catch(() => setModels([]));
    // The banner only appears on a definite "no": a failed lookup must not
    // nag someone whose provider is fine.
    void providersService
      .list()
      .then(({ providers }) => setUnconfigured(providers.every((entry) => !entry.configured)))
      .catch(() => setUnconfigured(false));
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
    }
  }, [messages?.length, streamedLength]);

  function onScroll(): void {
    const element = scroller.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    // 96px, aw's threshold: generous enough that a bounce or an address-bar
    // resize does not break follow mode, small enough that scrolling up does.
    atBottom.current = distance < 96;
    if (atBottom.current) setMissed(0);
  }

  function jumpToLatest(): void {
    const element = scroller.current;
    if (element === null) return;
    atBottom.current = true;
    element.scrollTop = element.scrollHeight;
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

        <Link
          to={`/chat/${chatId}/artifacts`}
          data-testid="chat-artifacts"
          aria-label={t('artifacts.title')}
          title={t('artifacts.title')}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          ⧉
        </Link>

      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid="chat-scroller"
        className="relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4">
          {(messages ?? []).map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

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
              {failure === 'aborted' ? t('chat.stopped') : t('chat.failed')}
            </p>
          ) : null}
        </div>
      </div>

      {missed > 0 ? (
        <button
          type="button"
          data-testid="jump-to-latest"
          onClick={jumpToLatest}
          className="mx-auto mb-2 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-1.5 text-xs shadow-lg"
        >
          {t('chat.jumpToLatest')}
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
        {...(queued === undefined ? {} : { queuedText: queued.text })}
        onSend={(text, attachments) => void send(chatId, text, attachments)}
        onStop={() => void stop(chatId)}
      />

      {/*
        The strip under the composer (Vinicius, 31/07): per-chat knobs live
        here, with room to grow -- not in the header, not in a drawer.
      */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-2">
        <button
          type="button"
          data-testid="thinking-visibility"
          aria-pressed={showThinking}
          onClick={toggleThinking}
          title={t('chat.thinkingVisibility')}
          className={`rounded-md border border-[var(--border)] px-2 py-1 text-xs ${
            showThinking
              ? 'bg-[var(--hover-overlay)] text-[var(--screen-fg)]'
              : 'text-[var(--muted)]'
          }`}
        >
          💭 {showThinking ? t('chat.thinkingOn') : t('chat.thinkingOff')}
        </button>

        <select
          data-testid="chat-model"
          aria-label={t('chat.model')}
          value={chat?.model ?? ''}
          onChange={(event) => void setModel(chatId, event.target.value)}
          className="max-w-48 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--key-fg-dim)]"
        >
          <option value="">{t('chat.defaultModel')}</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
