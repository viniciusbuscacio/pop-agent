import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { ArtifactDTO, ChatDTO, FolderDTO } from '@popy/shared';
import { t } from '../i18n';
import { relativeTime } from '../lib/time';
import { artifactsService, foldersService } from '../services/artifacts';
import { useChatStore } from '../store/chat';
import { Button, Segmented } from '../ui/controls';

/** The conversation list: the sidebar on a wide screen, the home on a phone. */
export function ChatList() {
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadArchived = useChatStore((state) => state.loadArchived);
  const createChat = useChatStore((state) => state.createChat);

  const [segment, setSegment] = useState<'chats' | 'files'>('chats');
  const [filter, setFilter] = useState('');
  const [viewArchived, setViewArchived] = useState(false);
  const [listMenu, setListMenu] = useState(false);
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
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-3">
        <span className="font-semibold">{t('app.name')}</span>
        <button
          type="button"
          data-testid="shell-settings"
          aria-label={t('shell.settings')}
          onClick={() => navigate('/settings')}
          className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          <GearIcon />
        </button>
      </header>

      <div className="flex flex-col gap-2 p-3">
        <div className="relative flex items-center gap-2">
          <div className="flex-1">
            <Segmented<'chats' | 'files'>
              ariaLabel={t('shell.segments')}
              value={segment}
              onChange={(value) => {
                setSegment(value);
                setListMenu(false);
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
              onClick={() => setListMenu((value) => !value)}
              className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
            >
              ⋯
            </button>
          ) : null}
          {listMenu ? (
            <div
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

        <input
          data-testid="chat-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={segment === 'chats' ? t('shell.filter') : t('shell.filterFiles')}
          aria-label={t('shell.filter')}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      {segment === 'files' ? (
        <FilesView filter={filter} />
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
 * The Files tab, reworked after the 31/07 review: a real breadcrumb
 * (Files / folder, each level clickable), a consistent toolbar, per-item
 * menus on folders and files alike, batch selection with move/delete,
 * drag-and-drop upload with progress, and a danger-red delete everywhere
 * a delete lives. Flat tree: the root holds folders and loose files.
 */
function FilesView({ filter }: { filter: string }) {
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const [files, setFiles] = useState<ArtifactDTO[] | undefined>(undefined);
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [openFolder, setOpenFolder] = useState<FolderDTO | undefined>(undefined);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ done: number; total: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    try {
      const [{ artifacts: all }, { folders: tree }] = await Promise.all([
        artifactsService.listAll(),
        foldersService.list(),
      ]);
      setFiles(all);
      setFolders(tree);
      setOpenFolder((current) => tree.find((f) => f.id === current?.id));
      setSelected(new Set());
    } catch {
      setFiles([]);
      setFolders([]);
    }
  }

  async function upload(list: FileList | File[] | null): Promise<void> {
    const entries = list === null ? [] : Array.from(list);
    if (entries.length === 0) return;
    setUploading({ done: 0, total: entries.length });
    try {
      for (const [index, file] of entries.entries()) {
        setUploading({ done: index, total: entries.length });
        await artifactsService.uploadToFiles(file, openFolder?.id ?? '');
      }
    } finally {
      setUploading(undefined);
    }
    await reload();
  }

  async function download(id: string): Promise<void> {
    const { url } = await artifactsService.link(id);
    window.open(url, '_blank', 'noopener');
  }

  async function renameFile(file: ArtifactDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), file.name);
    if (name === null || name.trim().length === 0 || name === file.name) return;
    await artifactsService.rename(file.id, name.trim());
    await reload();
  }

  async function deleteFile(file: ArtifactDTO): Promise<void> {
    if (!window.confirm(t('files.deleteConfirm', { name: file.name }))) return;
    await artifactsService.remove(file.id);
    await reload();
  }

  async function newFolder(): Promise<void> {
    const name = window.prompt(t('files.newFolderPrompt'));
    if (name === null || name.trim().length === 0) return;
    await foldersService.create(name.trim());
    await reload();
  }

  async function renameFolder(folder: FolderDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), folder.name);
    if (name === null || name.trim().length === 0 || name === folder.name) return;
    await foldersService.rename(folder.id, name.trim());
    await reload();
  }

  async function deleteFolder(folder: FolderDTO): Promise<void> {
    const inside = (files ?? []).filter((file) => file.folderId === folder.id).length;
    if (!window.confirm(t('files.deleteFolderConfirm', { name: folder.name, count: inside }))) {
      return;
    }
    await foldersService.remove(folder.id);
    setOpenFolder(undefined);
    await reload();
  }

  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected(): Promise<void> {
    if (!window.confirm(t('files.deleteSelectedConfirm', { count: selected.size }))) return;
    for (const id of selected) await artifactsService.remove(id);
    setSelecting(false);
    await reload();
  }

  async function moveSelected(folderId: string): Promise<void> {
    for (const id of selected) await artifactsService.move(id, folderId);
    setSelecting(false);
    await reload();
  }

  const titles = new Map([...chats, ...archived].map((chat) => [chat.id, chat.title]));
  const searching = filter.trim().length > 0;
  const visibleFiles = (files ?? []).filter(
    (file) =>
      file.name.toLowerCase().includes(filter.toLowerCase()) &&
      (searching || file.folderId === (openFolder?.id ?? '')),
  );
  const visibleFolders =
    searching || openFolder !== undefined
      ? []
      : folders.filter((folder) => folder.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div
      className={`flex-1 overflow-y-auto ${dragging ? 'outline-2 outline-dashed outline-[var(--accent)] -outline-offset-2' : ''}`}
      data-testid="files-view"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      {/* Breadcrumb: where you are, every level clickable (31/07 review, 1-4). */}
      <div className="flex items-center gap-1 px-4 pt-1 pb-2" data-testid="files-breadcrumb">
        <button
          type="button"
          data-testid="crumb-root"
          onClick={() => setOpenFolder(undefined)}
          className={`text-sm ${openFolder === undefined ? 'font-semibold text-[var(--screen-fg)]' : 'text-[var(--accent)] hover:underline'}`}
        >
          {t('files.rootCrumb')}
        </button>
        {openFolder !== undefined ? (
          <>
            <span className="text-sm text-[var(--muted)]">/</span>
            <span className="text-sm font-semibold" data-testid="crumb-folder">
              {openFolder.name}
            </span>
            <button
              type="button"
              data-testid="folder-menu"
              aria-label={t('shell.chatMenu')}
              onClick={() => setMenuFor((v) => (v === openFolder.id ? undefined : openFolder.id))}
              className="relative rounded px-1.5 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
            >
              ⋯
            </button>
            {menuFor === openFolder.id ? (
              <div
                role="menu"
                className="absolute top-8 left-24 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
              >
                <MenuItem
                  testId="folder-rename"
                  label={t('files.renameFolder')}
                  onClick={() => {
                    setMenuFor(undefined);
                    void renameFolder(openFolder);
                  }}
                />
                <MenuItem
                  testId="folder-delete"
                  label={t('files.deleteFolder')}
                  danger
                  onClick={() => {
                    setMenuFor(undefined);
                    void deleteFolder(openFolder);
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}
        <span className="ml-auto text-xs text-[var(--muted)]" data-testid="files-count">
          {t('files.count', { count: visibleFiles.length })}
        </span>
      </div>

      {/* One toolbar, same on every screen (review, 7). */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="files-upload-input"
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = '';
          }}
        />
        <Button type="button" data-testid="files-upload" onClick={() => picker.current?.click()}>
          {t('files.upload')}
        </Button>
        {openFolder === undefined ? (
          <Button type="button" variant="ghost" data-testid="files-new-folder" onClick={() => void newFolder()}>
            {t('files.newFolder')}
          </Button>
        ) : null}
        {visibleFiles.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            data-testid="files-select"
            onClick={() => {
              setSelecting((value) => !value);
              setSelected(new Set());
            }}
          >
            {selecting ? t('common.cancel') : t('files.select')}
          </Button>
        ) : null}
      </div>

      {uploading !== undefined ? (
        <p className="px-4 pb-2 text-xs text-[var(--accent)]" data-testid="files-uploading" role="status">
          {t('files.uploading', { done: uploading.done + 1, total: uploading.total })}
        </p>
      ) : null}

      {selecting && selected.size > 0 ? (
        <div className="flex items-center gap-2 px-3 pb-2" data-testid="files-batch-bar">
          <span className="text-xs text-[var(--muted)]">
            {t('files.selected', { count: selected.size })}
          </span>
          <select
            data-testid="files-move-to"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value === '') return;
              const target = event.target.value === 'root' ? '' : event.target.value;
              event.target.value = '';
              void moveSelected(target);
            }}
            className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs"
          >
            <option value="">{t('files.moveTo')}</option>
            <option value="root">{t('files.rootCrumb')}</option>
            {folders
              .filter((folder) => folder.id !== openFolder?.id)
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
          </select>
          <Button type="button" variant="danger" data-testid="files-delete-selected" onClick={() => void deleteSelected()}>
            {t('shell.delete')}
          </Button>
        </div>
      ) : null}

      {visibleFolders.length > 0 ? (
        <ul data-testid="folder-list">
          {visibleFolders.map((folder) => (
            <li key={folder.id} className="relative">
              <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]">
                <button
                  type="button"
                  data-testid="folder-row"
                  onClick={() => setOpenFolder(folder)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FolderIcon />
                  <span className="truncate text-sm font-medium">{folder.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
                    {t('files.count', {
                      count: (files ?? []).filter((file) => file.folderId === folder.id).length,
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="folder-row-menu"
                  aria-label={t('shell.chatMenu')}
                  onClick={() => setMenuFor((v) => (v === folder.id ? undefined : folder.id))}
                  className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                >
                  ⋯
                </button>
              </div>
              {menuFor === folder.id ? (
                <div
                  role="menu"
                  className="absolute top-9 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
                >
                  <MenuItem
                    testId="folder-rename"
                    label={t('files.renameFolder')}
                    onClick={() => {
                      setMenuFor(undefined);
                      void renameFolder(folder);
                    }}
                  />
                  <MenuItem
                    testId="folder-delete"
                    label={t('files.deleteFolder')}
                    danger
                    onClick={() => {
                      setMenuFor(undefined);
                      void deleteFolder(folder);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {files === undefined ? null : visibleFiles.length === 0 && visibleFolders.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <p className="text-sm text-[var(--muted)]">{t('files.none')}</p>
          <p className="text-xs text-[var(--muted)]">{t('files.emptyCta')}</p>
        </div>
      ) : (
        <ul data-testid="all-artifacts">
          {visibleFiles.map((file) => (
            <li key={file.id} className="relative">
              <div
                data-testid="artifact-row"
                className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]"
              >
                {selecting ? (
                  <input
                    type="checkbox"
                    data-testid="file-check"
                    checked={selected.has(file.id)}
                    onChange={() => toggleSelected(file.id)}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {file.name}
                      {file.version > 1 ? (
                        <span className="ml-1 text-xs text-[var(--muted)]">v{file.version}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      data-testid="file-menu"
                      aria-label={t('shell.chatMenu')}
                      onClick={() => setMenuFor((v) => (v === file.id ? undefined : file.id))}
                      className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                    >
                      ⋯
                    </button>
                  </div>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {file.chatId !== '' ? `${titles.get(file.chatId) ?? file.chatId} · ` : ''}
                    {formatSize(file.size)} · {relativeTime(file.createdAt)}
                  </span>
                </div>
              </div>
              {menuFor === file.id ? (
                <div
                  role="menu"
                  className="absolute top-9 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
                >
                  <MenuItem
                    testId="file-download"
                    label={t('files.download')}
                    onClick={() => {
                      setMenuFor(undefined);
                      void download(file.id);
                    }}
                  />
                  <MenuItem
                    testId="file-rename"
                    label={t('shell.rename')}
                    onClick={() => {
                      setMenuFor(undefined);
                      void renameFile(file);
                    }}
                  />
                  <MenuItem
                    testId="file-delete"
                    label={t('shell.delete')}
                    danger
                    onClick={() => {
                      setMenuFor(undefined);
                      void deleteFile(file);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Line-style folder, matching the app's stroked icons (review, 9). */
function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        <div className="flex items-baseline justify-between gap-2">
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
          <span className="shrink-0 text-xs text-[var(--muted)]">{relativeTime(chat.updatedAt)}</span>
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
        onClick={() => setMenuOpen((value) => !value)}
        className="absolute top-2 right-1 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        ⋯
      </button>

      </div>
      </div>

      {menuOpen ? (
        <div
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

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.6-.25 1-.83 1-1.51V3a2 2 0 1 1 4 0v.09c0 .68.4 1.26 1 1.51.6.25 1.3.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.25.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.26.4-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
