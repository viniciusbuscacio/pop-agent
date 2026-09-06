import { useEffect, useState, type FormEvent } from 'react';
import type { RestClientDTO, RestOperationDTO } from '@pop-agent/shared';
import { integrationsService } from '../services/integrations';
import { Button, Card, TextField, TextArea, SwitchField, Select } from '../ui/controls';
const initialOperation: RestOperationDTO = { id: 'get_status', name: 'Get status', method: 'GET', path: '/status' };
export function RestClientsPanel({ enabled = true }: { enabled?: boolean }) {
    const [clients, setClients] = useState<RestClientDTO[]>([]);
    const [editing, setEditing] = useState<RestClientDTO | null | undefined>();
    const [error, setError] = useState('');
    const reload = async (): Promise<void> => { setClients((await integrationsService.clients()).clients); };
    useEffect(() => { void reload().catch(() => setError('Could not load REST clients.')); }, []);
    if (editing !== undefined) return <ClientEditor key={editing?.id ?? 'new'} client={editing ?? undefined} onCancel={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); try { await reload(); } catch { setError('Client saved. Reopen this page to reload the list.'); } }} />;
    return <div className="space-y-4"><p>Let Pop call other REST services through operations you configure. Credentials stay on the server. Only public HTTPS destinations are supported; private networks and redirects are blocked.</p>{error ? <p role="alert">{error}</p> : null}<Button onClick={() => setEditing(null)}>New client</Button>
    {clients.map(client => <Card key={client.id}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-medium">{client.name}</h3><p className="break-all text-sm">{client.baseUrl}</p><p className="text-sm">{client.enabled ? 'Enabled' : 'Disabled'} · {client.operations.length} operations · {client.hasCredential ? 'Credential stored' : 'No credential'}</p></div><Button variant="ghost" size="sm" onClick={() => setEditing(client)}>Edit</Button></div><ClientCall client={client} enabled={enabled}/></Card>)}
  </div>;
}
function ClientEditor({ client, onCancel, onSaved }: {
    client: RestClientDTO | undefined;
    onCancel: () => void;
    onSaved: () => Promise<void>;
}) {
    const [name, setName] = useState(client?.name ?? '');
    const [url, setUrl] = useState(client?.baseUrl ?? '');
    const [enabled, setEnabled] = useState(client?.enabled ?? false);
    const [header, setHeader] = useState(client?.authHeader ?? '');
    const [credential, setCredential] = useState('');
    const [clear, setClear] = useState(false);
    const [operations, setOperations] = useState<RestOperationDTO[]>(client?.operations ?? [{ ...initialOperation }]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const save = async (e: FormEvent): Promise<void> => { e.preventDefault(); setBusy(true); setError(''); try {
        await integrationsService.saveClient({ name, baseUrl: url, enabled, authHeader: header, operations, ...(clear ? { credential: '' } : credential ? { credential } : {}) }, client?.id);
        await onSaved();
    }
    catch {
        setError('Could not save. Check HTTPS URL, unique operation IDs, paths and credentials.');
    }
    finally {
        setBusy(false);
    } };
    const change = (index: number, patch: Partial<RestOperationDTO>): void => setOperations(old => old.map((operation, i) => i === index ? { ...operation, ...patch } : operation));
    return <Card><form className="space-y-4" onSubmit={e => void save(e)}><h3>{client ? 'Edit client' : 'New client'}</h3>{error ? <p role="alert">{error}</p> : null}
    <TextField id="rest-client-name" label="Name" required maxLength={80} value={name} onChange={e => setName(e.target.value)}/>
    <TextField id="rest-client-url" label="Base URL (HTTPS)" required type="url" value={url} onChange={e => setUrl(e.target.value)}/>
    <SwitchField id="rest-client-enabled" label="Allow Pop to use this client" checked={enabled} onChange={setEnabled}/>
    <TextField id="rest-client-header" label="Credential header (optional)" hint="Authorization or an X- header, such as X-API-Key." value={header} onChange={e => setHeader(e.target.value)}/>
    <TextField id="rest-client-secret" type="password" autoComplete="new-password" label="Credential value" hint="For bearer authentication include Bearer before the token. Leave empty to keep the existing credential; changing origin or header clears it." value={credential} onChange={e => setCredential(e.target.value)}/>
    {client?.hasCredential ? <SwitchField id="rest-client-clear" label="Remove stored credential" checked={clear} onChange={setClear}/> : null}
    <h4 className="font-medium">Allowed operations</h4>{operations.map((op, index) => <div key={index} className="space-y-2 border-t border-[var(--border)] pt-3">
      <TextField id={`op-id-${index}`} label="Operation ID" required value={op.id} onChange={e => change(index, { id: e.target.value })}/>
      <TextField id={`op-name-${index}`} label="Operation name" required value={op.name} onChange={e => change(index, { name: e.target.value })}/>
      <Select id={`op-method-${index}`} label="Method" value={op.method} onChange={e => change(index, { method: e.target.value as RestOperationDTO['method'] })}>{(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map(m => <option key={m}>{m}</option>)}</Select>
      <TextField id={`op-path-${index}`} label="Path appended to base URL" required value={op.path} onChange={e => change(index, { path: e.target.value })}/>
      <Button size="sm" variant="ghost" disabled={operations.length === 1} onClick={() => setOperations(old => old.filter((_, i) => i !== index))}>Remove operation</Button>
    </div>)}<Button variant="ghost" size="sm" disabled={operations.length >= 30} onClick={() => setOperations(old => [...old, { ...initialOperation, id: `operation_${old.length + 1}` }])}>Add operation</Button>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Save</Button><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form></Card>;
}
function ClientCall({ client, enabled }: {
    enabled: boolean;
    client: RestClientDTO;
}) {
    const [open, setOpen] = useState(false);
    const [operation, setOperation] = useState(client.operations[0]?.id ?? '');
    const [query, setQuery] = useState('{}');
    const [body, setBody] = useState('');
    const [result, setResult] = useState('');
    const [busy, setBusy] = useState(false);
    const call = async (e: FormEvent): Promise<void> => { e.preventDefault(); setBusy(true); try {
        const value: unknown = JSON.parse(query);
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(v => typeof v !== 'string'))
            throw new Error('invalid query');
        const response = await integrationsService.callClient(client.id, operation, value as Record<string, string>, body.trim() ? JSON.parse(body) : undefined);
        setResult(`HTTP ${response.status}\n${response.body}`);
    }
    catch {
        setResult('Request failed. Check JSON input, enabled state, network and credentials.');
    }
    finally {
        setBusy(false);
    } };
    return <div className="mt-3"><Button variant="ghost" size="sm" disabled={!enabled || !client.enabled} onClick={() => setOpen(v => !v)}>Try operation</Button>{open ? <form onSubmit={e => void call(e)} className="mt-3 space-y-3"><Select id={`call-${client.id}`} label="Operation" value={operation} onChange={e => setOperation(e.target.value)}>{client.operations.map(op => <option key={op.id} value={op.id}>{op.method} {op.name}</option>)}</Select><TextArea id={`query-${client.id}`} label="Query parameters (JSON string values)" value={query} onChange={e => setQuery(e.target.value)}/><TextArea id={`body-${client.id}`} label="JSON body (optional, not for GET)" value={body} onChange={e => setBody(e.target.value)}/><p className="text-sm">This sends a real request. Write operations may change remote data.</p><div className="flex gap-2"><Button type="submit" disabled={busy}>Send request</Button><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-sm">{result}</pre></form> : null}</div>;
}
