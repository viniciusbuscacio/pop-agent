import { useEffect, useState } from 'react';
import type { ProviderStatusDTO, ProvidersResponse } from '@pop-agent/shared';
import { t } from '../i18n';
import { normalizeBaseUrl, providersService } from '../services/providers';
import { chatsService } from '../services/chats';
import {
  Button,
  Card,
  ModelPicker,
  Select,
  TextField,
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

export function ProvidersSection() {
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void providersService
      .list()
      .then((response) => setProviders(response.providers))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  /** Configured is the only thing this screen counts: it is what you have. */
  const configured = providers
    .filter((provider) => provider.configured)
    .sort((left, right) => left.order - right.order);

  function absorb(response: ProvidersResponse): void {
    setProviders(response.providers);
  }

  if (!loaded) return <Card>{t('app.loading')}</Card>;

  if (view.kind === 'pick') {
    return (
      <PickProvider
        configured={configured}
        onCancel={() => setView({ kind: 'list' })}
        onPicked={(providerId) => setView({ kind: 'configure', providerId, adding: true })}
        onCreatedCustom={(response, id) => {
          absorb(response);
          setView({ kind: 'configure', providerId: id, adding: true });
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
        onDone={() => setView({ kind: 'list' })}
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

      {configured.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t('provider.none')}</p>
        </Card>
      ) : (
        configured.map((provider, index) => (
          <Card key={provider.id} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold" data-testid="provider-card-name">
                  {provider.name}
                </p>
                <Balance providerId={provider.id} />
                <p className="truncate text-xs text-[var(--muted)]">
                  {t('provider.priorityBadge', { n: index + 1 })}
                  {provider.defaultModel === '' ? '' : ` · ${provider.defaultModel}`}
                  {provider.authType === 'oauth' ? ` · ${t('provider.bySubscription')}` : ''}
                </p>
              </div>
              <span className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="provider-edit"
                  onClick={() =>
                    setView({ kind: 'configure', providerId: provider.id, adding: false })
                  }
                >
                  {t('common.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="provider-delete"
                  onClick={() => void remove(provider, absorb)}
                >
                  {t('shell.delete')}
                </Button>
              </span>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/**
 * The provider's own balance, for the ones that publish one (OpenRouter does).
 * Silent when it does not, or when the call fails: a row that cannot be
 * fetched is not news, and guessing at a number here would be worse than
 * saying nothing.
 */
function Balance({ providerId }: { providerId: string }) {
  const [credits, setCredits] = useState<{ remaining: number; used: number } | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void providersService
      .credits(providerId)
      .then((value) => {
        if (live) setCredits(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [providerId]);

  if (credits === undefined) return null;
  const dollars = (value: number): string => `$${value.toFixed(2)}`;
  return (
    <p className="truncate text-xs text-[var(--muted)]" data-testid="provider-credits">
      {t('provider.credits', {
        remaining: dollars(credits.remaining),
        used: dollars(credits.used),
      })}
    </p>
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
      <button
        type="button"
        data-testid="provider-back"
        aria-label={t('common.back')}
        onClick={onBack}
        className="-ml-2 rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
      >
        ←
      </button>
      <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
    </div>
  );
}

/** Step one: which provider. A builtin already set up is not offered twice. */
function PickProvider({
  configured,
  onCancel,
  onPicked,
  onCreatedCustom,
}: {
  configured: ProviderStatusDTO[];
  onCancel: () => void;
  onPicked: (providerId: string) => void;
  onCreatedCustom: (response: ProvidersResponse, id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
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
              disabled={busy || (entry.kind !== 'custom' && taken.has(entry.id))}
              onClick={() => {
                if (entry.kind !== 'custom') return onPicked(entry.id);
                // A custom provider has no identity until the server gives it
                // one: the id anchors its key and its registry row, so it is
                // created first and configured second.
                setBusy(true);
                setError(undefined);
                providersService
                  .createCustom()
                  .then((created) => onCreatedCustom({ providers: created.providers }, created.id))
                  .catch(() => setError(t('provider.add.failed')))
                  .finally(() => setBusy(false));
              }}
              className="justify-between"
            >
              <span>{t(entry.labelKey)}</span>
              {entry.kind !== 'custom' && taken.has(entry.id) ? (
                <span className="text-xs text-[var(--muted)]">{t('provider.alreadyAdded')}</span>
              ) : null}
            </Button>
          ))}
        </div>
        {error === undefined ? null : <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
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
}: {
  provider: ProviderStatusDTO;
  configured: ProviderStatusDTO[];
  adding: boolean;
  onChanged: (response: ProvidersResponse) => void;
  onDone: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState(provider.name);
  const [baseURL, setBaseURL] = useState(provider.baseURL ?? '');
  const [model, setModel] = useState(provider.defaultModel);
  // Empty means "follow the chat model" (pop-agent.spec §15). The card shows the
  // resolved value, so a provider that never chose one still reads sensibly;
  // choosing the chat model again is what clears it.
  const [serviceModel, setServiceModel] = useState(provider.serviceModel);
  const [catalogue, setCatalogue] = useState<ModelPickerOption[]>([]);
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
    void chatsService
      .models(provider.id)
      .then((response) => {
        if (!live) return;
        setCatalogue(
          response.models.map((entry) => ({ value: entry.id, label: entry.name ?? entry.id })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [provider.id, provider.configured]);

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
        // A subscription's check never leaves the machine, so there is no
        // round trip to report and claiming one would be a small lie.
        setNote(isOAuth ? t('provider.test.signedIn') : t('provider.test.ok'));
      } else {
        setNote(t('provider.test.okLatency', { ms: Math.round(result.latencyMs) }));
      }
    } catch {
      setNote(t('provider.test.failed'));
    } finally {
      setTesting(false);
    }
  }

  /**
   * One Save writes everything the screen touched, in an order that leaves
   * nothing half-applied if a later call fails: identity first, then the key,
   * then the position.
   */
  async function save(): Promise<void> {
    setSaving(true);
    try {
      let latest: ProvidersResponse | undefined;
      if (isCustom) {
        latest = await providersService.updateCustom(provider.id, {
          name: name.trim(),
          baseURL: normalizeBaseUrl(baseURL),
          defaultModel: model.trim(),
        });
      } else if (model.trim() !== provider.defaultModel) {
        latest = await providersService.setDefaultModel(provider.id, model.trim());
      }
      if (serviceModel.trim() !== provider.serviceModel) {
        // Back to the chat model is stored as empty, so the two keep following
        // each other instead of freezing a copy of today's choice.
        const next = serviceModel.trim() === model.trim() ? '' : serviceModel.trim();
        latest = await providersService.setServiceModel(provider.id, next);
      }
      if (apiKey.trim().length > 0) {
        latest = await providersService.setKey(provider.id, apiKey.trim());
      }
      latest = await applyPriority(provider.id, priority, configured, latest);
      if (latest !== undefined) onChanged(latest);
      onDone();
    } catch {
      setNote(t('provider.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

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

        {/* The Service Model, beside the credential (pop-agent.spec §15, corrected
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
          <Button type="button" data-testid="provider-save" disabled={saving} onClick={() => void save()}>
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

/**
 * Moves one provider to a 1-based position among the configured ones and
 * sends the whole list.
 *
 * The unconfigured providers keep their relative order after the configured
 * ones: the server's list covers everything it knows about, and dropping them
 * here would silently rewrite an order the user never touched.
 */
async function applyPriority(
  providerId: string,
  position: number,
  configured: ProviderStatusDTO[],
  latest: ProvidersResponse | undefined,
): Promise<ProvidersResponse | undefined> {
  const all = latest?.providers ?? configured;
  const live = all
    .filter((entry) => entry.configured || entry.id === providerId)
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.id);

  const without = live.filter((id) => id !== providerId);
  const index = Math.min(Math.max(position - 1, 0), without.length);
  const ordered = [...without.slice(0, index), providerId, ...without.slice(index)];

  const rest = (latest?.providers ?? [])
    .filter((entry) => !ordered.includes(entry.id))
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.id);

  return providersService.setOrder([...ordered, ...rest]);
}
