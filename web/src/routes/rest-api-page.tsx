import { useNotificationsStore } from '../store/notifications';
import { ActionSurface } from '../ui/action-surface';
import { AgentPageHeader } from '../ui/agent-page-header';
import { useEffect, useState } from 'react';
import type { RestApiSettingsDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { integrationsService } from '../services/integrations';
import { BackButton, Button, Card, SwitchField } from '../ui/controls';
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
      <div className="w-full">
        <AgentPageHeader
          title={editing ? t(editing === 'server' ? 'rest.server' : 'rest.client') : t('rest.title')}
          description={editing ? undefined : t('rest.description')}
          back={editing ? <BackButton aria-label={t('common.back')} onClick={() => setEditing(undefined)} /> : null}
        />
        {error ? <p role="alert">{error} {!settings ? <Button variant="ghost" size="sm" onClick={() => setRetry(v => v + 1)}>{t('rest.retry')}</Button> : null}</p> : null}
        {!settings && !error ? <p role="status">{t('app.loading')}</p> : null}
        {editing === undefined && settings ? <>
          <div className="grid gap-3">
            {(['server', 'client'] as const).map(kind => {
              const key = kind === 'server' ? 'serverEnabled' : 'clientEnabled';
              return <ActionSurface key={kind} actions={[
                {id:'edit',label:t('rest.edit'),run:()=>setEditing(kind)},
                ...(kind === 'server' && settings.serverEnabled ? [{id:'test',label:t('context.test'),run:async()=>{const result=await integrationsService.test();if(!result.ok)throw new Error('Connection test failed');useNotificationsStore.getState().notify(t('context.testPassed'));}}] : []),
                ...(!busy ? [{id:'toggle',label:t(settings[key]?'context.disable':'context.enable'),run:()=>toggle(key,!settings[key])}] : []),
              ]}><Card className="flex flex-col items-stretch justify-between gap-4 pr-10 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t(kind === 'server' ? 'rest.server' : 'rest.client')}</div>
                  <p className="text-sm text-[var(--muted)]">{t(kind === 'server' ? 'rest.serverDescription' : 'rest.clientDescription')}</p>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <SwitchField hideLabel id={'rest-' + kind} label={t(kind === 'server' ? 'rest.server' : 'rest.client')} checked={settings[key]} disabled={busy} onChange={value => void toggle(key, value)} />
                  <Button variant="ghost" aria-label={t(kind === 'server' ? 'rest.editServer' : 'rest.editClient')} onClick={() => setEditing(kind)}>{t('rest.edit')}</Button>
                </div>
              </Card></ActionSurface>;
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
