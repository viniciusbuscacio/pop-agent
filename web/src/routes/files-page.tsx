import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { FileNodeDTO, GarbageEntryDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { saveFromLink, viewFromLink } from '../lib/download';
import { useDismiss } from '../lib/dismiss';
import { MD_BREAKPOINT, useMediaQuery } from '../lib/media';
import { relativeTime } from '../lib/time';
import { useTrashUndo } from '../lib/trash-undo';
import { ApiError } from '../services/api';
import { filesService } from '../services/artifacts';
import {
  baseName,
  childrenOf,
  findNode,
  flattenDirs,
  joinPath,
  parentDir,
  useFilesStore,
} from '../store/files';
import { useNotificationsStore } from '../store/notifications';
import { Button, MenuItem, Select } from '../ui/controls';
import { Breadcrumb } from '../ui/breadcrumb';
import { PullToRefresh } from '../ui/pull-to-refresh';
import { SidebarNav } from './sidebar-nav';
import { ShellFooter } from './shell-header';

/**
 * The content pane of Files: the folders and files of ONE folder, listed at the
 * same indent, with a breadcrumb saying where that is (Vinicius, 03/08). You go
 * down by opening a folder and back up through the breadcrumb; the expandable
 * tree lives in the sidebar, where it does not compete with this list. The
 * folder's path is the rest of the URL after /files/ -- the path IS the
 * identifier now, there are no ids. Search asks the server for name matches
 * and returns folders as well as files, from anywhere in the tree, each shown
 * with its full path. On a phone the search box sits on its own full-width
 * line so the buttons do not crush it.
 */
export function FilesPage() {
  const currentPath = (useParams()['*'] ?? '').replace(/\/+$/, '');
  const navigate = useNavigate();
  const tree = useFilesStore((state) => state.tree);
  const reload = useFilesStore((state) => state.reload);
  const notify = useNotificationsStore((state) => state.notify);
  const announceTrash = useTrashUndo();

  const [filter, setFilter] = useState('');
  const [searchHits, setSearchHits] = useState<
    { path: string; kind: 'file' | 'dir' }[] | undefined
  >(undefined);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Folders are ticked in their own set rather than sharing the file one: the
  // two obey different rules downstream (Move to… steps aside while a folder
  // is ticked, and deleting one takes its whole subtree), and a bare path
  // alone would not say which kind it is.
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
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
    setSelectedFolders(new Set());
    setSelecting(false);
    setFilter('');
    setMenuFor(undefined);
  }, [currentPath]);

  const searching = filter.trim().length > 0;

  // Search asks the server for name matches (folders + files, whole tree).
  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const query = filter.trim();
    if (query.length === 0) {
      setSearchHits(undefined);
      return;
    }
    let live = true;
    const handle = setTimeout(() => {
      void filesService
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

  const openFolder: FileNodeDTO | undefined =
    currentPath === '' ? undefined : findNode(tree ?? [], currentPath);

  // A dead link (deleted folder, or a file's path) falls back to the root once
  // the tree arrived.
  useEffect(() => {
    if (currentPath !== '' && tree !== undefined && openFolder?.kind !== 'dir') {
      navigate('/files', { replace: true });
    }
  }, [currentPath, openFolder, tree, navigate]);

  const listing = childrenOf(tree ?? [], currentPath);
  const rootFolders = listing.filter((node) => node.kind === 'dir');
  const visibleFiles = listing.filter((node) => node.kind === 'file');

  function fileCount(node: FileNodeDTO): number {
    return (node.children ?? []).filter((child) => child.kind === 'file').length;
  }

  /**
   * Every file the server would trash along with this folder -- its own plus
   * each descendant's. A confirm that counted only the direct children would
   * understate the reach exactly where it matters most.
   */
  function subtreeFileCount(node: FileNodeDTO): number {
    return (node.children ?? []).reduce(
      (total, child) => total + (child.kind === 'file' ? 1 : subtreeFileCount(child)),
      0,
    );
  }

  // The breadcrumb's steps, root first: Files, then every segment of the open
  // folder's path, each crumb carrying the cumulative path as its id.
  function trail(): { id: string; name: string }[] {
    const crumbs = [{ id: '', name: t('files.rootCrumb') }];
    let walked = '';
    if (currentPath !== '') {
      for (const segment of currentPath.split('/')) {
        walked = joinPath(walked, segment);
        crumbs.push({ id: walked, name: segment });
      }
    }
    return crumbs;
  }

  function openCrumb(id: string): void {
    navigate(id === '' ? '/files' : `/files/${id}`);
  }

  /**
   * A move that may be refused: something at the target's path already exists.
   * The refusal gets its own words -- everything else stays a thrown error.
   */
  async function movePath(from: string, to: string): Promise<void> {
    try {
      await filesService.move(from, to);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'name_taken') {
        notify(t('files.nameTaken', { name: baseName(to) }));
        return;
      }
      throw error;
    }
  }

  async function upload(list: FileList | File[] | null): Promise<void> {
    const entries = list === null ? [] : Array.from(list);
    if (entries.length === 0) return;
    setUploading({ done: 0, total: entries.length });
    try {
      for (const [index, file] of entries.entries()) {
        setUploading({ done: index, total: entries.length });
        await filesService.upload(file, currentPath);
      }
    } finally {
      setUploading(undefined);
    }
    await reload();
  }

  /**
   * A directory upload arrives as a flat list where each file remembers the
   * path it came from ("Reports/Q3/summary.pdf"), so each file is posted with
   * that path as its `dir` -- no folder pre-creation, because the server
   * mkdir -p's every missing parent on write. Flattening everything into the
   * current folder would lose the shape the user picked.
   */
  async function uploadFolder(list: FileList | null): Promise<void> {
    const entries = list === null ? [] : Array.from(list);
    if (entries.length === 0) return;
    setUploading({ done: 0, total: entries.length });
    try {
      for (const [index, file] of entries.entries()) {
        setUploading({ done: index, total: entries.length });
        const relativeDir = parentDir(file.webkitRelativePath);
        await filesService.upload(file, joinPath(currentPath, relativeDir));
      }
    } finally {
      setUploading(undefined);
    }
    await reload();
  }

  async function download(path: string): Promise<void> {
    saveFromLink(await filesService.link(path));
  }

  /**
   * Opens the file in a new tab and lets the browser show it: a PDF, image,
   * text or video lands in the system's own viewer, and on a phone the share
   * sheet from there is what hands it to a real app. A web page cannot launch
   * the OS default program itself, so anything the browser will not display
   * (a .docx, a .zip) downloads instead and the OS takes over from there.
   */
  function openFile(path: string): void {
    viewFromLink(filesService.viewUrl(path));
  }

  async function renameFile(file: FileNodeDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), file.name);
    if (name === null || name.trim().length === 0 || name === file.name) return;
    await movePath(file.path, joinPath(parentDir(file.path), name.trim()));
    await reload();
  }

  async function deleteFile(file: FileNodeDTO): Promise<void> {
    const removed = await filesService.remove(file.path);
    await reload();
    announceTrash([removed]);
  }

  // A folder created here lands under the folder you are in (a subfolder), or at
  // the root when you are at the root.
  async function newFolder(): Promise<void> {
    const inside = openFolder !== undefined;
    const name = window.prompt(inside ? t('files.newSubfolderPrompt') : t('files.newFolderPrompt'));
    if (name === null || name.trim().length === 0) return;
    await filesService.mkdir(joinPath(currentPath, name.trim()));
    await reload();
  }

  async function renameFolder(folder: FileNodeDTO): Promise<void> {
    const name = window.prompt(t('files.renamePrompt'), folder.name);
    if (name === null || name.trim().length === 0 || name === folder.name) return;
    await movePath(folder.path, joinPath(parentDir(folder.path), name.trim()));
    await reload();
  }

  /**
   * Deleting a folder takes its whole subtree, so this one asks first. YOLO
   * (31/07) is about the AGENT not stopping to ask permission in the middle of
   * a task; it was never about the person's own thumb. A ⋯ menu on a phone
   * puts Delete folder a few millimetres from Rename (Vinicius, 03/08) -- the
   * trash keeps it reversible for thirty days, but the confirm still names
   * the reach.
   */
  async function deleteFolder(folder: FileNodeDTO): Promise<void> {
    const confirmed = window.confirm(
      t('files.deleteFolderConfirm', { name: folder.name, count: subtreeFileCount(folder) }),
    );
    if (!confirmed) return;
    const removed = await filesService.remove(folder.path);
    await reload();
    announceTrash([removed]);
    if (folder.path === currentPath) navigate('/files');
  }

  function toggleSelected(path: string): void {
    setSelected((current) => toggled(current, path));
  }

  function toggleFolderSelected(path: string): void {
    setSelectedFolders((current) => toggled(current, path));
  }

  /**
   * Selection now starts from the item you are pointing at, not from a mode
   * switch above the list: ticking this one and turning the mode on are the
   * same gesture. Already selecting, it adds to what is there rather than
   * throwing it away -- the menu is still reachable mid-selection, and losing
   * the previous ticks would be the surprise.
   */
  function startSelection(filePath?: string, folderPath?: string): void {
    setSelecting(true);
    if (filePath !== undefined) setSelected((current) => toggled(current, filePath, true));
    if (folderPath !== undefined) {
      setSelectedFolders((current) => toggled(current, folderPath, true));
    }
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
    const removed: GarbageEntryDTO[] = [];
    for (const path of selected) removed.push(await filesService.remove(path));
    for (const path of selectedFolders) removed.push(await filesService.remove(path));
    const closedTheOpenOne = currentPath !== '' && selectedFolders.has(currentPath);
    clearSelection();
    await reload();
    announceTrash(removed);
    if (closedTheOpenOne) navigate('/files');
  }

  // Files only: Move to… is hidden while a folder is ticked, so the batch bar
  // never offers something it would have to refuse half of.
  async function moveSelected(targetDir: string): Promise<void> {
    for (const path of selected) await movePath(path, joinPath(targetDir, baseName(path)));
    clearSelection();
    await reload();
  }

  const folderHits = (searchHits ?? []).filter((hit) => hit.kind === 'dir');
  const fileHits = (searchHits ?? []).filter((hit) => hit.kind === 'file');

  const selectedCount = selected.size + selectedFolders.size;
  const allSelected =
    visibleFiles.length + rootFolders.length > 0 &&
    visibleFiles.every((file) => selected.has(file.path)) &&
    rootFolders.every((folder) => selectedFolders.has(folder.path));

  // Seven steps on a wide screen, four on a phone (Vinicius, 03/08). Past the
  // limit the ones in front collapse into a … that lists them in order, Files
  // first, and the … takes the first slot -- so the line never grows either
  // way. The phone number is the smaller one because names truncate there
  // long before they do on a desktop.
  const CRUMB_LIMIT = useMediaQuery(MD_BREAKPOINT) ? 7 : 4;

  // A folder row of the open folder's list. No indent and no expander: this
  // pane shows one level, the same way it shows its files, and the sidebar is
  // where a folder opens in place (Vinicius, 03/08).
  function renderFolder(folder: FileNodeDTO) {
    return (
      <li key={folder.path} className="relative">
        <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]">
          {selecting ? (
            // Same as a file row: the folder's name is the only label the
            // checkbox can carry.
            <input
              type="checkbox"
              data-testid="folder-check"
              aria-label={folder.name}
              checked={selectedFolders.has(folder.path)}
              onChange={() => toggleFolderSelected(folder.path)}
            />
          ) : null}
          <button
            type="button"
            data-testid="folder-row"
            onClick={() => navigate(`/files/${folder.path}`)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <FolderIcon />
            <span className="truncate text-sm font-medium">{folder.name}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
              {t('files.count', { count: fileCount(folder) })}
            </span>
          </button>
          <button
            type="button"
            data-testid="folder-row-menu"
            aria-label={t('shell.chatMenu')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMenuFor((v) => (v === folder.path ? undefined : folder.path))}
            className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
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
              testId="folder-select"
              label={t('files.selectFolder')}
              onClick={() => {
                setMenuFor(undefined);
                startSelection(undefined, folder.path);
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

  // A file row's menu, shared between the folder listing and the search
  // results: the actions are the same wherever the file was found.
  function renderFileMenu(file: FileNodeDTO, inSearch: boolean) {
    return (
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
            openFile(file.path);
          }}
        />
        {/* No "Select file" in search: selection is a property of a folder's
            listing, and the batch bar is hidden while a search is on screen.
            An entry that did nothing would be worse than its absence. */}
        {inSearch ? null : (
          <MenuItem
            testId="file-select"
            label={t('files.selectFile')}
            onClick={() => {
              setMenuFor(undefined);
              startSelection(file.path);
            }}
          />
        )}
        <MenuItem
          testId="file-download"
          label={t('files.download')}
          onClick={() => {
            setMenuFor(undefined);
            void download(file.path);
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
        <Breadcrumb crumbs={trail()} limit={CRUMB_LIMIT} onOpen={openCrumb} />

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
          {/* Icon-only: the bin is the one control here everybody already
              recognises without reading, and among four worded buttons the
              word "Trash" read like a fifth action rather than a place to go.
              The label stays for a screen reader and for the hover tooltip. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="files-trash"
            aria-label={t('trash.title')}
            title={t('trash.title')}
            onClick={() => navigate('/files/trash')}
          >
            <TrashIcon />
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
              setSelected(allSelected ? new Set() : new Set(visibleFiles.map((file) => file.path)));
              setSelectedFolders(
                allSelected ? new Set() : new Set(rootFolders.map((folder) => folder.path)),
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
          {/* Move to… steps aside while a folder is ticked rather than
              offering something the batch loop does not do. */}
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
            {flattenDirs(tree ?? [])
              .filter((folder) => folder.path !== currentPath)
              .map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.path}
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
              {folderHits.map((hit) => {
                const node = findNode(tree ?? [], hit.path);
                return (
                  <li key={`folder-${hit.path}`} className="relative">
                    <button
                      type="button"
                      data-testid="search-folder-row"
                      onClick={() => navigate(`/files/${hit.path}`)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--hover-overlay)]"
                    >
                      <FolderIcon />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{baseName(hit.path)}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{hit.path}</span>
                      </span>
                      {node === undefined ? null : (
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {t('files.count', { count: fileCount(node) })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {fileHits.map((hit) => {
                const node = findNode(tree ?? [], hit.path);
                return (
                  <li key={`file-${hit.path}`} className="relative">
                    <div
                      data-testid="artifact-row"
                      className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover-overlay)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{baseName(hit.path)}</span>
                          <button
                            type="button"
                            data-testid="file-menu"
                            aria-label={t('shell.chatMenu')}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => setMenuFor((v) => (v === hit.path ? undefined : hit.path))}
                            className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                          >
                            ⋯
                          </button>
                        </div>
                        <span className="block truncate text-xs text-[var(--muted)]">{hit.path}</span>
                      </div>
                    </div>
                    {menuFor === hit.path
                      ? renderFileMenu(
                          node ?? {
                            name: baseName(hit.path),
                            path: hit.path,
                            kind: 'file',
                            size: 0,
                            mtime: '',
                          },
                          true,
                        )
                      : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <>
            {rootFolders.length > 0 ? (
              <ul data-testid="folder-list">
                {rootFolders.map((folder) => renderFolder(folder))}
              </ul>
            ) : null}

            {tree === undefined ? null : visibleFiles.length === 0 && rootFolders.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                <p className="text-sm text-[var(--muted)]">
                  {currentPath === '' ? t('files.none') : t('files.emptyFolder')}
                </p>
                <p className="text-xs text-[var(--muted)]">{t('files.emptyCta')}</p>
              </div>
            ) : (
              <ul data-testid="all-artifacts">
                {visibleFiles.map((file) => (
                  <li key={file.path} className="relative">
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
                          checked={selected.has(file.path)}
                          onChange={() => toggleSelected(file.path)}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{file.name}</span>
                          <button
                            type="button"
                            data-testid="file-menu"
                            aria-label={t('shell.chatMenu')}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => setMenuFor((v) => (v === file.path ? undefined : file.path))}
                            className="shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                          >
                            ⋯
                          </button>
                        </div>
                        <span className="block truncate text-xs text-[var(--muted)]">
                          {formatSize(file.size)} · {relativeTime(file.mtime)}
                        </span>
                      </div>
                    </div>
                    {menuFor === file.path ? renderFileMenu(file, false) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PullToRefresh>

      {/* On a phone Files IS the screen, not a pane beside the sidebar, so it
          carries the sidebar's bottom bar too -- otherwise Pop Agent, the health
          dot and Settings disappear the moment you open Files. */}
      <div className="md:hidden">
        <ShellFooter />
      </div>
    </div>
  );
}

/** The bin, drawn -- never an emoji (permanent house veto). */
export function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1ZM6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
 * A new set with `path` flipped, or forced in when `addOnly`. Files and folders
 * keep separate sets and both tick the same way, so the rule lives here once.
 */
function toggled(current: Set<string>, path: string, addOnly = false): Set<string> {
  const next = new Set(current);
  if (next.has(path) && !addOnly) next.delete(path);
  else next.add(path);
  return next;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
