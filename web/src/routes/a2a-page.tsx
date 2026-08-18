import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { A2aAgentDTO, A2aTaskDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { shortDateTime } from '../lib/time';
import { a2aService } from '../services/a2a';
import { useA2aStore } from '../store/a2a';
import { Button, Card, Select, SwitchField, TextArea, TextField } from '../ui/controls';
import { SidebarNav } from './sidebar-nav';

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
    void navigate('/a2a');
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="md:hidden"><SidebarNav /></div>
      {id === undefined && !isNew ? (
        <A2aOverview />
      ) : current !== undefined || isNew || id === 'new' ? (
        <A2aEditor key={current?.id ?? 'new'} agent={current} onDone={done} />
      ) : agents === undefined ? (
        <p className="p-6 text-sm text-[var(--muted)]">{t('a2a.loading')}</p>
      ) : (
        <p className="p-6 text-sm text-[var(--muted)]">{t('a2a.notFound')}</p>
      )}
    </div>
  );
}

function A2aOverview() {
  const navigate = useNavigate();
  const agents = useA2aStore((state) => state.agents);
  const toggle = useA2aStore((state) => state.toggle);

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">{t('a2a.title')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t('a2a.intro')}</p>
      </div>
      {agents === undefined ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">{t('a2a.loading')}</p>
      ) : agents.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">{t('a2a.none')}</p>
      ) : (
        <div className="grid gap-3" data-testid="a2a-overview-list">
          {agents.map((agent) => (
            <Card key={agent.id} className="flex items-center justify-between gap-4">
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function A2aEditor({ agent, onDone }: { agent?: A2aAgentDTO | undefined; onDone: () => Promise<void> }) {
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(agent?.baseUrl ?? '');
  const [authKind, setAuthKind] = useState<A2aAgentDTO['authKind']>(agent?.authKind ?? 'none');
  const [authHeader, setAuthHeader] = useState(agent?.authHeader ?? '');
  const [credential, setCredential] = useState('');
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [timeoutMs, setTimeoutMs] = useState(String(agent?.timeoutMs ?? 60000));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [discovered, setDiscovered] = useState(agent);
  const replaceAgent = useA2aStore((state) => state.replaceAgent);
  const removeAgent = useA2aStore((state) => state.remove);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = {
      name,
      description,
      baseUrl,
      authKind,
      authHeader: authKind === 'none' ? '' : authHeader,
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
    <form onSubmit={(event) => void save(event)} className="mx-auto w-full max-w-3xl p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {agent === undefined ? t('a2a.addTitle') : t('a2a.editTitle')}
        </h1>
        <Button variant="ghost" type="button" disabled={busy} onClick={() => void onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
      <Card className="grid gap-4">
        <TextField id="a2a-name" label={t('a2a.name')} value={name} onChange={(event) => setName(event.target.value)} required />
        <TextArea id="a2a-description" label={t('a2a.description')} value={description} onChange={(event) => setDescription(event.target.value)} />
        <TextField id="a2a-base-url" label={t('a2a.baseUrl')} type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
        <Select id="a2a-auth" label={t('a2a.authentication')} value={authKind} onChange={(event) => setAuthKind(event.target.value as A2aAgentDTO['authKind'])}>
          <option value="none">{t('a2a.auth.none')}</option>
          <option value="bearer">{t('a2a.auth.bearer')}</option>
          <option value="api-key">{t('a2a.auth.apiKey')}</option>
          <option value="custom-header">{t('a2a.auth.customHeader')}</option>
        </Select>
        {authKind !== 'none' ? (
          <>
            <TextField id="a2a-auth-header" label={t('a2a.authHeader')} value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} />
            <TextField id="a2a-credential" label={t('a2a.credential')} hint={agent?.hasCredential === true ? t('a2a.credentialHint') : undefined} type="password" value={credential} onChange={(event) => setCredential(event.target.value)} />
          </>
        ) : null}
        <TextField id="a2a-timeout" label={t('a2a.timeout')} type="number" min={1000} max={300000} value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} required />
        <SwitchField id="a2a-enabled" label={t('a2a.enabled')} checked={enabled} onChange={setEnabled} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || name.trim().length === 0 || baseUrl.trim().length === 0}>
            {busy ? t('a2a.saving') : t('common.save')}
          </Button>
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
      {task.responseText ? <p className="mt-1 line-clamp-2 text-[var(--muted)]">{task.responseText}</p> : null}
    </li>
  );
}

export function agentSummary(agent: A2aAgentDTO): string {
  const versions = [agent.protocolVersion, agent.agentVersion].filter((value): value is string => Boolean(value));
  return [agent.status, ...versions].join(' · ');
}
