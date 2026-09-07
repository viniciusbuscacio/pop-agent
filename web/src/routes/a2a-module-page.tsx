import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { A2aModuleSettingsDTO } from '@pop-agent/shared';
import { a2aModuleService } from '../services/a2a-module';
import { AgentPageHeader } from '../ui/agent-page-header';
import { BackButton, Button, Card, SwitchField, TextArea } from '../ui/controls';
import { A2aServerPanel } from './a2a-server-panel';
import { A2aOverview } from './a2a-page';

export function A2aModulePage() {
  const [settings, setSettings] = useState<A2aModuleSettingsDTO>();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === 'server' ? 'server' : params.get('edit') === 'client' ? 'client' : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void a2aModuleService.settings().then(value => { if (active) setSettings(value); })
      .catch(() => { if (active) setError('Could not load A2A settings.'); });
    return () => { active = false; };
  }, [retry]);
  const edit = (kind?: 'server' | 'client'): void => {
    setParams(current => { const next = new URLSearchParams(current); if (kind) next.set('edit', kind); else next.delete('edit'); return next; });
  };
  const toggle = async (key: keyof A2aModuleSettingsDTO, value: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    try { setSettings(await a2aModuleService.update({ [key]: value })); }
    catch { setError('Could not save A2A settings.'); }
    finally { setBusy(false); }
  };
  return <div className="p-6">
    <AgentPageHeader title={editing ? editing === 'server' ? 'A2A Server' : 'A2A Client' : 'A2A'}
      description={editing ? undefined : 'Receive tasks from trusted agents and connect to remote agents.'}
      back={editing ? <BackButton aria-label="Back" onClick={() => edit()} /> : null} />
    {error ? <p role="alert">{error} {!settings ? <Button variant="ghost" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</Button> : null}</p> : null}
    {!settings && !error ? <p role="status">Loading…</p> : null}
    {settings && !editing ? <div className="grid gap-3">
      {(['server', 'client'] as const).map(kind => {
        const key = kind === 'server' ? 'serverEnabled' : 'clientEnabled';
        return <Card key={kind} className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-medium">
            {kind === 'server' && settings.serverEnabled ? <span className="rest-api-dot" aria-label="A2A Server is running" /> : null}
            {kind === 'server' ? 'A2A Server' : 'A2A Client'}</div>
            <p className="text-sm text-[var(--muted)]">{kind === 'server' ? 'Let trusted agents send tasks to this Pop Agent.' : 'Let Pop Agent send tasks to configured remote agents.'}</p></div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <SwitchField id={'a2a-' + kind} hideLabel label={kind === 'server' ? 'A2A Server' : 'A2A Client'} checked={settings[key]} disabled={busy} onChange={value => void toggle(key, value)} />
            <Button variant="ghost" aria-label={'Edit A2A ' + kind} onClick={() => edit(kind)}>Edit</Button>
          </div>
        </Card>;
      })}
    </div> : null}
    {settings && editing === 'server' ? <A2aServerPanel enabled={settings.serverEnabled} changing={busy} onToggle={() => void toggle('serverEnabled', !settings.serverEnabled)} /> : null}
    {settings && editing === 'client' ? <><OutboundNetwork /><A2aOverview embedded /></> : null}
  </div>;
}
function OutboundNetwork() {
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void a2aModuleService.outboundIps().then(value => { if (active) { const text = value.entries.join(', '); setSaved(text); setDraft(text); } })
      .catch(() => { if (active) setError('Could not load outbound network permissions.'); });
    return () => { active = false; };
  }, []);
  return <Card className="mb-5 space-y-3">
    <TextArea id="a2a-outbound-ips" label="Allowed private destinations" rows={2} value={draft} disabled={saved === undefined || busy} onChange={event => setDraft(event.target.value)}
      hint="Optional IP addresses or CIDRs, separated by commas. Add the remote agent’s Tailscale IP to allow that private destination. Public HTTPS destinations remain available." />
    {error ? <p role="alert">{error}</p> : null}
    <div className="flex gap-2"><Button disabled={saved === undefined || busy || saved === draft} onClick={() => {
      setBusy(true); setError('');
      void a2aModuleService.setOutboundIps(draft.split(',').map(value => value.trim()).filter(Boolean))
        .then(value => { const text = value.entries.join(', '); setSaved(text); setDraft(text); })
        .catch(() => setError('Could not save. Use valid IP addresses or CIDRs.')).finally(() => setBusy(false));
    }}>Save</Button><Button variant="ghost" disabled={busy || saved === undefined} onClick={() => setDraft(saved ?? '')}>Cancel</Button></div>
  </Card>;
}
