import { useEffect, useRef, useState } from 'react';
import type { BackupDTO, BackupsResponse } from '@pop-agent/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { backupsService } from '../services/backups';
import { Button, Card, FileInput, SwitchField, TextField } from '../ui/controls';
import { useSettingsLoad } from '../ui/settings-sync';
import { settingsResources } from '../services/settings-resources';

/** Server-owned operations remain visible after navigating away and back. */
export function BackupSection() {
  const [backups, setBackups] = useState<BackupDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setBusy] = useState(false);
  const [operation, setOperation] = useState<BackupsResponse['operation']>();
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupDTO>();
  const [restorePassword, setRestorePassword] = useState('');
  const running = operation !== undefined && ['importing', 'creating', 'preparing', 'restarting'].includes(operation.state);
  const busy = pending || running;
  const [error, setError] = useState<string | undefined>(undefined);
  const [fileSelectionAvailable, setFileSelectionAvailable] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [skipUnsupportedLinks, setSkipUnsupportedLinks] = useState(false);
  const [importMaxBytes, setImportMaxBytes] = useState(0);
  const [importFile, setImportFile] = useState<File>();
  const [uploaded, setUploaded] = useState<number>();
  const [importNotice, setImportNotice] = useState('');
  const upload = useRef<AbortController | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => upload.current?.abort(), []);

  const resource = useSettingsLoad('backups', () => backupsService.list(), (result) => {
    setBackups(result.backups);
    setImportMaxBytes(result.importMaxBytes ?? 0);
    setConfigured(result.passwordConfigured === true);
    setOperation(result.operation);
    setRestoreAvailable(result.restoreAvailable === true);
    setFileSelectionAvailable(result.fileSelectionAvailable === true);
    setError(undefined); setLoading(false);
  });
  useEffect(() => { if (resource.error) { setError(t('backup.loadFailed')); setLoading(false); } }, [resource.error]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void reload(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function reload(): Promise<void> {
    await settingsResources.load('backups', () => backupsService.list());
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setOperation({ state: 'creating' });
      await backupsService.create(includeFiles, skipUnsupportedLinks);
      await reload();
    } catch (error) {
      setOperation({ state: 'idle' });
      setError(error instanceof ApiError ? error.message : t('backup.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function importArchive(): Promise<void> {
    if (!importFile) return;
    if (!importFile.name.endsWith('.popbackup') || importFile.size <= 52 || importFile.size > importMaxBytes) {
      setError(t('backup.importInvalid')); return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setBusy(true); setUploaded(0); setError(undefined); setImportNotice('');
    try {
      await backupsService.importArchive(importFile, controller.signal, setUploaded);
      setImportNotice(t('backup.importComplete'));
      setImportFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      await reload();
    } catch (error) {
      if (controller.signal.aborted) setImportNotice(t('backup.importCancelled'));
      else setError(error instanceof ApiError ? error.message : t('backup.importFailed'));
    } finally {
      upload.current = undefined; setUploaded(undefined); setBusy(false);
      // A cancelled upload can have completed just before cancellation. Reconcile the list.
      void reload();
    }
  }

  async function restore(): Promise<void> {
    if (restoreTarget === undefined || !window.confirm(t('backup.restoreConfirm', { name: restoreTarget.name }))) return;
    setBusy(true);
    setError(undefined);
    try {
      await backupsService.restore(restoreTarget.name, restoreTarget.encrypted === true ? restorePassword : undefined);
      setRestoreTarget(undefined);
      setOperation({ state: 'preparing' });
    } catch { setError(t('backup.restoreFailed')); }
    finally { setRestorePassword(''); setBusy(false); }
  }

  function cancelPassword(): void {
    setPassword('');
    setConfirmation('');
    setEditing(false);
    setError(undefined);
  }

  async function savePassword(): Promise<void> {
    if (password.length < 10 || password.length > 128 || password !== confirmation) {
      setError(t('backup.passwordInvalid'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await backupsService.setPassword(password, confirmation);
      cancelPassword();
      setConfigured(true);
    } catch {
      setError(t('backup.passwordFailed'));
    } finally { setBusy(false); }
  }

  async function download(name: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const blob = await backupsService.download(name);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('backup.downloadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string): Promise<void> {
    if (!window.confirm(t('backup.deleteConfirm', { name }))) return;
    setBusy(true);
    setError(undefined);
    try {
      await backupsService.remove(name);
      await reload();
    } catch {
      setError(t('backup.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('backup.intro')}</p>
        <p className="text-sm text-[var(--muted)]">{t('backup.privacy')}</p>
        <p className="text-sm text-[var(--muted)]">{t(configured ? 'backup.passwordSaved' : 'backup.passwordMissing')}</p>
        {editing ? (
          <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void savePassword(); }}>
            <TextField id="backup-password" type="password" autoComplete="new-password" minLength={10} maxLength={128}
              label={t('backup.password')} value={password} disabled={busy} required onChange={(event) => setPassword(event.target.value)} />
            <TextField id="backup-confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128}
              label={t('backup.confirmation')} value={confirmation} disabled={busy} required onChange={(event) => setConfirmation(event.target.value)} />
            <p className="text-sm text-[var(--muted)]">{t('backup.passwordNotice')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>{t('backup.savePassword')}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={cancelPassword}>{t('backup.cancel')}</Button>
            </div>
          </form>
        ) : (
          <div><Button type="button" variant="ghost" disabled={busy || loading} onClick={() => setEditing(true)}>
            {t(configured ? 'backup.changePassword' : 'backup.setPassword')}
          </Button></div>
        )}
        <SwitchField id="backup-include-files" label={t('backup.includeFiles')} hint={t('backup.includeFilesHint')}
          checked={includeFiles} onChange={setIncludeFiles} disabled={busy || loading || !fileSelectionAvailable} />
        <SwitchField id="backup-skip-links" label={t('backup.skipLinks')} hint={t('backup.skipLinksHint')}
          checked={skipUnsupportedLinks} onChange={setSkipUnsupportedLinks} disabled={busy || loading || !importMaxBytes} />
        <div>
          <Button type="button" data-testid="backup-create" disabled={busy || loading || !configured || editing} onClick={() => void create()}>
            {operation?.state === 'creating' ? t('backup.creating') : t('backup.create')}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('backup.importHint')}</p>
        <label htmlFor="backup-import">{t('backup.importFile')}</label>
        <FileInput id="backup-import" inputRef={fileInput} accept=".popbackup" disabled={busy || loading || !importMaxBytes}
          onChange={(event) => { setImportFile(event.target.files?.[0]); setImportNotice(''); }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !importFile || !importMaxBytes} onClick={() => void importArchive()}>{t('backup.import')}</Button>
          {uploaded === undefined ? null : <Button type="button" variant="ghost" onClick={() => upload.current?.abort()}>{t('backup.cancelImport')}</Button>}
        </div>
        {uploaded === undefined ? null : <p role="status">{uploaded >= (importFile?.size ?? 0) ? t('backup.importFinalizing') :
          t('backup.importProgress', { sent: (uploaded / 1024 ** 2).toFixed(1), total: ((importFile?.size ?? 0) / 1024 ** 2).toFixed(1) })}</p>}
        {importNotice ? <p role="status">{importNotice}</p> : null}
      </Card>

      {operation !== undefined && operation.state !== 'idle' ? (
        <Card><p role={operation.state === 'failed' ? 'alert' : 'status'} className="text-sm text-[var(--muted)]">
          {operation.state === 'importing' ? t('backup.importRunning') : operation.state === 'creating' ? t('backup.background') :
            operation.state === 'preparing' ? t('backup.preparing') :
              operation.state === 'restarting' ? t('backup.restarting') : operation.message ?? t('backup.restored')}
        </p></Card>
      ) : null}

      {restoreTarget === undefined ? null : (
        <Card>
          <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void restore(); }}>
            <p className="text-base font-semibold">{t('backup.restoreTitle', { name: restoreTarget.name })}</p>
            <p className="text-sm text-[var(--muted)]">{t(restoreTarget.includeFiles === null ? 'backup.restoreUnknownNotice' : restoreTarget.includeFiles === false ? 'backup.restoreWithoutFilesNotice' : 'backup.restoreNotice')}</p>
            {restoreTarget.encrypted === true ? <TextField id="restore-password" type="password" autoComplete="off"
              label={t('backup.archivePassword')} value={restorePassword} required maxLength={128} disabled={busy}
              onChange={(event) => setRestorePassword(event.target.value)} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || (restoreTarget.encrypted === true && !restorePassword)}>{t('backup.restoreNow')}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setRestoreTarget(undefined); setRestorePassword(''); }}>{t('backup.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
      )}

      {loading ? (
        <Card>{t('app.loading')}</Card>
      ) : backups.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t('backup.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {backups.map((backup) => (
            <Card key={backup.name} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-[var(--screen-fg)]">{backup.name}</p>
                <p className="text-xs text-[var(--muted)]">{t(backup.includeFiles === null ? 'backup.filesUnknown' : backup.includeFiles === false ? 'backup.withoutFiles' : 'backup.withFiles')}</p>
                <p className="text-xs text-[var(--muted)]">{t(backup.encrypted === true ? 'backup.encrypted' : 'backup.legacy')}</p>
                <p className="text-xs text-[var(--muted)]">
                  {(backup.size / 1024).toFixed(0)} KB · {backup.createdAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              <div className="flex max-w-full flex-wrap gap-1">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void download(backup.name)}>
                  {t('backup.download')}
                </Button>
                <Button type="button" variant="ghost" disabled={busy || !restoreAvailable} onClick={() => {
                  setRestoreTarget(backup); setRestorePassword(''); setEditing(false); setError(undefined);
                }}>{t('backup.restore')}</Button>
                <Button type="button" variant="danger" disabled={busy} onClick={() => void remove(backup.name)}>
                  {t('backup.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
