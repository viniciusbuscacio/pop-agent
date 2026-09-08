import { useEffect, useState } from 'react';
import type { BackupDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { backupsService } from '../services/backups';
import { Button, Card } from '../ui/controls';

/** Live backup management; restore is an offline operator action. */
export function BackupSection() {
  const [backups, setBackups] = useState<BackupDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      setBackups((await backupsService.list()).backups);
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
        <div>
          <Button type="button" data-testid="backup-create" disabled={busy} onClick={() => void create()}>
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
