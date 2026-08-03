import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AboutResponse,
  ProviderCreditsResponse,
  ModelCatalogSource,
  ModelDTO,
  ProvidersResponse,
  ProviderStatusDTO,
  ServerInfoResponse,
  SettingsDTO,
  SkillDTO,
  UsageResponse,
} from '@popy/shared';
import { t } from '../i18n';
import { OAuthSection } from './oauth-section';
import { PriorityList } from './priority-list';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { backupsService } from '../services/backups';
import { chatsService } from '../services/chats';
import { normalizeBaseUrl, providersService } from '../services/providers';
import { passkeyService } from '../services/passkey';
import { pushService } from '../services/push';
import { voiceService, type VoiceModelStatus } from '../services/voice';
import { serverService } from '../services/server';
import { settingsService } from '../services/settings';
import { skillsService } from '../services/skills';
import { checkForUpdateNow } from '../services/pwa-update';
import { useAuthStore } from '../store/auth';
import { useFontStore, type FontSizeChoice } from '../store/font';
import { useThemeStore, type ThemeChoice } from '../store/theme';
import { UPDATE_INTERVAL_OPTIONS, useUpdatesStore } from '../store/updates';
import { Button, Card, CheckField, Segmented, Select, TextArea, TextField } from '../ui/controls';

/**
 * Settings as a full screen with a back button -- never a drawer or a modal
 * (permanent house veto, popy.spec §14). Sections sit on the left on a wide
 * screen and become a row of tabs when there is no room for a column.
 */

type Section =
  | 'server'
  | 'general'
  | 'model'
  | 'memory'
  | 'usage'
  | 'backup'
  | 'appearance'
  | 'updates'
  | 'security'
  | 'about';

const SECTIONS: { id: Section; labelKey: Parameters<typeof t>[0] }[] = [
  { id: 'server', labelKey: 'settings.section.server' },
  { id: 'general', labelKey: 'settings.section.general' },
  { id: 'model', labelKey: 'settings.section.model' },
  { id: 'memory', labelKey: 'settings.section.memory' },
  { id: 'usage', labelKey: 'settings.section.usage' },
  { id: 'backup', labelKey: 'settings.section.backup' },
  { id: 'appearance', labelKey: 'settings.section.appearance' },
  { id: 'updates', labelKey: 'settings.section.updates' },
  { id: 'security', labelKey: 'settings.section.security' },
  { id: 'about', labelKey: 'settings.section.about' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  // A push notification deep-links here with ?section=updates (popy.spec §15).
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
          {section === 'model' ? <ModelSection /> : null}
          {section === 'memory' ? <MemorySection /> : null}
          {section === 'usage' ? <UsageSection /> : null}
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
  );
}

/**
 * The living document Popy keeps about the user (popy.spec §7). The agent
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

/** Passkey / Face ID setup and management (popy.spec §9). */
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

/** Backup and restore (popy.spec §16). */
function BackupSection() {
  const [backups, setBackups] = useState<import('@popy/shared').BackupDTO[]>([]);
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

/** The cost dashboard (popy.spec §14), read off llm_runs. */
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
 * Skills management (popy.spec §8). A list, and a full-screen editor when you
 * create or edit one -- never a side drawer (permanent house veto). Built-in
 * skills can be edited but not deleted.
 */
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [editing, setEditing] = useState<SkillDTO | 'new' | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      setSkills((await skillsService.list()).skills);
    } catch {
      // Leave what is on screen.
    }
  }

  async function remove(skill: SkillDTO): Promise<void> {
    try {
      await skillsService.remove(skill.slug);
      await reload();
    } catch {
      // Ignore; the list is authoritative on the next load.
    }
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

      <div className="flex flex-col gap-2">
        {skills.map((skill) => (
          <Card key={skill.slug} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{skill.name}</span>
                {skill.builtin ? (
                  <span className="rounded bg-[var(--panel-bg)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                    {t('skills.builtin')}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-sm text-[var(--muted)]">{skill.description}</p>
            </div>
            <div className="flex flex-none flex-wrap gap-1">
              <Button type="button" variant="ghost" onClick={() => setEditing(skill)}>
                {t('skills.edit')}
              </Button>
              {skill.builtin ? null : (
                <Button type="button" variant="danger" onClick={() => void remove(skill)}>
                  {t('skills.delete')}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SkillEditor({ skill, onDone }: { skill: SkillDTO | undefined; onDone: () => void }) {
  const [slug, setSlug] = useState(skill?.slug ?? '');
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [whenToUse, setWhenToUse] = useState(skill?.whenToUse ?? '');
  const [body, setBody] = useState(skill?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const isNew = skill === undefined;
  const canSave = slug.trim().length > 0 && name.trim().length > 0 && !busy;

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await skillsService.save({ slug, name, description, whenToUse, body });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <button
        type="button"
        data-testid="skill-back"
        onClick={onDone}
        className="self-start text-sm text-[var(--accent)]"
      >
        ← {t('skills.back')}
      </button>

      <TextField
        id="skill-slug"
        data-testid="skill-slug"
        label={t('skills.field.slug')}
        value={slug}
        disabled={!isNew}
        onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
      />
      <TextField
        id="skill-name"
        data-testid="skill-name"
        label={t('skills.field.name')}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        id="skill-description"
        label={t('skills.field.description')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <TextField
        id="skill-when"
        label={t('skills.field.whenToUse')}
        hint={t('skills.field.whenToUseHint')}
        value={whenToUse}
        onChange={(event) => setWhenToUse(event.target.value)}
      />
      <TextArea
        id="skill-body"
        data-testid="skill-body"
        label={t('skills.field.body')}
        rows={10}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="font-mono text-sm"
      />

      {error !== undefined ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" data-testid="skill-save" disabled={!canSave} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

/** How fresh the catalog is, said plainly (aw's source label). */
const CATALOG_SOURCE_KEYS: Record<ModelCatalogSource, Parameters<typeof t>[0]> = {
  live: 'provider.source.live',
  cache: 'provider.source.cache',
  engine: 'provider.source.engine',
  static: 'provider.source.static',
};

/**
 * The providers and the models (popy.spec §15). One card picks the global
 * default pair; below it, one card per provider carries its write-only key,
 * its key test and its default model. Provider is data: the list comes from
 * GET /v1/providers, never hardcoded here.
 */
function ModelSection() {
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [defaultCatalog, setDefaultCatalog] = useState<ModelDTO[]>([]);
  // A just-created custom instance that was never saved: its Cancel deletes
  // it again, so add-then-cancel leaves nothing behind.
  const [pendingNewId, setPendingNewId] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const [providersResponse, settingsDoc] = await Promise.all([
        providersService.list(),
        settingsService.read(),
      ]);
      setProviders(providersResponse.providers);
      setSettings(settingsDoc);
      const catalog = await chatsService.models(settingsDoc.defaultProvider);
      setDefaultCatalog(catalog.models);
    } catch {
      // The section renders what it has; a failed load leaves it empty.
    }
  }

  async function saveSettings(next: Partial<SettingsDTO>): Promise<void> {
    if (settings === undefined) return;
    try {
      const written = await settingsService.write({ ...settings, ...next });
      setSettings(written);
      if (next.defaultProvider !== undefined) {
        const catalog = await chatsService.models(written.defaultProvider);
        setDefaultCatalog(catalog.models);
      }
    } catch {
      // The select snaps back on the next load; nothing was stored.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{t('provider.priority.title')}</h2>
        {/* One lever, not two: the head of this list is the global default,
            so there is no separate "default provider" control to contradict
            it (popy.spec §15, fase 2). */}
        <PriorityList
          providers={providers}
          onChanged={(next) => {
            setProviders(next.providers);
            // The head may have just become the default; re-read it so the
            // model picker below is the new head's catalog, not the old.
            void reload();
          }}
        />
        <ModelPicker
          id="settings-default-model"
          label={t('provider.defaultModel')}
          models={defaultCatalog}
          value={settings?.defaultModel ?? ''}
          onChange={(model) => void saveSettings({ defaultModel: model })}
        />
      </Card>

      {providers.map((entry) => (
        <ProviderCard
          key={entry.id}
          provider={entry}
          onChanged={(next) => setProviders(next.providers)}
          pendingNew={entry.id === pendingNewId}
          onSettled={() => setPendingNewId(undefined)}
        />
      ))}

      <div>
        <Button
          type="button"
          variant="ghost"
          data-testid="provider-custom-add"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            providersService
              .createCustom()
              .then((created) => {
                setProviders(created.providers);
                setPendingNewId(created.id);
              })
              .catch(() => undefined)
              .finally(() => setAdding(false));
          }}
        >
          {t('provider.custom.add')}
        </Button>
      </div>

      <ServiceModelCard settings={settings} onSave={saveSettings} />

      <VoiceModelCard />
      <VoiceCleanupCard />
    </div>
  );
}

/** Titles and summaries stay on the default provider's catalog for now. */
function ServiceModelCard({
  settings,
  onSave,
}: {
  settings: SettingsDTO | undefined;
  onSave: (next: Partial<SettingsDTO>) => Promise<void>;
}) {
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
      <ModelPicker
        id="settings-service-model"
        label={t('provider.serviceModel')}
        hint={t('provider.serviceModelHint')}
        models={models}
        value={settings?.serviceModel ?? ''}
        onChange={(model) => void onSave({ serviceModel: model })}
      />
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
function ProviderCard({
  provider,
  onChanged,
  pendingNew = false,
  onSettled,
}: {
  provider: ProviderStatusDTO;
  onChanged: (response: ProvidersResponse) => void;
  /** A just-created custom instance nobody saved yet: Cancel discards it. */
  pendingNew?: boolean;
  onSettled?: () => void;
}) {
  const [keyDraft, setKeyDraft] = useState('');
  const [testResult, setTestResult] = useState<string | undefined>(undefined);
  const [testOk, setTestOk] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [catalogSource, setCatalogSource] = useState<ModelCatalogSource | undefined>(undefined);
  const [nameDraft, setNameDraft] = useState(provider.name);
  const [urlDraft, setUrlDraft] = useState(provider.baseURL ?? '');
  const [customModelDraft, setCustomModelDraft] = useState(
    provider.custom === true ? provider.defaultModel : '',
  );

  const isCustom = provider.custom === true;
  // Subscription providers have no key at all: the card swaps the key input
  // for the sign-in flow (popy.spec §15, fase 1.5).
  const isOAuth = provider.authType === 'oauth';

  // The balance row (LOTE 6): undefined = still loading or hidden. ANY error
  // hides it silently -- a balance you cannot see is never a broken card.
  const [credits, setCredits] = useState<ProviderCreditsResponse | undefined>(undefined);

  useEffect(() => {
    if (!provider.configured) return;
    providersService
      .credits(provider.id)
      .then(setCredits)
      .catch(() => setCredits(undefined));
  }, [provider.id, provider.configured]);

  useEffect(() => {
    void loadCatalog();
  }, [provider.id, provider.configured]);

  async function loadCatalog(): Promise<void> {
    try {
      const catalog = await chatsService.models(provider.id);
      setModels(catalog.models);
      setCatalogSource(catalog.source);
    } catch {
      setModels([]);
    }
  }

  async function testKey(): Promise<void> {
    setTesting(true);
    setTestResult(undefined);
    try {
      const result = await providersService.test(
        provider.id,
        keyDraft.length > 0 ? keyDraft : undefined,
      );
      setTestOk(result.ok);
      setTestResult(
        result.ok
          ? result.latencyMs === undefined
            ? t('provider.testOk')
            : t('provider.testOkLatency', { ms: result.latencyMs })
          : t('provider.testFailed', { message: result.message ?? '' }),
      );
    } catch {
      setTestOk(false);
      setTestResult(t('error.generic'));
    } finally {
      setTesting(false);
    }
  }

  async function saveKey(): Promise<void> {
    if (keyDraft.length === 0) return;
    setBusy(true);
    try {
      onChanged(await providersService.setKey(provider.id, keyDraft));
      setKeyDraft('');
      setTestResult(undefined);
      setSaved(true);
      // A fresh key can unlock the live catalog.
      await loadCatalog();
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(): Promise<void> {
    try {
      onChanged(await providersService.clearKey(provider.id));
    } catch {
      // Leave the card as it is; the next reload tells the truth.
    }
  }

  async function saveCustomInstance(): Promise<void> {
    setBusy(true);
    try {
      onChanged(
        await providersService.updateCustom(provider.id, {
          name: nameDraft,
          // Sent already normalized, so what the hint said is what is stored.
          baseURL: normalizeBaseUrl(urlDraft),
          defaultModel: customModelDraft,
        }),
      );
      setSaved(true);
      onSettled?.();
      await loadCatalog();
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCustomInstance(confirmFirst: boolean): Promise<void> {
    if (confirmFirst && !window.confirm(t('provider.custom.deleteConfirm', { name: provider.name }))) {
      return;
    }
    try {
      onChanged(await providersService.deleteCustom(provider.id));
      onSettled?.();
    } catch {
      // Leave the card as it is; the next reload tells the truth.
    }
  }

  async function saveDefaultModel(model: string): Promise<void> {
    try {
      onChanged(await providersService.setDefaultModel(provider.id, model));
    } catch {
      // The select snaps back on the next load.
    }
  }

  const statusLabel = isOAuth
    ? provider.configured
      ? t('provider.oauth.connected')
      : t('provider.oauth.notConnected')
    : !provider.configured
      ? t('provider.notConfigured')
      : provider.source === 'env'
        ? t('provider.configuredEnv')
        : t('provider.configured');

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{provider.name}</h2>
        <span
          data-testid={`provider-status-${provider.id}`}
          className={
            provider.configured ? 'text-sm text-[var(--success)]' : 'text-sm text-[var(--muted)]'
          }
        >
          {statusLabel}
        </span>
      </div>

      {credits !== undefined ? (
        <p data-testid={`provider-credits-${provider.id}`} className="text-sm text-[var(--muted)]">
          {t('provider.credits', {
            remaining: credits.remaining.toFixed(2),
            used: credits.used.toFixed(2),
          })}
        </p>
      ) : null}

      {isCustom ? (
        <div className="flex flex-col gap-3">
          <TextField
            id={`provider-custom-name-${provider.id}`}
            data-testid={`provider-custom-name-${provider.id}`}
            type="text"
            autoComplete="off"
            label={t('provider.custom.name')}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
          />
          <TextField
            id={`provider-custom-url-${provider.id}`}
            data-testid={`provider-custom-url-${provider.id}`}
            type="text"
            autoComplete="off"
            label={t('provider.customBaseURL')}
            hint={t('provider.customBaseURLHint')}
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
          />
          {urlDraft.trim().length > 0 ? (
            <p
              data-testid={`provider-custom-target-${provider.id}`}
              className="text-xs text-[var(--muted)]"
            >
              {t('provider.custom.requestsGoTo', {
                url: `${normalizeBaseUrl(urlDraft)}/chat/completions`,
              })}
            </p>
          ) : null}
          <TextField
            id={`provider-custom-model-${provider.id}`}
            data-testid={`provider-custom-model-${provider.id}`}
            type="text"
            autoComplete="off"
            label={t('provider.customModel')}
            value={customModelDraft}
            onChange={(event) => setCustomModelDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              data-testid={`provider-custom-save-${provider.id}`}
              disabled={busy || nameDraft.length === 0 || urlDraft.length === 0 || customModelDraft.length === 0}
              onClick={() => void saveCustomInstance()}
            >
              {t('common.save')}
            </Button>
            {pendingNew ? (
              <Button
                type="button"
                variant="ghost"
                data-testid={`provider-custom-cancel-${provider.id}`}
                onClick={() => void deleteCustomInstance(false)}
              >
                {t('common.cancel')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                data-testid={`provider-custom-delete-${provider.id}`}
                onClick={() => void deleteCustomInstance(true)}
              >
                {t('provider.custom.delete')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {isOAuth ? <OAuthSection provider={provider} onChanged={onChanged} /> : null}

      {isOAuth ? null : (
      <>
      <TextField
        id={`provider-key-${provider.id}`}
        data-testid={`provider-key-${provider.id}`}
        type="password"
        autoComplete="off"
        label={t('provider.keyLabel')}
        hint={t('provider.keyHint')}
        placeholder={provider.configured ? t('provider.keyConfiguredPlaceholder') : undefined}
        value={keyDraft}
        onChange={(event) => {
          setKeyDraft(event.target.value);
          setSaved(false);
          setTestResult(undefined);
        }}
      />

      {testResult !== undefined ? (
        <p
          data-testid={`provider-test-result-${provider.id}`}
          role="status"
          className={testOk ? 'text-sm text-[var(--success)]' : 'text-sm text-[var(--danger)]'}
        >
          {testResult}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          data-testid={`provider-save-${provider.id}`}
          disabled={busy || keyDraft.length === 0}
          onClick={() => void saveKey()}
        >
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          data-testid={`provider-test-${provider.id}`}
          disabled={testing || (keyDraft.length === 0 && !provider.configured)}
          onClick={() => void testKey()}
        >
          {testing ? t('provider.testing') : t('provider.test')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setKeyDraft('');
            setTestResult(undefined);
            setSaved(false);
          }}
        >
          {t('common.cancel')}
        </Button>
        {provider.source === 'settings' ? (
          <Button
            type="button"
            variant="danger"
            data-testid={`provider-remove-${provider.id}`}
            onClick={() => void removeKey()}
          >
            {t('provider.removeKey')}
          </Button>
        ) : null}
        {saved ? <span className="text-sm text-[var(--success)]">{t('provider.saved')}</span> : null}
      </div>
      </>
      )}

      {!isCustom ? (
        <ModelPicker
          id={`provider-model-${provider.id}`}
          label={t('provider.defaultForProvider')}
          models={models}
          value={provider.defaultModel}
          onChange={(model) => void saveDefaultModel(model)}
        />
      ) : null}
      {catalogSource !== undefined && models.length > 0 ? (
        <p data-testid={`catalog-source-${provider.id}`} className="text-xs text-[var(--muted)]">
          {t('provider.modelsInfo', {
            count: models.length,
            source: t(CATALOG_SOURCE_KEYS[catalogSource]),
          })}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The optional LLM pass over a raw transcript (popy.spec §14). Off by default
 * (decision of 31/07): the raw text lands in the composer in whisper time;
 * turning this on trades ~10s+ per note for punctuation fixes.
 */
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

/** The whisper model for voice transcription (popy.spec §14). */
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

function ModelPicker({
  id,
  label,
  hint,
  models,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  models: ModelDTO[];
  value: string;
  onChange: (model: string) => void;
}) {
  // The stored model may not be in the loaded catalog (stale cache, another
  // provider): it still has to be selectable rather than silently replaced.
  const known = models.some((model) => model.id === value);

  return (
    <Select
      id={id}
      data-testid={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full max-w-md"
    >
      {known || value.length === 0 ? null : <option value={value}>{value}</option>}
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name === undefined ? model.id : `${model.name} — ${model.id}`}
        </option>
      ))}
    </Select>
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
 * How the installed PWA notices a new build (popy.spec §15). Device-scoped
 * like the theme and notifications: the interval lives in localStorage and
 * never reaches the server. "Check now" asks the service worker immediately.
 */
function AppUpdatesCard() {
  const intervalMinutes = useUpdatesStore((state) => state.intervalMinutes);
  const setIntervalMinutes = useUpdatesStore((state) => state.setIntervalMinutes);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);

  async function checkNow(): Promise<void> {
    setChecking(true);
    setResult(undefined);
    const outcome = await checkForUpdateNow();
    setResult(
      outcome === 'update-found'
        ? t('settings.updates.found')
        : outcome === 'up-to-date'
          ? t('settings.updates.current')
          : t('settings.updates.checkUnavailable'),
    );
    setChecking(false);
  }

  return (
    <Card className="flex flex-col gap-3">
      <span className="text-sm text-[var(--key-fg-dim)]">{t('settings.updates.checkTitle')}</span>
      <Select
        id="update-interval"
        data-testid="update-interval"
        label={t('settings.updates.every')}
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
      <div>
        <Button
          type="button"
          variant="ghost"
          data-testid="update-check-now"
          disabled={checking}
          onClick={() => void checkNow()}
        >
          {checking ? t('settings.updates.checking') : t('settings.updates.checkNow')}
        </Button>
      </div>
      {result !== undefined ? (
        <p role="status" data-testid="update-check-result" className="text-xs text-[var(--muted)]">
          {result}
        </p>
      ) : null}
      <p className="text-xs text-[var(--muted)]">{t('settings.updates.checkNote')}</p>
    </Card>
  );
}

function intervalLabel(minutes: number): string {
  if (minutes === 60) return t('settings.updates.everyHour');
  if (minutes < 60) return t('settings.updates.everyMinutes', { count: minutes });
  if (minutes < 1440) return t('settings.updates.everyHours', { count: minutes / 60 });
  return t('settings.updates.everyDay');
}

/** Web Push opt-in (popy.spec §14). Device-scoped, like the theme. */
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
 * Settings → Updates (popy.spec §15, design closed 31/07): three cards, one
 * per channel. The app checks and prompts; the server is notify-only -- a
 * push says a new tag exists and taps into this screen, applying it stays
 * the shell command shown here; the environment is visibility only.
 */
function UpdatesSection() {
  const [update, setUpdate] = useState<import('@popy/shared').UpdateStatusResponse | undefined>(
    undefined,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    settingsService
      .updateStatus()
      .then(setUpdate)
      .catch(() => setUpdate(undefined));
  }, []);

  const popyOutdated =
    update?.popy.latest !== undefined && update.popy.latest !== update.popy.current;
  const piOutdated = update?.pi.latest !== undefined && update.pi.latest !== update.pi.current;

  return (
    <div className="flex flex-col gap-4">
      <AppUpdatesCard />

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t('settings.updates.serverTitle')}</h2>
        <Row
          label={t('settings.updates.installed')}
          value={update?.popy.current ?? '…'}
          testId="update-popy-current"
        />
        {popyOutdated ? (
          <p data-testid="update-popy-available" className="text-sm text-[var(--accent)]">
            {t('settings.updates.popyAvailable', { version: update?.popy.latest ?? '' })}
          </p>
        ) : (
          <p className="text-sm text-[var(--muted)]">{t('settings.updates.upToDate')}</p>
        )}
        <p className="text-xs text-[var(--muted)]">{t('settings.updates.notifyNote')}</p>
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
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t('settings.updates.envTitle')}</h2>
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
      </Card>
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
        <Row label={t('settings.server.popy')} value={info ? `${info.popyVersion} (${info.commit})` : '…'} testId="server-popy" />
      </Card>

      <Card className="flex flex-col gap-3">
        <Row label={t('settings.server.db')} value={info && info.dbBytes !== null ? formatBytes(info.dbBytes) : '…'} testId="server-db" />
        <Row label={t('settings.server.workspaceSize')} value={info && info.workspaceBytes !== null ? formatBytes(info.workspaceBytes) : '…'} testId="server-workspace" />
        <Row label={t('settings.server.dataDir')} value={info?.dataDir ?? '…'} testId="server-datadir" />
        <Row label={t('settings.server.workspace')} value={info?.workspace ?? '…'} testId="server-workspace-path" />
      </Card>

      <DangerZoneSection />
    </div>
  );
}

function DangerZoneSection() {
  const [busy, setBusy] = useState<string | undefined>(undefined);

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

  return (
    <Card className="flex flex-col gap-3 border-[var(--danger)]">
      <h3 className="text-sm font-semibold text-[var(--danger)]">{t('settings.server.dangerZone')}</h3>
      <div className="flex flex-wrap gap-2">
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
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          disabled={busy !== undefined}
          data-testid="server-llm-stop"
          onClick={() => {
            if (!window.confirm(t('settings.server.llmStopConfirm'))) return;
            void act('llm-stop', () => serverService.llmStop());
          }}
        >
          {t('settings.server.llmStop')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy !== undefined}
          data-testid="server-llm-start"
          onClick={() => void act('llm-start', () => serverService.llmStart())}
        >
          {t('settings.server.llmStart')}
        </Button>
      </div>
      <p className="text-xs text-[var(--muted)]">{t('settings.server.dangerHint')}</p>
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
        <Row label={t('settings.about.popy')} value={about?.popyVersion ?? '…'} testId="about-popy" />
        <Row label={t('settings.about.node')} value={about?.nodeVersion ?? '…'} testId="about-node" />
        <Row label={t('settings.about.pi')} value={about?.piVersion ?? '…'} testId="about-pi" />
        <a
          href="https://github.com/viniciusbuscacio/popy"
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
