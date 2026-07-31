import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AboutResponse,
  ModelCatalogSource,
  ModelDTO,
  ProviderStatusDTO,
  SettingsDTO,
  SkillDTO,
  UsageResponse,
} from '@popy/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { backupsService } from '../services/backups';
import { chatsService } from '../services/chats';
import { providersService } from '../services/providers';
import { pushService } from '../services/push';
import { settingsService } from '../services/settings';
import { skillsService } from '../services/skills';
import { useAuthStore } from '../store/auth';
import { useThemeStore, type ThemeChoice } from '../store/theme';
import { Button, Card, Segmented, TextField } from '../ui/controls';

/**
 * Settings as a full screen with a back button -- never a drawer or a modal
 * (permanent house veto, popy.spec §14). Sections sit on the left on a wide
 * screen and become a row of tabs when there is no room for a column.
 */

type Section =
  | 'general'
  | 'model'
  | 'memory'
  | 'skills'
  | 'usage'
  | 'backup'
  | 'appearance'
  | 'security'
  | 'about';

const SECTIONS: { id: Section; labelKey: Parameters<typeof t>[0] }[] = [
  { id: 'general', labelKey: 'settings.section.general' },
  { id: 'model', labelKey: 'settings.section.model' },
  { id: 'memory', labelKey: 'settings.section.memory' },
  { id: 'skills', labelKey: 'settings.section.skills' },
  { id: 'usage', labelKey: 'settings.section.usage' },
  { id: 'backup', labelKey: 'settings.section.backup' },
  { id: 'appearance', labelKey: 'settings.section.appearance' },
  { id: 'security', labelKey: 'settings.section.security' },
  { id: 'about', labelKey: 'settings.section.about' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('general');

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

      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:flex-row">
        <nav className="flex gap-1 overflow-x-auto md:w-48 md:flex-col">
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

        <div className="flex-1">
          {section === 'general' ? <GeneralSection /> : null}
          {section === 'model' ? <ModelSection /> : null}
          {section === 'memory' ? <MemorySection /> : null}
          {section === 'skills' ? <SkillsSection /> : null}
          {section === 'usage' ? <UsageSection /> : null}
          {section === 'backup' ? <BackupSection /> : null}
          {section === 'appearance' ? <AppearanceSection /> : null}
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-language" className="text-sm text-[var(--key-fg-dim)]">
          {t('settings.general.language')}
        </label>
        <select
          id="settings-language"
          data-testid="settings-language"
          defaultValue="en"
          className="w-48 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)]"
        >
          <option value="en">English</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-instructions" className="text-sm text-[var(--key-fg-dim)]">
          {t('settings.general.instructions')}
        </label>
        <textarea
          id="settings-instructions"
          data-testid="settings-instructions"
          rows={5}
          maxLength={4000}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
            setSaved(false);
          }}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)] outline-none focus:border-[var(--accent)]"
        />
        <p className="text-xs text-[var(--muted)]">{t('settings.general.instructionsHint')}</p>
      </div>

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
    if (!window.confirm(t('settings.memory.restoreConfirm'))) return;
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-memory" className="text-sm text-[var(--key-fg-dim)]">
          {t('settings.memory.label')}
        </label>
        <textarea
          id="settings-memory"
          data-testid="settings-memory"
          rows={10}
          maxLength={8000}
          value={doc}
          placeholder={t('settings.memory.empty')}
          onChange={(event) => {
            setDoc(event.target.value);
            setSaved(false);
          }}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-[var(--screen-fg)] outline-none focus:border-[var(--accent)]"
        />
        <p className="text-xs text-[var(--muted)]">{t('settings.memory.hint')}</p>
      </div>

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
    if (!window.confirm(t('backup.restoreConfirm'))) return;
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
function SkillsSection() {
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
    if (!window.confirm(t('skills.deleteConfirm', { name: skill.name }))) return;
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
          <Card key={skill.slug} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
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
            <div className="flex flex-none gap-1">
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-body" className="text-sm text-[var(--key-fg-dim)]">
          {t('skills.field.body')}
        </label>
        <textarea
          id="skill-body"
          data-testid="skill-body"
          rows={10}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-[var(--screen-fg)] outline-none focus:border-[var(--accent)]"
        />
      </div>

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
 * The provider and the models (popy.spec §15). The key field is write-only:
 * what was stored is reported as "configured", never echoed back.
 */
function ModelSection() {
  const [provider, setProvider] = useState<ProviderStatusDTO | undefined>(undefined);
  const [settings, setSettings] = useState<SettingsDTO | undefined>(undefined);
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [catalogSource, setCatalogSource] = useState<ModelCatalogSource | undefined>(undefined);

  const [keyDraft, setKeyDraft] = useState('');
  const [testResult, setTestResult] = useState<string | undefined>(undefined);
  const [testOk, setTestOk] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const [providersResponse, settingsDoc, modelsResponse] = await Promise.all([
        providersService.list(),
        settingsService.read(),
        chatsService.models(),
      ]);
      setProvider(providersResponse.providers[0]);
      setSettings(settingsDoc);
      setModels(modelsResponse.models);
      setCatalogSource(modelsResponse.source);
    } catch {
      // The section renders what it has; a failed load leaves it empty.
    }
  }

  async function test(): Promise<void> {
    setTesting(true);
    setTestResult(undefined);
    try {
      const result = await providersService.test(keyDraft.length > 0 ? keyDraft : undefined);
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
      const response = await providersService.setKey(keyDraft);
      setProvider(response.providers[0]);
      setKeyDraft('');
      setTestResult(undefined);
      setSaved(true);
      // A fresh key can unlock the live catalog.
      const catalog = await chatsService.models();
      setModels(catalog.models);
      setCatalogSource(catalog.source);
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(): Promise<void> {
    if (!window.confirm(t('provider.removeKeyConfirm'))) return;
    try {
      const response = await providersService.clearKey();
      setProvider(response.providers[0]);
    } catch {
      // Leave the section as it is; the next reload tells the truth.
    }
  }

  async function saveModels(next: Partial<SettingsDTO>): Promise<void> {
    if (settings === undefined) return;
    try {
      setSettings(await settingsService.write({ ...settings, ...next }));
    } catch {
      // The select snaps back on the next load; nothing was stored.
    }
  }

  const statusLabel =
    provider === undefined || !provider.configured
      ? t('provider.notConfigured')
      : provider.source === 'env'
        ? t('provider.configuredEnv')
        : t('provider.configured');

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">{t('provider.title')}</h2>
          <span
            data-testid="provider-status"
            className={
              provider?.configured === true
                ? 'text-sm text-[var(--success)]'
                : 'text-sm text-[var(--muted)]'
            }
          >
            {statusLabel}
          </span>
        </div>

        <TextField
          id="provider-key"
          data-testid="provider-key"
          type="password"
          autoComplete="off"
          label={t('provider.keyLabel')}
          hint={t('provider.keyHint')}
          value={keyDraft}
          onChange={(event) => {
            setKeyDraft(event.target.value);
            setSaved(false);
            setTestResult(undefined);
          }}
        />

        {testResult !== undefined ? (
          <p
            data-testid="provider-test-result"
            role="status"
            className={testOk ? 'text-sm text-[var(--success)]' : 'text-sm text-[var(--danger)]'}
          >
            {testResult}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            data-testid="provider-save"
            disabled={busy || keyDraft.length === 0}
            onClick={() => void saveKey()}
          >
            {t('common.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid="provider-test"
            disabled={testing || (keyDraft.length === 0 && provider?.configured !== true)}
            onClick={() => void test()}
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
          {provider?.source === 'settings' ? (
            <Button
              type="button"
              variant="danger"
              data-testid="provider-remove"
              onClick={() => void removeKey()}
            >
              {t('provider.removeKey')}
            </Button>
          ) : null}
          {saved ? <span className="text-sm text-[var(--success)]">{t('provider.saved')}</span> : null}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <ModelPicker
          id="settings-default-model"
          label={t('provider.defaultModel')}
          models={models}
          value={settings?.defaultModel ?? ''}
          onChange={(model) => void saveModels({ defaultModel: model })}
        />
        <ModelPicker
          id="settings-service-model"
          label={t('provider.serviceModel')}
          hint={t('provider.serviceModelHint')}
          models={models}
          value={settings?.serviceModel ?? ''}
          onChange={(model) => void saveModels({ serviceModel: model })}
        />
        {catalogSource !== undefined ? (
          <p data-testid="catalog-source" className="text-xs text-[var(--muted)]">
            {t('provider.modelsInfo', {
              count: models.length,
              source: t(CATALOG_SOURCE_KEYS[catalogSource]),
            })}
          </p>
        ) : null}
      </Card>
    </div>
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-[var(--key-fg-dim)]">
        {label}
      </label>
      <select
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)]"
      >
        {known || value.length === 0 ? null : <option value={value}>{value}</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name === undefined ? model.id : `${model.name} — ${model.id}`}
          </option>
        ))}
      </select>
      {hint !== undefined ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
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

      <NotificationsCard />
    </div>
  );
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
    if (!window.confirm(t('settings.security.signOutOthersConfirm'))) return;
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
        {/* Biometric unlock (WebAuthn) is a later version; noted, not promised. */}
        <p className="text-xs text-[var(--muted)]">{t('settings.security.passkeySoon')}</p>
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

function AboutSection() {
  const [about, setAbout] = useState<AboutResponse | undefined>(undefined);

  useEffect(() => {
    settingsService
      .about()
      .then(setAbout)
      .catch(() => setAbout(undefined));
  }, []);

  return (
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
