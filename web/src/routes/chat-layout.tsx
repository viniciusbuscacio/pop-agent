import { useEffect } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { t } from '../i18n';
import { eventStream } from '../services/events';
import { useChatStore } from '../store/chat';
import { ChatList } from './chat-list';

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
  const openChat = useMatch('/chat/:chatId');
  const filesRoot = useMatch('/files');
  const filesFolder = useMatch('/files/:folderId');
  const skills = useMatch('/skills');
  const mcp = useMatch('/mcp');
  // On a phone, Files is its own screen (back returns to the list), exactly
  // like a conversation; on a wide screen the sidebar stays as the tree.
  // Skills and MCP behave the same way: their content lives in the right-hand
  // pane, so on a narrow screen that pane has to become the screen or the
  // sidebar would cover a page you just asked for.
  const contentOpen =
    openChat !== null || filesRoot !== null || filesFolder !== null || skills !== null || mcp !== null;

  useEffect(() => {
    // One stream for the whole session; the store fans events out from here.
    const unsubscribe = eventStream.subscribe(apply);
    eventStream.start();
    return () => {
      unsubscribe();
      eventStream.stop();
    };
  }, [apply]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`${contentOpen ? 'hidden md:flex' : 'flex'} relative w-full flex-col border-[var(--border)] md:w-80 md:border-r`}
      >
        <ChatList />
      </aside>

      <main className={`${contentOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
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
        <h1 className="text-lg font-semibold">{t('shell.empty.title')}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t('shell.empty.body')}</p>
      </div>
    </div>
  );
}
