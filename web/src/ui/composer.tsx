import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';

/**
 * The composer. Enter sends, Shift+Enter breaks a line, Escape stops a run.
 *
 * The draft is kept per chat in localStorage: half-written messages survive a
 * reload, a tab switch, and the phone deciding to reclaim the page.
 */
export function Composer({
  chatId,
  busy,
  queuedText,
  onSend,
  onStop,
}: {
  chatId: string;
  busy: boolean;
  queuedText?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const storageKey = `popy.draft.${chatId}`;

  useEffect(() => {
    try {
      setText(localStorage.getItem(storageKey) ?? '');
    } catch {
      setText('');
    }
  }, [storageKey]);

  useEffect(() => {
    const element = area.current;
    if (element === null) return;
    // Grow with the content, but never past a third of the screen.
    element.style.height = 'auto';
    element.style.height = `${String(Math.min(element.scrollHeight, window.innerHeight / 3))}px`;
  }, [text]);

  function persist(value: string): void {
    setText(value);
    try {
      if (value.length > 0) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // storage denied; the draft simply will not survive a reload
    }
  }

  function submit(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    persist('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {queuedText !== undefined ? (
        <p
          data-testid="composer-queued"
          className="mb-2 truncate rounded bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--muted)]"
        >
          {t('chat.queued', { text: queuedText })}
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          ref={area}
          data-testid="composer-input"
          rows={1}
          value={text}
          onChange={(event) => persist(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          className="max-h-[33dvh] flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-[var(--screen-fg)] outline-none focus:border-[var(--accent)]"
        />

        {busy ? (
          <button
            type="button"
            data-testid="composer-stop"
            onClick={onStop}
            aria-label={t('chat.stop')}
            className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--screen-fg)] hover:bg-[var(--hover-overlay)]"
          >
            {t('chat.stop')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="composer-send"
            onClick={submit}
            disabled={text.trim().length === 0}
            aria-label={t('chat.send')}
            className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-fg)] disabled:opacity-50"
          >
            {t('chat.send')}
          </button>
        )}
      </div>
    </div>
  );
}
