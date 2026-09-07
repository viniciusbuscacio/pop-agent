import { useEffect, useState } from 'react';
import type { IntegrationReferenceDTO } from '@pop-agent/shared';
import { integrationsService } from '../services/integrations';
import { Button, Card } from '../ui/controls';
export function RestServerPanel({ enabled, changing = false, onToggle }: { enabled: boolean; changing?: boolean; onToggle: () => void }) {
    const [reference, setReference] = useState<IntegrationReferenceDTO>();
    const [secret, setSecret] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const origin = window.location.origin;
    const base = origin + '/v1';
    const secure = window.location.protocol === 'https:';
    const port = window.location.port || (secure ? '443' : '80');
    const instructions = [
      `Base URL: ${origin}`,
      `Header:   Authorization: Bearer ${secret || '<GENERATE_ACCESS_KEY>'}`,
      'GET  /v1/integration/ax -> how it works + where to click',
      'GET  /v1/integration/ui/sessions -> available tabs',
      'GET  /v1/integration/ui/state?sessionId=ID -> visible controls',
      'POST /v1/integration/ui/input -> {"sessionId":"ID","testid":"composer-input","value":"Draft"}',
      'POST /v1/integration/ui/press -> {"sessionId":"ID","testid":"shell-new-chat"}',
      'GET  /v1/integration/activity -> run activity',
      'GET  /v1/integration/conversations -> conversations',
      'POST /v1/integration/conversations -> create a conversation (Idempotency-Key required)',
      'POST /v1/integration/runs/ID/cancel -> cancel a run (Idempotency-Key required)',
    ].join('\n');
    useEffect(() => {
      let active = true;
      void integrationsService.accessKey().then(result => { if (active) { setSecret(result.secret); setLoaded(true); } }).catch(() => { if (active) setError('Could not load the access key. Reopen this screen to try again.'); });
      void integrationsService.reference().then(value => { if (active) setReference(value); }).catch(() => { if (active) setError('Could not load the API reference.'); });
      return () => { active = false; };
    }, []);
    const rotate = async (): Promise<void> => {
      setBusy(true); setError(''); setStatus('');
      try {
        const result = await integrationsService.rotateAccessKey();
        setSecret(result.secret);
        setStatus('Access key updated. Copy the new agent instructions to your integrations.');
      } catch {
        // A lost response can hide a successful rotation. Read once; never rotate again automatically.
        setSecret(null);
        try { setSecret((await integrationsService.accessKey()).secret); }
        catch { setLoaded(false); }
        setError('Could not confirm the key change. Check the current key before updating your integrations.');
      } finally { setBusy(false); }
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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" data-testid="rest-server-power" variant={enabled ? 'danger' : 'primary'} disabled={changing} onClick={onToggle}>{enabled ? 'Stop' : 'Start'}</Button>
        <span data-testid="rest-server-status" className={`rounded-md border px-4 py-2 text-sm font-medium ${enabled ? 'border-[var(--success)] text-[var(--success)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>{enabled ? 'Enabled' : 'Stopped'}</span>
      </div>
      <p className="text-sm text-[var(--muted)]">This state is saved and restored when Pop Agent starts. Stopping the API keeps the app available.</p>
      {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
      <div className="grid gap-3">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="font-medium">Server address</h2><p className="break-all font-mono text-sm">{origin}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => void copy(origin)}>Copy URL</Button><Button type="button" size="sm" variant="ghost" disabled={!enabled} onClick={() => { void integrationsService.test().then(() => setStatus('Connected using your owner session. Test integration tokens from your external client.')).catch(() => setError('Connection test failed.')); }}>Test connection</Button></div>
        </Card>
        <Card className="flex items-center justify-between gap-4">
          <div><h2 className="font-medium">Connection port</h2><p className="text-sm text-[var(--muted)]">Shared with the Pop app at this address.</p></div><span className="font-mono">{port}</span>
        </Card>
        <Card className="flex items-center justify-between gap-4">
          <div><h2 className="font-medium">HTTPS</h2><p className="text-sm text-[var(--muted)]">Managed by your server connection. Remote access requires HTTPS.</p></div><span className={`shrink-0 text-sm ${secure ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>{secure ? 'Enabled' : 'Not in use'}</span>
        </Card>
        <Card><h2 className="font-medium">Access control</h2><p className="text-sm text-[var(--muted)]">One access key authorizes all REST API operations, including conversations and UI control. It stays valid until you generate a new key. Network access follows your Tailscale and server configuration.</p></Card>
      </div>
      <section className="space-y-3" aria-labelledby="rest-agent-instructions">
        <div className="flex items-center justify-between gap-3"><h2 id="rest-agent-instructions" className="font-medium">Agent instructions</h2><Button type="button" variant="ghost" size="sm" data-testid="rest-copy-instructions" disabled={!secret || busy} onClick={() => void copy(instructions)}>Copy instructions</Button></div>
        <Card><pre data-ui-private={secret ? true : undefined} data-testid="rest-agent-instructions" className="overflow-x-auto text-xs leading-relaxed">{instructions}</pre></Card>
        <p className="text-sm text-[var(--muted)]">The instructions include the current access key and are ready to paste into your agent.</p>
      </section>
      <Card className="space-y-3">
        <h2 className="font-medium">Access key</h2>
        <div className="flex flex-wrap items-center gap-3">
          <code data-ui-private data-testid="rest-access-key" className="min-w-0 break-all text-sm">{secret ? `${secret.slice(0, 9)}••••••••${secret.slice(-4)}` : loaded ? 'No key generated' : 'Loading…'}</code>
          <Button type="button" size="sm" variant="ghost" disabled={!secret || busy} onClick={() => secret && void copy(secret)}>Copy key</Button>
          <Button type="button" size="sm" variant="ghost" data-testid="rest-rotate-key" disabled={!loaded || busy} onClick={() => void rotate()}>{secret ? 'Generate new key' : 'Generate key'}</Button>
        </div>
        <p className="text-sm text-[var(--muted)]">Generating a key replaces all previous keys and tokens immediately. Update the instructions in every connected integration.</p>
      </Card>
      <details className="space-y-4"><summary className="cursor-pointer">API reference and examples</summary><Button type="button" variant="ghost" disabled={!reference} onClick={download}>Download OpenAPI</Button>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Method / path</th><th>Scope</th><th>Behavior</th></tr></thead><tbody>{reference?.endpoints.map(e => <tr key={e.method + e.path}><td className="py-2 font-mono">{e.method.toUpperCase()} {e.path}</td><td>{e.scope}</td><td>{e.summary}</td></tr>)}</tbody></table></div>
      <Card><h3 className="font-medium">Read activity</h3><pre className="overflow-x-auto py-3 text-sm">{`# Set POP_API_TOKEN in your external client environment.
curl -H "Authorization: Bearer $POP_API_TOKEN" "${base}/integration/activity"

# PowerShell
Invoke-RestMethod '${base}/integration/activity' -Headers @{ Authorization = "Bearer $env:POP_API_TOKEN" }`}</pre></Card>
      <Card><h3 className="font-medium">Create a conversation and send a message</h3><pre className="overflow-x-auto py-3 text-sm">{`# Use the access key. Replace CHAT_ID with the returned chatId.
curl -X POST -H "Authorization: Bearer $POP_API_TOKEN" -H "Idempotency-Key: create-001" "${base}/integration/conversations"
curl -X POST -H "Authorization: Bearer $POP_API_TOKEN" -H "Idempotency-Key: send-001" -H "Content-Type: application/json" -d '{"text":"Hello"}' "${base}/integration/conversations/CHAT_ID/messages"`}</pre></Card>
      <p className="text-sm">Conversation and cancellation commands require Idempotency-Key (1–128 letters, digits, dots, underscores, colons or hyphens). Retries with the same token, key and payload return the original result for 24 hours. Use a new key for each new operation. Messages sent during a run become follow-ups, not steering; their queueId appears on the eventual run snapshot. Local access is not inherited.</p>
      <p className="text-sm">SSE: GET /integration/events with the bearer header. Resume with Last-Event-ID; ready/resync means refresh the REST snapshot. Replay retains up to 1,000 events for one hour. Heartbeats show connectivity, not work progress. Replaced keys disconnect within one second. Limit: 120 requests/minute and three streams per token; retry after 60 seconds.</p>
      <p className="text-sm">Activity history is retained for 30 days. A quiet run is not necessarily stuck. Subagent activity currently identifies the delegated tool; detailed output remains in the authorized conversation. Configure outbound operations in REST API Client.</p>
      </details>
  </div>;
}
