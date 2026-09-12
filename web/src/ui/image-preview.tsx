import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './controls';
import { t } from '../i18n';

/** Native modal focus handling, Escape and focus restoration; only mounted while open. */
export function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-label={name} onCancel={event => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-[var(--bg)] p-0 text-[var(--screen-fg)] backdrop:bg-black/80">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <strong className="min-w-0 flex-1 truncate">{name}</strong>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      </div>
    </dialog>, document.body,
  );
}
