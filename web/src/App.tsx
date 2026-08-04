import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { t } from './i18n';
import { setSessionLostHandler } from './services/api';
import { authService } from './services/auth';
import { session } from './services/session';
import { useAuthStore } from './store/auth';
import { ChatLayout, NoChatSelected } from './routes/chat-layout';
import { ChatPage } from './routes/chat-page';
import { FilesPage } from './routes/files-page';
import { TrashPage } from './routes/trash-page';
import { ArtifactsPage } from './routes/artifacts-page';
import { LoginPage } from './routes/login-page';
import { RecoverPage } from './routes/recover-page';
import { SettingsPage } from './routes/settings-page';
import { SetupPage } from './routes/setup-page';
import { TaskFormPage } from './routes/task-form-page';
import { TasksIntro } from './routes/tasks-list';
import { McpPage } from './routes/mcp-page';
import { SkillsPage } from './routes/skills-page';
import { UpdatePrompt } from './ui/update-prompt';
import { ConnectionBanner } from './ui/connection-banner';
import { Toasts } from './ui/toasts';

/**
 * Boot decides the screen (popy.spec §9): a server with no account goes to the
 * wizard, a device with no token goes to login, anything else is the app.
 */
export function App() {
  return (
    <BrowserRouter>
      {/*
        Above the router, so an unreachable server is announced on every screen
        -- including the login the failed boot falls back to, which otherwise
        just looks like the app forgot who you are.
      */}
      <ConnectionBanner />
      <UpdatePrompt />
      <Toasts />
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
        path="/chat/:chatId/artifacts"
        element={
          <Protected status={status}>
            <ArtifactsPage />
          </Protected>
        }
      />
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
        {/* Before files/:folderId, or "trash" would be read as a folder id. */}
        <Route path="files/trash" element={<TrashPage />} />
        <Route path="files/:folderId" element={<FilesPage />} />
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
