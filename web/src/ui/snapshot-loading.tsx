import { useSyncExternalStore } from 'react';
import { syncQueue } from '../services/sync-queue';
import { refreshClientData } from '../services/client-sync';
import { Button } from './controls';
import { t } from '../i18n';

/** Missing data is loading/failed, never an empty conversation or empty list. */
export function SnapshotLoading({ resource }: { resource: string }) {
  const { errors, busy } = useSyncExternalStore(syncQueue.subscribe, syncQueue.getState);
  const failed = errors.includes(resource);
  return <div className="grid gap-3 p-4" role={failed ? 'alert' : 'status'}>
    <p className="text-sm text-[var(--muted)]">{t(failed ? 'settings.sync.failed' : 'app.loading')}</p>
    {failed ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void refreshClientData()}>{t('settings.sync.retry')}</Button> : null}
    <div aria-hidden="true" className="h-10 rounded-md bg-[var(--hover-overlay)]" />
    <div aria-hidden="true" className="h-24 rounded-md bg-[var(--hover-overlay)]" />
  </div>;
}
