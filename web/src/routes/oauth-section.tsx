import { useEffect, useState } from 'react';
import type { OAuthStateResponse, ProviderStatusDTO, ProvidersResponse } from '@popy/shared';
import { t } from '../i18n';
import { providersService } from '../services/providers';
import { Button } from '../ui/controls';

/**
 * The subscription sign-in, inline in the provider's card (popy.spec §15,
 * fase 1.5). The flow runs on the server; this section starts it, polls its
 * transcript every two seconds and renders it: a link to open, a device code
 * to type, at most one question to answer. No token ever reaches the browser.
 */

/**
 * The login methods pi offers for a subscription, by the id it sends. Popy
 * relabels them because pi's own wording sells the wrong one: it calls the
 * browser redirect "(default)", and that redirect is the one method that
 * cannot complete on a self-hosted install -- the provider sends the browser
 * to a loopback address on the machine doing the browsing, which is not the
 * machine running Popy. The code method has no callback at all, so it is the
 * one that works from any device, and it leads here.
 */
const METHOD_DEVICE_CODE = 'device_code';
const METHOD_BROWSER = 'browser';

const METHOD_COPY: Record<string, { label: string; hint: string; rank: number }> = {
  [METHOD_DEVICE_CODE]: {
    label: t('provider.oauth.method.deviceCode'),
    hint: t('provider.oauth.method.deviceCodeHint'),
    rank: 0,
  },
  [METHOD_BROWSER]: {
    label: t('provider.oauth.method.browser'),
    hint: t('provider.oauth.method.browserHint'),
    rank: 1,
  },
};

export function OAuthSection({
  provider,
  onChanged,
}: {
  provider: ProviderStatusDTO;
  onChanged: (response: ProvidersResponse) => void;
}) {
  const [flow, setFlow] = useState<OAuthStateResponse | undefined>(undefined);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const active = flow !== undefined && !flow.done;
  // The paste path: pi asks for it only when the browser redirect was chosen
  // and its own loopback server is still waiting for a code that will never
  // arrive here. It is the step that needs the most hand-holding.
  const pastePending = flow?.pending?.type === 'manual_code';

  // A finished, successful flow refreshes the card's status from the truth.
  // Done here rather than in an effect so a parent re-render can never loop
  // the refresh: only the callback that sees the transition triggers it.
  function absorb(next: OAuthStateResponse): void {
    setFlow(next);
    if (next.done && next.ok === true) {
      providersService
        .list()
        .then(onChanged)
        .catch(() => undefined);
    }
  }

  // A sign-in already running on the server has to be visible here even when
  // this page was reloaded, closed or reopened while the browser was away at
  // the provider -- which is the normal path, not an edge case. Without this
  // the card offered "Sign in" again while the server sat waiting for the
  // code, and a perfectly healthy flow looked broken. A 404 (nothing running)
  // is the common answer and leaves the card alone.
  useEffect(() => {
    let dropped = false;
    providersService
      .oauthState(provider.id)
      .then((state) => {
        if (dropped || state.done) return;
        if (provider.configured) {
          // Already signed in, yet a flow is still waiting for a code: the
          // leftover of a second attempt nobody needed. Rendering it under
          // "Connected" states two contradictory things at once, which is
          // worse than either -- so close it and let the status speak.
          void providersService.oauthCancel(provider.id).catch(() => undefined);
          return;
        }
        setFlow(state);
      })
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [provider.id, provider.configured]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      providersService
        .oauthState(provider.id)
        .then(absorb)
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
    // absorb is recreated per render but only reads props/state it is given.
  }, [active, provider.id]);

  async function start(): Promise<void> {
    setBusy(true);
    setAnswer('');
    try {
      await providersService.oauthStart(provider.id);
      setFlow(await providersService.oauthState(provider.id));
    } catch {
      setFlow(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    // The same question the button asks, and the one that actually decides:
    // for a free-text prompt an empty answer is an ANSWER. GitHub Copilot's
    // "GitHub Enterprise URL/domain (blank for github.com)" is exactly that,
    // and this line sent it nowhere however the user pressed it.
    if (answer.length === 0 && flow?.pending?.type !== 'text') return;
    try {
      await providersService.oauthInput(provider.id, answer);
      setAnswer('');
      absorb(await providersService.oauthState(provider.id));
    } catch {
      // The next poll tells the truth.
    }
  }

  async function choose(optionId: string): Promise<void> {
    try {
      await providersService.oauthInput(provider.id, optionId);
      absorb(await providersService.oauthState(provider.id));
    } catch {
      // Same: the poll owns the state.
    }
  }

  async function cancel(): Promise<void> {
    try {
      await providersService.oauthCancel(provider.id);
      setFlow(await providersService.oauthState(provider.id));
    } catch {
      // Same: the poll owns the state.
    }
  }

  async function disconnect(): Promise<void> {
    try {
      onChanged(await providersService.oauthLogout(provider.id));
      setFlow(undefined);
    } catch {
      // Leave the card as it is; the next reload tells the truth.
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid={`provider-oauth-${provider.id}`}>
      <p className="text-xs text-[var(--muted)]">{t('provider.oauth.hint')}</p>

      {flow !== undefined ? (
        <div className="flex flex-col gap-2">
          {flow.events.map((event, index) =>
            // The paste steps below carry the sign-in link themselves, so the
            // transcript must not offer a second copy of the same link.
            pastePending && event.type === 'auth_url' ? null : (
              <OAuthEventRow key={index} event={event} />
            ),
          )}

          {flow.pending !== undefined && flow.pending.type !== 'select' ? (
            <div className="flex flex-col gap-2">
              {pastePending ? <PasteSteps events={flow.events} /> : null}
              <label
                htmlFor={`oauth-answer-${provider.id}`}
                // Step three already says what goes in the box; a visible
                // label here would be the same sentence a third time.
                className={pastePending ? 'sr-only' : 'text-sm text-[var(--key-fg-dim)]'}
              >
                {pastePending ? t('provider.oauth.paste.label') : flow.pending.message}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`oauth-answer-${provider.id}`}
                  data-testid={`provider-oauth-answer-${provider.id}`}
                  type={flow.pending.type === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={
                    // pi's own placeholder for this prompt is the loopback URL
                    // itself, which reads like something to type rather than an
                    // example of what to paste.
                    pastePending
                      ? t('provider.oauth.paste.placeholder')
                      : flow.pending.placeholder ?? t('provider.oauth.answerPlaceholder')
                  }
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  // Enter sends it. The input sits outside a <form>, so
                  // nothing submitted it before: the only way through was the
                  // mouse, on a screen whose whole content is one question and
                  // one text field.
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void submit();
                  }}
                  className={`w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)] ${pastePending ? '' : 'max-w-xs'}`}
                />
                <Button
                  type="button"
                  data-testid={`provider-oauth-submit-${provider.id}`}
                  // Empty is a real answer to a free-text question: GitHub
                  // Copilot asks for an Enterprise domain and says "blank for
                  // github.com", so a guard on length made the one correct
                  // answer the one you could not give (Vinicius, 05/08).
                  // Kept for `secret` and `manual_code`, where an empty value
                  // is never meaningful and an accidental click should not
                  // spend the prompt. What is valid is the server's call, not
                  // this component's.
                  disabled={flow.pending.type === 'text' ? false : answer.length === 0}
                  onClick={() => void submit()}
                >
                  {t('provider.oauth.submit')}
                </Button>
              </div>
            </div>
          ) : null}

          {flow.pending !== undefined && flow.pending.type === 'select' ? (
            <MethodChoice
              message={flow.pending.message}
              options={flow.pending.options ?? []}
              providerId={provider.id}
              onChoose={(optionId) => void choose(optionId)}
            />
          ) : null}

          {active && flow.pending === undefined ? (
            <p className="text-sm text-[var(--muted)]">{t('provider.oauth.waiting')}</p>
          ) : null}

          {flow.done && flow.ok === true ? (
            <p role="status" className="text-sm text-[var(--success)]">
              {t('provider.oauth.done')}
            </p>
          ) : null}
          {flow.done && flow.ok !== true ? (
            <p
              role="status"
              data-testid={`provider-oauth-error-${provider.id}`}
              className="text-sm text-[var(--danger)]"
            >
              {t('provider.oauth.failed', { message: flow.error ?? '' })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!active ? (
          <Button
            type="button"
            data-testid={`provider-oauth-signin-${provider.id}`}
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? t('provider.oauth.starting') : t('provider.oauth.signIn')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={() => void cancel()}>
            {t('provider.oauth.cancel')}
          </Button>
        )}
        {provider.configured ? (
          <Button
            type="button"
            variant="danger"
            data-testid={`provider-oauth-disconnect-${provider.id}`}
            onClick={() => void disconnect()}
          >
            {t('provider.oauth.disconnect')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How to sign in, when the flow offers a choice. pi's two known methods get
 * Popy's own words and the one that works everywhere goes first; anything
 * else pi may add later is rendered as it arrives, unrelabelled.
 */
function MethodChoice({
  message,
  options,
  providerId,
  onChoose,
}: {
  message: string;
  options: { id: string; label: string; description?: string }[];
  providerId: string;
  onChoose: (optionId: string) => void;
}) {
  const known = options.length > 0 && options.every((option) => METHOD_COPY[option.id] !== undefined);
  const ordered = known
    ? [...options].sort((a, b) => (METHOD_COPY[a.id]?.rank ?? 0) - (METHOD_COPY[b.id]?.rank ?? 0))
    : options;

  return (
    <div className="flex flex-col gap-2" data-testid={`provider-oauth-method-${providerId}`}>
      <p className="text-sm text-[var(--key-fg-dim)]">
        {known ? t('provider.oauth.method.title') : message}
      </p>
      <div className={known ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {ordered.map((option) => {
          const copy = METHOD_COPY[option.id];
          return (
            <Button
              key={option.id}
              type="button"
              variant="ghost"
              className={copy === undefined ? '' : 'flex-col items-start gap-0.5 text-left'}
              onClick={() => onChoose(option.id)}
            >
              <span>{copy?.label ?? option.label}</span>
              {copy === undefined ? null : (
                <span className="text-xs font-normal text-[var(--muted)]">{copy.hint}</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The three steps of the browser-redirect path, in order, said once each.
 * The middle one is the whole reason this exists: the browser lands on a page
 * that fails to load, and without being told beforehand that this is the
 * expected outcome, a user reads it as a broken sign-in and gives up there.
 */
function PasteSteps({ events }: { events: OAuthStateResponse['events'] }) {
  let authUrl: string | undefined;
  for (const event of events) {
    if (event.type === 'auth_url') authUrl = event.url;
  }

  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-[var(--screen-fg)]">
      <li>
        {t('provider.oauth.paste.step1')}
        {authUrl === undefined ? null : (
          <a href={authUrl} target="_blank" rel="noreferrer" className="ml-2 underline">
            {t('provider.oauth.openLink')}
          </a>
        )}
      </li>
      <li className="text-[var(--muted)]">{t('provider.oauth.paste.step2')}</li>
      <li>{t('provider.oauth.paste.step3')}</li>
    </ol>
  );
}

/** One line of the sign-in transcript, rendered by what it is. */
function OAuthEventRow({ event }: { event: OAuthStateResponse['events'][number] }) {
  switch (event.type) {
    case 'info':
      return (
        <p className="text-sm text-[var(--screen-fg)]">
          {event.message}
          {(event.links ?? []).map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="ml-2 underline"
            >
              {link.label ?? link.url}
            </a>
          ))}
        </p>
      );
    case 'auth_url':
      return (
        <p className="text-sm">
          <a href={event.url} target="_blank" rel="noreferrer" className="underline">
            {t('provider.oauth.openLink')}
          </a>
          {event.instructions !== undefined ? (
            <span className="ml-2 text-[var(--muted)]">{event.instructions}</span>
          ) : null}
        </p>
      );
    case 'device_code':
      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-[var(--screen-fg)]">{t('provider.oauth.deviceCode')}</p>
          <p className="font-mono text-2xl tracking-widest">{event.userCode}</p>
          <a
            href={event.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            {event.verificationUri}
          </a>
        </div>
      );
    case 'progress':
      return <p className="text-sm text-[var(--muted)]">{event.message}</p>;
  }
}
