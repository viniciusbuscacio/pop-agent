import { useEffect, useState } from 'react';
import { integrationsService } from '../services/integrations';
import { Button, Card, TextField } from '../ui/controls';
export function RestAllowedIps({ service = integrationsService, protocol = 'REST API' }: { service?: Pick<typeof integrationsService, 'allowedIps' | 'setAllowedIps'>; protocol?: string }) {
  const [entries, setEntries] = useState<string[]>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError('');
    void service.allowedIps().then(result => { if (active) setEntries(result.entries); }).catch(() => { if (active) setError('Could not load allowed IP addresses.'); });
    return () => { active = false; };
  }, [retry, service]);
  async function save(next: string[], adding = false): Promise<void> {
    if (busy) return;
    setBusy(true); setError('');
    try { setEntries((await service.setAllowedIps(next)).entries); if (adding) setDraft(''); }
    catch { setError('Could not save. Use a valid IPv4/IPv6 address or CIDR range and keep at least one entry.'); }
    finally { setBusy(false); }
  }
  return <Card className="space-y-3">
    <h2 className="font-medium">Allowed IP addresses</h2>
    <p className="text-sm text-[var(--muted)]">Only these addresses can call the {protocol}. A valid access key is always required. By default, only 127.0.0.1/32 is allowed.</p>
    {entries ? <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="Allowed IP addresses"><tbody>
      {entries.map(entry => <tr key={entry}><td className="break-all py-2 font-mono">{entry}</td><td className="py-2 text-right"><Button type="button" size="sm" variant="ghost" aria-label={`Remove ${entry}`} disabled={busy || entries.length === 1} onClick={() => void save(entries.filter(value => value !== entry))}>Remove</Button></td></tr>)}
    </tbody></table></div> : !error ? <p role="status">Loading…</p> : null}
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); if (entries && draft.trim()) void save([...entries, draft.trim()], true); }}>
      <div className="min-w-0 flex-1"><TextField id="rest-new-ip" label="IP address or CIDR" placeholder="e.g. 100.64.0.0/10" value={draft} maxLength={100} disabled={!entries || busy} onChange={event => setDraft(event.target.value)} /></div>
      <Button type="submit" disabled={!entries || busy || !draft.trim()}>Add</Button>
    </form>
    {error ? <p role="alert">{error} {!entries ? <Button type="button" variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button> : null}</p> : null}
  </Card>;
}
