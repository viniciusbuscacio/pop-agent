import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { authService } from '../services/auth';
import { useAuthStore } from '../store/auth';
import { Button, Card, CenteredScreen, CheckField, TextField } from '../ui/controls';
import { RecoveryKeyPanel } from '../ui/recovery-key-panel';

/**
 * Recovery: prove the key, set a new password, and receive a replacement key.
 *
 * The replacement is not a nicety -- the server spends the key that was used,
 * so this screen is the only place the new one is ever shown.
 */
const MIN_PASSWORD = 10;

export function RecoverPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);

  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canSubmit =
    recoveryKey.trim().length > 0 && password.length >= MIN_PASSWORD && password === confirmation && !busy;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(undefined);
    try {
      const result = await authService.recover(recoveryKey, password);
      signIn(result.token, true);
      setIssuedKey(result.recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'invalid_credentials'
          ? t('recover.invalid')
          : t('error.generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (issuedKey !== undefined) {
    return (
      <CenteredScreen>
        <Card>
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">{t('recover.newKeyTitle')}</h1>
              <p className="text-sm text-[var(--key-fg-dim)]">{t('recover.newKeyBody')}</p>
            </header>

            <RecoveryKeyPanel recoveryKey={issuedKey} idPrefix="recover" />

            <CheckField
              id="recover-saved-key"
              testId="recover-saved-key"
              label={t('setup.recovery.confirm')}
              checked={saved}
              onChange={setSaved}
            />

            <Button
              type="button"
              data-testid="recover-finish"
              disabled={!saved}
              onClick={() => navigate('/')}
            >
              {t('common.continue')}
            </Button>
          </div>
        </Card>
      </CenteredScreen>
    );
  }

  return (
    <CenteredScreen>
      <Card>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <header className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold">{t('recover.title')}</h1>
            <p className="text-sm text-[var(--key-fg-dim)]">{t('recover.body')}</p>
          </header>

          <TextField
            id="recover-key"
            data-testid="recover-key"
            label={t('recover.key')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
            value={recoveryKey}
            onChange={(event) => setRecoveryKey(event.target.value)}
          />

          <TextField
            id="recover-password"
            data-testid="recover-password"
            type="password"
            autoComplete="new-password"
            label={t('recover.newPassword')}
            hint={t('setup.password.hint')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <TextField
            id="recover-password-confirm"
            data-testid="recover-password-confirm"
            type="password"
            autoComplete="new-password"
            label={t('setup.password.confirmLabel')}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            {...(mismatch ? { error: t('setup.password.mismatch') } : {})}
          />

          {error !== undefined ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <Button type="submit" data-testid="recover-submit" disabled={!canSubmit}>
            {t('recover.submit')}
          </Button>

          <Button type="button" variant="ghost" onClick={() => navigate('/login')}>
            {t('common.cancel')}
          </Button>
        </form>
      </Card>
    </CenteredScreen>
  );
}
