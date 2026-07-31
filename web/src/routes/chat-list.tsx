import { useEffect, useRef, useState } from 'react';
import { NavLink, useMatch, useNavigate, useParams } from 'react-router-dom';
import type { ChatDTO } from '@popy/shared';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { useChatStore } from '../store/chat';
import { FolderIcon } from './files-page';
import { ShellHeader } from './shell-header';
import { useFilesStore } from '../store/files';
import { Button, Segmented } from '../ui/controls';

/** The conversation list: the sidebar on a wide screen, the home on a phone. */
export function ChatList() {
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadArchived = useChatStore((state) => state.loadArchived);
  const createChat = useChatStore((state) => state.createChat);

  const filesRoot = useMatch('/files');
  const filesFolder = useMatch('/files/:folderId');
  const segment: 'chats' | 'files' = filesRoot !== null || filesFolder !== null ? 'files' : 'chats';
  const [filter, setFilter] = useState('');
  const [viewArchived, setViewArchived] = useState(false);
  const [listMenu, setListMenu] = useState(false);
  useDismiss(listMenu, () => setListMenu(false));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadChats();
    void loadArchived();
  }, [loadChats, loadArchived]);

  const searching = filter.trim().length > 0;
  const match = (chat: ChatDTO): boolean =>
    `${chat.title} ${chat.preview}`.toLowerCase().includes(filter.toLowerCase());

  // Browsing shows one list at a time; searching looks across both, with a
  // badge telling the archived rows apart (Vinicius, 31/07 -- no pinned line,
  // no collapsible footer).
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
      navigate(`/chat/${chat.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <ShellHeader />

      <div className="flex flex-col gap-2 p-3">
        <div className="relative flex items-center gap-2">
          <div className="flex-1">
            <Segmented<'chats' | 'files'>
              ariaLabel={t('shell.segments')}
              value={segment}
              onChange={(value) => {
                setListMenu(false);
                if (value === 'files') {
                  const folder = read('popy.lastFolder');
                  navigate(folder !== undefined && folder.length > 0 ? `/files/${folder}` : '/files');
                  return;
                }
                // Back to the conversation that was open, if it still exists.
                const last = read('popy.lastChat');
                const alive =
                  last !== undefined &&
                  [...chats, ...archived].some((chat) => chat.id === last);
                navigate(alive ? `/chat/${last}` : '/');
              }}
              options={[
                { value: 'chats', label: t('shell.segChats'), testId: 'segment-chats' },
                { value: 'files', label: t('shell.segFiles'), testId: 'segment-files' },
              ]}
            />
          </div>
          {segment === 'chats' ? (
            <button
              type="button"
              data-testid="list-menu"
              aria-label={t('shell.listMenu')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setListMenu((value) => !value)}
              className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
            >
              ⋯
            </button>
          ) : null}
          {listMenu ? (
            <div
              onPointerDown={(event) => event.stopPropagation()}
              role="menu"
              className="absolute top-10 right-0 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
            >
              <MenuItem
                testId="list-view-archived"
                label={viewArchived ? t('shell.viewActive') : t('shell.viewArchived', { count: archived.length })}
                onClick={() => {
                  setListMenu(false);
                  setViewArchived((value) => !value);
                }}
              />
            </div>
          ) : null}
        </div>

        {segment === 'chats' ? (
          <Button type="button" data-testid="shell-new-chat" disabled={creating} onClick={() => void startChat()}>
            {t('shell.newChat')}
          </Button>
        ) : null}

        {segment === 'files' ? null : (
        <input
          data-testid="chat-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={segment === 'chats' ? t('shell.filter') : t('shell.filterFiles')}
          aria-label={t('shell.filter')}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        )}
      </div>

      {segment === 'files' ? (
        <FolderTree />
      ) : (
        <div className="flex-1 overflow-y-auto">
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
        </div>
      )}
    </>
  );
}

/**
 * The sidebar when Files is active (31/07 explorer layout): the folder tree.
 * The content pane on the right shows the selected folder; here is only
 * where-you-can-go, with counts, kept in sync through the shared store.
 */
function FolderTree() {
  const navigate = useNavigate();
  const { folderId } = useParams();
  const files = useFilesStore((state) => state.files);
  const folders = useFilesStore((state) => state.folders);
  const reload = useFilesStore((state) => state.reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rootCount = (files ?? []).filter((file) => file.folderId === '').length;

  return (
    <div className="flex-1 overflow-y-auto" data-testid="folder-tree">
      <button
        type="button"
        data-testid="tree-root"
        onClick={() => navigate('/files')}
        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left ${
          folderId === undefined ? 'bg-[var(--hover-overlay)] font-medium' : 'hover:bg-[var(--hover-overlay)]'
        }`}
      >
        <FolderIcon />
        <span className="truncate text-sm">{t('files.rootCrumb')}</span>
        <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
          {t('files.count', { count: rootCount })}
        </span>
      </button>
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          data-testid="tree-folder"
          onClick={() => navigate(`/files/${folder.id}`)}
          className={`flex w-full items-center gap-2 py-2.5 pr-4 pl-8 text-left ${
            folderId === folder.id ? 'bg-[var(--hover-overlay)] font-medium' : 'hover:bg-[var(--hover-overlay)]'
          }`}
        >
          <FolderIcon />
          <span className="truncate text-sm">{folder.name}</span>
          <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
            {t('files.count', {
              count: (files ?? []).filter((file) => file.folderId === folder.id).length,
            })}
          </span>
        </button>
      ))}
    </div>
  );
}

/** localStorage, but never throwing on a device that refuses it. */
function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** How far a finger must travel before the swipe action fires. */
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
  const remove = useChatStore((state) => state.remove);
  const live = useChatStore((state) => state.live[chat.id]);

  const [menuOpen, setMenuOpen] = useState(false);
  useDismiss(menuOpen, () => setMenuOpen(false));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  // Swipe (touch only; the desktop keeps the row menu): right = delete,
  // left = archive -- Vinicius's mapping, 31/07. touch-action: pan-y leaves
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
    if (window.confirm(t('shell.deleteConfirm', { title: chat.title }))) {
      void remove(chat.id);
    }
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
    else if (deltaX <= -SWIPE_TRIGGER_PX) void setArchived(chat.id, !archived);
  }

  async function commitRename(): Promise<void> {
    setEditing(false);
    if (draft.trim() !== chat.title) await rename(chat.id, draft);
  }

  if (editing) {
    return (
      <li className="px-3 py-2">
        <input
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
          className="w-full rounded border border-[var(--accent)] bg-[var(--input-bg)] px-2 py-1 text-sm outline-none"
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
        className={({ isActive }) =>
          `flex flex-col gap-0.5 px-4 py-3 ${isActive ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'}`
        }
      >
        {/* The top-right corner belongs to the row menu (Vinicius, 31/07):
            the timestamp used to sit there too, hiding the ⋯ under it. */}
        <div className="flex items-baseline justify-between gap-2 pr-6">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium">{chat.title}</span>
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
        <span className="truncate text-xs text-[var(--muted)]">
          {live !== undefined ? t('chat.answering') : chat.preview}
        </span>
      </NavLink>

      {/*
        A visible button rather than long-press: on a touch screen a hidden
        gesture has no affordance and fights the scroll, and on a pointer
        screen hover-only controls are invisible to keyboards.
      */}
      <button
        type="button"
        data-testid="chat-menu"
        aria-label={t('shell.chatMenu')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setMenuOpen((value) => !value)}
        className="absolute top-2 right-1 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        ⋯
      </button>

      </div>
      </div>

      {menuOpen ? (
        <div
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          className="absolute top-8 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
        >
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
              void setArchived(chat.id, !archived);
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
        </div>
      ) : null}
    </li>
  );
}

function MenuItem({
  label,
  onClick,
  testId,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-1.5 text-left whitespace-nowrap hover:bg-[var(--hover-overlay)] ${
        danger ? 'text-[var(--danger)]' : ''
      }`}
    >
      {label}
    </button>
  );
}

