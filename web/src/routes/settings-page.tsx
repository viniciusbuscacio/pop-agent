import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  compareVersions,
  type AboutResponse,
  type DistillerStatusDTO,
  type ModelCatalogSource,
  type ModelDTO,
  type ServerInfoResponse,
  type SettingsDTO,
  type SkillDTO,
  type StorageResponse,
  type UsageResponse,
} from '@pop-agent/shared';
import { t } from '../i18n';
import { ProvidersSection } from './providers-section';
import { ApiError, clientEnvironment } from '../services/api';
import { authService } from '../services/auth';
import { backupsService } from '../services/backups';
import { chatsService } from '../services/chats';
import { passkeyService } from '../services/passkey';
import { pushService } from '../services/push';
import { voiceService, type VoiceModelStatus } from '../services/voice';
import { serverService } from '../services/server';
import { settingsService } from '../services/settings';
import { skillsService } from '../services/skills';
import { SkillEditor } from './skill-editor';
import { applyUpdate, checkForUpdateNow } from '../services/pwa-update';
import { useAuthStore } from '../store/auth';
import { useFontStore, type FontSizeChoice } from '../store/font';
import { useThemeStore, type ThemeChoice } from '../store/theme';
import { UPDATE_INTERVAL_OPTIONS, useUpdatesStore } from '../store/updates';
import { Button, Card, CheckField, Segmented, Select, TextArea, TextField } from '../ui/controls';
import { relativeTime } from '../lib/time';
import { LOCAL_POP_AGENT_VERSION } from '../build-info';

/**
 * Settings as a full screen with a back button -- never a drawer or a modal
 * (permanent house veto, pop-agent.spec §14). Sections sit on the left on a wide
 * screen and become a row of tabs when there is no room for a column.
 */

type Section =
  | 'server'
  | 'general'
  | 'model'
  | 'audio'
  | 'auto-skills'
  | 'memory'
  | 'usage'
  | 'storage'
  | 'backup'
  | 'appearance'
  | 'updates'
  | 'security'
  | 'about';

const SECTIONS: { id: Section; labelKey: Parameters<typeof t>[0] }[] = [
  { id: 'server', labelKey: 'settings.section.server' },
  { id: 'general', labelKey: 'settings.section.general' },
  { id: 'model', labelKey: 'settings.section.model' },
  { id: 'audio', labelKey: 'settings.section.audio' },
  { id: 'auto-skills', labelKey: 'settings.section.autoSkills' },
  { id: 'memory', labelKey: 'settings.section.memory' },
  { id: 'usage', labelKey: 'settings.section.usage' },
  { id: 'storage', labelKey: 'settings.section.storage' },
  { id: 'backup', labelKey: 'settings.section.backup' },
  { id: 'appearance', labelKey: 'settings.section.appearance' },
  { id: 'updates', labelKey: 'settings.section.updates' },
  { id: 'security', labelKey: 'settings.section.security' },
  { id: 'about', labelKey: 'settings.section.about' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  // A push notification deep-links here with ?section=updates (pop-agent.spec §15).
  const requested = new URLSearchParams(window.location.search).get('section');
  const [section, setSection] = useState<Section>(
    SECTIONS.some((entry) => entry.id === requested) ? (requested as Section) : 'general',
  );

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <button
          type="button"
          data-testid="settings-back"
          aria-label={t('common.back')}
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:w-[90%] md:max-w-none md:flex-row">
        <nav className="flex gap-1 overflow-x-auto md:w-48 md:shrink-0 md:flex-col">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`settings-tab-${entry.id}`}
              aria-current={section === entry.id}
              onClick={() => setSection(entry.id)}
              className={
                section === entry.id
                  ? 'rounded-md bg-[var(--accent)] px-3 py-2 text-left text-sm text-[var(--accent-fg)]'
                  : 'rounded-md px-3 py-2 text-left text-sm text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]'
              }
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>

        {/*
          `min-w-0` is load-bearing, not decoration. A flex item defaults to
          `min-width: auto`, so without it this column refuses to shrink below
          the widest thing inside it -- one long skill description was enough
          to push the whole page wider than the window, which put a horizontal
          scrollbar on Settings and scrolled the nav off the left edge. It also
          means `truncate` inside a section never fires: the column yields
          instead of the text being cut.
        */}
        <div className="min-w-0 flex-1">
          {section === 'server' ? <ServerSection /> : null}
          {section === 'general' ? <GeneralSection /> : null}
          {section === 'model' ? <ProvidersSection /> : null}
          {section === 'audio' ? <AudioSection /> : null}
          {section === 'auto-skills' ? <AutoSkillsSection /> : null}
          {section === 'memory' ? <MemorySection /> : null}
          {section === 'usage' ? <UsageSection /> : null}
          {section === 'storage' ? <StorageSection /> : null}
          {section === 'backup' ? <BackupSection /> : null}
          {section === 'appearance' ? <AppearanceSection /> : null}
          {section === 'updates' ? <UpdatesSection /> : null}
          {section === 'security' ? <SecuritySection /> : null}
          {section === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    settingsService
      .read()
      .then((doc) => {
        setSettings(doc);
        setInstructions(doc.customInstructions);
      })
      .catch(() => setSettings(undefined));
  }, []);

  async function save(): Promise<void> {
    if (settings === undefined) return;
    setBusy(true);
    try {
      const next = await settingsService.write({ ...settings, customInstructions: instructions });
      setSettings(next);
      setSaved(true);
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
    <Card className="flex flex-col gap-4">
      <Select
        id="settings-language"
        data-testid="settings-language"
        label={t('settings.general.language')}
        defaultValue="en"
        className="w-48"
      >
        <option value="en">English</option>
      </Select>

      <TextArea
        id="settings-instructions"
        data-testid="settings-instructions"
        label={t('settings.general.instructions')}
        hint={t('settings.general.instructionsHint')}
        rows={5}
        maxLength={4000}
        value={instructions}
        onChange={(event) => {
          setInstructions(event.target.value);
          setSaved(false);
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          data-testid="settings-general-save"
          disabled={busy || settings === undefined}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setInstructions(settings?.customInstructions ?? '');
            setSaved(false);
          }}
        >
          {t('common.cancel')}
        </Button>
        {saved ? <span className="text-sm text-[var(--success)]">{t('settings.general.saved')}</span> : null}
      </div>
    </Card>

    {/* Which model does the work nobody asked for -- titles, summaries. It
        used to sit under Model, which is now only about providers (Vinicius,
        03/08). It is a background behaviour, so it lives with the other
        general ones rather than being dropped along with the old screen. */}
    <CatalogSourceCard />
    </div>
  );
}

/**
 * The living document Pop Agent keeps about the user (pop-agent.spec §7). The agent
 * writes it through its tools; here the user can read, edit, and restore the
 * one-level backup.
 */
function MemorySection() {
  const [doc, setDoc] = useState('');
  const [hasBackup, setHasBackup] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    settingsService
      .readMemory()
      .then((memory) => {
        setDoc(memory.doc);
        setHasBackup(memory.hasBackup);
      })
      .catch(() => undefined);
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const memory = await settingsService.writeMemory(doc);
      setDoc(memory.doc);
      setHasBackup(memory.hasBackup);
      setSaved(true);
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  async function restore(): Promise<void> {
    try {
      const memory = await settingsService.restoreMemory();
      setDoc(memory.doc);
      setHasBackup(memory.hasBackup);
    } catch {
      // Leave what is on screen; the next open tells the truth.
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <TextArea
        id="settings-memory"
        data-testid="settings-memory"
        label={t('settings.memory.label')}
        hint={t('settings.memory.hint')}
        rows={10}
        maxLength={8000}
        value={doc}
        placeholder={t('settings.memory.empty')}
        onChange={(event) => {
          setDoc(event.target.value);
          setSaved(false);
        }}
        className="font-mono text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" data-testid="settings-memory-save" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        {hasBackup ? (
          <Button type="button" variant="ghost" data-testid="settings-memory-restore" onClick={() => void restore()}>
            {t('settings.memory.restore')}
          </Button>
        ) : null}
        {saved ? <span className="text-sm text-[var(--success)]">{t('settings.general.saved')}</span> : null}
      </div>
    </Card>
  );
}

/** Passkey / Face ID setup and management (pop-agent.spec §9). */
function PasskeyControls() {
  const [supported] = useState(() => passkeyService.supported());
  const [credentials, setCredentials] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (supported) void reload();
  }, [supported]);

  async function reload(): Promise<void> {
    try {
      setCredentials((await passkeyService.list()).credentials);
    } catch {
      // Leave the list.
    }
  }

  async function register(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await passkeyService.register('This device');
      await reload();
    } catch {
      setError(t('settings.security.passkeyFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await passkeyService.remove(id);
      await reload();
    } catch {
      // Ignore.
    }
  }

  if (!supported) {
    return <p className="text-xs text-[var(--muted)]">{t('settings.security.passkeyUnsupported')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('settings.security.passkeys')}</h3>
      {credentials.map((credential) => (
        <div key={credential.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-[var(--muted)]">{credential.label || credential.id.slice(0, 12)}</span>
          <Button type="button" variant="ghost" onClick={() => void remove(credential.id)}>
            {t('common.cancel')}
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="ghost" data-testid="passkey-register" disabled={busy} onClick={() => void register()}>
          {t('settings.security.passkeyAdd')}
        </Button>
      </div>
      {error !== undefined ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Backup and restore (pop-agent.spec §16). */
function BackupSection() {
  const [backups, setBackups] = useState<import('@pop-agent/shared').BackupDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      setBackups((await backupsService.list()).backups);
    } catch {
      // Leave the list.
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      await backupsService.create();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function download(name: string): Promise<void> {
    const blob = await backupsService.download(name);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function restore(name: string): Promise<void> {
    try {
      await backupsService.restore(name);
      setNotice(t('backup.restored'));
    } catch {
      setNotice(t('error.generic'));
    }
  }

  async function remove(name: string): Promise<void> {
    try {
      await backupsService.remove(name);
      await reload();
    } catch {
      // Ignore.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('backup.intro')}</p>
        <div>
          <Button type="button" data-testid="backup-create" disabled={busy} onClick={() => void create()}>
            {busy ? t('backup.creating') : t('backup.create')}
          </Button>
        </div>
        {notice !== undefined ? (
          <p role="status" className="text-sm text-[var(--success)]">
            {notice}
          </p>
        ) : null}
      </Card>

      {backups.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t('backup.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {backups.map((backup) => (
            <Card key={backup.name} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-[var(--key-fg-dim)]">{backup.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {(backup.size / 1024).toFixed(0)} KB · {backup.createdAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              <div className="flex flex-none gap-1">
                <Button type="button" variant="ghost" onClick={() => void download(backup.name)}>
                  {t('backup.download')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void restore(backup.name)}>
                  {t('backup.restore')}
                </Button>
                <Button type="button" variant="danger" onClick={() => void remove(backup.name)}>
                  {t('backup.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** The cost dashboard (pop-agent.spec §14), read off llm_runs. */
function UsageSection() {
  const [usage, setUsage] = useState<UsageResponse | undefined>(undefined);

  useEffect(() => {
    settingsService
      .usage()
      .then(setUsage)
      .catch(() => setUsage(undefined));
  }, []);

  if (usage === undefined) {
    return <Card>{t('app.loading')}</Card>;
  }

  const dollars = (value: number): string => `$${value.toFixed(4)}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('usage.intro')}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label={t('usage.totalCost')} value={dollars(usage.total.cost)} testId="usage-total" />
          <Stat label={t('usage.runs')} value={String(usage.total.runs)} />
          <Stat
            label={t('usage.tokens')}
            value={`${usage.total.tokensIn} / ${usage.total.tokensOut}`}
          />
        </div>
      </Card>

      {usage.byModel.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t('usage.empty')}</p>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t('usage.byModel')}</h2>
            {usage.byModel.map((row) => (
              <div key={row.model} className="flex justify-between gap-4 text-sm">
                <span className="truncate font-mono text-[var(--key-fg-dim)]">{row.model}</span>
                <span className="text-[var(--muted)]">
                  {row.runs} · {dollars(row.cost)}
                </span>
              </div>
            ))}
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t('usage.byDay')}</h2>
            {usage.byDay.map((row) => (
              <div key={row.day} className="flex justify-between gap-4 text-sm">
                <span className="font-mono text-[var(--key-fg-dim)]">{row.day}</span>
                <span className="text-[var(--muted)]">{dollars(row.cost)}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Where the disk went (pop-agent.spec §14). Measurement before any quota: a limit
 * chosen without this screen is a guess, and the guess is usually wrong about
 * which line is the expensive one. Sorted heaviest first for the same reason
 * -- the answer to "what is eating my disk" should be the first row, not
 * something the reader has to find.
 */
function StorageSection() {
  const [storage, setStorage] = useState<StorageResponse | undefined>(undefined);

  useEffect(() => {
    settingsService
      .storage()
      .then(setStorage)
      .catch(() => setStorage(undefined));
  }, []);

  if (storage === undefined) return <Card>{t('app.loading')}</Card>;

  const rows = [...storage.entries].sort((left, right) => right.bytes - left.bytes);
  const largest = rows[0]?.bytes ?? 0;
  const usedPercent =
    storage.disk === undefined || storage.disk.totalBytes === 0
      ? undefined
      : Math.round(((storage.disk.totalBytes - storage.disk.freeBytes) / storage.disk.totalBytes) * 100);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('storage.intro')}</p>
        <div className="grid grid-cols-2 gap-3 text-center">
          <Stat label={t('storage.total')} value={bytes(storage.totalBytes)} testId="storage-total" />
          <Stat
            label={t('storage.free')}
            value={storage.disk === undefined ? '—' : bytes(storage.disk.freeBytes)}
          />
        </div>
        {usedPercent === undefined ? null : (
          <p className="text-xs text-[var(--muted)]">
            {t('storage.diskUsed', { percent: usedPercent, total: bytes(storage.disk?.totalBytes ?? 0) })}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1" data-testid={`storage-${row.key}`}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-medium">{t(`storage.key.${row.key}` as 'storage.key.files')}</span>
              <span className="shrink-0 text-[var(--muted)]">
                {bytes(row.bytes)}
                {/* A count beside a zero reads as a bug rather than as a
                    fact: 1 item weighing 0 B is a version row whose copy is
                    not on disk, which this screen cannot explain in four
                    words. The size is the honest part; show only that. */}
                {row.count === undefined || row.bytes === 0
                  ? ''
                  : ` · ${t('storage.items', { count: row.count })}`}
              </span>
            </div>
            {/* A bar against the biggest line, not against the disk: the point
                is which of these is the heavy one relative to the others. */}
            <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--hover-overlay)]">
              <span
                className="block h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${String(largest === 0 ? 0 : Math.max((row.bytes / largest) * 100, 1))}%` }}
              />
            </span>
            <span className="text-xs text-[var(--muted)]">
              {t(`storage.hint.${row.key}` as 'storage.hint.files')}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Sizes people read: three significant digits and the unit they expect. */
function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(size) : size.toFixed(size >= 100 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span data-testid={testId} className="text-lg font-semibold text-[var(--screen-fg)]">
        {value}
      </span>
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </div>
  );
}

/**
 * Skills management (pop-agent.spec §8). A list, and a full-screen editor when you
 * create or edit one -- never a side drawer (permanent house veto). Built-in
 * skills can be edited but not deleted.
 */
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [archived, setArchived] = useState<SkillDTO[]>([]);
  const [distiller, setDistiller] = useState<DistillerStatusDTO | undefined>(undefined);
  const [editing, setEditing] = useState<SkillDTO | 'new' | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const response = await skillsService.list();
      setSkills(response.skills);
      setArchived(response.archived);
      setDistiller(response.distiller);
    } catch {
      // Leave what is on screen.
    }
  }

  /** Every yes and no on this screen ends the same way: ask the server again. */
  async function act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await reload();
    } catch {
      // Ignore; the list is authoritative on the next load.
    }
  }

  async function approve(skill: SkillDTO): Promise<void> {
    await act(() => skillsService.approve(skill.slug));
  }

  async function remove(skill: SkillDTO): Promise<void> {
    await act(() => skillsService.remove(skill.slug));
  }

  if (editing !== undefined) {
    return (
      <SkillEditor
        skill={editing === 'new' ? undefined : editing}
        onDone={() => {
          setEditing(undefined);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('skills.intro')}</p>
        <div>
          <Button type="button" data-testid="skill-new" onClick={() => setEditing('new')}>
            {t('skills.new')}
          </Button>
        </div>
      </Card>

      {/* One discreet line, never a card: the money already has a home in
          Settings → Usage, so all this has to say is when Pop Agent last looked and
          how much is waiting on the reader. */}
      {distiller === undefined ? null : (
        <p data-testid="distiller-status" className="text-xs text-[var(--muted)]">
          {distillerLine(distiller)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {skills.map((skill) => (
          <Card key={skill.slug} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{skill.name}</span>
                {skill.source === 'builtin' ? (
                  <span className="rounded bg-[var(--panel-bg)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                    {t('skills.builtin')}
                  </span>
                ) : null}
                {skill.source === 'auto' ? (
                  <span className="rounded bg-[var(--panel-bg)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                    {t('skills.auto')}
                  </span>
                ) : null}
                {skill.pending === true ? (
                  <span
                    data-testid="skill-pending-badge"
                    className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs"
                  >
                    {t('skills.pending')}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-sm text-[var(--muted)]">{skill.description}</p>
              {skill.pending === true ? (
                <p className="mt-1 text-xs text-[var(--muted)]">{t('skills.pendingNote')}</p>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {skill.useCount === undefined || skill.useCount === 0
                    ? t('skills.neverUsed')
                    : t('skills.used', { count: skill.useCount })}
                </p>
              )}
            </div>
            <div className="flex flex-none flex-wrap gap-1">
              {skill.pending === true ? (
                <Button type="button" data-testid="skill-approve" onClick={() => void approve(skill)}>
                  {t('skills.approve')}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setEditing(skill)}>
                {t('skills.edit')}
              </Button>
              {skill.source === 'builtin' ? null : (
                <Button type="button" variant="danger" onClick={() => void remove(skill)}>
                  {t('skills.delete')}
                </Button>
              )}
            </div>
            {skill.proposedRevision === undefined ? null : (
              <div
                data-testid="skill-revision"
                className="w-full rounded border border-[var(--border)] p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs">
                    {t('skills.revision')}
                  </span>
                  <span className="truncate text-sm">{skill.proposedRevision.description}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{t('skills.revisionNote')}</p>
                {/* The proposal in full, because "accept" is not a decision
                    anyone can make from a summary. */}
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--muted)]">
                  {skill.proposedRevision.body}
                </pre>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    type="button"
                    data-testid="skill-revision-approve"
                    onClick={() => void act(() => skillsService.approveRevision(skill.slug))}
                  >
                    {t('skills.revisionApprove')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void act(() => skillsService.discardRevision(skill.slug))}
                  >
                    {t('skills.revisionDiscard')}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {archived.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('skills.archived')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('skills.archivedNote')}</p>
          {archived.map((skill) => (
            <Card
              key={skill.slug}
              data-testid="skill-archived"
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">{skill.name}</span>
                <p className="truncate text-sm text-[var(--muted)]">{skill.description}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void act(() => skillsService.restore(skill.slug))}
              >
                {t('skills.restore')}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The status line's text. Two facts at most: when Pop Agent last read a
 * conversation, and how much is waiting on the reader -- joined only when both
 * are worth saying.
 */
function distillerLine(status: DistillerStatusDTO): string {
  if (!status.enabled) return t('skills.distiller.off');

  const waiting = status.pending + status.revisions;
  const when =
    status.lastRunAt === undefined
      ? t('skills.distiller.never')
      : t('skills.distiller.lastRun', { when: relativeTime(status.lastRunAt) });
  return waiting === 0 ? when : `${when} · ${t('skills.distiller.waiting', { count: waiting })}`;
}

/** How fresh the catalog is, said plainly (aw's source label). */
const CATALOG_SOURCE_KEYS: Record<ModelCatalogSource, Parameters<typeof t>[0]> = {
  live: 'provider.source.live',
  cache: 'provider.source.cache',
  engine: 'provider.source.engine',
  static: 'provider.source.static',
};

/**
 * The providers and the models (pop-agent.spec §15). One card picks the global
 * default pair; below it, one card per provider carries its write-only key,
 * its key test and its default model. Provider is data: the list comes from
 * GET /v1/providers, never hardcoded here.
 */
/**
 * Where the model catalogue came from -- live, cached, or the engine's offline
 * list. It used to also carry the global Service Model picker; that moved onto
 * each provider's own card on 07/08 (pop-agent.spec §15), because one model id
 * cannot be right for every provider at once. What is left is the diagnosis.
 */
function CatalogSourceCard() {
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [source, setSource] = useState<ModelCatalogSource | undefined>(undefined);

  useEffect(() => {
    void chatsService
      .models()
      .then((catalog) => {
        setModels(catalog.models);
        setSource(catalog.source);
      })
      .catch(() => setModels([]));
  }, []);

  return (
    <Card className="flex flex-col gap-4">
      {source !== undefined ? (
        <p data-testid="catalog-source" className="text-xs text-[var(--muted)]">
          {t('provider.modelsInfo', {
            count: models.length,
            source: t(CATALOG_SOURCE_KEYS[source]),
          })}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * One provider: its write-only key (the placeholder says "configured", the
 * stored value is never read back), the test that proves a key works, and
 * its default model. The custom provider also carries its endpoint URL.
 */
function AudioSection() {
  return (
    <div className="flex flex-col gap-4">
      <VoiceModelCard />
      <VoiceCleanupCard />
    </div>
  );
}

/**
 * The optional LLM pass over a raw transcript (pop-agent.spec §14). Off by default
 * (decision of 31/07): the raw text lands in the composer in whisper time;
 * turning this on trades ~10s+ per note for punctuation fixes.
 */
/** The three background-learning policies live in Settings, not in the inbox they fill. */
function AutoSkillsSection() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);

  useEffect(() => {
    void settingsService
      .read()
      .then(setSettings)
      .catch(() => setSettings(undefined));
  }, []);

  if (settings === undefined) return null;

  /** Every control here writes the whole document; the API replaces, not merges. */
  function save(patch: Partial<SettingsDTO>): void {
    if (settings === undefined) return;
    void settingsService
      .write({ ...settings, ...patch })
      .then(setSettings)
      .catch(() => undefined);
  }

  const modeHint =
    settings.autoSkillMode === 'disabled'
      ? t('settings.autoSkills.disabledHint')
      : settings.autoSkillMode === 'medium'
        ? t('settings.autoSkills.mediumHint')
        : t('settings.autoSkills.fullHint');

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <Select
          id="settings-auto-skill-mode"
          data-testid="settings-auto-skill-mode"
          label={t('settings.autoSkills.mode')}
          hint={modeHint}
          className="w-full max-w-md"
          value={settings.autoSkillMode}
          onChange={(event) => save({
            autoSkillMode: event.target.value as SettingsDTO['autoSkillMode'],
          })}
        >
          <option value="disabled">{t('settings.autoSkills.disabled')}</option>
          <option value="medium">{t('settings.autoSkills.medium')}</option>
          <option value="full">{t('settings.autoSkills.full')}</option>
        </Select>

        <p className="text-sm text-[var(--muted)]">{t('settings.autoSkills.protections')}</p>
      </Card>

      {settings.autoSkillMode === 'disabled' ? null : (
        <Card>
          <Select
            id="skills-distill-interval"
            data-testid="skills-distill-interval"
            label={t('skills.distillInterval')}
            hint={t('skills.distillIntervalNote')}
            className="w-48"
            value={String(settings.distillIntervalMinutes)}
            onChange={(event) => save({ distillIntervalMinutes: Number(event.target.value) })}
          >
            {DISTILL_INTERVALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('skills.distillEvery', { minutes })}
              </option>
            ))}
          </Select>
        </Card>
      )}
    </div>
  );
}

/** How often the distiller may look. One conversation per tick, so this is the bill. */
const DISTILL_INTERVALS = [10, 30, 60, 360, 1440];

function VoiceCleanupCard() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    void settingsService
      .read()
      .then(setSettings)
      .catch(() => setSettings(undefined));
    void chatsService
      .models()
      .then(({ models: available }) => setModels(available.map((model) => model.id)))
      .catch(() => setModels([]));
  }, []);

  async function save(next: Partial<SettingsDTO>): Promise<void> {
    if (settings === undefined) return;
    const written = await settingsService.write({ ...settings, ...next });
    setSettings(written);
  }

  if (settings === undefined) return null;

  return (
    <Card className="flex flex-col gap-3">
      <CheckField
        id="voice-cleanup-toggle"
        testId="voice-cleanup-toggle"
        label={t('voice.cleanup')}
        hint={t('voice.cleanupNote')}
        checked={settings.voiceCleanup}
        onChange={(checked) => void save({ voiceCleanup: checked })}
      />
      {settings.voiceCleanup ? (
        <Select
          id="voice-cleanup-model"
          data-testid="voice-cleanup-model"
          label={t('voice.cleanupModel')}
          value={settings.voiceCleanupModel}
          onChange={(event) => void save({ voiceCleanupModel: event.target.value })}
          className="w-full max-w-md"
        >
          <option value="">{t('voice.cleanupModelDefault')}</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </Select>
      ) : null}
    </Card>
  );
}

/** The whisper model for voice transcription (pop-agent.spec §14). */
function VoiceModelCard() {
  const [status, setStatus] = useState<VoiceModelStatus[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const result = await voiceService.models();
      setStatus(result.models);
      setSelected(result.selected);
    } catch {
      // Leave what is shown.
    }
  }

  async function choose(name: string): Promise<void> {
    setBusy(true);
    setNote(t('voice.installing'));
    try {
      await voiceService.select(name);
      setSelected(name);
      setNote(undefined);
      await reload();
    } catch {
      setNote(t('voice.installFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <Select
        id="voice-model"
        data-testid="voice-model"
        label={t('voice.model')}
        value={selected}
        disabled={busy}
        onChange={(event) => void choose(event.target.value)}
        className="w-full max-w-md"
        hint={t('voice.hint')}
      >
        {status.map((model) => (
          <option key={model.name} value={model.name}>
            {model.name} · {model.approxMb} MB
            {model.installed ? '' : ` · ${t('voice.notInstalled')}`}
          </option>
        ))}
      </Select>
      {note !== undefined ? <p className="text-xs text-[var(--muted)]">{note}</p> : null}
    </Card>
  );
}


function AppearanceSection() {
  const choice = useThemeStore((state) => state.choice);
  const setChoice = useThemeStore((state) => state.setChoice);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <span className="text-sm text-[var(--key-fg-dim)]">{t('settings.appearance.theme')}</span>
        <Segmented<ThemeChoice>
          ariaLabel={t('settings.appearance.theme')}
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'system', label: t('settings.appearance.system'), testId: 'settings-theme-system' },
            { value: 'light', label: t('settings.appearance.light'), testId: 'settings-theme-light' },
            { value: 'dark', label: t('settings.appearance.dark'), testId: 'settings-theme-dark' },
          ]}
        />
        <p className="text-xs text-[var(--muted)]">{t('settings.appearance.note')}</p>
      </Card>

      <FontSizeCard />
      <NotificationsCard />
    </div>
  );
}

/** Device-scoped like the theme: the root font-size, remembered per device. */
function FontSizeCard() {
  const choice = useFontStore((state) => state.choice);
  const setChoice = useFontStore((state) => state.setChoice);

  return (
    <Card className="flex flex-col gap-4">
      <span className="text-sm text-[var(--key-fg-dim)]">{t('settings.appearance.fontSize')}</span>
      <Segmented<FontSizeChoice>
        ariaLabel={t('settings.appearance.fontSize')}
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'small', label: t('settings.appearance.fontSmall'), testId: 'settings-font-small' },
          { value: 'default', label: t('settings.appearance.fontDefault'), testId: 'settings-font-default' },
          { value: 'large', label: t('settings.appearance.fontLarge'), testId: 'settings-font-large' },
          { value: 'xlarge', label: t('settings.appearance.fontXlarge'), testId: 'settings-font-xlarge' },
          { value: 'huge', label: t('settings.appearance.fontHuge'), testId: 'settings-font-huge' },
        ]}
      />
      <p className="text-xs text-[var(--muted)]">{t('settings.appearance.fontNote')}</p>
    </Card>
  );
}

/**
 * How the installed PWA notices a new build (pop-agent.spec §15). Device-scoped
 * like the theme and notifications: the interval lives in localStorage and
 * never reaches the server. "Check now" asks the service worker immediately.
 */
function AppUpdatesCard() {
  const intervalMinutes = useUpdatesStore((state) => state.intervalMinutes);
  const setIntervalMinutes = useUpdatesStore((state) => state.setIntervalMinutes);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);
  const client = clientEnvironment();

  async function updateNow(): Promise<void> {
    setChecking(true);
    setResult(undefined);
    const outcome = await checkForUpdateNow();
    setChecking(false);

    if (outcome === 'update-found') {
      setApplying(true);
      setResult(t('settings.updates.applying'));
      await applyUpdate();
      return;
    }

    setResult(
      outcome === 'up-to-date'
        ? t('settings.updates.current')
        : t('settings.updates.checkUnavailable'),
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{client.deviceLabel}</h2>
        <p className="text-xs text-[var(--muted)]">{t('settings.updates.deviceSubtitle')}</p>
      </div>
      <Row label={t('settings.updates.appType')} value={client.appLabel} testId="update-local-kind" />
      <Row
        label={t('settings.updates.localVersion')}
        value={LOCAL_POP_AGENT_VERSION}
        testId="update-local-version"
      />
      {result !== undefined ? (
        <p role="status" data-testid="update-check-result" className="text-sm text-[var(--muted)]">
          {result}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="ghost"
          data-testid="update-check-now"
          disabled={checking || applying}
          onClick={() => void updateNow()}
        >
          {applying
            ? t('settings.updates.applying')
            : checking
              ? t('settings.updates.checking')
              : t('settings.updates.checkAndUpdate')}
        </Button>
      </div>
      <Select
        id="update-interval"
        data-testid="update-interval"
        label={t('settings.updates.automaticChecks')}
        value={intervalMinutes}
        onChange={(event) => setIntervalMinutes(Number(event.target.value))}
        className="w-full max-w-xs"
      >
        {UPDATE_INTERVAL_OPTIONS.map((minutes) => (
          <option key={minutes} value={minutes}>
            {intervalLabel(minutes)}
          </option>
        ))}
      </Select>
      <p className="text-xs text-[var(--muted)]">{t('settings.updates.deviceNote')}</p>
    </Card>
  );
}

function intervalLabel(minutes: number): string {
  if (minutes === 60) return t('settings.updates.everyHour');
  if (minutes < 60) return t('settings.updates.everyMinutes', { count: minutes });
  if (minutes < 1440) return t('settings.updates.everyHours', { count: minutes / 60 });
  return t('settings.updates.everyDay');
}

/** Web Push opt-in (pop-agent.spec §14). Device-scoped, like the theme. */
function NotificationsCard() {
  const [supported] = useState(() => pushService.supported());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushService.isSubscribed().then(setSubscribed);
  }, []);

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      if (subscribed) {
        await pushService.disable();
        setSubscribed(false);
      } else {
        setSubscribed(await pushService.enable());
      }
    } catch {
      // Leave the state; the next open reflects the truth.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <span className="text-sm text-[var(--key-fg-dim)]">{t('settings.notifications.title')}</span>
      {supported ? (
        <>
          <div>
            <Button type="button" data-testid="notifications-toggle" disabled={busy} onClick={() => void toggle()}>
              {subscribed ? t('settings.notifications.disable') : t('settings.notifications.enable')}
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)]">{t('settings.notifications.note')}</p>
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">{t('settings.notifications.unsupported')}</p>
      )}
    </Card>
  );
}

function SecuritySection() {
  const navigate = useNavigate();
  const signOut = useAuthStore((state) => state.signOut);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const canSubmit = current.length > 0 && next.length >= 10 && next === confirmation && !busy;

  async function changePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // The reply carries a token on the new epoch, so this device stays in.
      const { token } = await authService.changePassword(current, next);
      useAuthStore.getState().signIn(token, true);
      setCurrent('');
      setNext('');
      setConfirmation('');
      setNotice(t('settings.security.passwordChanged'));
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'invalid_credentials'
          ? t('login.invalid')
          : t('error.generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOutOthers(): Promise<void> {
    try {
      const { token } = await authService.signOutOthers();
      useAuthStore.getState().signIn(token, true);
      setNotice(t('settings.security.signedOutOthers'));
    } catch {
      setError(t('error.generic'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form className="flex flex-col gap-4" onSubmit={(event) => void changePassword(event)}>
          <h2 className="text-base font-semibold">{t('settings.security.changePassword')}</h2>

          <TextField
            id="settings-current-password"
            data-testid="settings-current-password"
            type="password"
            autoComplete="current-password"
            label={t('settings.security.currentPassword')}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <TextField
            id="settings-new-password"
            data-testid="settings-new-password"
            type="password"
            autoComplete="new-password"
            label={t('settings.security.newPassword')}
            hint={t('setup.password.hint')}
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <TextField
            id="settings-confirm-password"
            data-testid="settings-confirm-password"
            type="password"
            autoComplete="new-password"
            label={t('settings.security.confirmPassword')}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          {error !== undefined ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          {notice !== undefined ? (
            <p role="status" className="text-sm text-[var(--success)]">
              {notice}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" data-testid="settings-change-password" disabled={!canSubmit}>
              {t('common.save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCurrent('');
                setNext('');
                setConfirmation('');
                setError(undefined);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t('settings.security.signOutOthers')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('settings.security.signOutOthersBody')}</p>
        <div>
          <Button
            type="button"
            variant="ghost"
            data-testid="settings-sign-out-others"
            onClick={() => void signOutOthers()}
          >
            {t('settings.security.signOutOthers')}
          </Button>
        </div>
        <PasskeyControls />
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <Button
            type="button"
            variant="danger"
            data-testid="settings-sign-out"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            {t('settings.security.signOut')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Settings → Updates (pop-agent.spec §15): three cards, one per channel. The
 * shell still fetches/builds commits; once a clean committed checkout differs
 * from the boot commit, this screen can drain work and hand activation to the
 * external restart/health/rollback supervisor.
 */
function UpdatesSection() {
  const [update, setUpdate] = useState<import('@pop-agent/shared').UpdateStatusResponse | undefined>(
    undefined,
  );
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | undefined>(undefined);
  const [appSettings, setAppSettings] = useState<SettingsDTO | undefined>(undefined);

  async function load(refresh: boolean): Promise<void> {
    if (refresh) {
      setRefreshing(true);
      setRefreshNote(undefined);
    }
    try {
      setUpdate(await settingsService.updateStatus(refresh));
      if (refresh) setRefreshNote(t('settings.updates.refreshed'));
    } catch {
      if (refresh) setRefreshNote(t('settings.updates.refreshFailed'));
      // During a supervised restart the server is expected to disappear for a
      // moment. Keep the last truthful deployment card while polling it back.
    } finally {
      if (refresh) setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(false);
    void settingsService.read().then(setAppSettings).catch(() => undefined);
  }, []);

  const popAgentOutdated =
    update?.popAgent.latest !== undefined &&
    compareVersions(update.popAgent.latest, update.popAgent.current) > 0;
  const piOutdated =
    update?.pi.latest !== undefined && compareVersions(update.pi.latest, update.pi.current) > 0;
  const deployment = update?.deployment;
  const deploymentBusy =
    deployment?.phase === 'waiting-idle' ||
    deployment?.phase === 'restarting' ||
    deployment?.phase === 'rolling-back';

  useEffect(() => {
    if (!deploymentBusy) return;
    const timer = setInterval(() => void load(false), 2_000);
    return () => clearInterval(timer);
  }, [deploymentBusy]);

  function saveAutomaticUpdate(patch: Partial<SettingsDTO>): void {
    if (appSettings === undefined) return;
    void settingsService
      .write({ ...appSettings, ...patch })
      .then(setAppSettings)
      .catch(() => undefined);
  }

  async function restartWhenIdle(): Promise<void> {
    setDeploying(true);
    setRefreshNote(undefined);
    try {
      const result = await settingsService.restartWhenIdle();
      if (result.ok) {
        setUpdate((current) =>
          current === undefined ? current : { ...current, deployment: result.deployment },
        );
        setRefreshNote(t('settings.updates.restartScheduled'));
      }
    } catch {
      setRefreshNote(t('settings.updates.restartFailed'));
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AppUpdatesCard />

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('settings.updates.yourServer')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('settings.updates.serverSubtitle')}</p>
        </div>
        <Row
          label={t('settings.updates.runningNow')}
          value={
            update === undefined
              ? '…'
              : `${update.popAgent.current} · ${deployment?.runningCommit ?? 'unknown'}`
          }
          testId="update-pop-agent-current"
        />
        {deployment?.pending ? (
          <Row
            label={t('settings.updates.readyToActivate')}
            value={`${update?.popAgent.current ?? '…'} · ${deployment.headCommit}`}
            testId="update-head-commit"
          />
        ) : null}
        {deployment !== undefined ? (
          <p
            data-testid="update-deployment-phase"
            className={deployment.pending ? 'text-sm text-[var(--accent)]' : 'text-sm text-[var(--muted)]'}
          >
            {t(`settings.updates.phase.${deployment.phase}`)}
          </p>
        ) : null}
        {deployment?.clean === false ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t('settings.updates.dirtyTree')}
          </p>
        ) : null}
        {deployment?.error !== undefined ? (
          <p role="alert" className="text-xs text-[var(--danger)]">{deployment.error}</p>
        ) : null}
        {deployment?.failedRef !== undefined ? (
          <p className="text-xs text-[var(--muted)]">
            {t('settings.updates.failedRef', { ref: deployment.failedRef })}
          </p>
        ) : null}
        {deployment?.pending ? (
          <div>
            <Button
              type="button"
              data-testid="update-restart-when-idle"
              disabled={!deployment.clean || deploymentBusy || deploying}
              onClick={() => void restartWhenIdle()}
            >
              {deploymentBusy || deploying
                ? t('settings.updates.waitingForIdle')
                : t('settings.updates.restartWhenIdle')}
            </Button>
          </div>
        ) : null}

        {appSettings === undefined ? null : (
          <div className="mt-1 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <CheckField
              id="updates-auto-activate"
              testId="updates-auto-activate"
              label={t('settings.updates.autoActivate')}
              hint={t('settings.updates.autoActivateHint')}
              checked={appSettings.autoActivatePreparedUpdates}
              onChange={(checked) => saveAutomaticUpdate({ autoActivatePreparedUpdates: checked })}
            />
            {appSettings.autoActivatePreparedUpdates ? (
              <Select
                id="updates-idle-minutes"
                data-testid="updates-idle-minutes"
                label={t('settings.updates.idleMinutes')}
                hint={t('settings.updates.idleMinutesHint')}
                value={String(appSettings.autoRestartIdleMinutes)}
                onChange={(event) =>
                  saveAutomaticUpdate({ autoRestartIdleMinutes: Number(event.target.value) })
                }
              >
                {[5, 10, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes}</option>
                ))}
              </Select>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <Button
            type="button"
            variant="ghost"
            data-testid="update-refresh-server"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? t('settings.updates.refreshingServer') : t('settings.updates.refreshServer')}
          </Button>
          {refreshNote !== undefined ? (
            <p role="status" data-testid="update-refresh-result" className="text-xs text-[var(--muted)]">
              {refreshNote}
            </p>
          ) : null}
        </div>
      </Card>

      <details className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-6">
        <summary className="cursor-pointer text-base font-semibold">{t('settings.updates.advanced')}</summary>
        <div className="mt-4 flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('settings.updates.publishedReleases')}</h3>
            {popAgentOutdated ? (
              <p data-testid="update-pop-agent-available" className="text-sm text-[var(--accent)]">
                {t('settings.updates.popAgentAvailable', { version: update?.popAgent.latest ?? '' })}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">{t('settings.updates.noNewerRelease')}</p>
            )}
            <p className="text-xs text-[var(--muted)]">{t('settings.updates.notifyNote')}</p>
          </section>

          <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-semibold">{t('settings.updates.runtimeComponents')}</h3>
            <Row label="pi" value={update?.pi.current ?? '…'} testId="update-pi-current" />
            {piOutdated ? (
              <p data-testid="update-pi-available" className="text-sm text-[var(--accent)]">
                {t('settings.updates.piAvailable', { version: update?.pi.latest ?? '' })}
              </p>
            ) : null}
            <Row label="Node" value={update?.node ?? '…'} testId="update-node" />
            {(update?.environment ?? []).map((tool) => (
              <Row key={tool.name} label={tool.name} value={tool.version} testId={`env-${tool.name}`} />
            ))}
            <p className="text-xs text-[var(--muted)]">{t('settings.updates.envNote')}</p>
          </section>

          <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-semibold">{t('settings.updates.manualUpdate')}</h3>
            <p className="text-xs text-[var(--muted)]">{t('settings.updates.how')}</p>
            <pre className="overflow-x-auto rounded bg-[var(--input-bg)] p-2 font-mono text-xs">
              {update?.updateCommand ?? '…'}
            </pre>
            <div>
              <Button
                type="button"
                variant="ghost"
                data-testid="update-copy-command"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(update?.updateCommand ?? '')
                    .then(() => setCopied(true));
                }}
              >
                {copied ? t('settings.updates.copied') : t('settings.updates.copy')}
              </Button>
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

function ServerSection() {
  const [info, setInfo] = useState<ServerInfoResponse | undefined>(undefined);

  useEffect(() => {
    serverService
      .info()
      .then(setInfo)
      .catch(() => setInfo(undefined));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <Row label={t('settings.server.cpu')} value={info ? `${info.cpu.model} (${info.cpu.cores})` : '…'} testId="server-cpu" />
        <Row
          label={t('settings.server.load')}
          value={info ? info.cpu.load.map((n) => n.toFixed(2)).join(' / ') : '…'}
          testId="server-load"
        />
        <Row label={t('settings.server.memory')} value={info ? `${formatBytes(info.memory.used)} / ${formatBytes(info.memory.total)}` : '…'} testId="server-memory" />
        <Row
          label={t('settings.server.disk')}
          value={info && info.disk.free !== null && info.disk.total !== null ? `${formatBytes(info.disk.free)} ${t('settings.server.freeOf')} ${formatBytes(info.disk.total)}` : '…'}
          testId="server-disk"
        />
        <Row label={t('settings.server.uptime')} value={info ? formatDuration(info.uptimeSeconds) : '…'} testId="server-uptime" />
        <Row label={t('settings.server.processUptime')} value={info ? formatDuration(info.processUptimeSeconds) : '…'} testId="server-process-uptime" />
      </Card>

      <Card className="flex flex-col gap-3">
        <Row label={t('settings.server.time')} value={info ? new Date(info.serverTime).toLocaleString() : '…'} testId="server-time" />
        <Row label={t('settings.server.timezone')} value={info?.timezone ?? '…'} testId="server-timezone" />
        <Row label={t('settings.server.node')} value={info?.nodeVersion ?? '…'} testId="server-node" />
        <Row label={t('settings.server.popAgent')} value={info ? `${info.popAgentVersion} (${info.commit})` : '…'} testId="server-pop-agent" />
      </Card>

      <Card className="flex flex-col gap-3">
        <Row label={t('settings.server.db')} value={info && info.dbBytes !== null ? formatBytes(info.dbBytes) : '…'} testId="server-db" />
        <Row label={t('settings.server.workspaceSize')} value={info && info.workspaceBytes !== null ? formatBytes(info.workspaceBytes) : '…'} testId="server-workspace" />
        <Row label={t('settings.server.dataDir')} value={info?.dataDir ?? '…'} testId="server-datadir" />
        <Row label={t('settings.server.workspace')} value={info?.workspace ?? '…'} testId="server-workspace-path" />
      </Card>

      <DangerZoneSection llmStopped={info?.llmStopped === true} />
    </div>
  );
}

/**
 * Four switches on two different machines, which is exactly why each one
 * carries its own consequence line: "Restart Pop Agent" and "Restart LLM" share a
 * verb and share nothing else. The LLM button is also labelled by the actual
 * state -- Start when it is off, Restart when it is on -- because a switch
 * that reads "Restart" while the model is stopped is the confusion this card
 * kept causing (Vinicius, 05/08).
 */
function DangerZoneSection({ llmStopped: reported }: { llmStopped: boolean }) {
  const [busy, setBusy] = useState<string | undefined>(undefined);
  // The reported state arrives with the info fetch; a click updates it
  // locally so the label follows the action without another round trip.
  const [llmStopped, setLlmStopped] = useState(reported);
  useEffect(() => setLlmStopped(reported), [reported]);

  async function act(action: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(action);
    try {
      await fn();
    } catch {
      // The service dying mid-answer is the expected path for restart/stop.
    } finally {
      setBusy(undefined);
    }
  }

  const hint = (text: string) => <p className="text-xs text-[var(--muted)]">{text}</p>;

  return (
    <Card className="flex flex-col gap-4 border-[var(--danger)]">
      <h3 className="text-sm font-semibold text-[var(--danger)]">{t('settings.server.dangerZone')}</h3>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t('settings.server.dangerService')}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="danger"
            disabled={busy !== undefined}
            data-testid="server-restart"
            onClick={() => {
              if (!window.confirm(t('settings.server.restartConfirm'))) return;
              void act('restart', () => serverService.restart());
            }}
          >
            {t('settings.server.restart')}
          </Button>
          {hint(t('settings.server.restartHint'))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="danger"
            disabled={busy !== undefined}
            data-testid="server-stop"
            onClick={() => {
              if (!window.confirm(t('settings.server.stopConfirm1'))) return;
              if (!window.confirm(t('settings.server.stopConfirm2'))) return;
              void act('stop', () => serverService.stop());
            }}
          >
            {t('settings.server.stop')}
          </Button>
          {hint(t('settings.server.stopHint'))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t('settings.server.dangerLlm')}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={busy !== undefined || llmStopped}
            data-testid="server-llm-stop"
            onClick={() => {
              if (!window.confirm(t('settings.server.llmStopConfirm'))) return;
              void act('llm-stop', async () => {
                await serverService.llmStop();
                setLlmStopped(true);
              });
            }}
          >
            {t('settings.server.llmStop')}
          </Button>
          {hint(t('settings.server.llmStopHint'))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={busy !== undefined}
            data-testid="server-llm-start"
            onClick={() =>
              void act('llm-start', async () => {
                await serverService.llmStart();
                setLlmStopped(false);
              })
            }
          >
            {llmStopped ? t('settings.server.llmStart') : t('settings.server.llmRestart')}
          </Button>
          {hint(
            llmStopped ? t('settings.server.llmStartHint') : t('settings.server.llmRestartHint'),
          )}
        </div>
      </div>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function AboutSection() {
  const [about, setAbout] = useState<AboutResponse | undefined>(undefined);

  useEffect(() => {
    settingsService
      .about()
      .then(setAbout)
      .catch(() => setAbout(undefined));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <Row label={t('settings.about.popAgent')} value={about?.popAgentVersion ?? '…'} testId="about-pop-agent" />
        <Row label={t('settings.about.node')} value={about?.nodeVersion ?? '…'} testId="about-node" />
        <Row label={t('settings.about.pi')} value={about?.piVersion ?? '…'} testId="about-pi" />
        <a
          href="https://github.com/viniciusbuscacio/pop-agent"
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-[var(--accent)] underline underline-offset-2"
        >
          {t('settings.about.repo')}
        </a>
        <p className="text-xs text-[var(--muted)]">{t('settings.about.iconCredit')}</p>
      </Card>

    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-[var(--key-fg-dim)]">{label}</span>
      <span data-testid={testId} className="font-mono text-[var(--muted)]">
        {value}
      </span>
    </div>
  );
}
