import { menuAnchor, menuKeyboard, nativeContext, selectionIn, type MenuAnchor } from '../lib/context-menu';
import { useNotificationsStore } from '../store/notifications';
import type { ContextAction } from '../ui/action-surface';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackButton, Pressable, ContextMenu, MenuItem } from '../ui/controls';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ProviderStatusDTO, QueuedMessageDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { chatsService } from '../services/chats';
import { ensureChat } from '../services/client-sync';
import { SnapshotLoading } from '../ui/snapshot-loading';
import { providersService } from '../services/providers';
import type { ModelChoice } from '../ui/slash-menu';
import { useChatStore } from '../store/chat';
import { ChatMessage } from '../ui/chat-message';
import { PopBubbleMark } from '../ui/pop-bubble-mark';
import { Composer } from '../ui/composer';
import { RunStatusLine } from '../ui/run-status-line';
import { resendSource } from '../lib/resend';
import { useResendAction } from '../lib/resend-action';
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
  const loadOlder = useChatStore(state => state.loadOlder);
  const send = useChatStore((state) => state.send);
  const updateQueued = useChatStore((state) => state.updateQueued);
  const cancelQueued = useChatStore((state) => state.cancelQueued);
  const stop = useChatStore((state) => state.stop);
  const respondConfirm = useChatStore((state) => state.respondConfirm);
  const setModel = useChatStore((state) => state.setModel);
  const setExecutionMode = useChatStore((state) => state.setExecutionMode);
  const createChat = useChatStore((state) => state.createChat);
  const [context, setContext] = useState<{ anchor: MenuAnchor; actions: ContextAction[] }>();
  const [quoteRequest, setQuoteRequest] = useState<{chatId:string; text:string; id:string}>();
  const notify = useNotificationsStore(state=>state.notify);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const { resendingId, resendError, resend } = useResendAction(chatId, send);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const [editingPendingId, setEditingPendingId] = useState<string | undefined>(undefined);
  const editRequest = pending.find((message) => message.id === editingPendingId);
  const [queueActionError, setQueueActionError] = useState(false);
  // Local command output belongs to the visible transcript, but not to the
  // durable conversation sent back to the model.
  const [localSystemMessages, setLocalSystemMessages] = useState<{
    content: string;
    afterMessageId: string | undefined;
    createdAt: string;
  }[]>([]);
  function showSystemMessage(content: string): void {
    const history = useChatStore.getState().messages[chatId] ?? [];
    const entry = { content, afterMessageId: history.at(-1)?.id, createdAt: new Date().toISOString() };
    setLocalSystemMessages((current) => [...current, entry]);
  }
  const [compacting, setCompacting] = useState(false);
  const currentModel = activeChatModel(chat, providers);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastScrollTop = useRef(0);
  // The floating "↓" is the visible half of follow mode being off.
  const [showJump, setShowJump] = useState(false);
  const [oldestReached, setOldestReached] = useState<string>();
  const olderRequest = useRef<AbortController | undefined>(undefined);
  const prependAnchor = useRef<{ firstId?: string; height: number; top: number } | undefined>(undefined);
  const showOlderRef = useRef(showOlder);
  showOlderRef.current = showOlder;

  async function showOlder(): Promise<void> {
    const element = scroller.current;
    const first = messages?.[0]?.id;
    if (!element || !first || olderRequest.current || first === oldestReached) return;
    const request = new AbortController(); olderRequest.current = request;
    prependAnchor.current = { firstId: first, height: element.scrollHeight, top: element.scrollTop };
    atBottom.current = false;
    try {
      const count = await loadOlder(chatId, request.signal);
      if (!request.signal.aborted && count === 0) setOldestReached(first);
    } catch {
      // Pagination is deliberately invisible. A later upward interaction retries.
    } finally {
      if (olderRequest.current === request) {
        olderRequest.current = undefined;
        if (useChatStore.getState().messages[chatId]?.[0]?.id === first) prependAnchor.current = undefined;
      }
    }
  }

  useEffect(() => {
    // Remembered per device, so the Chats segment reopens where you were.
    try {
      localStorage.setItem('pop-agent.lastChat', chatId);
    } catch {
      // storage denied; the segment just falls back to the list
    }
    // On mount and on every chat change, the stored history replaces whatever
    // was on screen: a reload mid-run must not show the answer twice.
    const leaveChat = ensureChat(chatId);
    setContext(undefined);setQuoteRequest(undefined);
    setShowJump(false);
    setOldestReached(undefined);
    setEditingPendingId(undefined);
    setQueueActionError(false);
    setLocalSystemMessages([]);
    setCompacting(false);
    atBottom.current = true;
    lastScrollTop.current = 0;
    return () => {
      olderRequest.current?.abort(); olderRequest.current = undefined; prependAnchor.current = undefined;
      leaveChat();
    };
  }, [chatId, openChat]);

  useEffect(() => {
    // The pickable pairs (docs/specs/Spec-Pop-General.md §15): every provider that has a catalog
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
          providers.filter((entry) => entry.configured).map(async (entry) => {
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
        const catalog = withModels.flatMap(({ entry, models: list }, providerOrder) =>
          list.map((model) => ({
            provider: entry.id,
            model: model.id,
            label: several ? `${entry.name} · ${model.id}` : model.id,
            providerLabel: entry.name,
            providerOrder,
          })),
        );
        const catalogByKey = new Map(catalog.map((choice) => [`${choice.provider}||${choice.model}`, choice]));
        const recent = recentResponse.models.flatMap((entry) => {
          const available = catalogByKey.get(`${entry.provider}||${entry.model}`);
          return available === undefined ? [] : [available];
        });
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
  useEffect(()=>setContext(undefined),[chatId,idle,pending.length,compacting]);
  const settledTranscript = useMemo(
    () =>
      (messages ?? []).map((message, index, history) => {
        const source = resendSource(history, index);
        const canResend = source !== undefined && idle && pending.length === 0 && !compacting;
        return (
          <div key={message.id} data-context-message={message.id} className="min-w-0">
          <ChatMessage
            message={message}
            resending={resendingId !== undefined}
            {...(!canResend
              ? {}
              : {
                  onResend: () => { void resend(message.id, source); },
                })}
            {...(message.notice === undefined
              ? {}
              : { onChangeModel: () => setModelPickerRequest((request) => request + 1) })}
          />
          </div>
        );
      }),
    [idle, messages, pending.length, resendingId, resend, compacting],
  );
  const streamedLength = (live?.content.length ?? 0) + (live?.thinking.length ?? 0);
  const transcriptWithCommands = useMemo(() => {
    const history = messages ?? [];
    const slots = new Map<number, React.ReactNode[]>();
    localSystemMessages.forEach((entry, index) => {
      const anchor = history.findIndex((message) => message.id === entry.afterMessageId);
      // IDs survive snapshot reconciliation. If an anchor was removed, retain
      // chronological placement instead of moving the output to the latest row.
      const next = history.findIndex((message) => message.createdAt >= entry.createdAt);
      const position = entry.afterMessageId === undefined ? 0 : anchor >= 0 ? anchor + 1 : next >= 0 ? next : history.length;
      const rows = slots.get(position) ?? [];
      rows.push(<ChatMessage key={`local-system-${String(index)}`} systemTone="info" message={{
        role: 'system', content: entry.content, thinking: '', tools: [], attachments: [],
      }} />);
      slots.set(position, rows);
    });
    return [...settledTranscript.flatMap((row, index) => [...(slots.get(index) ?? []), row]), ...(slots.get(history.length) ?? [])];
  }, [messages, settledTranscript, localSystemMessages]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    const anchor = prependAnchor.current;
    if (anchor && messages?.[0]?.id !== anchor.firstId) {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
      lastScrollTop.current = element.scrollTop;
      prependAnchor.current = undefined;
    }
    // Polite autoscroll: follow the answer only if the reader was already at
    // the bottom. Somebody who scrolled up to re-read something is not
    // dragged back down.
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
      lastScrollTop.current = element.scrollTop;
    } else {
      setShowJump(true);
    }
  }, [localSystemMessages.length, messages?.length, pending.length, pending[0]?.id, streamedLength]);

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
    if (event.deltaY < 0) {
      disarm();
      if (event.currentTarget.scrollTop < 120) void showOlder();
    }
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
      if (element.scrollTop < 120) void showOlderRef.current();
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

  // The scroll position is the source of truth for the floating control, no
  // matter whether the reader used touch, a wheel, the keyboard or a scrollbar.
  // The tolerance absorbs Safari bounce and small viewport adjustments.
  function onScroll(): void {
    const element = scroller.current;
    if (element === null) return;
    const previous = lastScrollTop.current;
    const current = element.scrollTop;
    const distance = distanceFromBottom();
    lastScrollTop.current = current;

    if (current < previous && current < 120) void showOlder();
    if (distance >= BOTTOM_TOLERANCE_PX) {
      atBottom.current = false;
      setShowJump(true);
      return;
    }

    if (!atBottom.current && shouldResumeFollowing(previous, current, distance, BOTTOM_TOLERANCE_PX)) {
      atBottom.current = true;
      setShowJump(false);
    }
  }

  function jumpToLatest(): void {
    const element = scroller.current;
    if (element === null) return;
    atBottom.current = true;
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
    setShowJump(false);
  }

  function openContext(event: React.MouseEvent<HTMLElement>): void {
    if (nativeContext(event.target)) return;
    if ((event.target as Element).closest('[data-testid="message-assistant"], [data-testid="message-user"], [data-testid="message-system"]') && !(event.target as Element).closest('[data-context-message]')) return;
    event.preventDefault();event.stopPropagation();
    const root = (event.target as Element).closest<HTMLElement>('[data-context-message]');
    const index = (messages ?? []).findIndex(message=>message.id === root?.dataset.contextMessage);
    const message = messages?.[index];
    const actions: ContextAction[] = [];
    if (message && root) {
      const selection = selectionIn(root);
      const text = selection || message.content;
      if (text) {
        actions.push({id:'copy',label:t(selection ? 'context.copySelection':'context.copyMessage'),run:()=>navigator.clipboard.writeText(text)});
        if (!compacting && !editingPendingId) actions.push({id:'quote',label:t('context.quote'),run:()=>setQuoteRequest({chatId,text,id:crypto.randomUUID()})});
      }
      const source = resendSource(messages ?? [], index);
      if (!selection && source && idle && pending.length===0 && !compacting && !resendingId) actions.push({id:'resend',label:t('chat.resend'),run:()=>resend(message.id,source)});
    } else {
      actions.push({id:'new-chat',label:t('shell.newChat'),run:async()=>{const created=await createChat();void navigate(`/chat/${created.id}`);}});
    }
    if (actions.length) setContext({anchor:menuAnchor(event),actions});
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <BackButton data-testid="chat-back" aria-label={t('common.back')} onClick={() => void navigate('/')} className="md:hidden" />
        <h1 className="min-w-0 flex-1 truncate font-medium">{chat?.title ?? t('app.loading')}</h1>

      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div
          ref={scroller}
          onScroll={onScroll}
          onWheel={onWheel}
          data-testid="chat-scroller"
          onKeyDown={menuKeyboard}
          onContextMenu={event=>openContext(event)}
          className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
        >
          {messages?.length === 0 && live === undefined && pending.length === 0 && localSystemMessages.length === 0 ? (
          <div
            data-testid="empty-chat-icon"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <PopBubbleMark className="h-24 w-24 select-none text-[var(--muted)] opacity-25" />
          </div>
        ) : null}

        <div data-testid="chat-transcript" className="mx-auto flex w-full min-w-0 flex-col gap-5 p-4 md:w-[95%]">
          {messages === undefined ? <SnapshotLoading resource={`chat:${chatId}`} /> : null}
          {transcriptWithCommands}

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
            className="absolute right-4 bottom-2 z-10 flex size-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-sm shadow-lg"
          >
            <span aria-hidden="true">↓</span>
          </Pressable>
        ) : null}
      </div>

      {unconfigured ? (
        <p
          data-testid="no-provider"
          className="mx-auto mb-1 w-full px-4 text-center text-xs text-[var(--muted)] md:w-[95%]"
        >
          {t('chat.noProvider')}{' '}
          <Link
            to="/settings"
            state={{ returnTo: `/chat/${chatId}` }}
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {t('chat.noProviderLink')}
          </Link>
        </p>
      ) : null}

      <div data-testid="run-status-slot" className="h-7 shrink-0">
        {live !== undefined ? (
          <RunStatusLine status={confirm === undefined ? live.status : 'approval'} />
        ) : compacting ? (
          <CompactProgress />
        ) : null}
      </div>

      {context ? <ContextMenu anchor={context.anchor} onClose={()=>setContext(undefined)}>{context.actions.map(action=><MenuItem key={action.id} testId={`context-${action.id}`} label={action.label} onClick={()=>{setContext(undefined);void Promise.resolve().then(action.run).catch(()=>notify(t('context.failed')));}} />)}</ContextMenu> : null}
      {resendError ? <p role="alert" data-testid="resend-error" className="px-3 py-2 text-sm text-[var(--danger)]">{resendError}</p> : null}
      <Composer
        {...(quoteRequest ? {quoteRequest} : {})}
        chatId={chatId}
        busy={live !== undefined}
        locked={compacting}
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
          void createChat().then((created) => void navigate(`/chat/${created.id}`));
        }}
        models={models}
        activeProvider={chat?.provider ?? ''}
        activeModel={chat?.model ?? ''}
        currentProvider={currentModel?.currentProvider ?? ''}
        currentProviderLabel={
          providers.find((provider) => provider.id === currentModel?.currentProvider)?.name ?? ''
        }
        currentModel={currentModel?.currentModel ?? ''}
        onShowSystemMessage={showSystemMessage}
        onCommand={async (command, argument) => {
          const isCompact = command === 'compact';
          if (isCompact) setCompacting(true);
          try {
            if (command === 'fork' && argument.trim().length === 0) {
              const { points } = await chatsService.forkPoints(chatId);
              const message = points.length === 0
                ? 'No user messages are available to fork.'
                : `Choose a point with /fork <number>:\n${points.map((point) => `${String(point.number)}. ${point.text.slice(0, 120)}`).join('\n')}`;
              showSystemMessage(message);
              return;
            }
            const result = await chatsService.command(chatId, command, argument);
            if (result.kind === 'fork' && result.chat !== undefined) {
              try {
                localStorage.setItem(`pop-agent.draft.${result.chat.id}`, result.draft ?? '');
              } catch {
                // The fork still exists; only its prefilled draft is unavailable.
              }
              void navigate(`/chat/${result.chat.id}`);
              return;
            }
            if (isCompact) {
              // Compaction completion is durable history, just like a provider
              // fallback marker. Reconcile from the canonical transcript rather
              // than rendering a separate local notice below it.
              await openChat(chatId);
              setCompacting(false);
              return;
            }
            const message = result.message ?? (result.path === undefined ? `${command} completed.` : `Exported to Files/${result.path}`);
            showSystemMessage(message);
          } catch (error) {
            if (isCompact) setCompacting(false);
            throw error;
          }
        }}
        executionMode={chat?.executionMode ?? 'normal'}
        onSetExecutionMode={(executionMode) => setExecutionMode(chatId, executionMode)}
        onSetModel={(model, provider) => setModel(chatId, model, provider)}
        modelPickerRequest={modelPickerRequest}
      />

    </>
  );
}

function CompactProgress() {
  const message = t('chat.compacting');
  return (
    <div
      data-testid="compact-progress"
      role="status"
      aria-live="polite"
      className="mx-auto w-full px-4 py-0.5 md:w-[95%]"
    >
      <p className="mb-1 text-xs text-[var(--muted)]">{message}</p>
      <div
        role="progressbar"
        aria-label={message}
        className="h-1 overflow-hidden rounded-full bg-[var(--input-bg)]"
      >
        <span className="block h-full w-1/3 rounded-full bg-[var(--accent)] motion-safe:animate-[updatebar_1s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
