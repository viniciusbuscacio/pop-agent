import { useEffect, useState } from 'react';
import type { MessageDTO, ToolCallDTO } from '@popy/shared';
import { t } from '../i18n';
import { Markdown } from './markdown';

/**
 * One turn of the conversation. The user's words go in a bubble on the right;
 * the assistant gets the full width, because its answer is the content and a
 * bubble around a page of markdown just wastes the screen.
 */
export function ChatMessage({
  message,
  streaming = false,
}: {
  message: Pick<MessageDTO, 'role' | 'content' | 'thinking' | 'tools'>;
  streaming?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="message-user">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="message-assistant">
      {message.thinking.length > 0 ? (
        <ThinkingCard text={message.thinking} answered={message.content.length > 0} />
      ) : null}

      {message.tools.length > 0 ? <ToolCards tools={message.tools} /> : null}

      {message.content.length > 0 ? (
        <div className="text-[var(--screen-fg)]">
          <Markdown text={message.content} />
          {streaming ? <Cursor /> : null}
        </div>
      ) : streaming && message.thinking.length === 0 && message.tools.length === 0 ? (
        <Cursor />
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
