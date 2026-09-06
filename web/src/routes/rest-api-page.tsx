import { useEffect, useState } from 'react';
import type { RestApiSettingsDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { integrationsService } from '../services/integrations';
import { Button, Card, SwitchField } from '../ui/controls';
import { SidebarNav } from './sidebar-nav';
import { ShellFooter } from './shell-header';
import { RestClientsPanel } from './rest-clients-panel';
import { RestServerPanel } from './rest-server-panel';

export function RestApiPage() {
  const [settings, setSettings] = useState<RestApiSettingsDTO>();
  const [editing, setEditing] = useState<'server' | 'client'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void integrationsService.settings().then(value => { if (active) setSettings(value); })
      .catch(() => { if (active) setError(t('rest.loadError')); });
    return () => { active = false; };
  }, [retry]);
  const toggle = async (key: keyof RestApiSettingsDTO, enabled: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { setSettings(await integrationsService.updateSettings({ [key]: enabled })); }
    catch { setError(t('rest.saveError')); }
    finally { setBusy(false); }
  };
  return <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
    <div className="md:hidden"><SidebarNav /></div>
    <div className="flex-1 overflow-y-auto p-6 pb-24 md:pb-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{editing ? t(editing === 'server' ? 'rest.server' : 'rest.client') : t('rest.title')}</h1>
          {editing ? <Button variant="ghost" size="sm" onClick={() => setEditing(undefined)}>{t('rest.back')}</Button> : null}
        </div>
        {error ? <p role="alert">{error} {!settings ? <Button variant="ghost" size="sm" onClick={() => setRetry(v => v + 1)}>{t('rest.retry')}</Button> : null}</p> : null}
        {!settings && !error ? <p role="status">{t('app.loading')}</p> : null}
        {editing === undefined && settings ? <>
          <p className="text-sm text-[var(--muted)]">{t('rest.description')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['server', 'client'] as const).map(kind => {
              const key = kind === 'server' ? 'serverEnabled' : 'clientEnabled';
              return <Card key={kind} padding="compact" className="flex flex-col gap-3">
                <SwitchField id={'rest-' + kind} label={t(kind === 'server' ? 'rest.server' : 'rest.client')} checked={settings[key]} disabled={busy} onChange={value => void toggle(key, value)} />
                <p className="flex-1 text-sm text-[var(--muted)]">{t(kind === 'server' ? 'rest.serverDescription' : 'rest.clientDescription')}</p>
                <p className="text-xs text-[var(--muted)]">{t(settings[key] ? 'rest.enabled' : 'rest.disabled')}</p>
                <Button variant="ghost" size="sm" aria-label={t(kind === 'server' ? 'rest.editServer' : 'rest.editClient')} onClick={() => setEditing(kind)}>{t('rest.edit')}</Button>
              </Card>;
            })}
          </div>
        </> : null}
        {editing === 'server' ? <RestServerPanel /> : null}
        {editing === 'client' ? <RestClientsPanel enabled={settings?.clientEnabled ?? false} /> : null}
      </div>
    </div>
    <div className="md:hidden"><ShellFooter /></div>
  </div>;
}
