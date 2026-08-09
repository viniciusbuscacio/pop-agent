import { useEffect, useState, type ReactNode } from 'react';
import type { MessageDTO, ToolCallDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { useThinkingStore } from '../store/thinking';
import { Markdown } from './markdown';

/**
 * One turn of the conversation. The user's words go in a bubble on the right;
 * the assistant gets the full width, because its answer is the content and a
 * bubble around a page of markdown just wastes the screen.
 */
export function ChatMessage({
  message,
  streaming = false,
  onResend,
  resending = false,
  onChangeModel,
}: {
  message: Pick<MessageDTO, 'role' | 'content' | 'thinking' | 'tools' | 'attachments' | 'notice'>;
  streaming?: boolean;
  onResend?: () => void;
  resending?: boolean;
  onChangeModel?: () => void;
}) {
  const showThinking = useThinkingStore((state) => state.show);

  // A run that failed or was stopped leaves this mark in the history
  // forever (pop-agent.spec §6): quiet, centered, unmistakably not a reply.
  if (message.role === 'system') {
    if (message.notice?.kind === 'model-fallback') {
      const { failed, fallback } = message.notice;
      return (
        <SystemNoticeCard
          testId="message-fallback"
          title={t('chat.fallback.title', { model: modelLabel(failed) })}
          detail={t('chat.fallback.detail', {
            reason: failureReason(failed.code, failed.status),
            model: modelLabel(fallback),
          })}
          {...(onChangeModel === undefined ? {} : { onChangeModel })}
        />
      );
    }
    if (message.notice?.kind === 'run-failure') {
      const { failed } = message.notice;
      return (
        <SystemNoticeCard
          danger
          testId="message-failure"
          title={t('chat.failure.title', { model: modelLabel(failed) })}
          detail={failureReason(failed.code, failed.status)}
          {...(onResend === undefined ? {} : { onResend })}
          {...(onChangeModel === undefined ? {} : { onChangeModel })}
          resending={resending}
        />
      );
    }
    return (
      <div
        data-testid="message-system"
        className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-[var(--danger)]"
      >
        <span>{message.content}</span>
        {onResend === undefined ? null : (
          <ActionButton testId="message-resend" disabled={resending} onClick={onResend}>
            <span aria-hidden="true" className={resending ? 'animate-spin' : ''}>↻</span>
            {t('chat.resend')}
          </ActionButton>
        )}
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-2" data-testid="message-user">
        {message.content.length > 0 ? (
          <div className="user-bubble max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] whitespace-pre-wrap">
            {message.content}
          </div>
        ) : null}
        {message.attachments.length > 0 ? <Attachments attachments={message.attachments} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="message-assistant">
      {showThinking && message.thinking.length > 0 ? (
        <ThinkingCard text={message.thinking} answered={message.content.length > 0} />
      ) : null}

      {message.tools.length > 0 ? <ToolCards tools={message.tools} /> : null}

      {message.content.length > 0 ? (
        <div
          className={streaming ? 'streaming-tail text-[var(--screen-fg)]' : 'text-[var(--screen-fg)]'}
          {...(streaming ? { 'data-testid': 'stream-cursor' } : {})}
        >
          <Markdown text={message.content} />
        </div>
      ) : streaming && message.thinking.length === 0 && message.tools.length === 0 ? (
        <Cursor />
      ) : null}
    </div>
  );
}

function modelLabel(model: { providerId: string; modelId: string }): string {
  return model.modelId.length === 0
    ? model.providerId
    : `${model.providerId} · ${model.modelId}`;
}

function failureReason(code: string, status?: number): string {
  if (status === 401 || code === 'provider_not_configured') return t('chat.failure.auth');
  if (status === 402) return t('chat.failure.quota');
  if (status === 403) return t('chat.failure.access');
  if (status === 404) return t('chat.failure.modelUnavailable');
  if (status === 408 || code === 'attempt_timeout') return t('chat.failure.timeout');
  if (status === 429) return t('chat.failure.rateLimit');
  if (status !== undefined && status >= 500) return t('chat.failure.unavailable');
  if (code === 'network_error') return t('chat.failure.network');
  return t('chat.failure.technical', { code });
}

function SystemNoticeCard({
  testId,
  title,
  detail,
  danger = false,
  onResend,
  onChangeModel,
  resending = false,
}: {
  testId: string;
  title: string;
  detail: string;
  danger?: boolean;
  onResend?: () => void;
  onChangeModel?: () => void;
  resending?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      role={danger ? 'alert' : 'status'}
      className={`rounded-lg border bg-[var(--panel-bg)] p-3 ${
        danger ? 'border-[var(--danger)]' : 'border-[var(--border)]'
      }`}
    >
      <p className="text-sm font-medium text-[var(--screen-fg)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
      {onResend === undefined && onChangeModel === undefined ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          {onResend === undefined ? null : (
            <ActionButton testId="message-resend" disabled={resending} onClick={onResend}>
              <span aria-hidden="true" className={resending ? 'animate-spin' : ''}>↻</span>
              {t('chat.tryAgain')}
            </ActionButton>
          )}
          {onChangeModel === undefined ? null : (
            <ActionButton testId="message-change-model" onClick={onChangeModel}>
              {t('chat.changeModel')}
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  testId,
  disabled = false,
  onClick,
  children,
}: {
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--screen-fg)] hover:bg-[var(--hover-overlay)] disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * What was sent along with the words (aw's split): images render as
 * thumbnails, everything else as a named chip. Tapping an image opens it in a
 * new tab -- the data URI is the file.
 */
function Attachments({ attachments }: { attachments: MessageDTO['attachments'] }) {
  const images = attachments.filter((entry) => entry.type.startsWith('image/'));
  const files = attachments.filter((entry) => !entry.type.startsWith('image/'));

  return (
    <div className="flex max-w-[85%] flex-col items-end gap-2" data-testid="message-attachments">
      {images.map((image, index) => (
        <img
          key={`${image.name}-${String(index)}`}
          src={image.dataUri}
          alt={image.name}
          className="max-h-72 max-w-full rounded-xl object-contain"
        />
      ))}
      {files.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((file, index) => (
            <span
              key={`${file.name}-${String(index)}`}
              className="inline-flex max-w-64 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--muted)]"
            >
              <span className="truncate">{file.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reasoning, shown but out of the way: it opens while it is the only thing
 * happening and folds itself once the answer starts, which is the moment it
 * stops being what the reader wants.
 */
function ThinkingCard({ text, answered }: { text: string; answered: boolean }) {
  const [open, setOpen] = useState(!answered);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (answered && !pinned) setOpen(false);
  }, [answered, pinned]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]" data-testid="thinking-card">
      <button
        type="button"
        data-testid="thinking-toggle"
        aria-expanded={open}
        onClick={() => {
          setPinned(true);
          setOpen((value) => !value);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {t('chat.thinking')}
      </button>
      {open ? (
        <p
          data-testid="thinking-text"
          className="px-3 pb-3 text-sm whitespace-pre-wrap text-[var(--muted)] italic"
        >
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** Consecutive calls collapse into one card, so six greps read as "Ran 6 tools". */
function ToolCards({ tools }: { tools: ToolCallDTO[] }) {
  const [open, setOpen] = useState(false);
  const grouped = tools.length > 1;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]" data-testid="tool-card">
      <button
        type="button"
        data-testid="tool-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--hover-overlay)]"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-[var(--key-fg-dim)]">
          {grouped ? t('chat.ranTools', { count: tools.length }) : (tools[0]?.name ?? '')}
        </span>
        <ToolStatusMark tools={tools} />
      </button>

      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {tools.map((tool, index) => (
            <div key={`${tool.name}-${String(index)}`} className="flex flex-col gap-1">
              <span className="font-mono text-xs text-[var(--muted)]">{tool.name}</span>
              <pre
                data-testid="tool-output"
                className="overflow-x-auto rounded bg-[var(--input-bg)] p-2 font-mono text-xs whitespace-pre-wrap"
              >
                {tool.detail}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolStatusMark({ tools }: { tools: ToolCallDTO[] }) {
  const last = tools[tools.length - 1];
  if (last === undefined) return null;

  if (last.status === 'error') {
    return <span className="text-xs text-[var(--danger)]">{t('chat.toolFailed')}</span>;
  }
  if (last.status === 'done') {
    return <span className="text-xs text-[var(--success)]">✓</span>;
  }
  return <Spinner />;
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--muted)] border-t-transparent"
    />
  );
}

function Cursor() {
  return (
    <span
      data-testid="stream-cursor"
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--accent)] align-text-bottom"
    />
  );
}
