import { healthMonitor } from '../services/health';
import { useEffect, useRef, useState } from 'react';
import type {
  ProviderStatusDTO,
  ProviderSubscriptionUsageResponse,
  ProviderUsageWindowDTO,
  ProvidersResponse,
} from '@pop-agent/shared';
import { t } from '../i18n';
import { formatDollars } from '../lib/money';
import { loadProviderCredits } from '../lib/provider-credits-cache';
import { normalizeBaseUrl, providersService } from '../services/providers';
import { chatsService } from '../services/chats';
import {
  BackButton,
  Button,
  Card,
  ModelPicker,
  Select,
  TextField,
  Pressable,
  type ModelPickerOption,
} from '../ui/controls';
import { OAuthSection } from './oauth-section';

/**
 * Providers, rebuilt around adding one at a time (Vinicius, 03/08).
 *
 * The screen used to show every provider Pop Agent knows about, configured or not,
 * each an open form: six cards to read before finding the one you had set up.
 * Now it shows what you actually have. One button adds another, a wizard walks
 * the one path that provider needs, and each configured provider is a card
 * with Edit and Delete.
 *
 * **Priority is the whole ordering story.** It is a plain 1..N dropdown over
 * the providers you have configured, because that is the question a person
 * asks -- "who answers first" -- and a drag-to-reorder list answers it only
 * after you learn the gesture. The number feeds the fallback chain that
 * already existed (§15 fase 2): #1 answers, and a refusal walks down the list.
 *
 * Full-screen steps, never a drawer or a modal (permanent house veto): the
 * wizard replaces the list while it runs, and every step has a way back.
 */

/** What the picker offers. A builtin appears once; custom, as often as you like. */
interface Catalogue {
  /** A builtin provider id, or 'custom' for a new OpenAI-compatible instance. */
  id: string;
  labelKey: Parameters<typeof t>[0];
  kind: 'api-key' | 'oauth' | 'custom';
}

const CATALOGUE: Catalogue[] = [
  { id: 'openrouter', labelKey: 'provider.add.openrouter', kind: 'api-key' },
  { id: 'openai', labelKey: 'provider.add.openai', kind: 'api-key' },
  { id: 'openai-codex', labelKey: 'provider.add.openaiSubscription', kind: 'oauth' },
  { id: 'anthropic', labelKey: 'provider.add.anthropic', kind: 'api-key' },
  { id: 'github-copilot', labelKey: 'provider.add.copilot', kind: 'oauth' },
  { id: 'custom', labelKey: 'provider.add.custom', kind: 'custom' },
];

type View =
  | { kind: 'list' }
  | { kind: 'pick' }
  | { kind: 'configure'; providerId: string; adding: true }
  | { kind: 'configure'; providerId: string; adding: false };

/** Set when a run failed with an auth-class error; cleared on new evidence. */
function providerAuthErrorAt(provider: ProviderStatusDTO): string | undefined {
  return provider.authErrorAt;
}

export function ProvidersSection({ onSetupDone }: { onSetupDone?: () => void } = {}) {
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [view, setView] = useState<View>({ kind: onSetupDone === undefined ? 'list' : 'pick' });
  const [loaded, setLoaded] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void providersService
      .list()
      .then((response) => absorb(response))
      .catch(() => setError(t('provider.loadFailed')))
      .finally(() => setLoaded(true));
  }, []);

  /** Configured is the only thing this screen counts: it is what you have. */
  const configured = providers
    .filter((provider) => provider.configured)
    .sort((left, right) => left.order - right.order);

  function absorb(response: ProvidersResponse): void {
    setProviders(response.providers);
    setListVersion((version) => version + 1);
  }

  if (!loaded) return <Card>{t('app.loading')}</Card>;

  if (error !== undefined && onSetupDone !== undefined) {
    return <Card>
      <p role="alert">{error}</p>
      <Button type="button" variant="ghost" data-testid="setup-skip-provider" onClick={onSetupDone}>
        {t('setup.provider.skip')}
      </Button>
    </Card>;
  }

  if (view.kind === 'pick') {
    return (
      <PickProvider
        configured={configured}
        setup={onSetupDone !== undefined}
        onCancel={() => onSetupDone === undefined ? setView({ kind: 'list' }) : onSetupDone()}
        onPicked={(providerId) => {
          if (providerId === 'custom') {
            const draft: ProviderStatusDTO = {
              id: 'custom-draft',
              name: 'Custom provider',
              authType: 'api-key',
              configured: false,
              source: null,
              defaultModel: '',
              serviceModel: '',
              allowCustomModel: true,
              baseURL: '',
              custom: true,
              order: providers.length + 1,
              enabled: true,
            };
            setProviders((current) => [...current.filter((entry) => entry.id !== draft.id), draft]);
            setView({ kind: 'configure', providerId: draft.id, adding: true });
            return;
          }
          setView({ kind: 'configure', providerId, adding: true });
        }}
      />
    );
  }

  if (view.kind === 'configure') {
    const provider = providers.find((entry) => entry.id === view.providerId);
    if (provider === undefined) {
      setView({ kind: 'list' });
      return null;
    }
    return (
      <ConfigureProvider
        provider={provider}
        configured={configured}
        adding={view.adding}
        onChanged={absorb}
        {...(onSetupDone === undefined ? {} : { onSaved: onSetupDone })}
        onDone={() => {
          if (provider.id === 'custom-draft') {
            setProviders((current) => current.filter((entry) => entry.id !== provider.id));
          }
          setView({ kind: onSetupDone === undefined ? 'list' : 'pick' });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" data-testid="provider-add" onClick={() => setView({ kind: 'pick' })}>
          {t('provider.add')}
        </Button>
      </div>

      {error === undefined ? null : <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}

      {configured.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t('provider.none')}</p>
        </Card>
      ) : (
        configured.map((provider, index) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            index={index}
            listVersion={listVersion}
            onChanged={absorb}
            onEdit={() => setView({ kind: 'configure', providerId: provider.id, adding: false })}
            onDelete={() => {
              setError(undefined);
              void remove(provider, absorb).catch(() => setError(t('provider.deleteFailed')));
            }}
          />
        ))
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  index,
  listVersion,
  onChanged,
  onEdit,
  onDelete,
}: {
  provider: ProviderStatusDTO;
  index: number;
  listVersion: number;
  onChanged: (response: ProvidersResponse) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | undefined>(undefined);
  const authErrorAt = providerAuthErrorAt(provider);

  async function toggleEnabled(): Promise<void> {
    setToggling(true);
    setToggleError(undefined);
    try {
      onChanged(await providersService.setEnabled(provider.id, !provider.enabled));
    } catch {
      setToggleError(t('provider.enableFailed'));
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card
      padding="compact"
      className={`flex flex-col gap-3 ${provider.enabled ? '' : 'opacity-70'}`}
      data-testid={`provider-card-${provider.id}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Pressable
          type="button"
          role="switch"
          data-testid="provider-toggle"
          aria-checked={provider.enabled}
          aria-label={provider.enabled ? t('provider.disable') : t('provider.enable')}
          title={provider.enabled ? t('provider.disable') : t('provider.enable')}
          disabled={toggling}
          onClick={() => void toggleEnabled()}
          className={`flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
            provider.enabled
              ? 'border-transparent bg-[var(--accent)]'
              : 'border-[var(--border)] bg-transparent'
          }`}
        >
          <span
            aria-hidden="true"
            className={
              provider.enabled
                ? 'block h-3.5 w-3.5 translate-x-4 rounded-full bg-[var(--accent-fg)] transition-transform'
                : 'block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-[var(--muted)] transition-transform'
            }
          />
        </Pressable>
        <p className="min-w-0 break-words font-semibold" data-testid="provider-card-name">
          {provider.name}
        </p>
      </div>

      <div className="min-w-0">
        <Balance providerId={provider.id} listVersion={listVersion} />
        <p className="break-words text-xs text-[var(--muted)]">
          {t('provider.priorityBadge', { n: index + 1 })}
          {provider.defaultModel === '' ? '' : ` · ${provider.defaultModel}`}
          {provider.authType === 'oauth' ? ` · ${t('provider.bySubscription')}` : ''}
          {!provider.enabled ? ` · ${t('provider.priority.off')}` : ''}
        </p>
      </div>

      {provider.id === 'openai-codex' ? (
        <SubscriptionUsage providerId={provider.id} listVersion={listVersion} />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="provider-edit"
          onClick={onEdit}
        >
          {t('common.edit')}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          data-testid="provider-delete"
          onClick={onDelete}
        >
          {t('shell.delete')}
        </Button>
      </div>

      {authErrorAt === undefined ? null : (
        <Pressable
          type="button"
          data-testid="provider-sign-in-again"
          onClick={onEdit}
          className="self-start rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 px-2 py-0.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/20"
        >
          {t('provider.signInAgain')}
        </Pressable>
      )}
      {toggleError === undefined ? null : (
        <p className="text-sm text-[var(--danger)]" data-testid="provider-toggle-error">
          {toggleError}
        </p>
      )}
    </Card>
  );
}

/**
 * The provider's own balance, for the ones that publish one (OpenRouter does).
 * Silent when it does not, or when the call fails: a row that cannot be
 * fetched is not news, and guessing at a number here would be worse than
 * saying nothing.
 */
function Balance({
  providerId,
  listVersion,
}: {
  providerId: string;
  listVersion: number;
}) {
  const [credits, setCredits] = useState<{ remaining: number; used: number } | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    void loadProviderCredits(providerId, listVersion, providersService.credits).then((value) => {
      if (live) setCredits(value);
    });
    return () => {
      live = false;
    };
  }, [providerId, listVersion]);

  if (credits === undefined || credits === null) return null;
  return (
    <p className="break-words text-xs text-[var(--muted)]" data-testid="provider-credits">
      {t('provider.credits', {
        remaining: formatDollars(credits.remaining),
        used: formatDollars(credits.used),
      })}
    </p>
  );
}

/** OpenAI's rolling allowance, kept inside its provider card (not Usage). */
function SubscriptionUsage({
  providerId,
  listVersion,
}: {
  providerId: string;
  listVersion: number;
}) {
  const [usage, setUsage] = useState<ProviderSubscriptionUsageResponse | null>(null);

  useEffect(() => {
    let live = true;
    void providersService
      .subscriptionUsage(providerId)
      .then((value) => {
        if (live) setUsage(value);
      })
      .catch(() => {
        if (live) setUsage(null);
      });
    return () => {
      live = false;
    };
  }, [providerId, listVersion]);

  if (usage === null) return null;
  const windows = [usage.primary, usage.secondary].filter(
    (window): window is ProviderUsageWindowDTO => window !== undefined,
  );
  return (
    <div className="mt-2 flex w-72 max-w-full flex-col gap-2" data-testid="provider-subscription-usage">
      {windows.map((window) => (
        <UsageWindow key={`${String(window.windowSeconds)}-${String(window.resetAt)}`} window={window} />
      ))}
      <p className="text-xs text-[var(--muted)]">
        {t('provider.subscriptionUsage.plan', {
          plan: usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1),
        })}
      </p>
    </div>
  );
}

function UsageWindow({ window }: { window: ProviderUsageWindowDTO }) {
  const percent = Math.max(0, Math.min(100, window.usedPercent));
  const label =
    window.windowSeconds >= 6 * 24 * 60 * 60
      ? t('provider.subscriptionUsage.weekly')
      : t('provider.subscriptionUsage.hours', {
          hours: Math.max(1, Math.round(window.windowSeconds / 3600)),
        });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-medium">{Math.round(percent * 10) / 10}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
      >
        <span
          aria-hidden="true"
          className="block h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p className="text-xs text-[var(--muted)]">
        {t('provider.subscriptionUsage.resets', {
          date: new Date(window.resetAt * 1000).toLocaleString([], {
            dateStyle: 'short',
            timeStyle: 'short',
          }),
        })}
      </p>
    </div>
  );
}

/**
 * Removing a provider means different things to different kinds, and all three
 * are irreversible enough to ask first: a key has to be pasted again, and a
 * subscription has to be signed into again from another device.
 */
async function remove(
  provider: ProviderStatusDTO,
  absorb: (response: ProvidersResponse) => void,
): Promise<void> {
  if (!window.confirm(t('provider.deleteConfirm', { name: provider.name }))) return;
  if (provider.custom === true) return absorb(await providersService.deleteCustom(provider.id));
  if (provider.authType === 'oauth') {
    await providersService.oauthLogout(provider.id);
    return absorb(await providersService.list());
  }
  absorb(await providersService.clearKey(provider.id));
}

/**
 * The way out of a step, inside the card it belongs to (Vinicius, 04/08).
 *
 * The wizard replaces the list rather than floating over it, so without this
 * the only way back was Cancel at the very bottom -- past every field, and
 * reading as "discard" rather than "up one level". The arrow is the app's own
 * (the Settings header and the skills editor use the same one), not a new
 * glyph to learn. Cancel stays: every Save has one (permanent house veto).
 */
function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <BackButton data-testid="provider-back" aria-label={t('common.back')} onClick={onBack} />
      <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
    </div>
  );
}

/** Step one: which provider. A builtin already set up is not offered twice. */
function PickProvider({
  configured,
  setup = false,
  onCancel,
  onPicked,
}: {
  configured: ProviderStatusDTO[];
  setup?: boolean;
  onCancel: () => void;
  onPicked: (providerId: string) => void;
}) {
  const taken = new Set(configured.map((provider) => provider.id));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <StepHeader title={t('provider.add')} onBack={onCancel} />
          <p className="text-sm text-[var(--muted)]">{t('provider.add.intro')}</p>
        </div>
        <div className="flex flex-col gap-2">
          {CATALOGUE.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              variant="ghost"
              data-testid="provider-choice"
              disabled={entry.kind !== 'custom' && taken.has(entry.id)}
              onClick={() => onPicked(entry.id)}
              className="justify-between"
            >
              <span>{t(entry.labelKey)}</span>
              {entry.kind !== 'custom' && taken.has(entry.id) ? (
                <span className="text-xs text-[var(--muted)]">{t('provider.alreadyAdded')}</span>
              ) : null}
            </Button>
          ))}
        </div>
        <div>
          <Button type="button" variant="ghost" data-testid={setup ? 'setup-skip-provider' : undefined} onClick={onCancel}>
            {t(setup ? 'setup.provider.skip' : 'common.cancel')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Step two and three in one screen: what this provider needs, then where it
 * sits in the order. The same screen is the Edit view -- there is nothing an
 * edit can change that adding did not ask, so a second layout would only be
 * two places to keep in step.
 */
function ConfigureProvider({
  provider,
  configured,
  adding,
  onChanged,
  onDone,
  onSaved,
}: {
  provider: ProviderStatusDTO;
  configured: ProviderStatusDTO[];
  adding: boolean;
  onChanged: (response: ProvidersResponse) => void;
  onDone: () => void;
  onSaved?: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState(provider.name);
  const [baseURL, setBaseURL] = useState(provider.baseURL ?? '');
  const [model, setModel] = useState(provider.defaultModel);
  // Empty means "follow the chat model" (docs/specs/Spec-Pop-General.md §15). The card shows the
  // resolved value, so a provider that never chose one still reads sensibly;
  // choosing the chat model again is what clears it.
  const [serviceModel, setServiceModel] = useState(provider.serviceModel);
  const [catalogue, setCatalogue] = useState<ModelPickerOption[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [catalogNote, setCatalogNote] = useState<string>();
  const catalogRevision = useRef(0);
  const catalogRefreshPending = useRef(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Adding puts the new one last unless asked otherwise; editing starts where
  // it already is. Positions are counted over configured providers only --
  // "priority 3" has to mean the third thing that answers, not the third row
  // of a list that includes six providers you never set up.
  const positions = configured.length + (adding && !provider.configured ? 1 : 0);
  const current = configured.findIndex((entry) => entry.id === provider.id);
  const [priority, setPriority] = useState(current === -1 ? positions : current + 1);

  const isCustom = provider.custom === true;
  const isOAuth = provider.authType === 'oauth';

  // The provider's own catalogue: OpenRouter answers with hundreds, a
  // subscription with the handful its plan includes, a custom endpoint often
  // with nothing at all. Reloaded when the key changes, because for most
  // providers there is no catalogue to fetch until one is stored.
  useEffect(() => {
    let live = true;
    const revision = ++catalogRevision.current;
    void chatsService
      .models(provider.id)
      .then((response) => {
        if (!live || revision !== catalogRevision.current) return;
        setCatalogue(
          response.models.map((entry) => ({ value: entry.id, label: entry.name ?? entry.id })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
      catalogRevision.current += 1;
    };
  }, [provider.id, provider.configured]);

  async function refreshModels(): Promise<void> {
    if (catalogRefreshPending.current || !provider.configured) return;
    catalogRefreshPending.current = true;
    setRefreshingModels(true);
    setCatalogNote(undefined);
    const revision = ++catalogRevision.current;
    try {
      const response = await chatsService.models(provider.id);
      if (revision !== catalogRevision.current) return;
      setCatalogue(response.models.map((entry) => ({ value: entry.id, label: entry.name ?? entry.id })));
      setCatalogNote(t('provider.models.refreshed'));
    } catch {
      if (revision === catalogRevision.current) setCatalogNote(t('provider.models.failed'));
    } finally {
      catalogRefreshPending.current = false;
      setRefreshingModels(false);
    }
  }

  async function test(): Promise<void> {
    setTesting(true);
    setNote(undefined);
    try {
      const result = await providersService.test(
        provider.id,
        apiKey.trim().length > 0 ? apiKey.trim() : undefined,
      );
      // The round trip is the useful half of the answer: "it works" and "it
      // works, in four seconds" are different findings, and the second one is
      // what tells you a provider is alive but not worth being first.
      if (!result.ok) {
        setNote(result.message ?? t('provider.test.failed'));
      } else if (result.latencyMs === undefined) {
        setNote(t('provider.test.ok'));
      } else {
        setNote(t('provider.test.okLatency', { ms: Math.round(result.latencyMs) }));
      }
    } catch {
      setNote(t('provider.test.failed'));
    } finally {
      setTesting(false);
    }
  }

  /** One Save is one server request; a network failure cannot split the form. */
  async function save(): Promise<void> {
    if (saving || missingRequiredConfiguration) return;
    setSaving(true);
    setNote(undefined);
    try {
      const normalizedServiceModel = serviceModel.trim() === model.trim() ? '' : serviceModel.trim();
      if (provider.id === 'custom-draft') {
        const created = await providersService.createConfiguredCustom({
          name: name.trim(),
          baseURL: normalizeBaseUrl(baseURL),
          defaultModel: model.trim(),
          serviceModel: normalizedServiceModel,
          priority,
          apiKey: apiKey.trim(),
        });
        onChanged({ providers: created.providers });
      } else {
        const latest = await providersService.saveConfiguration(provider.id, {
          defaultModel: model.trim(),
          serviceModel: normalizedServiceModel,
          priority,
          ...(apiKey.trim().length === 0 ? {} : { apiKey: apiKey.trim() }),
          ...(isCustom ? { name: name.trim(), baseURL: normalizeBaseUrl(baseURL) } : {}),
        });
        onChanged(latest);
      }
      healthMonitor.refreshAfterProviderChange();
      (onSaved ?? onDone)();
    } catch {
      setNote(t('provider.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const missingRequiredConfiguration =
    isOAuth ? !provider.configured : adding &&
    (apiKey.trim().length === 0 ||
      (isCustom && (name.trim().length === 0 || normalizeBaseUrl(baseURL).length === 0)));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <StepHeader title={provider.name} onBack={onDone} />

        {isCustom ? (
          <>
            <TextField
              id="provider-name"
              data-testid="provider-name"
              label={t('provider.custom.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              id="provider-base-url"
              data-testid="provider-base-url"
              label={t('provider.customBaseURL')}
              hint={t('provider.customBaseURLHint')}
              value={baseURL}
              placeholder="https://…/v1"
              onChange={(event) => setBaseURL(event.target.value)}
            />
          </>
        ) : null}

        {isOAuth ? (
          // The subscription sign-in runs on the server and is its own little
          // machine; the wizard hosts it rather than reimplementing it.
          <OAuthSection provider={provider} onChanged={onChanged} />
        ) : (
          <>
            <TextField
              id="provider-key"
              data-testid="provider-key"
              type="password"
              autoComplete="off"
              label={provider.configured ? t('provider.key.replace') : t('provider.key')}
              hint={provider.configured ? t('provider.key.storedHint') : undefined}
              value={apiKey}
              placeholder={provider.configured ? '••••••••' : ''}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </>
        )}

        {/* Every provider can be tested, subscriptions included: the server
            checks those with pi's own auth check rather than a paid probe, so
            there is no reason to hide the one button that answers "is this
            actually going to work?" (Vinicius, 03/08). */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="provider-test"
            disabled={testing || (!provider.configured && apiKey.trim().length === 0)}
            onClick={() => void test()}
          >
            {testing ? t('provider.test.running') : t('provider.test.run')}
          </Button>
          {note === undefined ? null : (
            <span className="text-sm text-[var(--muted)]" data-testid="provider-note">
              {note}
            </span>
          )}
        </div>
        <p className="-mt-1 text-xs text-[var(--muted)]">{t('provider.test.hint')}</p>

        {isOAuth ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="provider-refresh-models"
              disabled={!provider.configured || refreshingModels}
              onClick={() => void refreshModels()}
            >
              {refreshingModels ? t('provider.models.refreshing') : t('provider.models.refresh')}
            </Button>
            {catalogNote ? <span role="status" className="text-sm text-[var(--muted)]">{catalogNote}</span> : null}
          </div>
        ) : null}

        {/* A dropdown of what this provider actually offers, which is the
            only way to choose among OpenRouter's hundreds. A custom endpoint
            usually publishes no catalogue at all, so there it stays a field
            you type into -- an empty picker would be a dead end. */}
        {catalogue.length > 0 ? (
          // ModelPicker keeps its label sr-only, which is right in the
          // composer toolbar and wrong in a form: here the label is the only
          // thing saying what the chip is. `relative` is what its popup
          // anchors to -- without it the list positions against whatever
          // ancestor happens to be positioned.
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="provider-model" className="text-sm font-medium">
              {t('provider.model')}
            </label>
            {/* `relative` wraps the control ALONE: with the hint inside it,
                the list opened a line below the field and read as detached. */}
            <div className="relative">
            <ModelPicker
              id="provider-model"
              label={t('provider.model')}
              value={model}
              options={catalogue}
              placeholder={t('chat.searchModels')}
              noResults={t('chat.noModelsFound')}
              onChange={setModel}
              layout="field"
            />
            </div>
            <span className="text-xs text-[var(--muted)]">{t('provider.modelHint')}</span>
          </div>
        ) : (
          <TextField
            id="provider-model"
            data-testid="provider-model"
            label={t('provider.model')}
            hint={t('provider.modelHint')}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        )}

        {/* The Service Model, beside the credential (docs/specs/Spec-Pop-General.md §15, corrected
            07/08). It used to be one global setting, which could not be right:
            a model id only means something inside one provider's catalogue, so
            a single stored id was wrong for every provider but one. Shown
            resolved -- equal to the chat model until the user picks something
            else -- and picking the chat model again is what clears it. */}
        {catalogue.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="provider-service-model" className="text-sm font-medium">
              {t('provider.serviceModel')}
            </label>
            <div className="relative">
              <ModelPicker
                id="provider-service-model"
                label={t('provider.serviceModel')}
                value={serviceModel}
                options={catalogue}
                placeholder={t('chat.searchModels')}
                noResults={t('chat.noModelsFound')}
                onChange={setServiceModel}
                layout="field"
              />
            </div>
            <span className="text-xs text-[var(--muted)]">
              {serviceModel.trim() === model.trim()
                ? t('provider.serviceModelSame')
                : t('provider.serviceModelHint')}
            </span>
          </div>
        ) : (
          <TextField
            id="provider-service-model"
            data-testid="provider-service-model"
            label={t('provider.serviceModel')}
            hint={t('provider.serviceModelHint')}
            value={serviceModel}
            onChange={(event) => setServiceModel(event.target.value)}
          />
        )}

        <Select
          id="provider-priority"
          data-testid="provider-priority"
          label={t('provider.priority')}
          hint={t('provider.priorityHint')}
          value={String(priority)}
          disabled={positions <= 1}
          onChange={(event) => setPriority(Number(event.target.value))}
        >
          {Array.from({ length: Math.max(positions, 1) }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
            </option>
          ))}
        </Select>

        <div className="flex gap-2">
          <Button type="button" data-testid="provider-save" disabled={saving || missingRequiredConfiguration} onClick={() => void save()}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
