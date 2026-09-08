import { useEffect, useState } from 'react';
import type { BackupDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { backupsService } from '../services/backups';
import { Button, Card, TextField } from '../ui/controls';

/** Live backup management; restore is an offline operator action. */
export function BackupSection() {
  const [backups, setBackups] = useState<BackupDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const result = await backupsService.list();
      setBackups(result.backups);
      setConfigured(result.passwordConfigured === true);
      setError(undefined);
    } catch {
      setError(t('backup.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await backupsService.create();
      await reload();
    } catch {
      setError(t('backup.createFailed'));
    } finally {
      setBusy(false);
    }
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
        <div>
          <Button type="button" data-testid="backup-create" disabled={busy || loading || !configured || editing} onClick={() => void create()}>
            {busy ? t('backup.creating') : t('backup.create')}
          </Button>
        </div>
      </Card>

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
                <p className="truncate font-mono text-xs text-[var(--key-fg-dim)]">{backup.name}</p>
                <p className="text-xs text-[var(--muted)]">{t(backup.encrypted === true ? 'backup.encrypted' : 'backup.legacy')}</p>
                <p className="text-xs text-[var(--muted)]">
                  {(backup.size / 1024).toFixed(0)} KB · {backup.createdAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              <div className="flex max-w-full flex-wrap gap-1">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void download(backup.name)}>
                  {t('backup.download')}
                </Button>
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
