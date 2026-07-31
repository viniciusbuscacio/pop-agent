import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { t } from './i18n';
import { setSessionLostHandler } from './services/api';
import { authService } from './services/auth';
import { session } from './services/session';
import { useAuthStore } from './store/auth';
import { ChatLayout, NoChatSelected } from './routes/chat-layout';
import { ChatPage } from './routes/chat-page';
import { LoginPage } from './routes/login-page';
import { RecoverPage } from './routes/recover-page';
import { SettingsPage } from './routes/settings-page';
import { SetupPage } from './routes/setup-page';

/**
 * Boot decides the screen (popy.spec §9): a server with no account goes to the
 * wizard, a device with no token goes to login, anything else is the app.
 */
export function App() {
  return (
    <BrowserRouter>
      <Boot />
    </BrowserRouter>
  );
}

function Boot() {
  const status = useAuthStore((state) => state.status);
  const setStatus = useAuthStore((state) => state.setStatus);
  const navigate = useNavigate();

  useEffect(() => {
    // A session that dies mid-use (epoch bump elsewhere, expiry) lands here.
    setSessionLostHandler(() => {
      setStatus('signed-out');
      navigate('/login');
    });
  }, [navigate, setStatus]);

  useEffect(() => {
    let cancelled = false;
    authService
      .state()
      .then(({ setupDone }) => {
        if (cancelled) return;
        if (!setupDone) return setStatus('needs-setup');
        setStatus(session.token() === undefined ? 'signed-out' : 'signed-in');
      })
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--muted)]">
        {t('app.loading')}
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/login"
        element={status === 'signed-in' ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/recover" element={<RecoverPage />} />
      <Route
        path="/settings/*"
        element={
          <Protected status={status}>
            <SettingsPage />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected status={status}>
            <ChatLayout />
          </Protected>
        }
      >
        <Route index element={<NoChatSelected />} />
        <Route path="chat/:chatId" element={<ChatPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Protected({
  status,
  children,
}: {
  status: ReturnType<typeof useAuthStore.getState>['status'];
  children: React.ReactNode;
}) {
  if (status === 'needs-setup') return <Navigate to="/setup" replace />;
  if (status !== 'signed-in') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
