import { useState, useSyncExternalStore } from 'react';
import { uiControl } from '../services/ui-control';
import { Button, Card, TextField } from './controls';
export function UiAccessPanel() {
  const state = useSyncExternalStore(uiControl.subscribe, uiControl.getState);
  const [name, setName] = useState('Pop browser');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect UI access.'); } finally { setBusy(false); } };
  return <Card className="space-y-3">
    <h2 className="text-base font-medium">UI access</h2>
    <p className="text-sm text-[var(--muted)]">Connect this tab so a trusted integration can inspect and operate its real interface. UI control includes owner actions, personal content and settings. Disconnect stops access to this tab.</p>
    {!state.connected ? <><TextField id="ui-tab-name" label="Tab name" maxLength={80} value={name} onChange={e => setName(e.target.value)} /><Button type="button" data-testid="ui-connect" disabled={busy || !name.trim()} onClick={() => void run(() => uiControl.start(name.trim()))}>Connect this tab</Button></> : <>
      <p className="break-all font-mono text-sm">Session: {state.sessionId}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" data-testid="ui-disconnect" variant="danger" onClick={uiControl.stop}>Disconnect</Button>
        <Button type="button" data-testid="ui-share-screen" variant="ghost" disabled={busy} onClick={() => state.sharing ? uiControl.stopSharing() : void run(uiControl.share)}>{state.sharing ? 'Stop sharing screen' : 'Share screen for screenshots'}</Button>
      </div>
      <p className="text-sm text-[var(--muted)]">Screenshots contain the actual surface you select in the browser, including visible secrets. Sharing is optional and ends when you disconnect or close the tab.</p>
    </>}
    {error || state.error ? <p role="alert">{error || state.error}</p> : null}
    <details className="space-y-2"><summary className="cursor-pointer text-sm">API examples</summary>
    <pre className="overflow-x-auto text-xs">{'GET  /v1/integration/ax\nGET  /v1/integration/ui/sessions\nGET  /v1/integration/ui/state?sessionId=...\nPOST /v1/integration/ui/press  {"sessionId":"...","testid":"shell-new-chat"}\nPOST /v1/integration/ui/input {"sessionId":"...","testid":"composer-input","value":"Hello"}\nGET  /v1/integration/ui/screenshot?sessionId=...'}</pre>
    <p className="text-sm text-[var(--muted)]">Header: Authorization: Bearer &lt;token with ui:control&gt;. Start with /ax and use the testid and index returned by /ui/state.</p>
    </details>
  </Card>;
}
export function UiAccessIndicator() {
  const state = useSyncExternalStore(uiControl.subscribe, uiControl.getState);
  return state.connected ? <Button type="button" className="fixed right-3 top-3 z-[100]" data-testid="ui-stop-access" size="sm" variant="danger" title="Stop remote UI access to this tab" onClick={uiControl.stop}>Stop UI</Button> : null;
}
