import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArtifactDTO, FilesSearchHitDTO, FolderDTO } from '@popy/shared';
import { t } from '../i18n';
import { saveFromLink } from '../lib/download';
import { useDismiss } from '../lib/dismiss';
import { relativeTime } from '../lib/time';
import { artifactsService, foldersService } from '../services/artifacts';
import { useChatStore } from '../store/chat';
import { useFilesStore } from '../store/files';
import { Button, Select } from '../ui/controls';
import { SidebarNav } from './sidebar-nav';
import { ShellFooter } from './shell-header';

/**
 * The content pane of Files: the folders and files of ONE folder, listed at the
 * same indent, with a breadcrumb saying where that is (Vinicius, 03/08). You go
 * down by opening a folder and back up through the breadcrumb; the expandable
 * tree lives in the sidebar, where it does not compete with this list. Search
 * runs against the server's path index and returns folders as well as files,
 * from anywhere in the tree, each shown with its full path. On a phone the
 * search box sits on its own full-width line so the buttons do not crush it.
 */
export function FilesPage() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const files = useFilesStore((state) => state.files);
  const folders = useFilesStore((state) => state.folders);
  const reload = useFilesStore((state) => state.reload);

  const [filter, setFilter] = useState('');
  const [searchHits, setSearchHits] = useState<FilesSearchHitDTO[] | undefined>(undefined);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ done: number; total: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  useDismiss(menuFor !== undefined, () => setMenuFor(undefined));

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
    setFilter('');
    setMenuFor(undefined);
    // Remembered per device, so the Files segment reopens where you were.
    try {
      localStorage.setItem('popy.lastFolder', folderId ?? '');
    } catch {
      // storage denied; the segment just falls back to the root
    }
  }, [folderId]);

  const searching = filter.trim().length > 0;

  // Search hits the server's path index (folders + files, whole tree). Debounced
  // so a fast typist does not fire a request per keystroke; the data is small.
  useEffect(() => {
    const query = filter.trim();
    if (query.length === 0) {
      setSearchHits(undefined);
      return;
    }
    let live = true;
    const handle = setTimeout(() => {
      void artifactsService
        .search(query)
        .then((response) => {
          if (live) setSearchHits(response.hits);
        })
        .catch(() => {
          if (live) setSearchHits([]);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [filter]);

  const openFolder: FolderDTO | undefined = folders.find((entry) => entry.id === folderId);

  // A dead link (deleted folder) falls back to the root once folders arrived.
  useEffect(() => {
    if (folderId !== undefined && files !== undefined && openFolder === undefined) {
      navigate('/files', { replace: true });
    }
  }, [folderId, openFolder, files, navigate]);

  const currentParent = openFolder?.id ?? '';

  function childFolders(parentId: string): FolderDTO[] {
    return folders.filter((folder) => folder.parentId === parentId);
  }
  function fileCount(id: string): number {
    return (files ?? []).filter((file) => file.folderId === id).length;
  }

  // The chain root → … → open folder, for the breadcrumb. The length guard is
  // for a parent link that somehow points at an ancestor: a cycle must not
  // hang the render.
  function trail(): FolderDTO[] {
    const chain: FolderDTO[] = [];
    let current = openFolder;
    while (current !== undefined && chain.length < 64) {
      chain.unshift(current);
      const parentId = current.parentId;
      current = parentId === '' ? undefined : folders.find((entry) => entry.id === parentId);
    }
    return chain;
  }

  async function upload(list: FileList | File[] | null): Promise<void> {
    const entries = list === null ? [] : Array.from(list);
    if (entries.length === 0) return;
    setUploading({ done: 0, total: entries.length });
    try {
      for (const [index, file] of entries.entries()) {
        setUploading({ done: index, total: entries.length });
        await artifactsService.uploadToFiles(file, currentParent);
      }
    } finally {
      setUploading(undefined);
    }
    await reload();
  }

  /**
   * A directory upload arrives as a flat list where each file remembers the
   * path it came from ("Reports/Q3/summary.pdf"), so the tree is rebuilt here:
   * every directory on the way is created once and the file lands inside its
   * own folder. Flattening everything into the current folder would lose the
   * shape the user picked.
   */
  async function uploadFolder(list: FileList | null): Promise<void> {
    const entries = list === null ? [] : Array.from(list);
    if (entries.length === 0) return;
    setUploading({ done: 0, total: entries.length });
    const made = new Map<string, string>();
    try {
      for (const [index, file] of entries.entries()) {
        setUploading({ done: index, total: entries.length });
        let path = '';
        let parent = currentParent;
        for (const segment of file.webkitRelativePath.split('/').slice(0, -1)) {
          path = path === '' ? segment : `${path}/${segment}`;
          const known = made.get(path);
          if (known === undefined) {
            const folder = await foldersService.create(segment, parent);
            made.set(path, folder.id);
            parent = folder.id;
          } else {
            parent = known;
          }
        }
        await artifactsService.uploadToFiles(file, parent);
      }
    } finally {
      setUploading(undefined);
    }
    await reload();
  }

  async function download(id: string): Promise<void> {
    const { url } = await artifactsService.link(id);
    saveFromLink(url);
  }

  async function renameFile(file: ArtifactDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), file.name);
    if (name === null || name.trim().length === 0 || name === file.name) return;
    await artifactsService.rename(file.id, name.trim());
    await reload();
  }

  async function deleteFile(file: ArtifactDTO): Promise<void> {
    await artifactsService.remove(file.id);
    await reload();
  }

  // A folder created here lands under the folder you are in (a subfolder), or at
  // the root when you are at the root.
  async function newFolder(): Promise<void> {
    const inside = openFolder !== undefined;
    const name = window.prompt(inside ? t('files.newSubfolderPrompt') : t('files.newFolderPrompt'));
    if (name === null || name.trim().length === 0) return;
    await foldersService.create(name.trim(), currentParent);
    await reload();
  }

  async function renameFolder(folder: FolderDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), folder.name);
    if (name === null || name.trim().length === 0 || name === folder.name) return;
    await foldersService.rename(folder.id, name.trim());
    await reload();
  }

  // YOLO mode (31/07): destructive actions just happen -- no dialogs anywhere.
  // Deleting a folder takes its whole subtree (server side).
  async function deleteFolder(folder: FolderDTO): Promise<void> {
    await foldersService.remove(folder.id);
    await reload();
    if (folder.id === openFolder?.id) navigate('/files');
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
    for (const id of selected) await artifactsService.remove(id);
    setSelecting(false);
    await reload();
  }

  async function moveSelected(target: string): Promise<void> {
    for (const id of selected) await artifactsService.move(id, target);
    setSelecting(false);
    await reload();
  }

  const titles = new Map([...chats, ...archived].map((chat) => [chat.id, chat.title]));
  const visibleFiles = (files ?? []).filter((file) => file.folderId === currentParent);
  const rootFolders = childFolders(currentParent);

  const folderHits = (searchHits ?? []).filter((hit) => hit.kind === 'folder');
  const fileHits = (searchHits ?? []).filter((hit) => hit.kind === 'file');

  // A folder row of the open folder's list. No indent and no expander: this
  // pane shows one level, the same way it shows its files, and the sidebar is
  // where a folder opens in place (Vinicius, 03/08).
  function renderFolder(folder: FolderDTO) {
    return (
      <li key={folder.id} className="relative">
        <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]">
          <button
            type="button"
            data-testid="folder-row"
            onClick={() => navigate(`/files/${folder.id}`)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <FolderIcon />
            <span className="truncate text-sm font-medium">{folder.name}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
              {t('files.count', { count: fileCount(folder.id) })}
            </span>
          </button>
          <button
            type="button"
            data-testid="folder-row-menu"
            aria-label={t('shell.chatMenu')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMenuFor((v) => (v === folder.id ? undefined : folder.id))}
            className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
          >
            ⋯
          </button>
        </div>
        {menuFor === folder.id ? (
          <div
            onPointerDown={(event) => event.stopPropagation()}
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
    );
  }

  return (
    <div
      className={`relative flex h-full min-h-0 flex-1 flex-col ${dragging ? 'outline-2 outline-dashed outline-[var(--accent)] -outline-offset-2' : ''}`}
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
      {/* The phone's copy of the nav. No rule under it: the sidebar's copy has
          none either, and the line only ever showed up on this one screen. */}
      <div className="md:hidden">
        <SidebarNav />
      </div>

      <div className="flex flex-col gap-2 p-3 pb-2">
        {/* Where you are, and the way back: every ancestor is a link, the open
            folder is the plain last word. Only inside a folder -- at the root
            the nav above already says Files. */}
        {openFolder !== undefined ? (
          <nav
            data-testid="files-breadcrumb"
            aria-label={t('files.breadcrumb')}
            className="flex flex-wrap items-center gap-1 text-sm"
          >
            <button
              type="button"
              data-testid="crumb-root"
              onClick={() => navigate('/files')}
              className="text-[var(--accent)] hover:underline"
            >
              {t('files.rootCrumb')}
            </button>
            {trail().map((folder, index, chain) => (
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <span className="text-[var(--muted)]">/</span>
                {index === chain.length - 1 ? (
                  <span className="truncate font-semibold" data-testid="crumb-current">
                    {folder.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="crumb-ancestor"
                    onClick={() => navigate(`/files/${folder.id}`)}
                    className="truncate text-[var(--accent)] hover:underline"
                  >
                    {folder.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        {/* On a phone the buttons alone fill the line, so the search box was
            being squeezed into a sliver. It wraps onto its own full-width line
            below them instead; from `sm` up there is room to share one row. */}
        <div className="flex flex-wrap items-center gap-2">
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
          {/* React has no prop for a directory picker, but the attribute is
              what makes the browser offer one; where it is not supported the
              input simply stays a file picker. */}
          <input
            ref={folderPicker}
            type="file"
            multiple
            hidden
            data-testid="files-upload-folder-input"
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(event) => {
              void uploadFolder(event.target.files);
              event.target.value = '';
            }}
          />
          <Button type="button" data-testid="files-upload" onClick={() => picker.current?.click()}>
            {t('files.uploadFile')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid="files-upload-folder"
            onClick={() => folderPicker.current?.click()}
          >
            {t('files.uploadFolder')}
          </Button>
          <Button type="button" variant="ghost" data-testid="files-new-folder" onClick={() => void newFolder()}>
            {t('files.newFolder')}
          </Button>
          {!searching && visibleFiles.length > 0 ? (
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
          <input
            data-testid="files-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('shell.filterFiles')}
            aria-label={t('shell.filterFiles')}
            className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] sm:w-auto sm:flex-1"
          />
        </div>
      </div>

      {uploading !== undefined ? (
        <p className="px-4 pb-2 text-xs text-[var(--accent)]" data-testid="files-uploading" role="status">
          {t('files.uploading', { done: uploading.done + 1, total: uploading.total })}
        </p>
      ) : null}

      {!searching && selecting && selected.size > 0 ? (
        <div className="flex items-center gap-2 px-3 pb-2" data-testid="files-batch-bar">
          <span className="text-xs text-[var(--muted)]">
            {t('files.selected', { count: selected.size })}
          </span>
          <Select
            id="files-move-to"
            size="sm"
            data-testid="files-move-to"
            aria-label={t('files.moveTo')}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value === '') return;
              const target = event.target.value === 'root' ? '' : event.target.value;
              event.target.value = '';
              void moveSelected(target);
            }}
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
          </Select>
          <Button type="button" variant="danger" data-testid="files-delete-selected" onClick={() => void deleteSelected()}>
            {t('shell.delete')}
          </Button>
        </div>
      ) : null}

      {/* pb-20 on a phone keeps the last row clear of the bottom bar below. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        {searching ? (
          searchHits === undefined ? null : folderHits.length === 0 && fileHits.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <p className="text-sm text-[var(--muted)]">{t('files.noResults', { query: filter.trim() })}</p>
            </div>
          ) : (
            <ul data-testid="files-search-results">
              {folderHits.map((hit) =>
                hit.kind === 'folder' ? (
                  <li key={`folder-${hit.folder.id}`} className="relative">
                    <button
                      type="button"
                      data-testid="search-folder-row"
                      onClick={() => navigate(`/files/${hit.folder.id}`)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--hover-overlay)]"
                    >
                      <FolderIcon />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.folder.name}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{hit.path}</span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {t('files.count', { count: fileCount(hit.folder.id) })}
                      </span>
                    </button>
                  </li>
                ) : null,
              )}
              {fileHits.map((hit) =>
                hit.kind === 'file' ? (
                  <li key={`file-${hit.file.id}`} className="relative">
                    <div
                      data-testid="artifact-row"
                      className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {hit.file.name}
                            {hit.file.version > 1 ? (
                              <span className="ml-1 text-xs text-[var(--muted)]">v{hit.file.version}</span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            data-testid="file-menu"
                            aria-label={t('shell.chatMenu')}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => setMenuFor((v) => (v === hit.file.id ? undefined : hit.file.id))}
                            className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                          >
                            ⋯
                          </button>
                        </div>
                        <span className="block truncate text-xs text-[var(--muted)]">{hit.path}</span>
                      </div>
                    </div>
                    {menuFor === hit.file.id ? (
                      <div
                        onPointerDown={(event) => event.stopPropagation()}
                        role="menu"
                        className="absolute top-9 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
                      >
                        <MenuItem
                          testId="file-download"
                          label={t('files.download')}
                          onClick={() => {
                            setMenuFor(undefined);
                            void download(hit.file.id);
                          }}
                        />
                        <MenuItem
                          testId="file-rename"
                          label={t('shell.rename')}
                          onClick={() => {
                            setMenuFor(undefined);
                            void renameFile(hit.file);
                          }}
                        />
                        <MenuItem
                          testId="file-delete"
                          label={t('shell.delete')}
                          danger
                          onClick={() => {
                            setMenuFor(undefined);
                            void deleteFile(hit.file);
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                ) : null,
              )}
            </ul>
          )
        ) : (
          <>
            {rootFolders.length > 0 ? (
              <ul data-testid="folder-list">
                {rootFolders.map((folder) => renderFolder(folder))}
              </ul>
            ) : null}

            {files === undefined ? null : visibleFiles.length === 0 && rootFolders.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                <p className="text-sm text-[var(--muted)]">
                  {openFolder === undefined ? t('files.none') : t('files.emptyFolder')}
                </p>
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
                        // A row selector has no visible label of its own, so the
                        // file's name is the only name it can carry.
                        <input
                          type="checkbox"
                          data-testid="file-check"
                          aria-label={file.name}
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
                            onPointerDown={(event) => event.stopPropagation()}
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
                        onPointerDown={(event) => event.stopPropagation()}
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
          </>
        )}
      </div>

      {/* On a phone Files IS the screen, not a pane beside the sidebar, so it
          carries the sidebar's bottom bar too -- otherwise Popy, the health
          dot and Settings disappear the moment you open Files. */}
      <div className="md:hidden">
        <ShellFooter />
      </div>
    </div>
  );
}

/** Line-style folder, matching the app's stroked icons. */
export function FolderIcon() {
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
