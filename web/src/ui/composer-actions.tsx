import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { t } from '../i18n';
import { BackButton, Menu, MenuItem, Pressable, SwitchField } from './controls';

/** One bounded action surface, with in-place model navigation on every device. */
export function ComposerActions({
  modelPicker, modelLabel, modelRequest, chatId, thinking, onThinking,
  plan, onPlan, planPending, locked, onOpen, onAttach, voice, onVoice, busy, onStop,
}: {
  modelPicker: (close: () => void) => ReactNode;
  modelLabel: string; modelRequest: number; chatId: string;
  thinking: boolean; onThinking: () => void;
  plan: boolean; onPlan: () => void; planPending: boolean;
  locked: boolean; onOpen: () => void; onAttach: () => void; voice: 'idle' | 'recording' | 'transcribing';
  onVoice: () => void; busy: boolean; onStop: () => void;
}) {
  const [page, setPage] = useState<'actions' | 'models' | undefined>();
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previousRequest = useRef(modelRequest);
  const close = () => { setPage(undefined); trigger.current?.focus(); };

  useEffect(() => { setPage(undefined); }, [chatId, locked]);
  useEffect(() => {
    if (modelRequest !== previousRequest.current) {
      previousRequest.current = modelRequest;
      setPage('models');
    }
  }, [modelRequest]);

  useLayoutEffect(() => {
    if (!page) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = Math.min(352, window.innerWidth - 16);
      const boxTop = trigger.current?.closest('[data-testid="composer-box"]')?.getBoundingClientRect().top ?? rect.top;
      const bottom = Math.max(top + 88, Math.min(boxTop - 8, top + height - 8));
      setPosition({
        width, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        bottom: window.innerHeight - bottom, maxHeight: Math.max(80, bottom - top - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [page]);

  useEffect(() => {
    if (!page) return;
    panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPage(undefined);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [page]);

  return <>
    <Pressable ref={trigger} type="button" data-testid="composer-actions" aria-label={t('chat.actions')}
      aria-haspopup="dialog" aria-expanded={page !== undefined} aria-controls={page ? 'composer-actions-panel' : undefined}
      disabled={locked} onClick={() => { if (page) close(); else { onOpen(); setPage('actions'); } }}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover-overlay)]">
      <Plus size={20} aria-hidden="true" />
    </Pressable>
    {page && !locked ? createPortal(
      <Menu ref={panel} id="composer-actions-panel" role="dialog" aria-label={t('chat.actions')}
        data-testid="composer-actions-panel" style={position} className="fixed z-50 overflow-y-auto"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === 'Tab') {
            const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
            const first = nodes[0], last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        {page === 'models' ? <>
          <div className="flex items-center gap-2 px-2 py-1">
            <BackButton aria-label={t('common.back')} onClick={() => setPage('actions')} />
            <span className="text-sm font-semibold">{t('chat.model')}</span>
          </div>
          {modelPicker(close)}
        </> : <>
          <div className="grid gap-4 px-4 py-3">
            <SwitchField id="composer-thinking" testId="thinking-visibility" label={t('chat.thinkingLabel')}
              checked={thinking} onChange={onThinking} />
            <SwitchField id="composer-plan" testId="plan-mode" label={t('chat.planLabel')}
              checked={plan} disabled={planPending} onChange={onPlan} />
          </div>
          <MenuItem role="button" testId="composer-model" label={t('chat.model')} shortcut="›" onClick={() => setPage('models')} />
          <p className="truncate px-4 pb-2 text-xs text-[var(--muted)]" title={modelLabel}>{modelLabel}</p>
          <MenuItem role="button" testId="composer-attach" label={t('chat.attach')} onClick={() => { onAttach(); close(); }} />
          <MenuItem role="button" testId={voice === 'recording' ? 'composer-mic-stop' : 'composer-mic'}
            label={voice === 'recording' ? t('chat.micStop') : t('chat.mic')}
            disabled={voice === 'transcribing'} onClick={() => { onVoice(); close(); }} />
          {busy ? <MenuItem role="button" testId="composer-menu-stop" label={t('chat.stop')} onClick={() => { onStop(); close(); }} /> : null}
        </>}
      </Menu>, document.body) : null}
  </>;
}
