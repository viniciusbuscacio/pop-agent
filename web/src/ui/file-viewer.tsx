import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { saveFromLink, viewFromLink } from '../lib/download';
import { ApiError } from '../services/api';
import { filesService } from '../services/artifacts';
import { Button, Card, TextArea } from './controls';

export interface FileViewerProps {
  path: string;
  name: string;
  onClose: () => void;
  onSaved?: () => void;
}

type Preview = { kind: 'text'; content: string; revision: string } | { kind: 'frame'; url: string } | { kind: 'image'; url: string } | { kind: 'html'; content: string };

/** Extensions the server maps to a safe plain-text inline response. */
const TEXT_EXTENSIONS = new Set([
  'css', 'csv', 'js', 'json', 'log', 'md', 'mjs', 'ts', 'txt', 'xml', 'yaml', 'yml', 'spec', 'ini', 'conf', 'toml',
]);

function isTextFile(name: string): boolean {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension !== undefined && TEXT_EXTENSIONS.has(extension);
}

/**
 * Shows a safe, server-approved file inside the PWA.
 *
 * Text is fetched and painted by React so it inherits the app's theme, font
 * family and device font-size setting. Other browser-viewable formats retain
 * the isolated frame they need (PDF, media and images).
 */
export function FileViewer({ path, name, onClose, onSaved }: FileViewerProps) {
  const [preview, setPreview] = useState<Preview>();
  const [source, setSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = editing && preview?.kind === 'text' && draft !== preview.content;

  function cancelEdit(): void {
    if (saving || (dirty && !window.confirm(t('files.discardEdits')))) return;
    setEditing(false); setError('');
  }
  function close(): void {
    if (saving || (dirty && !window.confirm(t('files.discardEdits')))) return;
    onClose();
  }
  async function save(): Promise<void> {
    if (saving || preview?.kind !== 'text') return;
    setSaving(true); setError('');
    try {
      const result = await filesService.saveText({ path, content: draft, revision: preview.revision });
      setPreview({ kind: 'text', ...result }); setEditing(false);
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'file_changed'
        ? t('files.editConflict') : cause instanceof ApiError && cause.code === 'too_large'
        ? t('files.editTooLarge') : t('files.editFailed'));
    } finally { setSaving(false); }
  }

  useEffect(() => {
    let live = true;
    let objectUrl: string | undefined;
    setPreview(undefined);
    setSource(false);
    setFailed(false);
    setEditing(false); setError('');
    const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
    async function load(): Promise<Preview> {
      if (isTextFile(name)) return { kind: 'text', ...await filesService.readText(path) };
      if (['html', 'htm', 'svg'].includes(extension)) {
        const { blob } = await filesService.blob(await filesService.link(path));
        if (extension !== 'svg') return { kind: 'html', content: await blob.text() };
        const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
        if (!live) URL.revokeObjectURL(url); else objectUrl = url;
        return { kind: 'image', url };
      }
      const url = await filesService.viewUrl(path);
      return { kind: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'].includes(extension) ? 'image' : 'frame', url };
    }
    const pending = load();
    void pending.then(
      (next) => {
        if (live) setPreview(next);
      },
      (cause: unknown) => {
        if (live) { setFailed(true); setError(cause instanceof ApiError && cause.code === 'too_large' ? t('files.editTooLarge') : ''); }
      },
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [name, path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (editing) cancelEdit(); else close(); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <strong className="min-w-0 flex-1 truncate text-sm">{name}</strong>
        {preview?.kind === 'html' ? <Button type="button" variant="ghost" size="sm" onClick={() => setSource(value => !value)}>{t(source ? 'files.preview' : 'files.source')}</Button> : null}
        {!editing ? <Button type="button" variant="ghost" size="sm" onClick={() => { void filesService.link(path).then(saveFromLink).catch(() => { setFailed(true); }); }}>{t('files.download')}</Button> : null}
        {name.toLowerCase().endsWith('.pdf') ? <Button type="button" variant="ghost" size="sm" onClick={() => viewFromLink(filesService.viewUrl(path))}>{t('files.openInBrowser')}</Button> : null}
        {preview?.kind === 'text' && !editing ? <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(preview.content); setEditing(true); setError(''); }}>{t('common.edit')}</Button> : null}
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>
          {t('common.close')}
        </Button>
      </div>
      {failed ? (
        <div
          className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--muted)]"
          role="alert"
        >
          {error || t('files.openFailed')}
        </div>
      ) : preview === undefined ? (
        <div
          className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]"
          role="status"
        >
          {t('app.loading')}
        </div>
      ) : editing ? (
        <form className="min-h-0 flex-1 overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onSubmit={event => { event.preventDefault(); void save(); }}>
          <Card className="flex flex-col gap-4">
            <TextArea id="file-editor" data-testid="file-editor" label={t('files.textContent')} rows={20} value={draft} disabled={saving} className="font-mono" onChange={event => setDraft(event.target.value)} />
            {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving || !dirty}>{t('common.save')}</Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={cancelEdit}>{t('common.cancel')}</Button>
            </div>
          </Card>
        </form>
      ) : preview.kind === 'text' || (preview.kind === 'html' && source) ? (
        <pre
          data-testid="file-text-preview"
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-base leading-relaxed text-[var(--screen-fg)]"
        >
          {preview.content}
        </pre>
      ) : preview.kind === 'image' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <img data-testid="file-image-preview" src={preview.url} alt={name} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
        </div>
      ) : preview.kind === 'html' ? (
        <iframe
          data-testid="file-html-preview"
          className="min-h-0 flex-1 border-0 bg-[var(--document-bg)]"
          style={{ colorScheme: 'light' }}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'">${preview.content}`}
          title={name}
        />
      ) : (
        <iframe
          className="min-h-0 flex-1 border-0 bg-[var(--bg)]"
          src={preview.url}
          title={name}
        />
      )}
    </div>
  );
}
