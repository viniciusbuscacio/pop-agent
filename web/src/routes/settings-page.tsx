import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArchiveRestore,
  Bell,
  BookOpen,
  Database,
  Download,
  Info,
  LockKeyhole,
  Mic,
  MonitorDown,
  Network,
  Server as ServerIcon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import {
  compareVersions,
  type AboutResponse,
  type DistillerStatusDTO,
  type ServerInfoResponse,
  type SettingsDTO,
  type SkillDTO,
  type StorageResponse,
} from '@pop-agent/shared';
import { t } from '../i18n';
import { InstallationSection } from './installation-section';
import { ProvidersSection } from './providers-section';
import { BackupSection } from './backup-section';
import { ApiError, clientEnvironment } from '../services/api';
import { authService } from '../services/auth';
import { pendingRecovery } from '../services/pending-recovery';
import { session } from '../services/session';
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
import { BackButton, Button, Card, CheckField, SearchField, Select, SwitchField, TextArea, TextField, Pressable } from '../ui/controls';
import { RecoveryKeyPanel } from '../ui/recovery-key-panel';
import { relativeTime } from '../lib/time';
import { LOCAL_POP_AGENT_VERSION } from '../build-info';
import { lastActiveChatPath } from '../lib/last-active-chat';

/** Settings is route navigation, not a row of tabs. On phones the index and
 * section are separate screens; wide screens keep the index beside the open
 * section. Forms remain full-screen and never move into a drawer or modal. */
type Section =
  | 'server'
  | 'general'
  | 'installation'
  | 'model'
  | 'audio'
  | 'auto-skills'
  | 'memory'
  | 'storage'
  | 'backup'
  | 'appearance'
  | 'notifications'
  | 'updates'
  | 'security'
  | 'about';

type SettingsEntry = {
  id: Section;
  label: string;
  summary: string;
};

type SettingsGroup = { label: string; entries: SettingsEntry[] };

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Agent',
    entries: [
      { id: 'model', label: 'Models & Providers', summary: 'Choose how Pop Agent answers' },
      { id: 'general', label: 'Instructions', summary: 'Response preferences for every conversation' },
      { id: 'memory', label: 'Memory', summary: 'What Pop Agent knows about you' },
      { id: 'auto-skills', label: 'Auto-Skills', summary: 'Reusable abilities learned from chats' },
      { id: 'audio', label: 'Voice', summary: 'Voice transcription and cleanup' },
    ],
  },
  {
    label: 'App',
    entries: [
      { id: 'appearance', label: 'Appearance', summary: 'Theme and text size' },
      { id: 'notifications', label: 'Notifications', summary: 'Push notification preferences' },
      { id: 'installation', label: 'Devices & Installation', summary: 'Install and connect your devices' },
    ],
  },
  {
    label: 'Data',
    entries: [
      { id: 'storage', label: 'Storage', summary: 'Space used by Pop Agent' },
      { id: 'backup', label: 'Backup & Restore', summary: 'Create, download and restore snapshots' },
    ],
  },
  {
    label: 'System',
    entries: [
      { id: 'security', label: 'Security', summary: 'Password, passkeys and sessions' },
      { id: 'server', label: 'Server', summary: 'Health, hardware and server actions' },
      { id: 'updates', label: 'Updates', summary: 'PWA, server and runtime versions' },
      { id: 'about', label: 'About', summary: 'Version, licenses and project information' },
    ],
  },
];

const SETTINGS_ENTRIES = SETTINGS_GROUPS.flatMap((group) => group.entries);

function settingsReturnTo(state: unknown): string {
  const returnTo =
    typeof state === 'object' && state !== null && 'returnTo' in state
      ? (state as { returnTo?: unknown }).returnTo
      : undefined;
  if (
    typeof returnTo === 'string' &&
    returnTo.startsWith('/') &&
    !returnTo.startsWith('/settings')
  ) {
    return returnTo;
  }
  return lastActiveChatPath() ?? '/';
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // happy-dom's MemoryRouter does not inherit window.history; the fallback also
  // keeps old embedders that mount this route directly working.
  const requested = new URLSearchParams(location.search || window.location.search).get('section');
  const section = SETTINGS_ENTRIES.some((entry) => entry.id === requested)
    ? (requested as Section)
    : undefined;
  const [query, setQuery] = useState('');
  const activeEntry = SETTINGS_ENTRIES.find((entry) => entry.id === section);

  function openSection(next: Section): void {
    void navigate(`/settings?section=${next}`, { state: location.state });
  }

  // CSS owns the breakpoint as well as the layout. Separate controls ensure
  // the visible split view always gets desktop navigation, without asking a
  // native host's JavaScript matchMedia implementation to classify the window.
  function goBackOnPhone(): void {
    if (section !== undefined) void navigate('/settings', { state: location.state });
    else void navigate('/');
  }

  function goBackOnDesktop(): void {
    void navigate(settingsReturnTo(location.state));
  }

  return (
    <div className="min-h-dvh max-w-full overflow-x-clip">
      <header
        data-testid="settings-header"
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] p-3"
      >
        <BackButton data-testid="settings-back-phone" aria-label={t('common.back')} onClick={goBackOnPhone} className="md:hidden" />
        <BackButton data-testid="settings-back-desktop" aria-label={t('common.back')} onClick={goBackOnDesktop} className="hidden md:grid" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold md:hidden">{activeEntry?.label ?? 'Settings'}</h1>
          <h1 className="hidden text-lg font-semibold md:block">Settings</h1>
        </div>
      </header>

      <div
        data-testid="settings-layout"
        className="mx-auto grid w-full md:w-[98%] md:grid-cols-[21rem_minmax(0,1fr)]"
      >
        <SettingsIndex
          query={query}
          onQueryChange={setQuery}
          active={section}
          onOpen={openSection}
          className={section === undefined ? 'block' : 'hidden md:block'}
        />

        <main
          data-testid="settings-content"
          className={section === undefined ? 'hidden min-w-0 max-w-full md:block' : 'min-w-0 max-w-full p-4 md:p-6'}
        >
          {section === undefined ? (
            <div className="flex min-h-[60dvh] items-center justify-center p-8 text-center text-sm text-[var(--muted)]">
              Select a setting to view and change it.
            </div>
          ) : (
            <div data-testid="settings-section-content" className="min-w-0 w-full">
              <div className="mb-5 hidden md:block">
                <h2 className="text-xl font-semibold">{activeEntry?.label}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{activeEntry?.summary}</p>
              </div>
              <SettingsSection section={section} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SettingsIndex({
  query,
  onQueryChange,
  active,
  onOpen,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  active: Section | undefined;
  onOpen: (section: Section) => void;
  className: string;
}) {
  const needle = query.trim().toLowerCase();
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) =>
      `${entry.label} ${entry.summary} ${group.label}`.toLowerCase().includes(needle),
    ),
  })).filter((group) => group.entries.length > 0);

  return (
    <nav aria-label="Settings" className={`${className} min-w-0 max-w-full border-[var(--border)] p-4 md:min-h-[calc(100dvh-65px)] md:border-r md:p-5`}>
      <SearchField
        id="settings-search"
        aria-label="Search settings"
        placeholder="Search settings"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        className="mb-5 w-full"
      />
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {group.label}
            </h2>
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--panel-bg)]">
              {group.entries.map((entry, index) => (
                <SettingsRow
                  key={entry.id}
                  entry={entry}
                  active={active === entry.id}
                  divided={index > 0}
                  onClick={() => onOpen(entry.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">No settings found.</p>
        ) : null}
      </div>
    </nav>
  );
}

function SettingsRow({ entry, active, divided, onClick }: {
  entry: SettingsEntry;
  active: boolean;
  divided: boolean;
  onClick: () => void;
}) {
  return (
    <Pressable
      type="button"
      data-testid={`settings-tab-${entry.id}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left ${divided ? 'border-t border-[var(--border)]' : ''} hover:bg-[var(--notice-bg)] ${active ? 'bg-[var(--panel-hover)]' : ''}`}
    >
      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center ${active ? 'text-[var(--screen-fg)]' : 'text-[var(--key-fg-dim)]'}`}>
        <SettingsIcon section={entry.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${active ? 'text-[var(--screen-fg)]' : 'text-[var(--key-fg-dim)]'}`}>{entry.label}</span>
        <span className="block truncate text-xs text-[var(--muted)]">{entry.summary}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-[var(--muted)]">›</span>
    </Pressable>
  );
}

const SETTINGS_ICONS: Record<Section, LucideIcon> = {
  audio: Mic,
  notifications: Bell,
  security: LockKeyhole,
  storage: Database,
  backup: ArchiveRestore,
  updates: Download,
  installation: MonitorDown,
  appearance: Sun,
  memory: BookOpen,
  'auto-skills': Sparkles,
  general: SlidersHorizontal,
  model: Network,
  server: ServerIcon,
  about: Info,
};

function SettingsIcon({ section }: { section: Section }) {
  const Icon = SETTINGS_ICONS[section];
  return <Icon aria-hidden="true" size={19} strokeWidth={1.8} />;
}

function SettingsSection({ section }: { section: Section }): ReactNode {
  if (section === 'server') return <ServerSection />;
  if (section === 'general') return <InstructionsSection />;
  if (section === 'installation') return <InstallationSection />;
  if (section === 'model') return <ProvidersSection />;
  if (section === 'audio') return <AudioSection />;
  if (section === 'auto-skills') return <AutoSkillsSection />;
  if (section === 'memory') return <MemorySection />;
  if (section === 'storage') return <StorageSection />;
  if (section === 'backup') return <BackupSection />;
  if (section === 'appearance') return <AppearanceSection />;
  if (section === 'notifications') return <NotificationsSection />;
  if (section === 'updates') return <UpdatesSection />;
  if (section === 'security') return <SecuritySection />;
  return <AboutSection />;
}

function InstructionsSection() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    settingsService
      .read()
      .then((doc) => {
        setSettings(doc);
        setInstructions(doc.customInstructions);
      })
      .catch(() => setError(t('settings.general.loadFailed')));
  }, []);

  async function save(): Promise<void> {
    if (settings === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await settingsService.update({ customInstructions: instructions });
      setSettings(next);
      setSaved(true);
    } catch {
      setSaved(false);
      setError(t('settings.general.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
    <Card className="flex flex-col gap-4">
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
      {error === undefined ? null : <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    </Card>

    </div>
  );
}

/**
 * The living document Pop Agent keeps about the user (docs/specs/Spec-Pop-General.md §7). The agent
 * writes it through its tools; here the user can read, edit, and restore the
 * one-level backup.
 */
function MemorySection() {
  const [doc, setDoc] = useState('');
  const [savedDoc, setSavedDoc] = useState('');
  const [hasBackup, setHasBackup] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    settingsService
      .readMemory()
      .then((memory) => {
        setDoc(memory.doc);
        setSavedDoc(memory.doc);
        setHasBackup(memory.hasBackup);
      })
      .catch(() => setError(t('settings.memory.loadFailed')));
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const memory = await settingsService.writeMemory(doc);
      setDoc(memory.doc);
      setSavedDoc(memory.doc);
      setHasBackup(memory.hasBackup);
      setSaved(true);
    } catch {
      setSaved(false);
      setError(t('settings.memory.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function restore(): Promise<void> {
    if (!window.confirm(t('settings.memory.restoreConfirm'))) return;
    setBusy(true);
    setError(undefined);
    try {
      const memory = await settingsService.restoreMemory();
      setDoc(memory.doc);
      setSavedDoc(memory.doc);
      setHasBackup(memory.hasBackup);
      setSaved(false);
    } catch {
      setError(t('settings.memory.restoreFailed'));
    } finally {
      setBusy(false);
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
          <Button type="button" variant="ghost" data-testid="settings-memory-restore" disabled={busy} onClick={() => void restore()}>
            {t('settings.memory.restore')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          data-testid="settings-memory-cancel"
          disabled={busy || doc === savedDoc}
          onClick={() => {
            setDoc(savedDoc);
            setSaved(false);
            setError(undefined);
          }}
        >
          {t('common.cancel')}
        </Button>
        {saved ? <span className="text-sm text-[var(--success)]">{t('settings.general.saved')}</span> : null}
      </div>
      {error === undefined ? null : <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    </Card>
  );
}

/** Passkey / Face ID setup and management (docs/specs/Spec-Pop-General.md §9). */
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
      setError(t('settings.security.passkeyLoadFailed'));
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

  async function remove(credential: { id: string; label: string }): Promise<void> {
    const name = credential.label || credential.id.slice(0, 12);
    if (!window.confirm(t('settings.security.passkeyRemoveConfirm', { name }))) return;
    setBusy(true);
    setError(undefined);
    try {
      await passkeyService.remove(credential.id);
      await reload();
    } catch {
      setError(t('settings.security.passkeyRemoveFailed'));
    } finally {
      setBusy(false);
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
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove(credential)}>
            {t('settings.security.passkeyRemove')}
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

/**
 * Where the disk went (docs/specs/Spec-Pop-General.md §14). Measurement before any quota: a limit
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
 * Skills management (docs/specs/Spec-Pop-General.md §8). A list, and a full-screen editor when you
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

      {/* One discreet line, never a card: this only says when Pop Agent last
          looked and how much is waiting on the reader. */}
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
              </div>
              <p className="truncate text-sm text-[var(--muted)]">{skill.description}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {skill.useCount === undefined || skill.useCount === 0
                  ? t('skills.neverUsed')
                  : t('skills.used', { count: skill.useCount })}
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-1">
              <Button type="button" variant="ghost" onClick={() => setEditing(skill)}>
                {t('skills.edit')}
              </Button>
              {skill.source === 'builtin' ? null : (
                <Button type="button" variant="danger" onClick={() => void remove(skill)}>
                  {t('skills.delete')}
                </Button>
              )}
            </div>
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

  return status.lastRunAt === undefined
    ? t('skills.distiller.never')
    : t('skills.distiller.lastRun', { when: relativeTime(status.lastRunAt) });
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
 * The optional LLM pass over a raw transcript (docs/specs/Spec-Pop-General.md §14). Off by default
 * (decision of 31/07): the raw text lands in the composer in whisper time;
 * turning this on trades ~10s+ per note for punctuation fixes.
 */
/** Background learning has one honest switch; safety is never optional. */
function AutoSkillsSection() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void settingsService
      .read()
      .then(setSettings)
      .catch(() => setSettings(undefined));
  }, []);

  if (settings === undefined) return null;

  async function save(patch: Partial<SettingsDTO>): Promise<void> {
    if (settings === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSettings(await settingsService.update(patch));
    } catch {
      setError(t('settings.autoSkills.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <SwitchField
          id="settings-auto-skills-enabled"
          testId="settings-auto-skills-enabled"
          label={t('settings.autoSkills.enabled')}
          hint={t('settings.autoSkills.enabledHint')}
          disabled={busy}
          checked={settings.autoSkillsEnabled}
          onChange={(autoSkillsEnabled) => void save({ autoSkillsEnabled })}
        />

        <p className="text-sm text-[var(--muted)]">{t('settings.autoSkills.protections')}</p>
        {error === undefined ? null : <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
      </Card>
    </div>
  );
}

function VoiceCleanupCard() {
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

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
    if (settings === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSettings(await settingsService.update(next));
    } catch {
      setError(t('settings.general.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) return null;

  return (
    <Card className="flex flex-col gap-3">
      <SwitchField
        id="voice-cleanup-toggle"
        testId="voice-cleanup-toggle"
        label={t('voice.cleanup')}
        hint={t('voice.cleanupNote')}
        disabled={busy}
        checked={settings.voiceCleanup}
        onChange={(checked) => void save({ voiceCleanup: checked })}
      />
      {settings.voiceCleanup ? (
        <Select
          id="voice-cleanup-model"
          data-testid="voice-cleanup-model"
          label={t('voice.cleanupModel')}
          value={settings.voiceCleanupModel}
          disabled={busy}
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
      {error === undefined ? null : <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    </Card>
  );
}

/** The whisper model for voice transcription (docs/specs/Spec-Pop-General.md §14). */
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
        <Select
          id="settings-theme"
          data-testid="settings-theme"
          label={t('settings.appearance.theme')}
          value={choice}
          onChange={(event) => setChoice(event.target.value as ThemeChoice)}
        >
          <option value="system">{t('settings.appearance.system')}</option>
          <option value="light">{t('settings.appearance.light')}</option>
          <option value="dark">{t('settings.appearance.dark')}</option>
        </Select>
        <p className="text-xs text-[var(--muted)]">{t('settings.appearance.note')}</p>
      </Card>

      <FontSizeCard />
    </div>
  );
}

/** Device-scoped like the theme: the root font-size, remembered per device. */
function FontSizeCard() {
  const choice = useFontStore((state) => state.choice);
  const setChoice = useFontStore((state) => state.setChoice);

  return (
    <Card className="flex flex-col gap-4">
      <Select
        id="settings-font-size"
        data-testid="settings-font-size"
        label={t('settings.appearance.fontSize')}
        value={choice}
        onChange={(event) => setChoice(event.target.value as FontSizeChoice)}
      >
        <option value="small">{t('settings.appearance.fontSmall')}</option>
        <option value="default">{t('settings.appearance.fontDefault')}</option>
        <option value="large">{t('settings.appearance.fontLarge')}</option>
        <option value="xlarge">{t('settings.appearance.fontXlarge')}</option>
        <option value="huge">{t('settings.appearance.fontHuge')}</option>
      </Select>
      <p className="text-xs text-[var(--muted)]">{t('settings.appearance.fontNote')}</p>
    </Card>
  );
}

/**
 * How the installed PWA notices a new build (docs/specs/Spec-Pop-General.md §15).
 * Automatic checks and activation are fixed product behavior; "Check now"
 * remains available for an immediate manual check.
 */
function AppUpdatesCard() {
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);
  const client = clientEnvironment();

  async function updateNow(): Promise<void> {
    setChecking(true);
    setResult(undefined);
    try {
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
    } catch {
      setResult(t('settings.updates.applyFailed'));
    } finally {
      setChecking(false);
      setApplying(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{client.deviceLabel}</h2>
        <p className="text-xs text-[var(--muted)]">
          {client.kind === 'pwa'
            ? t('settings.updates.deviceSubtitleInstalled', { device: client.deviceLabel.toLowerCase() })
            : t('settings.updates.deviceSubtitleBrowser', { device: client.deviceLabel.toLowerCase() })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Row label={t('settings.updates.appType')} value={client.appLabel} testId="update-local-kind" />
        <Row
          label={t('settings.updates.localVersion')}
          value={LOCAL_POP_AGENT_VERSION}
          testId="update-local-version"
        />
      </div>
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
              : t('settings.updates.checkForUpdates')}
        </Button>
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
        <Row
          label={t('settings.updates.checkAutomatically')}
          value={t('settings.updates.everyMinutes', { count: 10 })}
          testId="updates-automatic-status"
        />
        <p className="text-xs text-[var(--muted)]">{t('settings.updates.automaticApplyHint')}</p>
      </div>
    </Card>
  );
}

/** Web Push opt-in (docs/specs/Spec-Pop-General.md §14). Device-scoped, like the theme. */
function NotificationsSection() {
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
      {supported ? (
        <SwitchField
          id="notifications-toggle"
          testId="notifications-toggle"
          disabled={busy}
          checked={subscribed}
          onChange={() => void toggle()}
          label={t('settings.notifications.title')}
          hint={t('settings.notifications.note')}
        />
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
  const [issuedKey, setIssuedKey] = useState<string | undefined>(() =>
    pendingRecovery.read('change-password'),
  );
  const [recoverySaved, setRecoverySaved] = useState(false);

  const canSubmit = current.length > 0 && next.length >= 10 && next === confirmation && !busy;

  async function changePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // The reply carries a token on the new epoch, so this device stays in.
      const { token, recoveryKey } = await authService.changePassword(current, next);
      session.refresh(token);
      pendingRecovery.write('change-password', recoveryKey);
      setIssuedKey(recoveryKey);
      setRecoverySaved(false);
      setCurrent('');
      setNext('');
      setConfirmation('');
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
    if (!window.confirm(t('settings.security.signOutOthersConfirm'))) return;
    try {
      const { token } = await authService.signOutOthers();
      session.refresh(token);
      setNotice(t('settings.security.signedOutOthers'));
    } catch {
      setError(t('error.generic'));
    }
  }

  if (issuedKey !== undefined) {
    return (
      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold">{t('recover.newKeyTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--key-fg-dim)]">{t('recover.newKeyBody')}</p>
        </div>
        <RecoveryKeyPanel recoveryKey={issuedKey} idPrefix="password-change" />
        <CheckField
          id="password-change-saved-key"
          testId="password-change-saved-key"
          label={t('setup.recovery.confirm')}
          checked={recoverySaved}
          onChange={setRecoverySaved}
        />
        <div>
          <Button
            type="button"
            disabled={!recoverySaved}
            onClick={() => {
              pendingRecovery.clear();
              setIssuedKey(undefined);
              setNotice(t('settings.security.passwordChanged'));
            }}
          >
            {t('common.continue')}
          </Button>
        </div>
      </Card>
    );
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
              void navigate('/login');
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
 * Settings → Updates (docs/specs/Spec-Pop-General.md §15): device and server first, with the
 * AI runtime behind an advanced disclosure. The shell still fetches/builds
 * commits; once a clean committed checkout differs
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
  const [cancellingDeployment, setCancellingDeployment] = useState(false);
  const [preparingPi, setPreparingPi] = useState(false);
  const [activatingPi, setActivatingPi] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | undefined>(undefined);
  const [appSettings, setAppSettings] = useState<SettingsDTO | undefined>(undefined);
  const [savingSetting, setSavingSetting] = useState(false);

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
  const piCandidateBusy =
    update?.pi.candidate?.phase === 'installing' ||
    update?.pi.candidate?.phase === 'validating' ||
    update?.pi.candidate?.phase === 'waiting-idle' ||
    update?.pi.candidate?.phase === 'activating' ||
    update?.pi.candidate?.phase === 'rolling-back';

  useEffect(() => {
    if (!deploymentBusy && !piCandidateBusy) return;
    const timer = setInterval(() => void load(false), 2_000);
    return () => clearInterval(timer);
  }, [deploymentBusy, piCandidateBusy]);

  async function saveAutomaticUpdate(patch: Partial<SettingsDTO>): Promise<void> {
    if (appSettings === undefined || savingSetting) return;
    setSavingSetting(true);
    setRefreshNote(undefined);
    try {
      setAppSettings(await settingsService.update(patch));
    } catch {
      setRefreshNote(t('settings.updates.settingFailed'));
    } finally {
      setSavingSetting(false);
    }
  }

  async function preparePiCandidate(): Promise<void> {
    setPreparingPi(true);
    setRefreshNote(undefined);
    try {
      const result = await settingsService.preparePiCandidate();
      if (result.ok) {
        setUpdate((current) =>
          current === undefined
            ? current
            : { ...current, pi: { ...current.pi, candidate: result.candidate } },
        );
      }
    } catch {
      setRefreshNote(t('settings.updates.piPrepareFailed'));
    } finally {
      setPreparingPi(false);
    }
  }

  async function activatePiCandidate(): Promise<void> {
    if (!window.confirm(t('settings.updates.piActivateConfirm'))) return;
    setActivatingPi(true);
    setRefreshNote(undefined);
    try {
      const result = await settingsService.activatePiCandidate();
      if (result.ok) {
        setUpdate((current) =>
          current === undefined
            ? current
            : { ...current, pi: { ...current.pi, candidate: result.candidate } },
        );
      }
    } catch {
      setRefreshNote(t('settings.updates.piActivateFailed'));
    } finally {
      setActivatingPi(false);
    }
  }

  async function restartWhenIdle(): Promise<void> {
    if (!window.confirm(t('settings.updates.restartConfirm'))) return;
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

  async function cancelRestart(): Promise<void> {
    setCancellingDeployment(true);
    setRefreshNote(undefined);
    try {
      await settingsService.cancelRestart();
      await load(false);
      setRefreshNote(t('settings.updates.restartCancelled'));
    } catch {
      setRefreshNote(t('settings.updates.cancelFailed'));
    } finally {
      setCancellingDeployment(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AppUpdatesCard />

      {refreshNote !== undefined ? (
        <p role="status" data-testid="update-refresh-result" className="text-sm text-[var(--muted)]">
          {refreshNote}
        </p>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.updates.yourServer')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('settings.updates.serverSubtitle')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Row
            label={t('settings.updates.serverVersion')}
            value={update?.popAgent.current ?? '…'}
            testId="update-pop-agent-version"
          />
          <Row
            label={t('settings.updates.serverBuild')}
            value={deployment?.runningCommit ?? '…'}
            testId="update-pop-agent-current"
          />
          <Row
            label={t('settings.updates.serverStatus')}
            value={deployment === undefined ? '…' : t(`settings.updates.status.${deployment.phase}`)}
            testId="update-deployment-phase"
          />
          <Row
            label={t('settings.updates.availableUpdate')}
            value={popAgentOutdated ? (update?.popAgent.latest ?? '…') : t('settings.updates.none')}
            testId="update-server-available"
          />
          {deployment?.pending ? (
            <Row
              label={t('settings.updates.readyToActivate')}
              value={deployment.headCommit}
              testId="update-head-commit"
            />
          ) : null}
        </div>

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
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="update-restart-when-idle"
              disabled={!deployment.clean || !deployment.prepared || deploymentBusy || deploying}
              onClick={() => void restartWhenIdle()}
            >
              {deploymentBusy || deploying
                ? t('settings.updates.waitingForIdle')
                : t('settings.updates.restartWhenIdle')}
            </Button>
            {deployment.phase === 'waiting-idle' ? (
              <Button
                type="button"
                variant="ghost"
                data-testid="update-cancel-restart"
                disabled={cancellingDeployment}
                onClick={() => void cancelRestart()}
              >
                {t('settings.updates.cancelRestart')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div>
          <Button
            type="button"
            variant="ghost"
            data-testid="update-refresh-server"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? t('settings.updates.refreshingServer') : t('settings.updates.checkServerUpdates')}
          </Button>
        </div>

        <details className="border-t border-[var(--border)] pt-4">
          <summary className="cursor-pointer text-sm font-medium">{t('settings.updates.manualUpdate')}</summary>
          <div className="mt-3 flex flex-col gap-3">
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
          </div>
        </details>
      </Card>

      <details className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
        <summary data-testid="update-ai-runtime" className="cursor-pointer text-base font-semibold">
          {t('settings.updates.aiRuntime')} · <span className="text-[var(--muted)]">{t('settings.updates.advanced')}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Row
              label={t('settings.updates.piActive')}
              value={update?.pi.current ?? '…'}
              testId="update-pi-current"
            />
            <Row
              label={t('settings.updates.piRecommended')}
              value={update?.pi.recommended ?? '…'}
              testId="update-pi-recommended"
            />
            <Row
              label={t('settings.updates.piLatest')}
              value={update?.pi.latest ?? t('settings.updates.unknown')}
              testId="update-pi-latest"
            />
          </div>
          {piOutdated ? (
            <p data-testid="update-pi-available" className="text-sm text-[var(--accent)]">
              {t('settings.updates.piAvailable', { version: update?.pi.latest ?? '' })}
            </p>
          ) : null}
          {appSettings === undefined ? null : (
            <Select
              id="updates-pi-policy"
              data-testid="updates-pi-policy"
              label={t('settings.updates.updatePolicy')}
              hint={t(`settings.updates.piPolicyHint.${appSettings.piUpdatePolicy}`)}
              disabled={savingSetting}
              value={appSettings.piUpdatePolicy}
              onChange={(event) =>
                void saveAutomaticUpdate({
                  piUpdatePolicy: event.target.value as SettingsDTO['piUpdatePolicy'],
                })
              }
            >
              <option value="keep-current">{t('settings.updates.piPolicy.keepCurrent')}</option>
              <option value="recommended">{t('settings.updates.piPolicy.recommended')}</option>
              <option value="latest">{t('settings.updates.piPolicy.latest')}</option>
            </Select>
          )}
          <p className="text-xs text-[var(--muted)]">{t('settings.updates.piPolicyPhaseTwo')}</p>
          {update?.pi.candidate === undefined || update.pi.candidate.phase === 'idle' ? null : (
            <p
              data-testid="update-pi-candidate-status"
              className={update.pi.candidate.phase === 'failed' ? 'text-xs text-[var(--danger)]' : 'text-xs text-[var(--muted)]'}
            >
              {t(`settings.updates.piCandidate.${update.pi.candidate.phase}`, {
                version: update.pi.candidate.version ?? '',
              })}
              {update.pi.candidate.error === undefined ? '' : ` ${update.pi.candidate.error}`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="update-pi-prepare"
              disabled={
                preparingPi ||
                activatingPi ||
                piCandidateBusy ||
                appSettings?.piUpdatePolicy === 'keep-current'
              }
              onClick={() => void preparePiCandidate()}
            >
              {preparingPi || update?.pi.candidate?.phase === 'installing' || update?.pi.candidate?.phase === 'validating'
                ? t('settings.updates.piPreparing')
                : t('settings.updates.piPrepare')}
            </Button>
            {update?.pi.candidate?.phase === 'ready' ? (
              <Button
                type="button"
                data-testid="update-pi-activate"
                disabled={activatingPi}
                onClick={() => void activatePiCandidate()}
              >
                {activatingPi
                  ? t('settings.updates.piActivating')
                  : t('settings.updates.piActivate')}
              </Button>
            ) : null}
          </div>
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
        <Row label={t('settings.server.popAgent')} value={info ? `${info.popAgentVersion} (${info.commit})` : '…'} testId="server-pop-agent" />
      </Card>

      <Card className="flex flex-col gap-3">
        <Row label={t('settings.server.db')} value={info && info.dbBytes !== null ? formatBytes(info.dbBytes) : '…'} testId="server-db" />
        <Row label={t('settings.server.workspaceSize')} value={info && info.workspaceBytes !== null ? formatBytes(info.workspaceBytes) : '…'} testId="server-workspace" />
        <Row label={t('settings.server.dataDir')} value={info?.dataDir ?? '…'} testId="server-datadir" />
        <Row label={t('settings.server.workspace')} value={info?.workspace ?? '…'} testId="server-workspace-path" />
      </Card>

      <ServerSoftwareCard />
      <DangerZoneSection llmStopped={info?.llmStopped === true} />
    </div>
  );
}

function ServerSoftwareCard() {
  const [software, setSoftware] = useState<import('@pop-agent/shared').UpdateStatusResponse | undefined>(undefined);

  useEffect(() => {
    void settingsService.updateStatus(false).then(setSoftware).catch(() => undefined);
  }, []);

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{t('settings.server.software')}</h2>
        <p className="text-xs text-[var(--muted)]">{t('settings.server.softwareHint')}</p>
      </div>
      <Row label="Node" value={software?.node ?? '…'} testId="server-node" />
      {(software?.environment ?? []).map((tool) => (
        <Row key={tool.name} label={tool.name} value={tool.version} testId={`server-software-${tool.name}`} />
      ))}
    </Card>
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
    <Card variant="danger" className="flex flex-col gap-4">
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
    <div className="flex min-w-0 items-start justify-between gap-4 text-sm">
      <span className="min-w-0 text-[var(--key-fg-dim)]">{label}</span>
      <span data-testid={testId} className="min-w-0 break-words text-right font-mono text-[var(--muted)]">
        {value}
      </span>
    </div>
  );
}
