import { useEffect } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { eventStream } from '../services/events';
import { useChatStore } from '../store/chat';
import { PopBubbleMark } from '../ui/pop-bubble-mark';
import { ChatList } from './chat-list';
import { forgetLastActiveChat, rememberLastActiveChat } from '../lib/last-active-chat';

/**
 * The two-pane shell, Telegram-style ([[Decisoes-pre-Fase-2]] §1).
 *
 * On a wide screen the list sits beside the conversation. On a narrow one the
 * list *is* the screen and opening a chat is a navigation, so the phone's back
 * gesture works without the app implementing anything -- which is exactly what
 * a slide-over drawer would have thrown away.
 */
export function ChatLayout() {
  const apply = useChatStore((state) => state.apply);
  const navigate = useNavigate();
  const openChat = useMatch('/chat/:chatId');
  // /files/* covers the root and any folder path, however deep.
  const filesOpen = useMatch('/files/*');
  // On a phone, Files is its own screen (back returns to the list), exactly
  // like a conversation; on a wide screen the sidebar stays as the tree.
  // Tasks, Skills, MCP and A2A are explorers now too: the bare list route stays
  // in the sidebar, and a selected item's pane becomes the screen. /skills/:slug
  // covers /skills/new, /tasks/:taskId covers /tasks/new -- both the detail.
  const skillDetail = useMatch('/skills/:slug');
  const taskDetail = useMatch('/tasks/:taskId');
  const mcpDetail = useMatch('/mcp/:id');
  const a2aDetail = useMatch('/a2a/:id');
  const contentOpen =
    openChat !== null ||
    filesOpen !== null ||
    skillDetail !== null ||
    taskDetail !== null ||
    mcpDetail !== null ||
    a2aDetail !== null;

  useEffect(() => {
    const chatId = openChat?.params.chatId;
    if (chatId !== undefined) rememberLastActiveChat(chatId);
  }, [openChat?.params.chatId]);

  useEffect(() => {
    // Boot owns the one session-wide stream; this shell only feeds chat events
    // into the chat store while it is mounted.
    return eventStream.subscribe(apply);
  }, [apply]);

  useEffect(() => {
    // The store owns lifecycle data; the shell owns routing. If another client
    // deletes the selected conversation, replace that now-invalid history row
    // with the list instead of leaving an empty conversation pane behind.
    return eventStream.subscribe((event) => {
      if (event.kind === 'chat-deleted' && event.chatId === openChat?.params.chatId) {
        forgetLastActiveChat(event.chatId);
        void navigate('/', { replace: true });
      }
    });
  }, [navigate, openChat?.params.chatId]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`${contentOpen ? 'hidden md:flex' : 'flex'} relative w-full flex-col border-[var(--border)] md:w-80 md:border-r`}
      >
        <ChatList />
      </aside>

      <main className={`${contentOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col overflow-x-hidden`}>
        <Outlet />
      </main>
    </div>
  );
}

/** What the right-hand pane shows on a wide screen with nothing selected. */
export function NoChatSelected() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <PopBubbleMark className="mx-auto mb-5 h-24 w-24 select-none text-[var(--muted)] opacity-25" />
        <h1 className="text-lg font-semibold">{t('shell.empty.title')}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t('shell.empty.body')}</p>
      </div>
    </div>
  );
}
