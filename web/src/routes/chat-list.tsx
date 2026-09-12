import { ActionSurface } from '../ui/action-surface';
import { menuAnchor, menuKeyboard, nativeContext, type MenuAnchor } from '../lib/context-menu';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import type { ChatDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { useChatStore } from '../store/chat';
import { ShellFooter } from './shell-header';
import { SnapshotLoading } from '../ui/snapshot-loading';
import { useNotificationsStore } from '../store/notifications';
import { useA2aStore } from '../store/a2a';
import { useMcpStore } from '../store/mcp';
import { TasksList } from './tasks-list';
import { SidebarNav } from './sidebar-nav';
import { Button, SearchField, TextField, Pressable, ContextMenu, MenuItem } from '../ui/controls';
import { PullToRefresh } from '../ui/pull-to-refresh';
import { A2aSidebar, FolderTree, McpSidebar, SkillsList } from './chat-list-explorers';

/**
 * What the sidebar is showing. Every main destination is now an explorer: a
 * list here, the selected item in the right-hand pane -- chats, files, tasks,
 * skills, and MCP.
 */
type Segment = 'chats' | 'files' | 'tasks' | 'skills' | 'mcp' | 'a2a';

// Both controls must follow the device's root font scale together. A fixed
// 38px search button became smaller than the rem-based menu on larger phone text.
const chatHeaderIconButton =
  'flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]';

/** The conversation list: the sidebar on a wide screen, the home on a phone. */
export function ChatList() {
  const listsLoaded = useChatStore(state => state.listsLoaded);
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadArchived = useChatStore((state) => state.loadArchived);
  const archiveOthers = useChatStore((state) => state.archiveOthers);
  const deleteOthers = useChatStore((state) => state.deleteOthers);
  const removeArchived = useChatStore((state) => state.removeArchived);
  const notify = useNotificationsStore((state) => state.notify);
  const [archivingOthers, setArchivingOthers] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingOthers, setDeletingOthers] = useState(false);
  const [purging, setPurging] = useState(false);
  const createChat = useChatStore((state) => state.createChat);
  const reloadA2a = useA2aStore((state) => state.reload);
  const reloadMcp = useMcpStore((state) => state.reload);

  const location = useLocation();
  const openChat = useMatch('/chat/:chatId');
  const path = location.pathname;
  const segment: Segment = path.startsWith('/files')
    ? 'files'
    : path.startsWith('/tasks')
      ? 'tasks'
      : path.startsWith('/skills')
        ? 'skills'
        : path.startsWith('/mcp')
          ? 'mcp'
          : path.startsWith('/a2a')
            ? 'a2a'
            : 'chats';
  const [filter, setFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [viewArchived, setViewArchived] = useState(false);
  const [listMenu, setListMenu] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor>();
  useDismiss(listMenu, () => setListMenu(false));
  const [creating, setCreating] = useState(false);

  // On a wide screen the selected chat is in the route while this sidebar is
  // visible. On a phone the sidebar is visible only after Back returns to '/',
  // so keep the last chat ChatPage recorded -- but only if it is still open.
  let rememberedChatId: string | undefined;
  try {
    rememberedChatId = localStorage.getItem('pop-agent.lastChat') ?? undefined;
  } catch {
    // Storage may be denied. With no reliable chat to preserve, the bulk
    // action stays disabled rather than guessing and filing everything.
  }
  const keepChatId = openChat?.params.chatId ?? rememberedChatId;
  const keepChat = chats.find((chat) => chat.id === keepChatId);
  const hasPinnedChats = chats.some((chat) => chat.pinned);
  const archiveOthersCount =
    keepChat === undefined
      ? 0
      : chats.filter((chat) => chat.id !== keepChat.id && !chat.pinned).length;

  // Both lists, because the archived one is a click away and a stale count in
  // that heading is the kind of thing a pull is meant to fix.
  const refreshChats = useCallback(async (): Promise<void> => {
    await Promise.all([loadChats(), loadArchived()]);
  }, [loadChats, loadArchived]);

  // A search belongs to one list; carrying "foo" from Chats into Skills would
  // hide everything for no reason.
  useEffect(() => {
    setFilter('');
    setSearchOpen(false);
    if (segment === 'a2a') void reloadA2a();
  }, [reloadA2a, segment]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const closeSearch = (): void => {
    setFilter('');
    setSearchOpen(false);
  };

  const searching = filter.trim().length > 0;
  const match = (chat: ChatDTO): boolean =>
    `${chat.title} ${chat.preview}`.toLowerCase().includes(filter.toLowerCase());

  // Browsing shows one list at a time; searching looks across both, with a
  // badge telling the archived rows apart.
  const rows: { chat: ChatDTO; archived: boolean }[] = searching
    ? [
        ...chats.filter(match).map((chat) => ({ chat, archived: false })),
        ...archived.filter(match).map((chat) => ({ chat, archived: true })),
      ]
    : viewArchived
      ? archived.map((chat) => ({ chat, archived: true }))
      : chats.map((chat) => ({ chat, archived: false }));

  async function startChat(): Promise<void> {
    setCreating(true);
    try {
      const chat = await createChat();
      void navigate(`/chat/${chat.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function archiveAllOthers(): Promise<void> {
    if (keepChat === undefined || archiveOthersCount === 0 || archivingOthers) return;
    if (
      !window.confirm(
        t(hasPinnedChats ? 'shell.archiveExceptPinnedConfirm' : 'shell.archiveOthersConfirm', {
          count: archiveOthersCount,
          title: keepChat.title,
        }),
      )
    ) {
      return;
    }

    setListMenu(false);
    setArchivingOthers(true);
    try {
      const count = await archiveOthers(keepChat.id);
      notify(t('shell.archiveOthersDone', { count }));
    } catch {
      notify(t('shell.archiveOthersFailed'));
    } finally {
      setArchivingOthers(false);
    }
  }

  async function deleteAllOthers(): Promise<void> {
    if (keepChat === undefined || archiveOthersCount === 0 || deletingOthers) return;
    setDeletingOthers(true);
    try {
      const count = await deleteOthers(keepChat.id);
      setDeleteDialog(false);
      notify(t('shell.deleteOthersDone', { count }));
    } catch {
      notify(t('shell.deleteOthersFailed'));
    } finally {
      setDeletingOthers(false);
    }
  }

  useEffect(() => {
    if (!deleteDialog) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !deletingOthers) setDeleteDialog(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteDialog, deletingOthers]);

  return (
    <>
      <SidebarNav />
      {!listsLoaded ? <SnapshotLoading resource="chats" /> : null}
      <div className="flex flex-col gap-2 p-3">
        {/* The primary action and the list menu share one line: the ⋯ on a row
            of its own was a strip of empty sidebar above the button. */}
        <div className="relative flex items-center gap-1">
          {segment === 'chats' ? (
            <Button
              type="button"
              data-testid="shell-new-chat"
              className="flex-1"
              disabled={creating}
              onClick={() => void startChat()}
            >
              {t('shell.newChat')}
            </Button>
          ) : null}

          {segment === 'tasks' ? (
            <Button
              type="button"
              data-testid="shell-new-task"
              className="flex-1"
              onClick={() => void navigate('/tasks/new')}
            >
              {t('tasks.new')}
            </Button>
          ) : null}

          {segment === 'skills' ? (
            <Button
              type="button"
              data-testid="shell-new-skill"
              className="flex-1"
              onClick={() => void navigate('/skills/new')}
            >
              {t('skills.new')}
            </Button>
          ) : null}

          {segment === 'mcp' ? (
            <Button
              type="button"
              data-testid="shell-new-mcp"
              className="flex-1"
              onClick={() => {
                void reloadMcp();
                void navigate('/mcp/new');
              }}
            >
              New MCP
            </Button>
          ) : null}

          {segment === 'a2a' ? (
            <Button
              type="button"
              data-testid="shell-new-a2a"
              className="flex-1"
              onClick={() => {
                void reloadA2a();
                void navigate('/a2a/new');
              }}
            >
              {t('a2a.new')}
            </Button>
          ) : null}

          {segment === 'chats' ? (
            <Pressable
              type="button"
              data-testid="chat-search-toggle"
              aria-label={t('shell.filter')}
              aria-expanded={searchOpen}
              aria-controls="chat-search"
              onClick={() => {
                if (searchOpen) closeSearch();
                else setSearchOpen(true);
              }}
              className={`${chatHeaderIconButton} ${
                searchOpen ? 'bg-[var(--hover-overlay)]' : ''
              }`}
            >
              <SearchIcon />
            </Pressable>
          ) : null}

          {segment === 'chats' ? (
            <Pressable
              type="button"
              data-testid="list-menu"
              aria-label={t('shell.listMenu')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {setAnchor(menuAnchor(event));setListMenu((value) => !value);}}
              className={chatHeaderIconButton}
            >
              ⋯
            </Pressable>
          ) : null}
          {listMenu ? (
            <ContextMenu anchor={anchor} onClose={() => setListMenu(false)}
              onPointerDown={(event) => { event.stopPropagation(); setAnchor(undefined); }}
              className="absolute top-10 right-0 z-10"
            >
              <MenuItem
                testId="list-view-archived"
                label={viewArchived ? t('shell.viewActive') : t('shell.viewArchived', { count: archived.length })}
                onClick={() => {
                  setListMenu(false);
                  setViewArchived((value) => !value);
                }}
              />
              <MenuItem
                testId="list-archive-others"
                label={
                  archivingOthers
                    ? t('shell.archiveOthersBusy')
                    : t(hasPinnedChats ? 'shell.archiveExceptPinned' : 'shell.archiveOthers', {
                        count: archiveOthersCount,
                      })
                }
                disabled={keepChat === undefined || archiveOthersCount === 0 || archivingOthers}
                onClick={() => void archiveAllOthers()}
              />
              <MenuItem
                testId="list-delete-others"
                label={t('shell.deleteExceptPinned', { count: archiveOthersCount })}
                danger
                disabled={keepChat === undefined || archiveOthersCount === 0 || deletingOthers}
                onClick={() => {
                  setListMenu(false);
                  setDeleteDialog(true);
                }}
              />
            </ContextMenu>
          ) : null}
        </div>

        {segment === 'chats' && viewArchived && !searching && archived.length > 0 ? (
          <Pressable
            type="button"
            data-testid="delete-all-archived"
            onClick={() => {
              // Two confirms, like the emergency stop: this is every archived
              // conversation, permanently, and the archive is where a
              // scheduled task quietly piles up history.
              if (!window.confirm(t('shell.deleteArchivedConfirm1', { count: archived.length })))
                return;
              if (!window.confirm(t('shell.deleteArchivedConfirm2'))) return;
              setPurging(true);
              void removeArchived().finally(() => setPurging(false));
            }}
            disabled={purging}
            className="rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--hover-overlay)]"
          >
            {purging
              ? t('shell.deleteArchivedBusy')
              : t('shell.deleteArchivedAll', { count: archived.length })}
          </Pressable>
        ) : null}
        {segment === 'chats' && searchOpen ? (
          <SearchField
            inputRef={searchInput}
            id="chat-search"
            data-testid="chat-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
            }}
            placeholder={t('shell.filter')}
            aria-label={t('shell.filter')}
          />
        ) : null}
        {segment === 'tasks' || segment === 'skills' || segment === 'mcp' || segment === 'a2a' ? (
          <SearchField
            id="list-filter"
            data-testid="list-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t(
              segment === 'tasks'
                ? 'shell.searchTasks'
                : segment === 'skills'
                  ? 'shell.searchSkills'
                  : segment === 'mcp'
                    ? 'shell.searchMcp'
                    : 'shell.searchA2a',
            )}
            aria-label={t(
              segment === 'tasks'
                ? 'shell.searchTasks'
                : segment === 'skills'
                  ? 'shell.searchSkills'
                  : segment === 'mcp'
                    ? 'shell.searchMcp'
                    : 'shell.searchA2a',
            )}
          />
        ) : null}
      </div>

      {/* pb-20 keeps the last row clear of the floating bottom bar (§14). */}
      {segment === 'files' ? (
        <FolderTree />
      ) : segment === 'tasks' ? (
        <TasksList filter={filter} />
      ) : segment === 'skills' ? (
        <SkillsList filter={filter} />
      ) : segment === 'mcp' ? (
        <McpSidebar filter={filter} />
      ) : segment === 'a2a' ? (
        <A2aSidebar filter={filter} />
      ) : (
        <ActionSurface showTrigger={false} className="flex min-h-0 flex-1 flex-col" actions={[
          ...(creating ? [] : [{ id: 'new-chat', label: t('shell.newChat'), run: startChat }]),
          { id: 'refresh', label: t('context.refresh'), run: refreshChats },
        ]}>
        <PullToRefresh onRefresh={refreshChats} className="pb-20" testId="chat-list-background">
          {viewArchived && !searching ? (
            <p
              data-testid="archived-heading"
              className="px-4 pt-2 pb-1 text-xs text-[var(--muted)]"
            >
              {t('shell.archived', { count: archived.length })}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('shell.noChats')}</p>
          ) : (
            <ul data-testid="chat-list">
              {rows.map(({ chat, archived: isArchived }) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  archived={isArchived}
                  badge={searching && isArchived}
                />
              ))}
            </ul>
          )}
        </PullToRefresh>
        </ActionSurface>
      )}

      {deleteDialog && keepChat !== undefined ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] p-4"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !deletingOthers) setDeleteDialog(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-others-title"
            aria-describedby="delete-others-description"
            className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-xl"
          >
            <h2 id="delete-others-title" className="text-base font-medium text-[var(--screen-fg)]">
              {t('shell.deleteOthersTitle')}
            </h2>
            <p id="delete-others-description" className="mt-2 text-sm text-[var(--key-fg-dim)]">
              {t('shell.deleteOthersConfirm', {
                count: archiveOthersCount,
                title: keepChat.title,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={deletingOthers}
                onClick={() => setDeleteDialog(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                autoFocus
                data-testid="confirm-delete-others"
                disabled={deletingOthers}
                onClick={() => void deleteAllOthers()}
              >
                {deletingOthers
                  ? t('shell.deleteOthersBusy')
                  : t('shell.deleteOthersConfirmButton', { count: archiveOthersCount })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ShellFooter />
    </>
  );
}

const SWIPE_TRIGGER_PX = 72;

function ChatRow({
  chat,
  archived = false,
  badge = false,
}: {
  chat: ChatDTO;
  archived?: boolean;
  /** Marks an archived row inside mixed search results. */
  badge?: boolean;
}) {
  const rename = useChatStore((state) => state.rename);
  const setArchived = useChatStore((state) => state.setArchived);
  const setPinned = useChatStore((state) => state.setPinned);
  const remove = useChatStore((state) => state.remove);
  const live = useChatStore((state) => state.live[chat.id]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor>();
  useDismiss(menuOpen, () => setMenuOpen(false));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  // Swipe (touch only; the desktop keeps the row menu): right = delete,
  // Left archives; touch-action keeps vertical scrolling owned by the page.
  // vertical scrolling to the browser, so only a sideways drag reaches here.
  const [dx, setDx] = useState(0);
  // The state paints the drag; the refs carry the truth, because a fast
  // gesture ends before React re-renders the handlers' closures.
  const dxRef = useRef(0);
  const swiped = useRef(false);
  const touch = useRef<{ id: number; startX: number; startY: number; horizontal: boolean } | null>(
    null,
  );

  function confirmDelete(): void {
    // History is forever except for an explicit delete (the storage
    // contract), so the confirm must say this cannot be undone.
    if (!window.confirm(t('shell.deleteConfirm', { title: chat.title }))) return;
    void remove(chat.id);
  }

  async function toggleArchived(): Promise<void> {
    await setArchived(chat.id, !archived);
  }

  function onPointerDown(event: React.PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    touch.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
  }

  function onPointerMove(event: React.PointerEvent): void {
    const state = touch.current;
    if (state === null || event.pointerId !== state.id) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (!state.horizontal) {
      // Decide the gesture once: mostly sideways is a swipe, anything else
      // stays a scroll/tap and never moves the row.
      if (Math.abs(deltaX) < 8) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        touch.current = null;
        return;
      }
      state.horizontal = true;
    }
    dxRef.current = deltaX;
    setDx(deltaX);
  }

  function onPointerEnd(event: React.PointerEvent): void {
    const state = touch.current;
    if (state === null || event.pointerId !== state.id) return;
    touch.current = null;
    const deltaX = dxRef.current;
    dxRef.current = 0;
    setDx(0);
    if (!state.horizontal) return;
    swiped.current = true;
    if (deltaX >= SWIPE_TRIGGER_PX) confirmDelete();
    else if (deltaX <= -SWIPE_TRIGGER_PX) void toggleArchived();
  }

  async function commitRename(): Promise<void> {
    setEditing(false);
    // Empty means "I changed my mind", not "name it nothing".
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== chat.title) await rename(chat.id, trimmed);
  }

  if (editing) {
    return (
      <li className="px-3 py-2">
        <TextField
          id="chat-rename-input"
          size="compact"
          autoFocus
          data-testid="chat-rename-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitRename();
            if (event.key === 'Escape') {
              setDraft(chat.title);
              setEditing(false);
            }
          }}
          className="w-full"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <div className="relative overflow-hidden">
      {/* The colour that a drag uncovers: delete behind a right swipe, archive behind a left one. */}
      {dx > 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-start bg-[var(--danger)] pl-4 text-sm font-semibold text-white"
        >
          {t('shell.delete')}
        </div>
      ) : dx < 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end bg-[var(--accent)] pr-4 text-sm font-semibold text-[var(--accent-fg)]"
        >
          {archived ? t('shell.unarchive') : t('shell.archive')}
        </div>
      ) : null}

      <div
        data-testid="chat-row-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(event) => {
          // A finished swipe must not also open the conversation.
          if (swiped.current) {
            swiped.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        style={{
          transform: dx === 0 ? undefined : `translateX(${String(dx)}px)`,
          // Solid only while dragging, to hide the action colour underneath;
          // at rest it stays transparent so selection/hover paint as always.
          background: dx === 0 ? undefined : 'var(--bg)',
          touchAction: 'pan-y',
        }}
        className="relative"
      >
      <NavLink
        to={`/chat/${chat.id}`}
        data-testid="chat-row"
        onKeyDown={menuKeyboard}
      onContextMenu={(event) => {
        if (nativeContext(event.target, false)) return;
        event.stopPropagation(); setAnchor(menuAnchor(event));
          event.preventDefault();
          setMenuOpen(true);
        }}
        className={({ isActive }) =>
          `relative flex flex-col gap-0.5 px-4 py-3 ${isActive ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'}`
        }
      >
        {/* The top-right corner belongs to the row menu:
            the timestamp used to sit there too, hiding the ⋯ under it. */}
        <div className={`flex items-baseline justify-between gap-2 ${chat.pinned ? 'pr-14' : 'pr-8'}`}>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="truncate text-sm font-medium"
              onDoubleClick={(event) => {
                // Inline rename (docs/specs/Spec-Pop-General.md §14): double-click does what
                // the menu's Rename does, one gesture less.
                event.preventDefault();
                event.stopPropagation();
                setDraft(chat.title);
                setEditing(true);
              }}
            >
              {chat.title}
            </span>
            {badge ? (
              <span
                data-testid="archived-badge"
                className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--muted)]"
              >
                {t('shell.archivedBadge')}
              </span>
            ) : null}
          </span>
        </div>
        <span className={`truncate text-xs text-[var(--muted)] ${chat.pinned ? 'pr-14' : 'pr-8'}`}>
          {live !== undefined ? t('chat.answering') : chat.preview}
        </span>
        {live !== undefined ? (
          <span
            data-testid="chat-live"
            aria-hidden="true"
            className="absolute right-3 bottom-3 h-2 w-2 rounded-full bg-[var(--accent)] motion-safe:animate-[health-pulse_2s_ease-in-out_infinite]"
          />
        ) : null}
      </NavLink>

      {/* Only pinned chats show an indicator, kept neutral and hollow. Unpinned
          chats expose Pin in the row menu instead of adding an icon to every row. */}
      {chat.pinned ? (
        <Pressable
          type="button"
          data-testid="chat-pin"
          aria-label={t('shell.unpin')}
          aria-pressed="true"
          title={t('shell.unpin')}
          onPointerDown={(event) => { event.stopPropagation(); setAnchor(undefined); }}
          onClick={() => void setPinned(chat.id, false)}
          className="absolute top-1 right-9 rounded p-1.5 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
        >
          <PinIcon />
        </Pressable>
      ) : null}
      <Pressable
        type="button"
        data-testid="chat-menu"
        aria-label={t('shell.chatMenu')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {setAnchor(menuAnchor(event));setMenuOpen((value) => !value);}}
        className="absolute top-1 right-1 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        ⋯
      </Pressable>

      </div>
      </div>

      {menuOpen ? (
        <ContextMenu anchor={anchor} onClose={() => setMenuOpen(false)}
          onPointerDown={(event) => { event.stopPropagation(); setAnchor(undefined); }}
          className="absolute top-8 right-2 z-10"
        >
          <MenuItem
            testId="chat-pin-menu"
            label={chat.pinned ? t('shell.unpin') : t('shell.pin')}
            onClick={() => {
              setMenuOpen(false);
              void setPinned(chat.id, !chat.pinned);
            }}
          />
          <MenuItem
            testId="chat-rename"
            label={t('shell.rename')}
            onClick={() => {
              setMenuOpen(false);
              setDraft(chat.title);
              setEditing(true);
            }}
          />
          <MenuItem
            testId="chat-archive"
            label={archived ? t('shell.unarchive') : t('shell.archive')}
            onClick={() => {
              setMenuOpen(false);
              void toggleArchived();
            }}
          />
          <MenuItem
            testId="chat-delete"
            label={t('shell.delete')}
            danger
            onClick={() => {
              setMenuOpen(false);
              confirmDelete();
            }}
          />
        </ContextMenu>
      ) : null}
    </li>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function PinIcon() {
  // The pin is an outline-only state marker; being present already means the
  // chat is pinned, so colour and fill would add redundant emphasis.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}
