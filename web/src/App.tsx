import { startAutomaticUiControl } from './services/automatic-ui-control';
import { uiControl } from './services/ui-control';
import { RestApiPage } from './routes/rest-api-page';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LoadingState } from './ui/loading-state';
import { setSessionLostHandler } from './services/api';
import { authService } from './services/auth';
import { eventStream } from './services/events';
import { session } from './services/session';
import { useAuthStore } from './store/auth';
import { ChatLayout, NoChatSelected } from './routes/chat-layout';
import { ChatPage } from './routes/chat-page';
import { FilesPage } from './routes/files-page';
import { TrashPage } from './routes/trash-page';
import { LoginPage } from './routes/login-page';
import { RecoverPage } from './routes/recover-page';
import { SettingsPage } from './routes/settings-page';
import { SetupPage } from './routes/setup-page';
import { TaskFormPage } from './routes/task-form-page';
import { TasksIntro } from './routes/tasks-list';
import { McpPage } from './routes/mcp-page';
import { A2aPage } from './routes/a2a-page';
import { SkillsPage } from './routes/skills-page';
import { UpdatePrompt } from './ui/update-prompt';
import { ConnectionBanner } from './ui/connection-banner';
import { Toasts } from './ui/toasts';
import { ServerAvailabilityGate } from './ui/server-availability-gate';

/**
 * Boot decides the screen (docs/specs/Spec-Pop-General.md §9): a server with no account goes to the
 * wizard, a device with no token goes to login, anything else is the app.
 */
export function App() {
  return (
    <BrowserRouter>
      <ConnectionChrome />
      <UpdatePrompt />
      <Toasts />
      <ConnectionBoundary><Boot /></ConnectionBoundary>
    </BrowserRouter>
  );
}

/** Setup owns loading/retry and must remain interactive during network preparation. */
function ConnectionChrome() {
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  return location.pathname === '/setup' || status === 'needs-setup' ? null : <ConnectionBanner />;
}
function ConnectionBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  return <ServerAvailabilityGate bypass={location.pathname === '/setup' || status === 'needs-setup'}>{children}</ServerAvailabilityGate>;
}

function Boot() {
  const isSetup = useLocation().pathname === '/setup';
  const status = useAuthStore((state) => state.status);
  const setStatus = useAuthStore((state) => state.setStatus);
  const navigate = useNavigate();

  useEffect(() => {
    // A session that dies mid-use (epoch bump elsewhere, expiry) lands here.
    setSessionLostHandler(() => {
      setStatus('signed-out');
      void navigate('/login');
    });
  }, [navigate, setStatus]);

  useEffect(() => {
    if (status !== 'signed-in') { uiControl.stop(); return; }
    eventStream.start();
    const stopUiControl = startAutomaticUiControl();
    return () => { eventStream.stop(); stopUiControl(); };
  }, [status]);

  useEffect(() => {
    if (isSetup) {
      setStatus('needs-setup');
      return;
    }
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
  }, [setStatus, isSetup]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--muted)]">
        <LoadingState />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={status === 'signed-in' ? <Navigate to="/" replace /> : <SetupPage />}
      />
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
        <Route path="files" element={<FilesPage />} />
        {/* Before files/*, or "trash" would be read as a folder path. */}
        <Route path="files/trash" element={<TrashPage />} />
        {/* The splat is the open folder's path -- paths are the ids now. */}
        <Route path="files/*" element={<FilesPage />} />
        <Route path="tasks" element={<TasksIntro />} />
        <Route path="tasks/new" element={<TaskFormPage />} />
        <Route path="tasks/:taskId" element={<TaskFormPage />} />
        {/*
          Tasks, Skills and MCP are explorers like Chat and Files: the sidebar
          carries the list, and these panes carry the selected item. Children
          of the shell, so the navigation you just used stays mounted.
        */}
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/new" element={<SkillsPage />} />
        <Route path="skills/:slug" element={<SkillsPage />} />
        <Route path="mcp" element={<McpPage />} />
        <Route path="mcp/new" element={<McpPage />} />
        <Route path="mcp/:id" element={<McpPage />} />
        <Route path="rest-api" element={<RestApiPage />} />
        <Route path="a2a" element={<A2aPage />} />
        <Route path="a2a/new" element={<A2aPage />} />
        <Route path="a2a/:id" element={<A2aPage />} />
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
