import { AgentPageHeader } from '../ui/agent-page-header';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { McpAuthKind, McpServerDTO, McpTransport } from '@pop-agent/shared';
import { t } from '../i18n';
import { mcpService } from '../services/mcp';
import { useMcpStore } from '../store/mcp';
import { SidebarNav } from './sidebar-nav';
import {
  Button,
  Card,
  CheckField,
  Select,
  SwitchField,
  TextArea,
  TextField,
} from '../ui/controls';

export function McpPage() {
  const { id } = useParams();
  const location = useLocation();
  const isNew = location.pathname === '/mcp/new' || id === 'new';
  const navigate = useNavigate();
  const servers = useMcpStore((state) => state.servers);
  const loadError = useMcpStore((state) => state.error);
  const reload = useMcpStore((state) => state.reload);
  const [toggling, setToggling] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = isNew ? undefined : servers?.find((server) => server.id === id);

  async function toggle(server: McpServerDTO): Promise<void> {
    setToggling(server.id);
    setActionError(undefined);
    try {
      await mcpService.toggle(server.id);
      await reload();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The MCP server could not be changed.',
      );
    } finally {
      setToggling(undefined);
    }
  }

  function listView() {
    return (
      <div className="p-6">
        <AgentPageHeader title="MCP" description="Connect and manage MCP servers." />

        {loadError !== undefined || actionError !== undefined ? (
          <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
            {actionError ?? loadError}
          </p>
        ) : null}

        {servers === undefined ? (
          <Card>Loading MCP servers…</Card>
        ) : (
          <div className="grid gap-3">
            {servers.map((server) => (
              <Card key={server.id} className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{server.name}</div>
                  <div className="text-sm text-[var(--muted)]">
                    {server.transport} · {server.enabled ? server.status : t('mcp.disabled')}
                    {server.protocolEra === undefined
                      ? ''
                      : ` · ${server.protocolEra === 'modern' ? 'stateless' : 'legacy'} ${server.protocolVersion ?? ''}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SwitchField
                    id={`mcp-enabled-${server.id}`}
                    label={`${server.name} enabled`}
                    checked={server.enabled}
                    disabled={toggling !== undefined}
                    onChange={() => void toggle(server)}
                  />
                  <Button variant="ghost" onClick={() => void navigate(`/mcp/${server.id}`)}>
                    Edit
                  </Button>
                </div>
              </Card>
            ))}
            {servers.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">No MCP servers yet.</p>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  let body;
  if (id === undefined && !isNew) body = listView();
  else if (isNew || current !== undefined) {
    body = (
      <McpEditor
        key={current?.id ?? 'new'}
        server={current}
        onDone={async () => {
          await reload();
          void navigate('/mcp');
        }}
      />
    );
  } else if (servers === undefined) {
    body = <div className="p-6"><Card>Loading MCP servers…</Card></div>;
  } else {
    body = <div className="p-6"><Card>This MCP server could not be found.</Card></div>;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="md:hidden"><SidebarNav /></div>
      {body}
    </div>
  );
}

function McpEditor({
  server,
  onDone,
}: {
  server?: McpServerDTO | undefined;
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState(server?.name ?? '');
  const [description, setDescription] = useState(server?.description ?? '');
  const [transport, setTransport] = useState<McpTransport>(
    server?.transport ?? 'streamable-http',
  );
  const [endpoint, setEndpoint] = useState(server?.endpoint ?? '');
  const [command, setCommand] = useState(server?.command ?? '');
  // One line is one argv item. Spaces inside an argument are preserved and no
  // pretend shell parser corrupts quoted paths.
  const [args, setArgs] = useState(server?.args.join('\n') ?? '');
  const [authKind, setAuthKind] = useState<McpAuthKind>(server?.authKind ?? 'none');
  const [authHeader, setAuthHeader] = useState(server?.authHeader ?? '');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [timeoutMs, setTimeoutMs] = useState(String(server?.timeoutMs ?? 60000));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [tested, setTested] = useState(
    server?.capabilities.length ? server.capabilities : undefined,
  );

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const body = {
        name,
        description,
        transport,
        endpoint: transport === 'stdio' ? '' : endpoint,
        command: transport === 'stdio' ? command : '',
        args:
          transport === 'stdio'
          ? args.split(/\r?\n/).filter((argument) => argument.length > 0)
            : [],
        authKind,
        authHeader,
        enabled,
        timeoutMs: Number(timeoutMs),
        ...(clearSecret ? { env: null } : secret ? { env: { MCP_SECRET: secret } } : {}),
      };
      if (server === undefined) await mcpService.create(body);
      else await mcpService.update(server.id, body);
      await onDone();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not save the MCP server.');
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    if (server === undefined) {
      setFailed(true);
      setMessage('Save the server first, then test the connection.');
      return;
    }
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const result = await mcpService.test(server.id);
      setTested(result.capabilities);
      setMessage(
        `Connected via ${result.server.protocolEra === 'modern' ? 'stateless MCP' : 'legacy MCP'} ${result.server.protocolVersion ?? ''}. ${String(result.capabilities.length)} capabilities found.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (server === undefined || !window.confirm(`Delete MCP server “${server.name}”?`)) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await mcpService.remove(server.id);
      await onDone();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not delete the MCP server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="w-full p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{server ? 'Edit MCP server' : 'Add MCP server'}</h1>
        <Button variant="ghost" type="button" onClick={() => void onDone()}>Back</Button>
      </div>
      <Card className="grid gap-4">
        <TextField id="mcp-name" label="Name" value={name} onChange={(event) => setName(event.target.value)} required />
        <TextArea id="mcp-description" label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <Select id="mcp-transport" label="Transport" value={transport} onChange={(event) => setTransport(event.target.value as McpTransport)}>
          <option value="streamable-http">Streamable HTTP</option>
          <option value="sse">HTTP/SSE</option>
          <option value="stdio">stdio</option>
        </Select>
        {transport === 'stdio' ? (
          <>
            <TextField id="mcp-command" label="Command" value={command} onChange={(event) => setCommand(event.target.value)} required />
            <TextArea id="mcp-args" label="Arguments (one per line)" rows={4} value={args} onChange={(event) => setArgs(event.target.value)} />
          </>
        ) : (
          <TextField id="mcp-endpoint" label="Endpoint URL" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required />
        )}
        <Select id="mcp-auth" label="Authentication" value={authKind} onChange={(event) => setAuthKind(event.target.value as McpAuthKind)}>
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="api-key">API key</option>
          <option value="custom-header">Custom header</option>
        </Select>
        {authKind !== 'none' ? (
          <>
            <TextField id="mcp-header" label="Header name (optional)" value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} />
            <TextField
              id="mcp-secret"
              label="Secret / token"
              type="password"
              hint={server?.hasCredential === true && !clearSecret ? 'A credential is saved. Leave blank to keep it.' : undefined}
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value);
                setClearSecret(false);
              }}
            />
            {server?.hasCredential === true && !clearSecret ? (
              <Button type="button" variant="ghost" onClick={() => {
                setSecret('');
                setClearSecret(true);
              }}>
                Clear saved credential
              </Button>
            ) : null}
          </>
        ) : null}
        <TextField id="mcp-timeout" label="Timeout (ms)" type="number" value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} />
        <CheckField id="mcp-enabled" label="Enabled" checked={enabled} onChange={setEnabled} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !name}>{busy ? 'Saving…' : 'Save'}</Button>
          {server === undefined ? null : (
            <>
              <Button type="button" variant="ghost" onClick={() => void test()} disabled={busy}>Test connection</Button>
              <Button type="button" variant="danger" onClick={() => void remove()} disabled={busy}>Delete</Button>
            </>
          )}
        </div>
        {message ? (
          <p role={failed ? 'alert' : 'status'} className={failed ? 'text-sm text-[var(--danger)]' : 'text-sm text-[var(--muted)]'}>
            {message}
          </p>
        ) : null}
      </Card>
      {tested ? (
        <Card className="mt-4">
          <h2 className="font-medium">Discovered capabilities</h2>
          <ul className="mt-2 text-sm text-[var(--muted)]">
            {tested.map((capability) => (
              <li key={capability.id}>{capability.kind}: {capability.name}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </form>
  );
}
