import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import type { IntegrationScopeDTO, IntegrationTokenDTO, IntegrationReferenceDTO } from '@pop-agent/shared';
import { integrationsService } from '../services/integrations';
import { Button, Card, TextField, Select, SwitchField } from '../ui/controls';
const scopes: {
    value: IntegrationScopeDTO;
    label: string;
}[] = [
    { value: 'activity:read', label: 'Observe activity (no conversation content)' },
    { value: 'conversations:read', label: 'Read all conversations and personal content' },
    { value: 'conversations:write', label: 'Send messages (may incur provider costs)' },
    { value: 'runs:cancel', label: 'Cancel runs and queued messages' },
];
export function RestServerPanel() {
    const [tokensOpen, setTokensOpen] = useState(false);
    const [page, setPage] = useState(0);
    const [now, setNow] = useState(Date.now);
    const [tokens, setTokens] = useState<IntegrationTokenDTO[]>([]);
    const [reference, setReference] = useState<IntegrationReferenceDTO>();
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [days, setDays] = useState(30);
    const [selected, setSelected] = useState<IntegrationScopeDTO[]>(['activity:read']);
    const [secret, setSecret] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [revoking, setRevoking] = useState<string>();
    const activeTokens = tokens.filter(token => token.revokedAt === null && token.expiresAt > now);
    const pageCount = Math.max(1, Math.ceil(activeTokens.length / 10));
    const currentPage = Math.min(page, pageCount - 1);
    useEffect(() => {
        const nextExpiry = Math.min(...tokens.filter(token => token.revokedAt === null && token.expiresAt > Date.now()).map(token => token.expiresAt));
        if (!Number.isFinite(nextExpiry)) return;
        const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, nextExpiry - Date.now())));
        return () => window.clearTimeout(timer);
    }, [tokens, now]);
    const base = window.location.origin + '/v1';
    const reload = async (): Promise<void> => { const result = await integrationsService.list(); setTokens(result.tokens); setNow(Date.now()); };
    useEffect(() => { let active = true; void Promise.all([integrationsService.list(), integrationsService.reference()]).then(([list, docs]) => { if (active) {
        setTokens(list.tokens); setNow(Date.now());
        setReference(docs);
    } }).catch(() => { if (active)
        setError('Could not load REST API settings.'); }); return () => { active = false; }; }, []);
    const create = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const result = await integrationsService.create(name, selected, days);
            setSecret(result.secret);
            setCreating(false);
            setName('');
            await reload();
        }
        catch {
            setError('Could not create the integration token.');
        }
        finally {
            setBusy(false);
        }
    };
    const copy = async (text: string): Promise<void> => { try {
        await navigator.clipboard.writeText(text);
        setStatus('Copied.');
    }
    catch {
        setError('Copy failed. Select and copy the text manually.');
    } };
    const download = (): void => { if (!reference)
        return; const url = URL.createObjectURL(new Blob([JSON.stringify(reference.openapi, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'pop-agent-openapi.json'; a.click(); URL.revokeObjectURL(url); };
    return <div className="space-y-5">
      <p className="text-sm text-[var(--muted)]">Connect external integrations to this Pop Agent. Tokens apply to this entire single-user installation.</p>
      <Card><p className="break-all font-mono text-sm">{base}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => void copy(base)}>Copy URL</Button><Button type="button" size="sm" variant="ghost" onClick={() => { void integrationsService.test().then(() => setStatus('Connected using your owner session. Test integration tokens from your external client.')).catch(() => setError('Connection test failed.')); }}>Test connection</Button></div></Card>
      <p className="text-sm text-[var(--muted)]">Your external client must be able to reach this address. Remote connections require HTTPS. No network ports or Tailscale settings are changed here.</p>
      {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
      <h2 className="text-base font-medium">Integration tokens</h2>
      {secret ? <Card><p>Save this token now. It will not be shown again.</p><code className="block break-all py-3">{secret}</code><div className="flex gap-2"><Button type="button" onClick={() => void copy(secret)}>Copy token</Button><Button type="button" variant="ghost" onClick={() => setSecret('')}>Done</Button></div></Card> : null}
      {!creating ? <Button type="button" onClick={() => { setSelected(['activity:read']); setDays(30); setCreating(true); }}>New token</Button> : <Card><form className="space-y-4" onSubmit={event => void create(event)}>
        <TextField id="integration-name" label="Name" value={name} maxLength={80} required onChange={e => setName(e.target.value)}/>
        <Select id="integration-expiry" label="Expires in" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></Select>
        {scopes.map(scope => <SwitchField id={scope.value} key={scope.value} label={scope.label} checked={selected.includes(scope.value)} onChange={enabled => setSelected(previous => enabled ? [...previous, scope.value] : previous.filter(s => s !== scope.value))}/>)}
        <p className="text-sm">Access: {selected.join(', ') || 'none'}. Expires in {days} days. No access to account administration or local machines.</p>
        <div className="flex gap-2"><Button type="submit" disabled={busy || selected.length === 0}>Create token</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button></div>
      </form></Card>}
      <details className="space-y-3" onToggle={event => { setTokensOpen(event.currentTarget.open); setPage(0); }}>
        <summary className="cursor-pointer">{t(activeTokens.length === 1 ? 'rest.activeToken' : 'rest.activeTokens', { count: activeTokens.length })}</summary>
      {tokensOpen ? <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-label={t('rest.activeTokensTable')}>
          <thead><tr>{(['rest.tokenName', 'rest.tokenPermissions', 'rest.tokenExpiry', 'rest.tokenUsed', 'rest.tokenActions'] as const).map(key => <th key={key} scope="col" className="px-2 py-2">{t(key)}</th>)}</tr></thead>
          <tbody>{activeTokens.slice(currentPage * 10, currentPage * 10 + 10).map(token => <tr key={token.id}>
            <th scope="row" className="max-w-52 break-words px-2 py-3 align-top font-medium">{token.name}</th>
            <td className="px-2 py-3 align-top">{token.scopes.map(scope => <span key={scope} className="block">{scope}</span>)}</td>
            <td className="px-2 py-3 align-top">{new Date(token.expiresAt).toLocaleDateString()}</td>
            <td className="px-2 py-3 align-top">{token.lastUsedAt === null ? t('rest.neverUsed') : new Date(token.lastUsedAt).toLocaleString()}</td>
            <td className="px-2 py-3 align-top">
              {revoking === token.id ? <div className="flex flex-col gap-2">
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => { setBusy(true); void integrationsService.revoke(token.id).then(reload).then(() => setRevoking(undefined)).catch(() => setError('Revocation failed.')).finally(() => setBusy(false)); }}>{t('rest.confirmRevoke')}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(undefined)}>{t('rest.cancel')}</Button>
              </div> : <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => setRevoking(token.id)}>{t('rest.revoke')}</Button>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      {pageCount > 1 ? <nav aria-label={t('rest.tokenPages')} className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('rest.previous')}</Button>
        <span>{t('rest.pageCount', { page: currentPage + 1, count: pageCount })}</span>
        <Button type="button" variant="ghost" size="sm" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>{t('rest.next')}</Button>
      </nav> : null}
      </> : null}
      </details>
      <details className="space-y-4"><summary className="cursor-pointer">API reference and examples</summary><Button type="button" variant="ghost" disabled={!reference} onClick={download}>Download OpenAPI</Button>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Method / path</th><th>Scope</th><th>Behavior</th></tr></thead><tbody>{reference?.endpoints.map(e => <tr key={e.method + e.path}><td className="py-2 font-mono">{e.method.toUpperCase()} {e.path}</td><td>{e.scope}</td><td>{e.summary}</td></tr>)}</tbody></table></div>
      <Card><h3 className="font-medium">Read activity</h3><pre className="overflow-x-auto py-3 text-sm">{`# Set POP_API_TOKEN in your external client environment.
curl -H "Authorization: Bearer $POP_API_TOKEN" "${base}/integration/activity"

# PowerShell
Invoke-RestMethod '${base}/integration/activity' -Headers @{ Authorization = "Bearer $env:POP_API_TOKEN" }`}</pre></Card>
      <Card><h3 className="font-medium">Create a conversation and send a message</h3><pre className="overflow-x-auto py-3 text-sm">{`# Use a token with conversations:write. Replace CHAT_ID with the returned chatId.
curl -X POST -H "Authorization: Bearer $POP_API_TOKEN" -H "Idempotency-Key: create-001" "${base}/integration/conversations"
curl -X POST -H "Authorization: Bearer $POP_API_TOKEN" -H "Idempotency-Key: send-001" -H "Content-Type: application/json" -d '{"text":"Hello"}' "${base}/integration/conversations/CHAT_ID/messages"`}</pre></Card>
      <p className="text-sm">Commands require Idempotency-Key (1–128 letters, digits, dots, underscores, colons or hyphens). Retries with the same token, key and payload return the original result for 24 hours. Use a new key for each new operation. Messages sent during a run become follow-ups, not steering; their queueId appears on the eventual run snapshot. Local access is not inherited.</p>
      <p className="text-sm">SSE: GET /integration/events with the bearer header. Resume with Last-Event-ID; ready/resync means refresh the REST snapshot. Replay retains up to 1,000 events for one hour. Heartbeats show connectivity, not work progress. Revoked or expired tokens disconnect within one second. Limit: 120 requests/minute and three streams per token; retry after 60 seconds.</p>
      <p className="text-sm">Activity history is retained for 30 days. A quiet run is not necessarily stuck. Subagent activity currently identifies the delegated tool; detailed output remains in the authorized conversation. Configure outbound operations in REST API Client.</p>
      </details>
  </div>;
}
