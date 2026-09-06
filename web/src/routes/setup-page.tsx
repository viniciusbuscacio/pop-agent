import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OnboardingStateResponse } from '@pop-agent/shared';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { pendingRecovery } from '../services/pending-recovery';
import { onboardingService, onboardingSession } from '../services/onboarding';
import { prepareTailscaleSignIn, type PendingTailscaleSignIn } from '../services/tailscale-sign-in';
import { secureSetupDestination, setupNavigation } from '../services/setup-navigation';
import { ProvidersSection } from './providers-section';
import { session } from '../services/session';
import { useAuthStore } from '../store/auth';
import { Button, Card, CenteredScreen, CheckField, TextField } from '../ui/controls';
import { RecoveryKeyPanel } from '../ui/recovery-key-panel';
import { LoadingState } from '../ui/loading-state';

/**
 * First-run wizard (docs/specs/Spec-Pop-General.md §9). Four steps in one component: refreshing
 * mid-wizard sends the user back to the start, which is the right trade for a
 * flow that runs exactly once and must not leave a half-made account behind.
 */

const MIN_PASSWORD = 10;

type Step = 'loading' | 'unavailable' | 'network' | 'password' | 'recovery' | 'provider' | 'done';

export function SetupPage() {
  const navigate = useNavigate();
  const setStatus = useAuthStore((state) => state.setStatus);
  const [pendingKey] = useState(() => pendingRecovery.read('setup'));

  const [step, setStep] = useState<Step>(pendingKey === undefined ? 'loading' : 'recovery');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryKey, setRecoveryKey] = useState(pendingKey ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canSubmitPassword = password.length >= MIN_PASSWORD && confirmation === password && !busy;

  useEffect(() => {
    if (pendingKey !== undefined) return;
    let cancelled = false;
    void authService.state()
      .then((state) => {
        if (!cancelled) setStep(state.setupMode === 'network' ? 'network' : 'password');
      })
      .catch(() => {
        if (!cancelled) setStep('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [pendingKey]);

  async function submitPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmitPassword) return;

    setBusy(true);
    setError(undefined);
    try {
      const result = await authService.setup(password);
      // Keep the token page-scoped and leave auth routing in setup mode until
      // the one-time recovery key is explicitly acknowledged.
      session.start(result.token, false);
      pendingRecovery.write('setup', result.recoveryKey);
      setRecoveryKey(result.recoveryKey);
      setStep('recovery');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeRecovery(): Promise<void> {
    if (!saved || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await authService.acknowledgeSetup();
      pendingRecovery.clear();
      setStep('provider');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'loading') return <CenteredScreen><LoadingState /></CenteredScreen>;

  if (step === 'provider') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <ProvidersSection onSetupDone={() => setStep('done')} />
        </div>
      </main>
    );
  }

  return (
    <CenteredScreen>
      <Card>
        {step === 'unavailable' ? (
          <p role="alert" className="text-sm text-[var(--danger)]">{t('setup.stateFailed')}</p>
        ) : null}

        {step === 'network' ? <NetworkSetupStep /> : null}

        {step === 'password' ? (
          <form className="flex flex-col gap-5" onSubmit={(event) => void submitPassword(event)}>
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('setup.welcome.title')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.welcome.body')}</p>
            </header>

            <TextField
              id="setup-password"
              data-testid="setup-password"
              type="password"
              autoComplete="new-password"
              label={t('setup.password.label')}
              hint={t('setup.password.hint')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...(tooShort ? { error: t('setup.password.tooShort') } : {})}
            />

            <TextField
              id="setup-password-confirm"
              data-testid="setup-password-confirm"
              type="password"
              autoComplete="new-password"
              label={t('setup.password.confirmLabel')}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              {...(mismatch ? { error: t('setup.password.mismatch') } : {})}
            />

            <StrengthMeter password={password} />

            {error !== undefined ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <Button type="submit" data-testid="setup-submit" disabled={!canSubmitPassword}>
              {t('common.continue')}
            </Button>
          </form>
        ) : null}

        {step === 'recovery' ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('setup.recovery.title')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.recovery.body')}</p>
            </header>

            <RecoveryKeyPanel recoveryKey={recoveryKey} idPrefix="setup" />

            {error !== undefined ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <CheckField
              id="setup-saved-key"
              testId="setup-saved-key"
              label={t('setup.recovery.confirm')}
              checked={saved}
              onChange={setSaved}
            />

            <Button
              type="button"
              data-testid="setup-recovery-continue"
              disabled={!saved}
              onClick={() => void acknowledgeRecovery()}
            >
              {t('common.continue')}
            </Button>
          </div>
        ) : null}


        {step === 'done' ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('setup.done.title')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.done.body')}</p>
            </header>

            <Button
              type="button"
              data-testid="setup-finish"
              onClick={() => {
                setStatus('signed-in');
                void navigate('/');
              }}
            >
              {t('setup.done.enter')}
            </Button>
          </div>
        ) : null}
      </Card>
    </CenteredScreen>
  );
}

function NetworkSetupStep() {
  const pendingSignIn = useRef<PendingTailscaleSignIn | undefined>(undefined);
  useEffect(() => () => {
    pendingSignIn.current?.close();
    pendingSignIn.current = undefined;
  }, []);
  const [token, setToken] = useState(() => onboardingSession.read());
  const [code, setCode] = useState('');
  const [state, setState] = useState<OnboardingStateResponse | undefined>();
  const [publicSecureUrl, setPublicSecureUrl] = useState<string | undefined>();
  const [loginUrl, setLoginUrl] = useState<string | undefined>();
  const [hostname, setHostname] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const secureUrl = (state?.phase === 'secure' ? state.secureUrl : undefined) ?? publicSecureUrl;
  const secureTarget = secureSetupDestination(secureUrl);
  const [preparingHttps, setPreparingHttps] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [probeAttempt, setProbeAttempt] = useState(0);
  useEffect(() => {
    if (secureTarget === undefined || new URL(secureTarget).origin === window.location.origin) return;
    setHandoffFailed(false);
    const fallbackTimer = window.setTimeout(() => setHandoffFailed(true), 3_000);
    try {
      // The server verifies HTTPS before returning secure. Navigate at the top
      // level: insecure pages cannot probe private HTTPS using subresources.
      setupNavigation.replace(secureTarget);
    } catch { setHandoffFailed(true); }
    return () => window.clearTimeout(fallbackTimer);
  }, [secureTarget, probeAttempt]);

  useEffect(() => {
    let cancelled = false;
    const current = onboardingSession.read();
    const request = current === undefined
      ? onboardingService.publicState().then((value) => {
          if (!cancelled && value.phase === 'secure') setPublicSecureUrl(value.secureUrl);
        })
      : onboardingService.state(current).then((value) => {
          if (!cancelled) setState(value);
        });
    void request.catch(() => {
      if (!cancelled && current !== undefined) {
        onboardingSession.clear();
        setToken(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (token === undefined || state?.phase !== 'tailscale') return;
    const timer = window.setInterval(() => {
      void onboardingService.state(token).then(setState).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [state?.phase, token]);

  async function pair(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (code.trim().length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onboardingService.pair(code);
      onboardingSession.write(result.token);
      setToken(result.token);
      setState(result.state);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    if (token === undefined || busy || pendingSignIn.current !== undefined) return;
    const pending = prepareTailscaleSignIn(t('setup.network.preparing'));
    pendingSignIn.current = pending;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onboardingService.connect(token);
      if (pendingSignIn.current !== pending) return;
      if (result.loginUrl !== undefined) {
        pending.navigate(result.loginUrl);
        setLoginUrl(result.loginUrl);
      } else pending.close();
      setState(result);
    } catch (cause) {
      pending.close();
      if (pendingSignIn.current === pending) {
        setError(cause instanceof ApiError ? cause.message : t('error.generic'));
      }
    } finally {
      if (pendingSignIn.current === pending) {
        pendingSignIn.current = undefined;
        setBusy(false);
      }
    }
  }

  async function enableHttps(): Promise<void> {
    if (token === undefined || !accepted || busy) return;
    setBusy(true);
    setPreparingHttps(true);
    setError(undefined);
    try {
      setState(await onboardingService.enableHttps(token, accepted, hostname.trim()));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
      setPreparingHttps(false);
    }
  }

  if (preparingHttps || secureUrl !== undefined) {
    return (
      <div className="flex flex-col gap-5" data-testid="onboarding-https-loading">
        {secureUrl !== undefined && secureTarget === undefined ? <p role="alert">{t('error.generic')}</p> : <>
          {!handoffFailed ? <LoadingState label={t('chat.working')} /> : null}
          <p role={handoffFailed ? 'alert' : undefined} className="text-sm text-[var(--key-fg-dim)]">
            {handoffFailed ? t('setup.network.waitFailed') : t('setup.network.preparingHttps')}
          </p>
          {handoffFailed && secureTarget !== undefined ? <>
            <Button type="button" data-testid="onboarding-retry-https" onClick={() => setProbeAttempt((value) => value + 1)}>
              {t('setup.network.retryConnection')}
            </Button>
            <a data-testid="onboarding-secure-link" href={secureTarget}>{t('setup.network.continueSecurely')}</a>
          </> : null}
        </>}
      </div>
    );
  }

  if (token === undefined) {
    return (
      <form className="flex flex-col gap-5" onSubmit={(event) => void pair(event)}>
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{t('setup.network.pairTitle')}</h1>
          <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.network.pairBody')}</p>
        </header>
        <TextField
          id="onboarding-code"
          data-testid="onboarding-code"
          autoComplete="one-time-code"
          label={t('setup.network.codeLabel')}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        {error !== undefined ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
        <Button type="submit" data-testid="onboarding-pair" disabled={busy || code.trim().length === 0}>
          {t('common.continue')}
        </Button>
      </form>
    );
  }

  if (state?.phase === 'https') {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{t('setup.network.httpsTitle')}</h1>
          <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.network.httpsBody')}</p>
        </header>
        <TextField
          id="onboarding-hostname"
          data-testid="onboarding-hostname"
          label={t('setup.network.hostnameLabel')}
          hint={t('setup.network.hostnameHint')}
          placeholder="pop-agent"
          value={hostname}
          onChange={(event) => setHostname(event.target.value.toLowerCase())}
        />
        <CheckField
          id="onboarding-certificate-notice"
          testId="onboarding-certificate-notice"
          label={t('setup.network.certificateNotice')}
          checked={accepted}
          onChange={setAccepted}
        />
        {state.approvalUrl !== undefined ? (
          <a
            data-testid="onboarding-https-approval"
            className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--screen-fg)] hover:bg-[var(--panel-hover)]"
            href={state.approvalUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t('setup.network.openHttpsApproval')}
          </a>
        ) : null}
        {error !== undefined ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
        <Button
          type="button"
          data-testid="onboarding-enable-https"
          disabled={!accepted || busy}
          onClick={() => void enableHttps()}
        >
          {state.approvalUrl === undefined ? t('setup.network.enableHttps') : t('setup.network.retryHttps')}
        </Button>
      </div>
    );
  }

  if (state?.phase === 'blocked') {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{t('setup.network.blockedTitle')}</h1>
          <p role="alert" className="text-sm text-[var(--danger)]">
            {blockedMessage(state.issue)}
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t('setup.network.tailscaleTitle')}</h1>
        <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.network.tailscaleBody')}</p>
      </header>
      {loginUrl === undefined ? (
        <Button type="button" data-testid="onboarding-connect" disabled={busy} onClick={() => void connect()}>
          {busy ? t('setup.network.preparing') : t('setup.network.connect')}
        </Button>
      ) : (
        <a
          data-testid="onboarding-login-link"
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--screen-fg)] hover:bg-[var(--panel-hover)]"
          href={loginUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('setup.network.openTailscale')}
        </a>
      )}
      <p className="text-xs text-[var(--muted)]">{t('setup.network.tailnetDevice')}</p>
      {error !== undefined ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

function blockedMessage(issue: OnboardingStateResponse['issue']): string {
  if (issue === 'tailscale_missing') return t('setup.network.missing');
  if (issue === 'serve_conflict') return t('setup.network.conflict');
  return t('setup.network.failed');
}

/**
 * Length only. Pop Agent asks for ten characters and nothing else (no symbol
 * rules), so the meter should measure the thing that is actually required.
 */
function StrengthMeter({ password }: { password: string }) {
  const empty = password.length === 0;
  const level = password.length >= 20 ? 2 : password.length >= 14 ? 1 : 0;
  const labels = [t('setup.strength.weak'), t('setup.strength.fair'), t('setup.strength.strong')];
  const colours = ['var(--danger)', 'var(--muted)', 'var(--success)'];

  return (
    <div className="flex items-center gap-3" data-testid="setup-strength">
      <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--border)]">
        {/* An untouched field is not "weak" -- it is unanswered, so the bar
            stays empty until there is something to judge. */}
        <div
          className="h-full transition-all"
          style={{
            width: empty ? '0%' : `${String((level + 1) * 33)}%`,
            background: colours[level],
          }}
        />
      </div>
      <span className="w-14 text-right text-xs text-[var(--muted)]">{empty ? '' : labels[level]}</span>
    </div>
  );
}
