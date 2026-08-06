import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ChatDTO, FileNodeDTO, McpServerDTO, SkillDTO } from '@popy/shared';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { ApiError } from '../services/api';
import { useChatStore } from '../store/chat';
import { FolderIcon } from './files-page';
import { ShellFooter } from './shell-header';
import { joinPath, parentDir, useFilesStore } from '../store/files';
import { useNotificationsStore } from '../store/notifications';
import { filesService } from '../services/artifacts';
import { useSkillsStore } from '../store/skills';
import { useMcpStore } from '../store/mcp';
import { skillsService } from '../services/skills';
import { TasksList } from './tasks-list';
import { SidebarNav } from './sidebar-nav';
import { Button } from '../ui/controls';
import { PullToRefresh } from '../ui/pull-to-refresh';

/**
 * What the sidebar is showing. Every main destination is now an explorer: a
 * list here, the selected item in the right-hand pane -- chats, files, tasks,
 * skills, and MCP.
 */
type Segment = 'chats' | 'files' | 'tasks' | 'skills' | 'mcp';

/** The conversation list: the sidebar on a wide screen, the home on a phone. */
export function ChatList() {
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadArchived = useChatStore((state) => state.loadArchived);
  const removeArchived = useChatStore((state) => state.removeArchived);
  const [purging, setPurging] = useState(false);
  const createChat = useChatStore((state) => state.createChat);
  const reloadMcp = useMcpStore((state) => state.reload);

  const location = useLocation();
  const path = location.pathname;
  const segment: Segment = path.startsWith('/files')
    ? 'files'
    : path.startsWith('/tasks')
      ? 'tasks'
      : path.startsWith('/skills')
        ? 'skills'
        : path.startsWith('/mcp')
          ? 'mcp'
          : 'chats';
  const [filter, setFilter] = useState('');
  const [viewArchived, setViewArchived] = useState(false);
  const [listMenu, setListMenu] = useState(false);
  useDismiss(listMenu, () => setListMenu(false));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadChats();
    void loadArchived();
  }, [loadChats, loadArchived]);

  // A resumed PWA shows the list it froze with, and nothing on the stream
  // says "a chat was deleted elsewhere" -- so a phone could carry ghosts
  // until a full reload (Vinicius, 05/08). Ask again whenever the app comes
  // back to the foreground. pageshow rides along because Safari restoring a
  // frozen page does not always fire visibilitychange (see services/health).
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return;
      void loadChats();
      void loadArchived();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [loadChats, loadArchived]);

  // Both lists, because the archived one is a click away and a stale count in
  // that heading is the kind of thing a pull is meant to fix.
  const refreshChats = useCallback(async (): Promise<void> => {
    await Promise.all([loadChats(), loadArchived()]);
  }, [loadChats, loadArchived]);

  // A search belongs to one list; carrying "foo" from Chats into Skills would
  // hide everything for no reason.
  useEffect(() => {
    setFilter('');
  }, [segment]);

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
      <SidebarNav />
      <div className="flex flex-col gap-2 p-3">
        {/* The primary action and the list menu share one line: the ⋯ on a row
            of its own was a strip of empty sidebar above the button. */}
        <div className="relative flex items-center gap-2">
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
              onClick={() => navigate('/tasks/new')}
            >
              {t('tasks.new')}
            </Button>
          ) : null}

          {segment === 'skills' ? (
            <Button
              type="button"
              data-testid="shell-new-skill"
              className="flex-1"
              onClick={() => navigate('/skills/new')}
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
                navigate('/mcp/new');
              }}
            >
              New MCP
            </Button>
          ) : null}

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

        {segment === 'chats' && viewArchived && !searching && archived.length > 0 ? (
          <button
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
          </button>
        ) : null}
        {segment === 'chats' ? (
        <input
          data-testid="chat-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('shell.filter')}
          aria-label={t('shell.filter')}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        ) : null}
        {segment === 'tasks' || segment === 'skills' || segment === 'mcp' ? (
          <input
            data-testid="list-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t(
              segment === 'tasks'
                ? 'shell.searchTasks'
                : segment === 'skills'
                  ? 'shell.searchSkills'
                  : 'shell.searchMcp',
            )}
            aria-label={t(
              segment === 'tasks'
                ? 'shell.searchTasks'
                : segment === 'skills'
                  ? 'shell.searchSkills'
                  : 'shell.searchMcp',
            )}
            className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
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
      ) : (
        <PullToRefresh onRefresh={refreshChats} className="pb-20">
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
      )}

      <ShellFooter />
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
  const location = useLocation();
  const tree = useFilesStore((state) => state.tree);
  const reload = useFilesStore((state) => state.reload);
  const notify = useNotificationsStore((state) => state.notify);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  useDismiss(menuFor !== undefined, () => setMenuFor(undefined));

  // The open folder's path, straight off the URL: the sidebar sits outside the
  // files/* route, so the splat param is not in scope here.
  const currentPath = location.pathname.startsWith('/files/')
    ? decodeURIComponent(location.pathname.slice('/files/'.length)).replace(/\/+$/, '')
    : '';

  useEffect(() => {
    void reload();
  }, [reload]);

  // Same actions as the file pane's folder rows, so a folder is managed from
  // wherever you see it (Vinicius, 03/08). Rename is a path edit now, and the
  // one refusal worth words is the target's name being taken.
  async function renameFolder(folder: FileNodeDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), folder.name);
    if (name === null || name.trim().length === 0 || name === folder.name) return;
    try {
      await filesService.move(folder.path, joinPath(parentDir(folder.path), name.trim()));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'name_taken') {
        notify(t('files.nameTaken', { name: name.trim() }));
        return;
      }
      throw error;
    }
    await reload();
  }
  async function deleteFolder(folder: FileNodeDTO): Promise<void> {
    await filesService.remove(folder.path);
    await reload();
    if (folder.path === currentPath) navigate('/files');
  }

  function toggle(path: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // A row and, when open, its children -- indented by depth. A plain recursive
  // helper, so the tree reconciles cleanly.
  //
  // A top-level row starts at the sidebar's own left edge: the +/- lives in the
  // 1rem gutter the chat rows use as padding, so the folder icon lands exactly
  // where a chat's title does instead of floating a column further right
  // (Vinicius, 03/08).
  function renderRow(folder: FileNodeDTO, depth: number) {
    const kids = (folder.children ?? []).filter((child) => child.kind === 'dir');
    const isOpen = expanded.has(folder.path);
    return (
      <div key={folder.path} className="relative">
        <div
          className={`group flex items-center pr-1 ${
            currentPath === folder.path ? 'bg-[var(--hover-overlay)] font-medium' : 'hover:bg-[var(--hover-overlay)]'
          }`}
          style={{ paddingLeft: `${String(depth * 0.75)}rem` }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuFor(folder.path);
          }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              data-testid="tree-expand"
              aria-label={isOpen ? t('files.collapse') : t('files.expand')}
              aria-expanded={isOpen}
              onClick={() => toggle(folder.path)}
              className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
            >
              {isOpen ? '−' : '+'}
            </button>
          ) : (
            <span className="h-5 w-4 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            data-testid="tree-folder"
            onClick={() => navigate(`/files/${folder.path}`)}
            className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
          >
            <FolderIcon />
            <span className="truncate text-sm">{folder.name}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
              {t('files.count', {
                count: (folder.children ?? []).filter((child) => child.kind === 'file').length,
              })}
            </span>
          </button>
          <button
            type="button"
            data-testid="tree-folder-menu"
            aria-label={t('shell.chatMenu')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMenuFor((v) => (v === folder.path ? undefined : folder.path))}
            className="shrink-0 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            ⋯
          </button>
        </div>
        {menuFor === folder.path ? (
          <div
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
            className="absolute top-9 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
          >
            <MenuItem
              testId="tree-folder-rename"
              label={t('shell.rename')}
              onClick={() => {
                setMenuFor(undefined);
                void renameFolder(folder);
              }}
            />
            <MenuItem
              testId="tree-folder-delete"
              label={t('shell.delete')}
              danger
              onClick={() => {
                setMenuFor(undefined);
                void deleteFolder(folder);
              }}
            />
          </div>
        ) : null}
        {kids.length > 0 && isOpen ? kids.map((child) => renderRow(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-20" data-testid="folder-tree">
      {(tree ?? [])
        .filter((node) => node.kind === 'dir')
        .map((folder) => renderRow(folder, 0))}
    </div>
  );
}

/**
 * The skills list in the sidebar (popy.spec §8), the explorer twin of the
 * folder tree: the shared store keeps it in step with the editor pane, and a
 * row opens that skill on the right. Filtered by the sidebar search.
 */
function SkillsList({ filter }: { filter: string }) {
  const navigate = useNavigate();
  const { slug } = useParams();
  const skills = useSkillsStore((state) => state.skills);
  const reload = useSkillsStore((state) => state.reload);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  useDismiss(menuFor !== undefined, () => setMenuFor(undefined));

  useEffect(() => {
    void reload();
  }, [reload]);

  async function removeSkill(skill: SkillDTO): Promise<void> {
    await skillsService.remove(skill.slug);
    await reload();
    if (slug === skill.slug) navigate('/skills');
  }

  if (skills === undefined) return <div className="flex-1" />;

  const query = filter.trim().toLowerCase();
  const shown =
    query.length === 0
      ? skills
      : skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query));

  return (
    <div className="flex-1 overflow-y-auto pb-20" data-testid="skills-list">
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('skills.none')}</p>
      ) : (
        <ul>
          {shown.map((skill: SkillDTO) => (
            <li key={skill.slug} className="group relative">
              <div
                className={`flex items-center gap-1 pr-1 ${
                  slug === skill.slug ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'
                }`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuFor(skill.slug);
                }}
              >
                <button
                  type="button"
                  data-testid="skill-row"
                  onClick={() => navigate(`/skills/${skill.slug}`)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{skill.name}</span>
                    {skill.builtin ? (
                      <span className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--muted)]">
                        {t('skills.builtin')}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-[var(--muted)]">{skill.description}</span>
                </button>
                <button
                  type="button"
                  data-testid="skill-row-menu"
                  aria-label={t('shell.chatMenu')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setMenuFor((v) => (v === skill.slug ? undefined : skill.slug))}
                  className="shrink-0 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                >
                  ⋯
                </button>
              </div>
              {menuFor === skill.slug ? (
                <div
                  onPointerDown={(event) => event.stopPropagation()}
                  role="menu"
                  className="absolute top-9 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
                >
                  <MenuItem
                    testId="skill-row-edit"
                    label={t('skills.edit')}
                    onClick={() => {
                      setMenuFor(undefined);
                      navigate(`/skills/${skill.slug}`);
                    }}
                  />
                  {skill.builtin ? null : (
                    <MenuItem
                      testId="skill-row-delete"
                      label={t('skills.delete')}
                      danger
                      onClick={() => {
                        setMenuFor(undefined);
                        void removeSkill(skill);
                      }}
                    />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function McpSidebar({ filter }: { filter: string }) {
  const navigate = useNavigate();
  const servers = useMcpStore((state) => state.servers);
  const query = filter.trim().toLowerCase();
  const rows = (servers ?? []).filter((server) =>
    `${server.name} ${server.description} ${server.endpoint}`.toLowerCase().includes(query),
  );

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('mcp.none')}</p>
      ) : (
        <ul>
          {rows.map((server: McpServerDTO) => (
            <li key={server.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hover-overlay)]"
                onClick={() => navigate(`/mcp/${server.id}`)}
              >
                <span className="min-w-0 truncate text-sm">{server.name}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{server.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
    // History is forever except for an explicit delete (the storage
    // contract), so the confirm must say this cannot be undone.
    if (!window.confirm(t('shell.deleteConfirm', { title: chat.title }))) return;
    void remove(chat.id);
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
    // Empty means "I changed my mind", not "name it nothing".
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== chat.title) await rename(chat.id, trimmed);
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
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
        className={({ isActive }) =>
          `relative flex flex-col gap-0.5 px-4 py-3 ${isActive ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'}`
        }
      >
        {/* The top-right corner belongs to the row menu (Vinicius, 31/07):
            the timestamp used to sit there too, hiding the ⋯ under it. */}
        <div className="flex items-baseline justify-between gap-2 pr-6">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="truncate text-sm font-medium"
              onDoubleClick={(event) => {
                // Inline rename (popy.spec §14): double-click does what
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
        <span className="truncate pr-6 text-xs text-[var(--muted)]">
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
        className="absolute top-1 right-1 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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

