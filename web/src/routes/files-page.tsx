import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArtifactDTO, FilesSearchHitDTO, FolderDTO } from '@popy/shared';
import { t } from '../i18n';
import { saveFromLink, viewFromLink } from '../lib/download';
import { useDismiss } from '../lib/dismiss';
import { MD_BREAKPOINT, useMediaQuery } from '../lib/media';
import { relativeTime } from '../lib/time';
import { artifactsService, foldersService } from '../services/artifacts';
import { useChatStore } from '../store/chat';
import { useFilesStore } from '../store/files';
import { Button, Select } from '../ui/controls';
import { PullToRefresh } from '../ui/pull-to-refresh';
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
  const [crumbMenu, setCrumbMenu] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Folders are ticked in their own set rather than sharing the file one: the
  // two obey different rules downstream (a folder cannot be moved, and
  // deleting one takes its whole subtree), and an id alone would not say which
  // kind it is.
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ done: number; total: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  useDismiss(menuFor !== undefined, () => setMenuFor(undefined));
  useDismiss(crumbMenu, () => setCrumbMenu(false));

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

  /**
   * Every file the server would delete along with this folder -- its own plus
   * each descendant's. A confirm that counted only the direct children would
   * understate the damage exactly where it matters most, and the seen-set is
   * the same cycle guard the breadcrumb keeps.
   */
  function subtreeFileCount(id: string): number {
    const seen = new Set<string>();
    const queue = [id];
    let total = 0;
    while (queue.length > 0) {
      const current = queue.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      total += fileCount(current);
      for (const child of childFolders(current)) queue.push(child.id);
    }
    return total;
  }

  // The breadcrumb's steps, root first: Files, then every folder down to the
  // one that is open. The length guard is for a parent link that somehow
  // points at an ancestor -- a cycle must not hang the render.
  function trail(): { id: string; name: string }[] {
    const chain: FolderDTO[] = [];
    let current = openFolder;
    while (current !== undefined && chain.length < 64) {
      chain.unshift(current);
      const parentId = current.parentId;
      current = parentId === '' ? undefined : folders.find((entry) => entry.id === parentId);
    }
    return [
      { id: '', name: t('files.rootCrumb') },
      ...chain.map((folder) => ({ id: folder.id, name: folder.name })),
    ];
  }

  function openCrumb(id: string): void {
    navigate(id === '' ? '/files' : `/files/${id}`);
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

  /**
   * Opens the file in a new tab and lets the browser show it: a PDF, image,
   * text or video lands in the system's own viewer, and on a phone the share
   * sheet from there is what hands it to a real app. A web page cannot launch
   * the OS default program itself, so anything the browser will not display
   * (a .docx, a .zip) downloads instead and the OS takes over from there.
   */
  function openFile(id: string): void {
    viewFromLink(artifactsService.viewUrl(id));
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

  /**
   * Deleting a folder takes its whole subtree (server side), so this one asks
   * first. YOLO (31/07) is about the AGENT not stopping to ask permission in
   * the middle of a task; it was never about the person's own thumb. A ⋯ menu
   * on a phone puts Delete folder a few millimetres from Rename, and there is
   * no undo behind it (Vinicius, 03/08).
   */
  async function deleteFolder(folder: FolderDTO): Promise<void> {
    const confirmed = window.confirm(
      t('files.deleteFolderConfirm', { name: folder.name, count: subtreeFileCount(folder.id) }),
    );
    if (!confirmed) return;
    await foldersService.remove(folder.id);
    await reload();
    if (folder.id === openFolder?.id) navigate('/files');
  }

  function toggleSelected(id: string): void {
    setSelected((current) => toggled(current, id));
  }

  function toggleFolderSelected(id: string): void {
    setSelectedFolders((current) => toggled(current, id));
  }

  /**
   * Selection now starts from the item you are pointing at, not from a mode
   * switch above the list: ticking this one and turning the mode on are the
   * same gesture. Already selecting, it adds to what is there rather than
   * throwing it away -- the menu is still reachable mid-selection, and losing
   * the previous ticks would be the surprise.
   */
  function startSelection(fileId?: string, folderId?: string): void {
    setSelecting(true);
    if (fileId !== undefined) setSelected((current) => toggled(current, fileId, true));
    if (folderId !== undefined) setSelectedFolders((current) => toggled(current, folderId, true));
  }

  function clearSelection(): void {
    setSelecting(false);
    setSelected(new Set());
    setSelectedFolders(new Set());
  }

  // Files first, then folders: a folder takes its whole subtree with it, and
  // deleting a file whose folder is already gone would be a 404 either way.
  async function deleteSelected(): Promise<void> {
    // Batch delete is the easiest one to fire by accident -- the button sits
    // where Move to… was a moment ago -- and with a folder ticked it reaches
    // far past the rows on screen.
    const message =
      selectedFolders.size === 0
        ? t('files.deleteSelectedConfirm', { count: selected.size })
        : t('files.deleteSelectedMixedConfirm', {
            files: selected.size,
            folders: selectedFolders.size,
          });
    if (!window.confirm(message)) return;
    for (const id of selected) await artifactsService.remove(id);
    for (const id of selectedFolders) await foldersService.remove(id);
    const closedTheOpenOne = openFolder !== undefined && selectedFolders.has(openFolder.id);
    clearSelection();
    await reload();
    if (closedTheOpenOne) navigate('/files');
  }

  // Files only: a folder's parent is fixed at creation (popy.spec §6), which
  // is what keeps the tree acyclic, so Move to… is hidden while one is ticked.
  async function moveSelected(target: string): Promise<void> {
    for (const id of selected) await artifactsService.move(id, target);
    clearSelection();
    await reload();
  }

  const titles = new Map([...chats, ...archived].map((chat) => [chat.id, chat.title]));
  const visibleFiles = (files ?? []).filter((file) => file.folderId === currentParent);
  const rootFolders = childFolders(currentParent);

  const folderHits = (searchHits ?? []).filter((hit) => hit.kind === 'folder');
  const fileHits = (searchHits ?? []).filter((hit) => hit.kind === 'file');

  const selectedCount = selected.size + selectedFolders.size;
  const allSelected =
    visibleFiles.length + rootFolders.length > 0 &&
    visibleFiles.every((file) => selected.has(file.id)) &&
    rootFolders.every((folder) => selectedFolders.has(folder.id));

  // Seven steps on a wide screen, four on a phone (Vinicius, 03/08). Past the
  // limit the ones in front collapse into a … that lists them in order, Files
  // first, and the … takes the first slot -- so the line never grows either
  // way. The phone number is the smaller one because names truncate there
  // long before they do on a desktop.
  const CRUMB_LIMIT = useMediaQuery(MD_BREAKPOINT) ? 7 : 4;
  const crumbs = trail();
  const deep = crumbs.length > CRUMB_LIMIT;
  const collapsed = deep ? crumbs.slice(0, crumbs.length - (CRUMB_LIMIT - 1)) : [];
  const shownCrumbs = deep ? crumbs.slice(-(CRUMB_LIMIT - 1)) : crumbs;

  // A folder row of the open folder's list. No indent and no expander: this
  // pane shows one level, the same way it shows its files, and the sidebar is
  // where a folder opens in place (Vinicius, 03/08).
  function renderFolder(folder: FolderDTO) {
    return (
      <li key={folder.id} className="relative">
        <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]">
          {selecting ? (
            // Same as a file row: the folder's name is the only label the
            // checkbox can carry.
            <input
              type="checkbox"
              data-testid="folder-check"
              aria-label={folder.name}
              checked={selectedFolders.has(folder.id)}
              onChange={() => toggleFolderSelected(folder.id)}
            />
          ) : null}
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
              testId="folder-select"
              label={t('files.selectFolder')}
              onClick={() => {
                setMenuFor(undefined);
                startSelection(undefined, folder.id);
              }}
            />
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
        {/* Where you are, and the way back. The app's own text colour rather
            than the link blue: this is a title that happens to be clickable,
            so it is the heaviest thing on the screen after the navigation.
            Always on screen, the root included -- a line that appears only
            once you are deep makes the screen jump, and "Files" on its own is
            the title of the root (Vinicius, 03/08). */}
        <nav
          data-testid="files-breadcrumb"
          aria-label={t('files.breadcrumb')}
          className="relative flex items-center gap-1.5 text-base font-semibold text-[var(--screen-fg)]"
        >
            {collapsed.length > 0 ? (
              <button
                type="button"
                data-testid="crumb-more"
                aria-label={t('files.crumbsAbove')}
                aria-expanded={crumbMenu}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setCrumbMenu((value) => !value)}
                className="rounded px-1 text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
              >
                …
              </button>
            ) : null}
            {shownCrumbs.map((crumb, index) => (
              <span key={crumb.id === '' ? 'root' : crumb.id} className="flex min-w-0 items-center gap-1.5">
                {index > 0 || collapsed.length > 0 ? (
                  <span className="shrink-0 text-[var(--muted)]">&gt;</span>
                ) : null}
                {index === shownCrumbs.length - 1 ? (
                  <span className="truncate" data-testid="crumb-current">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="crumb-link"
                    onClick={() => openCrumb(crumb.id)}
                    className="truncate hover:underline"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
            {/* No ⋯ of its own here (Vinicius, 03/08). It held one entry,
                "Select files", and a menu beside the title is a second place
                to look for something the row's own ⋯ already offers -- so
                selection starts from the file or folder you mean, and the
                breadcrumb goes back to saying only where you are. */}
            {crumbMenu ? (
              <div
                onPointerDown={(event) => event.stopPropagation()}
                role="menu"
                className="absolute top-8 left-0 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm font-normal shadow-lg"
              >
                {collapsed.map((crumb) => (
                  <MenuItem
                    key={crumb.id === '' ? 'root' : crumb.id}
                    testId="crumb-menu-item"
                    label={crumb.name}
                    onClick={() => {
                      setCrumbMenu(false);
                      openCrumb(crumb.id);
                    }}
                  />
                ))}
              </div>
            ) : null}
        </nav>

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
          {/* Ghost like the ones beside it: three ways of putting something
              into this folder, none of them more the point than the others,
              so a raised Upload file only looked like a different kind of
              control (Vinicius, 03/08). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="files-upload"
            onClick={() => picker.current?.click()}
          >
            {t('files.uploadFile')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="files-upload-folder"
            onClick={() => folderPicker.current?.click()}
          >
            {t('files.uploadFolder')}
          </Button>
          <Button type="button" variant="ghost" size="sm" data-testid="files-new-folder" onClick={() => void newFolder()}>
            {t('files.newFolder')}
          </Button>
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

      {/* While selecting, the bar is always there: Select all is the point of
          turning selection on for a whole folder, and Cancel is the way out
          now that the toolbar button is gone (Vinicius, 03/08). Move and
          Delete only join once something is actually ticked. */}
      {!searching && selecting ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2" data-testid="files-batch-bar">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="files-select-all"
            onClick={() => {
              setSelected(allSelected ? new Set() : new Set(visibleFiles.map((file) => file.id)));
              setSelectedFolders(
                allSelected ? new Set() : new Set(rootFolders.map((folder) => folder.id)),
              );
            }}
          >
            {allSelected ? t('files.clearSelection') : t('files.selectAll')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="files-select-cancel"
            onClick={clearSelection}
          >
            {t('common.cancel')}
          </Button>
          <span className="text-xs text-[var(--muted)]">
            {t('files.selected', { count: selectedCount })}
          </span>
          {selectedCount === 0 ? null : (
          <>
          {/* A folder's parent never changes (popy.spec §6), so Move to…
              steps aside while one is ticked rather than offering something
              it would have to refuse half of. */}
          {selectedFolders.size > 0 ? null : (
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
          )}
          <Button type="button" variant="danger" size="sm" data-testid="files-delete-selected" onClick={() => void deleteSelected()}>
            {t('shell.delete')}
          </Button>
          </>
          )}
        </div>
      ) : null}

      {/* pb-20 on a phone keeps the last row clear of the bottom bar below. */}
      <PullToRefresh onRefresh={reload} className="pb-20 md:pb-0">
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
                          testId="file-open"
                          label={t('files.openFile')}
                          onClick={() => {
                            setMenuFor(undefined);
                            openFile(hit.file.id);
                          }}
                        />
                        {/* No "Select file" here: selection is a property of
                            a folder's listing, and the batch bar is hidden
                            while a search is on screen. An entry that did
                            nothing would be worse than its absence. */}
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
                          testId="file-open"
                          label={t('files.openFile')}
                          onClick={() => {
                            setMenuFor(undefined);
                            openFile(file.id);
                          }}
                        />
                        <MenuItem
                          testId="file-select"
                          label={t('files.selectFile')}
                          onClick={() => {
                            setMenuFor(undefined);
                            startSelection(file.id);
                          }}
                        />
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
      </PullToRefresh>

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

/**
 * A new set with `id` flipped, or forced in when `addOnly`. Files and folders
 * keep separate sets and both tick the same way, so the rule lives here once.
 */
function toggled(current: Set<string>, id: string, addOnly = false): Set<string> {
  const next = new Set(current);
  if (next.has(id) && !addOnly) next.delete(id);
  else next.add(id);
  return next;
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
