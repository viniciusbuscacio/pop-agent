import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { useAuthStore } from '../store/auth';
import { Button, Card, CenteredScreen, TextField } from '../ui/controls';
import { RecoveryKeyPanel } from '../ui/recovery-key-panel';

/**
 * First-run wizard (popy.spec §9). Four steps in one component: refreshing
 * mid-wizard sends the user back to the start, which is the right trade for a
 * flow that runs exactly once and must not leave a half-made account behind.
 */

const MIN_PASSWORD = 10;

type Step = 'password' | 'recovery' | 'provider' | 'done';

export function SetupPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);

  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canSubmitPassword = password.length >= MIN_PASSWORD && confirmation === password && !busy;

  async function submitPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmitPassword) return;

    setBusy(true);
    setError(undefined);
    try {
      const result = await authService.setup(password);
      // The first device is trusted by definition: it just created the account.
      signIn(result.token, true);
      setRecoveryKey(result.recoveryKey);
      setStep('recovery');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredScreen>
      <Card>
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

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="setup-saved-key"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
              />
              {t('setup.recovery.confirm')}
            </label>

            <Button
              type="button"
              data-testid="setup-recovery-continue"
              disabled={!saved}
              onClick={() => setStep('provider')}
            >
              {t('common.continue')}
            </Button>
          </div>
        ) : null}

        {step === 'provider' ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('setup.provider.title')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.provider.body')}</p>
            </header>

            <Button type="button" data-testid="setup-skip-provider" onClick={() => setStep('done')}>
              {t('setup.provider.skip')}
            </Button>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('setup.done.title')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('setup.done.body')}</p>
            </header>

            <Button type="button" data-testid="setup-finish" onClick={() => navigate('/')}>
              {t('setup.done.enter')}
            </Button>
          </div>
        ) : null}
      </Card>
    </CenteredScreen>
  );
}

/**
 * Length only. Popy asks for ten characters and nothing else (no symbol
 * rules), so the meter should measure the thing that is actually required.
 */
function StrengthMeter({ password }: { password: string }) {
  const level = password.length >= 20 ? 2 : password.length >= 14 ? 1 : 0;
  const labels = [t('setup.strength.weak'), t('setup.strength.fair'), t('setup.strength.strong')];
  const colours = ['var(--danger)', 'var(--muted)', 'var(--success)'];

  return (
    <div className="flex items-center gap-3" data-testid="setup-strength">
      <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--border)]">
        <div
          className="h-full transition-all"
          style={{ width: `${String((level + 1) * 33)}%`, background: colours[level] }}
        />
      </div>
      <span className="w-14 text-right text-xs text-[var(--muted)]">
        {password.length === 0 ? '' : labels[level]}
      </span>
    </div>
  );
}
