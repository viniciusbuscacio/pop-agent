import { RestAllowedIps } from './rest-allowed-ips';
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
    const instructions = [
      `Base URL: ${origin}`,
      `Header:   Authorization: Bearer ${secret || '<GENERATE_ACCESS_KEY>'}`,
      'GET  /v1/integration/ax -> how it works + where to click',
      'GET  /v1/integration/ui/sessions -> available tabs',
      'GET  /v1/integration/ui/state?sessionId=ID -> visible controls',
      'POST /v1/integration/ui/scroll -> {"sessionId":"ID","deltaY":600}',
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
        <Button type="button" data-testid="rest-server-power" variant="primary" disabled={changing} onClick={onToggle}>{enabled ? 'Stop' : 'Start'}</Button>
        <span data-testid="rest-server-status" role="status" className={`text-sm ${enabled ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>{enabled ? 'Enabled' : 'Stopped'}</span>
      </div>
      <p className="text-sm text-[var(--muted)]">This state is saved and restored when Pop Agent starts. Stopping the API keeps the app available.</p>
      {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
      <div className="grid gap-3">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="text-base font-semibold">Server address</h2><p className="break-all font-mono text-sm">{origin}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="md" variant="ghost" onClick={() => void copy(origin)}>Copy URL</Button><Button type="button" size="md" variant="ghost" disabled={!enabled} onClick={() => { void integrationsService.test().then(() => setStatus('Connected using your owner session. Test integration tokens from your external client.')).catch(() => setError('Connection test failed.')); }}>Test connection</Button></div>
        </Card>
        <Card><h2 className="text-base font-semibold">Access control</h2><p className="text-sm text-[var(--muted)]">One access key authorizes all REST API operations, including conversations and UI control. It stays valid until you generate a new key. Network access follows your Tailscale and server configuration.</p></Card>
      </div>
      <RestAllowedIps />
      <section className="space-y-3" aria-labelledby="rest-agent-instructions">
        <div className="flex items-center justify-between gap-3"><h2 id="rest-agent-instructions" className="text-base font-semibold">Agent instructions</h2><Button type="button" variant="ghost" size="md" data-testid="rest-copy-instructions" disabled={!secret || busy} onClick={() => void copy(instructions)}>Copy instructions</Button></div>
        <Card><pre data-ui-private={secret ? true : undefined} data-testid="rest-agent-instructions" className="overflow-x-auto text-xs leading-relaxed">{instructions}</pre></Card>
        <p className="text-sm text-[var(--muted)]">The instructions include the current access key and are ready to paste into your agent.</p>
      </section>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">Access key</h2>
        <div className="flex flex-wrap items-center gap-3">
          <code data-ui-private data-testid="rest-access-key" className="min-w-0 break-all text-sm">{secret ? `${secret.slice(0, 9)}••••••••${secret.slice(-4)}` : loaded ? 'Key unavailable' : 'Loading…'}</code>
          <Button type="button" size="md" variant="ghost" disabled={!secret || busy} onClick={() => secret && void copy(secret)}>Copy key</Button>
          <Button type="button" size="md" variant="ghost" data-testid="rest-rotate-key" disabled={!loaded || !secret || busy} onClick={() => void rotate()}>Generate new key</Button>
        </div>
        <p className="text-sm text-[var(--muted)]">A key is created automatically. Generating a new key replaces all previous keys and tokens immediately. Update the instructions in every connected integration.</p>
      </Card>
      <Button type="button" variant="ghost" disabled={!reference} onClick={download}>Download OpenAPI</Button>
  </div>;
}
