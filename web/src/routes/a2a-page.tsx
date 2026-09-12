import { ShellFooter } from './shell-header';
import { A2aModulePage } from './a2a-module-page';
import { ActionSurface } from '../ui/action-surface';
import { useAgentContextActions } from '../lib/agent-context-actions';
import { AgentPageHeader } from '../ui/agent-page-header';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { A2aAgentDTO, A2aTaskDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { shortDateTime } from '../lib/time';
import { a2aService } from '../services/a2a';
import { useA2aStore } from '../store/a2a';
import { BackButton, Button, Card, Select, SwitchField, TextArea, TextField } from '../ui/controls';
import { SidebarNav } from './sidebar-nav';

const DEFAULT_AGENT_CARD_PATH = '.well-known/agent-card.json';
const MICROSOFT_FOUNDRY_AGENT_CARD_PATH = 'agentCard/v1.0';
const DEFAULT_ENTRA_SCOPE = 'https://ai.azure.com/.default';

type A2aAuthKind = A2aAgentDTO['authKind'];

export function A2aPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isNew = location.pathname === '/a2a/new';
  const agents = useA2aStore((state) => state.agents);
  const reload = useA2aStore((state) => state.reload);

  useEffect(() => { void reload(); }, [reload]);

  const current = isNew || id === 'new' ? undefined : agents?.find((agent) => agent.id === id);
  const done = async (): Promise<void> => {
    await reload();
    void navigate('/a2a?edit=client');
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-24 md:pb-0">
      <div className="md:hidden"><SidebarNav /></div>
      {id === undefined && !isNew ? (
        <A2aModulePage />
      ) : current !== undefined || isNew || id === 'new' ? (
        <A2aEditor key={current?.id ?? 'new'} agent={current} onDone={done} />
      ) : agents === undefined ? (
        <p className="p-6 text-sm text-[var(--muted)]">{t('a2a.loading')}</p>
      ) : (
        <p className="p-6 text-sm text-[var(--muted)]">{t('a2a.notFound')}</p>
      )}
      <div className="md:hidden"><ShellFooter /></div>
    </div>
  );
}

export function A2aOverview({ embedded = false }: { embedded?: boolean }) {
  const contextActions=useAgentContextActions();
  const navigate = useNavigate();
  const agents = useA2aStore((state) => state.agents);
  const toggle = useA2aStore((state) => state.toggle);

  return (
    <ActionSurface actions={[{id:'new',label:t('context.new'),run:()=>{void navigate('/a2a/new');}},{id:'refresh',label:t('context.refresh'),run:()=>useA2aStore.getState().reload()}]} ><div className="p-6">
      {!embedded ? <AgentPageHeader title={t('a2a.title')} description={t('a2a.intro')} /> : <div className="mb-4 flex justify-between"><h2 className="font-medium">Remote agents</h2><Button onClick={() => void navigate('/a2a/new')}>New agent</Button></div>}
      {agents === undefined ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">{t('a2a.loading')}</p>
      ) : agents.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">{t('a2a.none')}</p>
      ) : (
        <div className="grid gap-3" data-testid="a2a-overview-list">
          {agents.map((agent) => (
            <ActionSurface key={agent.id} actions={contextActions.a2a(agent)}><Card className="flex items-center justify-between gap-4 pr-10">
              <div className="min-w-0">
                <div className="truncate font-medium">{agent.name}</div>
                <div className="text-sm text-[var(--muted)]">{agentSummary(agent)}</div>
                <div className="text-xs text-[var(--muted)]">
                  {agent.enabled ? t('a2a.enabled') : t('a2a.disabled')}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void toggle(agent.id)}>
                  {agent.enabled ? t('a2a.turnOff') : t('a2a.turnOn')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void navigate(`/a2a/${agent.id}`)}>
                  {t('common.edit')}
                </Button>
              </div>
            </Card></ActionSurface>
          ))}
        </div>
      )}
    </div></ActionSurface>
  );
}

function A2aEditor({ agent, onDone }: { agent?: A2aAgentDTO | undefined; onDone: () => Promise<void> }) {
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(agent?.baseUrl ?? '');
  const [agentCardPath, setAgentCardPath] = useState(
    agent?.agentCardPath ?? DEFAULT_AGENT_CARD_PATH,
  );
  const [authKind, setAuthKind] = useState<A2aAuthKind>(agent?.authKind ?? 'none');
  const [authHeader, setAuthHeader] = useState(agent?.authHeader ?? '');
  const [entraTenantId, setEntraTenantId] = useState(agent?.entraTenantId ?? '');
  const [entraClientId, setEntraClientId] = useState(agent?.entraClientId ?? '');
  const [entraScope, setEntraScope] = useState(
    agent?.entraScope ?? DEFAULT_ENTRA_SCOPE,
  );
  const [credential, setCredential] = useState('');
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [timeoutMs, setTimeoutMs] = useState(String(agent?.timeoutMs ?? 60000));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [discovered, setDiscovered] = useState(agent);
  const replaceAgent = useA2aStore((state) => state.replaceAgent);
  const removeAgent = useA2aStore((state) => state.remove);
  const usesEntra = authKind === 'microsoft-entra';
  const requiredEntraFieldsPresent = !usesEntra || (
    entraTenantId.trim().length > 0
    && entraClientId.trim().length > 0
    && entraScope.trim().length > 0
    && (
      credential.length > 0
      || (agent?.authKind === 'microsoft-entra' && agent.hasCredential)
    )
  );
  const saveDisabled = busy
    || name.trim().length === 0
    || baseUrl.trim().length === 0
    || agentCardPath.trim().length === 0
    || !requiredEntraFieldsPresent;

  function applyMicrosoftFoundryPreset(): void {
    setAgentCardPath(MICROSOFT_FOUNDRY_AGENT_CARD_PATH);
    setAuthKind('microsoft-entra');
    setEntraScope(DEFAULT_ENTRA_SCOPE);
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = {
      name,
      description,
      baseUrl,
      agentCardPath,
      authKind,
      authHeader: authKind === 'none' || usesEntra ? '' : authHeader,
      entraTenantId,
      entraClientId,
      entraScope,
      enabled,
      timeoutMs: Number(timeoutMs),
      ...(credential.length > 0 ? { credential } : {}),
    };
    try {
      if (agent === undefined) await a2aService.create(body);
      else await a2aService.update(agent.id, body);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('a2a.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (agent === undefined) {
      setMessage(t('a2a.saveBeforeTest'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { agent: tested } = await a2aService.test(agent.id);
      replaceAgent(tested);
      setDiscovered(tested);
      setMessage(t('a2a.testSucceeded'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('a2a.testFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(): Promise<void> {
    if (agent === undefined) return;
    setBusy(true);
    setMessage('');
    try {
      const { agent: updated } = await a2aService.toggle(agent.id);
      replaceAgent(updated);
      setDiscovered(updated);
      setEnabled(updated.enabled);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('a2a.toggleFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (agent === undefined || !window.confirm(t('a2a.deleteConfirm', { name: agent.name }))) return;
    setBusy(true);
    setMessage('');
    try {
      await removeAgent(agent.id);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('a2a.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="w-full p-6">
      <AgentPageHeader
        title={agent === undefined ? t('a2a.addTitle') : t('a2a.editTitle')}
        back={<BackButton aria-label={t('common.back')} disabled={busy} onClick={() => void onDone()} />}
      />
      <Card className="grid gap-4">
        <div>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={applyMicrosoftFoundryPreset}>
            {t('a2a.microsoftFoundryPreset')}
          </Button>
        </div>
        <TextField id="a2a-name" label={t('a2a.name')} value={name} onChange={(event) => setName(event.target.value)} required />
        <TextArea id="a2a-description" label={t('a2a.description')} value={description} onChange={(event) => setDescription(event.target.value)} />
        <TextField id="a2a-base-url" label={t('a2a.baseUrl')} type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
        <TextField id="a2a-agent-card-path" label={t('a2a.agentCardPath')} value={agentCardPath} onChange={(event) => setAgentCardPath(event.target.value)} required />
        <Select id="a2a-auth" label={t('a2a.authentication')} value={authKind} onChange={(event) => setAuthKind(event.target.value as A2aAuthKind)}>
          <option value="none">{t('a2a.auth.none')}</option>
          <option value="bearer">{t('a2a.auth.bearer')}</option>
          <option value="api-key">{t('a2a.auth.apiKey')}</option>
          <option value="custom-header">{t('a2a.auth.customHeader')}</option>
          <option value="microsoft-entra">{t('a2a.auth.microsoftEntra')}</option>
        </Select>
        {usesEntra ? (
          <>
            <TextField id="a2a-entra-tenant-id" label={t('a2a.entraTenantId')} value={entraTenantId} onChange={(event) => setEntraTenantId(event.target.value)} required />
            <TextField id="a2a-entra-client-id" label={t('a2a.entraClientId')} value={entraClientId} onChange={(event) => setEntraClientId(event.target.value)} required />
            <TextField id="a2a-entra-scope" label={t('a2a.entraScope')} value={entraScope} onChange={(event) => setEntraScope(event.target.value)} required />
            <TextField
              id="a2a-credential"
              label={t('a2a.clientSecret')}
              hint={agent?.authKind === 'microsoft-entra' && agent.hasCredential
                ? t('a2a.clientSecretStoredHint')
                : t('a2a.clientSecretHint')}
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              required={!(agent?.authKind === 'microsoft-entra' && agent.hasCredential)}
            />
          </>
        ) : authKind !== 'none' ? (
          <>
            <TextField id="a2a-auth-header" label={t('a2a.authHeader')} value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} />
            <TextField id="a2a-credential" label={t('a2a.credential')} hint={agent?.hasCredential === true ? t('a2a.credentialHint') : undefined} type="password" value={credential} onChange={(event) => setCredential(event.target.value)} />
          </>
        ) : null}
        <TextField id="a2a-timeout" label={t('a2a.timeout')} type="number" min={1000} max={300000} value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} required />
        <SwitchField id="a2a-enabled" label={t('a2a.enabled')} checked={enabled} onChange={setEnabled} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saveDisabled}>
            {busy ? t('a2a.saving') : t('common.save')}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void onDone()}>{t('common.cancel')}</Button>
          {agent === undefined ? null : (
            <>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void testConnection()}>{t('a2a.test')}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void toggle()}>{enabled ? t('a2a.turnOff') : t('a2a.turnOn')}</Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>{t('a2a.delete')}</Button>
            </>
          )}
        </div>
        {message ? <p role="status" className="text-sm text-[var(--muted)]">{message}</p> : null}
      </Card>
      {discovered === undefined ? null : <AgentCard agent={discovered} />}
      {agent === undefined ? null : <RecentTasks agentId={agent.id} />}
    </form>
  );
}

function AgentCard({ agent }: { agent: A2aAgentDTO }) {
  return (
    <Card className="mt-4 grid gap-4" data-testid="a2a-agent-card">
      <div>
        <h2 className="font-medium">{t('a2a.agentCard')}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{agentSummary(agent)}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium">{t('a2a.interfaces')}</h3>
        {agent.interfaces.length === 0 ? <p className="mt-1 text-sm text-[var(--muted)]">{t('a2a.interfacesNone')}</p> : (
          <ul className="mt-1 grid gap-1 text-sm text-[var(--muted)]">
            {agent.interfaces.map((item) => <li key={`${item.url}-${item.protocolBinding}`}>{item.protocolBinding} · {item.protocolVersion} · {item.url}</li>)}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">{t('a2a.skills')}</h3>
        {agent.skills.length === 0 ? <p className="mt-1 text-sm text-[var(--muted)]">{t('a2a.skillsNone')}</p> : (
          <ul className="mt-1 grid gap-2 text-sm text-[var(--muted)]">
            {agent.skills.map((skill) => (
              <li key={skill.id}>
                <span className="font-medium text-[var(--screen-fg)]">{skill.name}</span>
                {skill.description ? ` — ${skill.description}` : ''}
                {skill.tags.length > 0 ? <span className="block text-xs">{skill.tags.join(' · ')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RecentTasks({ agentId }: { agentId: string }) {
  const tasks = useA2aStore((state) => state.tasksByAgent[agentId]);
  const loadTasks = useA2aStore((state) => state.loadTasks);
  useEffect(() => { void loadTasks(agentId); }, [agentId, loadTasks]);

  const recent = [...(tasks ?? [])]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 10);

  return (
    <Card className="mt-4" data-testid="a2a-recent-tasks">
      <h2 className="font-medium">{t('a2a.recentTasks')}</h2>
      {tasks === undefined ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{t('a2a.tasksLoading')}</p>
      ) : recent.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{t('a2a.tasksNone')}</p>
      ) : (
        <ul className="mt-2 grid gap-3">
          {recent.map((task) => <RecentTask key={task.id} task={task} />)}
        </ul>
      )}
    </Card>
  );
}

function RecentTask({ task }: { task: A2aTaskDTO }) {
  return (
    <li className="min-w-0 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium">{task.requestText}</span>
        <span className="shrink-0 text-xs text-[var(--muted)]">{task.state} · {shortDateTime(task.updatedAt)}</span>
      </div>
      {(task.requestMessages?.length ? task.requestMessages : [{ author: 'unknown' as const, text: task.requestText }]).map((message, index) => <p key={index} className="mt-1 text-sm"><span className="font-medium">{message.author === 'owner' ? 'You → remote agent' : message.author === 'agent' ? 'Pop → remote agent' : 'Unknown sender → remote agent'}: </span>{index > 0 ? message.text : null}</p>)}
      {task.responseText ? <p className="mt-1 line-clamp-2 text-[var(--muted)]"><span className="font-medium">Remote agent → Pop: </span>{task.responseText}</p> : null}
    </li>
  );
}

export function agentSummary(agent: A2aAgentDTO): string {
  const versions = [agent.protocolVersion, agent.agentVersion].filter((value): value is string => Boolean(value));
  return [agent.status, ...versions].join(' · ');
}
