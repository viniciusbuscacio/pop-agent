import { RestAllowedIps } from './rest-allowed-ips';
import { useEffect, useState } from 'react';

import { a2aModuleService as integrationsService } from '../services/a2a-module';
import { Button, Card } from '../ui/controls';
export function A2aServerPanel({ enabled, changing = false, onToggle }: { enabled: boolean; changing?: boolean; onToggle: () => void }) {

    const [secret, setSecret] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const origin = window.location.origin;
    const instructions = [
      `Base URL: ${origin}`,
      `Header:   Authorization: Bearer ${secret || '<GENERATE_ACCESS_KEY>'}`,
      'Agent Card: ' + origin + '/.well-known/agent-card.json',
      'Protocol: A2A 1.0 (JSON-RPC)',
      'Endpoint: ' + origin + '/a2a/rpc',
      'Operations: SendMessage, GetTask, CancelTask',
      'Use a unique messageId. Reuse it only when retrying the same message.',
      'Text only. Streaming and push notifications are not supported.',
    ].join('\n');
    useEffect(() => {
      let active = true;
      void integrationsService.accessKey().then(result => { if (active) { setSecret(result.secret); setLoaded(true); } }).catch(() => { if (active) setError('Could not load the access key. Reopen this screen to try again.'); });
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
    return <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" data-testid="a2a-server-power" variant="primary" disabled={changing} onClick={onToggle}>{enabled ? 'Stop' : 'Start'}</Button>
        <span data-testid="a2a-server-status" role="status" className={`text-sm ${enabled ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>{enabled ? 'Enabled' : 'Stopped'}</span>
      </div>
      <p className="text-sm text-[var(--muted)]">This state is saved and restored when Pop Agent starts. Stopping A2A Server keeps the app and A2A Client available.</p>
      {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
      <div className="grid gap-3">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="text-base font-semibold">Server address</h2><p className="break-all font-mono text-sm">{origin}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="md" variant="ghost" onClick={() => void copy(origin)}>Copy URL</Button></div>
        </Card>
        <Card><h2 className="text-base font-semibold">Access control</h2><p className="text-sm text-[var(--muted)]">This key lets another agent send requests to Pop and retrieve their results. Pop can use its available tools to carry out those requests. The key does not grant access to REST API or browser UI control. It remains valid until replaced; incoming requests must also pass Allowed IP addresses and your server network rules.</p></Card>
      </div>
      <Button type="button" variant="ghost" disabled={!enabled} onClick={() => { void integrationsService.test().then(value => { if (!value.ok) throw new Error(); setStatus('Server is enabled. Test the key and IP permissions from your remote agent.'); }).catch(() => setError('Connection test failed.')); }}>Test connection</Button>
      <RestAllowedIps service={integrationsService} protocol="A2A Server" />
      <section className="space-y-3" aria-labelledby="a2a-agent-instructions">
        <div className="flex items-center justify-between gap-3"><h2 id="a2a-agent-instructions" className="text-base font-semibold">Agent instructions</h2><Button type="button" variant="ghost" size="md" data-testid="a2a-copy-instructions" disabled={!secret || busy} onClick={() => void copy(instructions)}>Copy instructions</Button></div>
        <Card><pre data-ui-private={secret ? true : undefined} data-testid="a2a-agent-instructions" className="overflow-x-auto text-xs leading-relaxed">{instructions}</pre></Card>
        <p className="text-sm text-[var(--muted)]">The instructions include the current access key and are ready to paste into your agent.</p>
      </section>
      <Button type="button" variant="ghost" onClick={() => {
        void integrationsService.card().then(card => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'pop-agent-card.json'; link.click(); URL.revokeObjectURL(url);
        }).catch(() => setError('Could not download the Agent Card.'));
      }}>Download Agent Card</Button>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">Access key</h2>
        <div className="flex flex-wrap items-center gap-3">
          <code data-ui-private data-testid="a2a-access-key" className="min-w-0 break-all text-sm">{secret ? `${secret.slice(0, 9)}••••••••${secret.slice(-4)}` : loaded ? 'Key unavailable' : 'Loading…'}</code>
          <Button type="button" size="md" variant="ghost" disabled={!secret || busy} onClick={() => secret && void copy(secret)}>Copy key</Button>
          <Button type="button" size="md" variant="ghost" data-testid="a2a-rotate-key" disabled={!loaded || !secret || busy} onClick={() => void rotate()}>Generate new key</Button>
        </div>
        <p className="text-sm text-[var(--muted)]">A key is created automatically. Generating a new key replaces all previous A2A keys immediately. Update the instructions in every connected integration.</p>
      </Card>

  </div>;
}
