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
    if (answer.length === 0) return;
    try {
      await providersService.oauthInput(provider.id, answer);
      setAnswer('');
      absorb(await providersService.oauthState(provider.id));
    } catch {
      // The next poll tells the truth.
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
          {flow.events.map((event, index) => (
            <OAuthEventRow key={index} event={event} />
          ))}

          {flow.pending !== undefined && flow.pending.type !== 'select' ? (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`oauth-answer-${provider.id}`}
                className="text-sm text-[var(--key-fg-dim)]"
              >
                {flow.pending.message}
              </label>
              {flow.pending.type === 'manual_code' ? (
                <p className="text-xs text-[var(--muted)]">{t('provider.oauth.loopbackHint')}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`oauth-answer-${provider.id}`}
                  data-testid={`provider-oauth-answer-${provider.id}`}
                  type={flow.pending.type === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={flow.pending.placeholder ?? t('provider.oauth.answerPlaceholder')}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  className={`w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)] ${flow.pending.type === 'manual_code' ? '' : 'max-w-xs'}`}
                />
                <Button
                  type="button"
                  data-testid={`provider-oauth-submit-${provider.id}`}
                  disabled={answer.length === 0}
                  onClick={() => void submit()}
                >
                  {t('provider.oauth.submit')}
                </Button>
              </div>
            </div>
          ) : null}

          {flow.pending !== undefined && flow.pending.type === 'select' ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--key-fg-dim)]">{flow.pending.message}</p>
              <div className="flex flex-wrap gap-2">
                {(flow.pending.options ?? []).map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      void providersService
                        .oauthInput(provider.id, option.id)
                        .then(() => providersService.oauthState(provider.id))
                        .then(absorb)
                        .catch(() => undefined);
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
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
          <p className="text-sm text-[var(--muted)]">{t('provider.oauth.deviceCode')}</p>
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
