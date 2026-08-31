import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { passkeyService } from '../services/passkey';
import { useAuthStore } from '../store/auth';
import { Button, Card, CenteredScreen, CheckField, TextField } from '../ui/controls';

/**
 * Vault-style login: one password field, no user name (docs/specs/Spec-Pop-General.md §9).
 *
 * When the server locks the account, the countdown ticks on screen rather than
 * showing a frozen number -- being told "wait 4 minutes" and having no idea
 * how much of it is left is the frustrating version of this screen.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);

  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lockedFor, setLockedFor] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockedFor]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || password.length === 0 || lockedFor > 0) return;

    setBusy(true);
    setError(undefined);
    try {
      const { token } = await authService.login(password);
      signIn(token, keepSignedIn);
      void navigate('/');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'setup_incomplete') {
        void navigate('/setup');
      } else if (cause instanceof ApiError && cause.code === 'locked') {
        setLockedFor(cause.retryAfterSeconds ?? 30);
        setError(undefined);
      } else if (cause instanceof ApiError && cause.code === 'rate_limited') {
        setError(t('login.rateLimited'));
      } else if (cause instanceof ApiError && cause.code === 'invalid_credentials') {
        setError(t('login.invalid'));
      } else {
        setError(t('error.generic'));
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPasskey(): Promise<void> {
    setError(undefined);
    try {
      const token = await passkeyService.login();
      signIn(token, keepSignedIn);
      void navigate('/');
    } catch (cause) {
      // A cancel is not an error; a real failure is.
      if (cause instanceof ApiError) setError(t('login.invalid'));
    }
  }

  return (
    <CenteredScreen>
      <Card>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>

          <TextField
            id="login-password"
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            label={t('login.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            {...(error !== undefined ? { error } : {})}
          />

          {lockedFor > 0 ? (
            <p role="alert" data-testid="login-locked" className="text-sm text-[var(--danger)]">
              {t('login.locked', { seconds: lockedFor })}
            </p>
          ) : null}

          <CheckField
            id="login-keep-signed-in"
            testId="login-keep-signed-in"
            label={t('login.keepSignedIn')}
            checked={keepSignedIn}
            onChange={setKeepSignedIn}
          />

          <Button
            type="submit"
            data-testid="login-submit"
            disabled={busy || password.length === 0 || lockedFor > 0}
          >
            {t('login.submit')}
          </Button>

          {passkeyService.supported() ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="login-passkey"
              onClick={() => void unlockWithPasskey()}
            >
              {t('login.passkey')}
            </Button>
          ) : null}

          <div className="min-h-6 text-center">
            <Link
              to="/recover"
              data-testid="login-forgot"
              className="text-xs text-[var(--muted)] underline underline-offset-2"
            >
              {t('login.forgot')}
            </Link>
          </div>
        </form>
      </Card>
    </CenteredScreen>
  );
}
