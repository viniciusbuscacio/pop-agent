import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
} from '@pop-agent/shared';
import { t } from '../i18n';
import { InstallationSection } from './installation-section';
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
import { Button, Card, SearchField, Select, SwitchField, TextArea, TextField, Pressable } from '../ui/controls';
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
      { id: 'audio', label: 'Audio', summary: 'Voice transcription and cleanup' },
      { id: 'general', label: 'Instructions', summary: 'Response preferences for every conversation' },
      { id: 'memory', label: 'Memory', summary: 'What Pop Agent knows about you' },
      { id: 'auto-skills', label: 'Auto-skills', summary: 'Reusable abilities learned from chats' },
    ],
  },
  {
    label: 'App',
    entries: [
      { id: 'appearance', label: 'Appearance', summary: 'Theme and text size' },
      { id: 'notifications', label: 'Notifications', summary: 'Push notification preferences' },
      { id: 'updates', label: 'Updates', summary: 'PWA, server and runtime versions' },
      { id: 'installation', label: 'Installation', summary: 'Install and connect your devices' },
    ],
  },
  {
    label: 'Data',
    entries: [
      { id: 'storage', label: 'Storage', summary: 'Space used by Pop Agent' },
      { id: 'backup', label: 'Backup', summary: 'Create, download and restore snapshots' },
    ],
  },
  {
    label: 'System',
    entries: [
      { id: 'server', label: 'Server & Connections', summary: 'Health, hardware and server actions' },
      { id: 'security', label: 'Security', summary: 'Password, passkeys and sessions' },
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
    navigate(`/settings?section=${next}`, { state: location.state });
  }

  // CSS owns the breakpoint as well as the layout. Separate controls ensure
  // the visible split view always gets desktop navigation, without asking a
  // native host's JavaScript matchMedia implementation to classify the window.
  function goBackOnPhone(): void {
    if (section !== undefined) navigate('/settings', { state: location.state });
    else navigate('/');
  }

  function goBackOnDesktop(): void {
    navigate(settingsReturnTo(location.state));
  }

  return (
    <div className="min-h-dvh max-w-full overflow-x-clip">
      <header
        data-testid="settings-header"
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] p-3"
      >
        <Pressable
          type="button"
          data-testid="settings-back-phone"
          aria-label={t('common.back')}
          onClick={goBackOnPhone}
          className="grid min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)] md:hidden"
        >
          ←
        </Pressable>
        <Pressable
          type="button"
          data-testid="settings-back-desktop"
          aria-label={t('common.back')}
          onClick={goBackOnDesktop}
          className="hidden min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)] md:grid"
        >
          ←
        </Pressable>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold md:hidden">{activeEntry?.label ?? 'Settings'}</h1>
          <h1 className="hidden text-lg font-semibold md:block">Settings</h1>
        </div>
      </header>

      <div
        data-testid="settings-layout"
        className="mx-auto grid w-full md:w-[95%] md:grid-cols-[21rem_minmax(0,1fr)]"
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
      className={`flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left ${divided ? 'border-t border-[var(--border)]' : ''} ${active ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'}`}
    >
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
        <SettingsIcon section={entry.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--screen-fg)]">{entry.label}</span>
        <span className="block truncate text-xs text-[var(--muted)]">{entry.summary}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-[var(--muted)]">›</span>
    </Pressable>
  );
}

function SettingsIcon({ section }: { section: Section }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (section === 'audio') return <svg {...common}><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3"/></svg>;
  if (section === 'notifications') return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (section === 'security') return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>;
  if (section === 'storage') return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>;
  if (section === 'backup') return <svg {...common}><path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6M12 11v5M9 14l3 3 3-3"/></svg>;
  if (section === 'updates') return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>;
  if (section === 'installation') return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 8v6M9 11l3 3 3-3"/></svg>;
  if (section === 'appearance') return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
  if (section === 'memory') return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23z"/></svg>;
  if (section === 'auto-skills') return <svg {...common}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>;
  if (section === 'general') return <svg {...common}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>;
  if (section === 'model') return <svg {...common}><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m7 7 3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/></svg>;
  if (section === 'server') return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>;
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
              <div className="flex max-w-full flex-wrap gap-1">
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
/** Background learning has one honest switch; safety is never optional. */
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

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <SwitchField
          id="settings-auto-skills-enabled"
          testId="settings-auto-skills-enabled"
          label={t('settings.autoSkills.enabled')}
          hint={t('settings.autoSkills.enabledHint')}
          checked={settings.autoSkillsEnabled}
          onChange={(autoSkillsEnabled) => save({ autoSkillsEnabled })}
        />

        <p className="text-sm text-[var(--muted)]">{t('settings.autoSkills.protections')}</p>
      </Card>
    </div>
  );
}

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
      <SwitchField
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
 * How the installed PWA notices a new build (pop-agent.spec §15). Device-scoped
 * like the theme and notifications: the interval lives in localStorage and
 * never reaches the server. "Check now" asks the service worker immediately.
 */
function AppUpdatesCard() {
  const checksEnabled = useUpdatesStore((state) => state.enabled);
  const intervalMinutes = useUpdatesStore((state) => state.intervalMinutes);
  const setChecksEnabled = useUpdatesStore((state) => state.setEnabled);
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
        <SwitchField
          id="updates-check-automatically"
          testId="updates-check-automatically"
          label={t('settings.updates.checkAutomatically')}
          hint={t('settings.updates.checkAutomaticallyHint')}
          checked={checksEnabled}
          onChange={setChecksEnabled}
        />
        {checksEnabled ? (
          <Select
            id="update-interval"
            data-testid="update-interval"
            label={t('settings.updates.checkFrequency')}
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
        ) : null}
      </div>
    </Card>
  );
}

function intervalLabel(minutes: number): string {
  if (minutes === 60) return t('settings.updates.everyHour');
  if (minutes < 60) return t('settings.updates.everyMinutes', { count: minutes });
  if (minutes < 1440) return t('settings.updates.everyHours', { count: minutes / 60 });
  return t('settings.updates.everyDay');
}

function idleLabel(minutes: number): string {
  return minutes === 60
    ? t('settings.updates.oneHourInactive')
    : t('settings.updates.minutesInactive', { count: minutes });
}

/** Web Push opt-in (pop-agent.spec §14). Device-scoped, like the theme. */
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
 * Settings → Updates (pop-agent.spec §15): device and server first, with the
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
  const [preparingPi, setPreparingPi] = useState(false);
  const [activatingPi, setActivatingPi] = useState(false);
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

  function saveAutomaticUpdate(patch: Partial<SettingsDTO>): void {
    if (appSettings === undefined) return;
    void settingsService
      .write({ ...appSettings, ...patch })
      .then(setAppSettings)
      .catch(() => undefined);
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

        {appSettings === undefined ? null : (
          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <SwitchField
              id="updates-auto-activate"
              testId="updates-auto-activate"
              label={t('settings.updates.activateAutomatically')}
              hint={t('settings.updates.autoActivateHint')}
              checked={appSettings.autoActivatePreparedUpdates}
              onChange={(checked) => saveAutomaticUpdate({ autoActivatePreparedUpdates: checked })}
            />
            {appSettings.autoActivatePreparedUpdates ? (
              <Select
                id="updates-idle-minutes"
                data-testid="updates-idle-minutes"
                label={t('settings.updates.restartAfter')}
                hint={t('settings.updates.idleMinutesHint')}
                value={String(appSettings.autoRestartIdleMinutes)}
                onChange={(event) =>
                  saveAutomaticUpdate({ autoRestartIdleMinutes: Number(event.target.value) })
                }
              >
                {[5, 10, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>{idleLabel(minutes)}</option>
                ))}
              </Select>
            ) : null}
          </div>
        )}

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
              value={appSettings.piUpdatePolicy}
              onChange={(event) =>
                saveAutomaticUpdate({
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
