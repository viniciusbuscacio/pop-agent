import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AttachmentDTO } from '@popy/shared';
import { t } from '../i18n';

/**
 * The composer, in aw's shape: an attach button on the left, the textarea in
 * the middle, and an icon-only send/stop on the right. Enter sends,
 * Shift+Enter breaks a line, Escape stops a run. Files arrive through the
 * picker or by dropping them anywhere on the composer; images show a
 * thumbnail chip, everything else a file chip. aw's 16 MB cap applies here
 * before a byte leaves the phone.
 *
 * The draft is kept per chat in localStorage: half-written messages survive a
 * reload, a tab switch, and the phone deciding to reclaim the page.
 */

const MAX_ATTACH_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

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
  onSend: (text: string, attachments: AttachmentDTO[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const storageKey = `popy.draft.${chatId}`;

  useEffect(() => {
    try {
      setText(localStorage.getItem(storageKey) ?? '');
    } catch {
      setText('');
    }
    setAttachments([]);
    setNotice(undefined);
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

  function addFiles(files: FileList | null): void {
    if (files === null) return;
    setNotice(undefined);
    for (const file of Array.from(files)) {
      if (attachments.length >= MAX_ATTACHMENTS) return;
      if (file.size > MAX_ATTACH_BYTES) {
        setNotice(t('chat.attachTooLarge', { name: file.name }));
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        const attachment: AttachmentDTO = {
          name: file.name,
          type: file.type.length > 0 ? file.type : 'application/octet-stream',
          dataUri: reader.result,
        };
        setAttachments((current) =>
          current.length >= MAX_ATTACHMENTS ? current : [...current, attachment],
        );
      };
      reader.readAsDataURL(file);
    }
  }

  const canSend = text.trim().length > 0 || attachments.length > 0;

  function submit(): void {
    if (!canSend) return;
    onSend(text.trim(), attachments);
    persist('');
    setAttachments([]);
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
    <div
      className="border-t border-[var(--border)] bg-[var(--bg)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      {queuedText !== undefined ? (
        <p
          data-testid="composer-queued"
          className="mb-2 truncate rounded bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--muted)]"
        >
          {t('chat.queued', { text: queuedText })}
        </p>
      ) : null}

      {notice !== undefined ? (
        <p role="alert" className="mb-2 text-xs text-[var(--danger)]">
          {notice}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="attachment-tray">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${String(index)}`}
              className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--key-fg-dim)]"
            >
              {attachment.type.startsWith('image/') ? (
                <img
                  src={attachment.dataUri}
                  alt=""
                  className="h-6 w-6 rounded object-cover"
                />
              ) : (
                <FileIcon />
              )}
              <span className="truncate">{attachment.name}</span>
              <button
                type="button"
                aria-label={t('chat.attachRemove', { name: attachment.name })}
                onClick={() =>
                  setAttachments((current) => current.filter((_, at) => at !== index))
                }
                className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          data-testid="composer-file-input"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <IconButton
          testId="composer-attach"
          label={t('chat.attach')}
          onClick={() => picker.current?.click()}
        >
          <AttachIcon />
        </IconButton>

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

        {busy && !canSend ? (
          <IconButton testId="composer-stop" label={t('chat.stop')} stop onClick={onStop}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            testId="composer-send"
            label={busy ? t('chat.queue') : t('chat.send')}
            primary
            disabled={!canSend}
            onClick={submit}
          >
            <SendIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** aw's 34px icon button, in Popy's rounder skin. */
function IconButton({
  testId,
  label,
  onClick,
  disabled = false,
  primary = false,
  stop = false,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  stop?: boolean;
  children: ReactNode;
}) {
  const skin = primary
    ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-transparent disabled:opacity-40'
    : stop
      ? 'border-[var(--border)] text-[var(--danger)] hover:bg-[var(--hover-overlay)]'
      : 'border-[var(--border)] text-[var(--key-fg-dim)] opacity-70 hover:bg-[var(--hover-overlay)] hover:opacity-100';

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-10 w-10 flex-none place-items-center rounded-full border ${skin}`}
    >
      {children}
    </button>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
