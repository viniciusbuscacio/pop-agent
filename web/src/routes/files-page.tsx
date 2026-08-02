import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArtifactDTO, FolderDTO } from '@popy/shared';
import { t } from '../i18n';
import { saveFromLink } from '../lib/download';
import { useDismiss } from '../lib/dismiss';
import { relativeTime } from '../lib/time';
import { artifactsService, foldersService } from '../services/artifacts';
import { useChatStore } from '../store/chat';
import { useFilesStore } from '../store/files';
import { Button, Segmented, Select } from '../ui/controls';

/**
 * The content pane of Files (31/07, explorer layout): on a wide screen it
 * fills the right side while the sidebar shows the folder tree; on a phone it
 * is its own screen with a back button. Shows one folder (or the root):
 * breadcrumb, toolbar, drag-and-drop upload, batch selection, per-item menus.
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
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ done: number; total: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

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

  const openFolder: FolderDTO | undefined = folders.find((entry) => entry.id === folderId);

  // A dead link (deleted folder) falls back to the root once folders arrived.
  useEffect(() => {
    if (folderId !== undefined && files !== undefined && openFolder === undefined) {
      navigate('/files', { replace: true });
    }
  }, [folderId, openFolder, files, navigate]);

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

  // YOLO mode (31/07): destructive actions just happen -- no dialogs anywhere.
  async function deleteFolder(folder: FolderDTO): Promise<void> {
    await foldersService.remove(folder.id);
    await reload();
    navigate('/files');
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
      className={`flex h-full min-h-0 flex-1 flex-col ${dragging ? 'outline-2 outline-dashed outline-[var(--accent)] -outline-offset-2' : ''}`}
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
      {/* Files is a first-class mobile segment, just like Chats and Tasks.
          Keep the same segmented header instead of replacing it with a
          one-off wordmark/back-button header. */}
      <div className="border-b border-[var(--border)] p-3 md:hidden">
        <Segmented<'chats' | 'files' | 'tasks'>
          ariaLabel={t('shell.segments')}
          value="files"
          onChange={(value) => {
            if (value === 'tasks') {
              navigate('/tasks');
              return;
            }
            if (value === 'chats') {
              // Files opens Chats as the list, never the last conversation.
              navigate('/');
            }
          }}
          options={[
            { value: 'chats', label: t('shell.segChats'), testId: 'segment-chats' },
            { value: 'files', label: t('shell.segFiles'), testId: 'segment-files' },
            { value: 'tasks', label: t('shell.segTasks'), testId: 'segment-tasks' },
          ]}
        />
      </div>
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <div className="flex min-w-0 flex-1 items-center gap-1" data-testid="files-breadcrumb">
          <button
            type="button"
            data-testid="crumb-root"
            onClick={() => navigate('/files')}
            className={`text-sm ${openFolder === undefined ? 'font-semibold text-[var(--screen-fg)]' : 'text-[var(--accent)] hover:underline'}`}
          >
            {t('files.rootCrumb')}
          </button>
          {openFolder !== undefined ? (
            <>
              <span className="text-sm text-[var(--muted)]">/</span>
              <span className="truncate text-sm font-semibold" data-testid="crumb-folder">
                {openFolder.name}
              </span>
              <div className="relative">
                <button
                  type="button"
                  data-testid="folder-menu"
                  aria-label={t('shell.chatMenu')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setMenuFor((v) => (v === openFolder.id ? undefined : openFolder.id))}
                  className="rounded px-1.5 text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                >
                  ⋯
                </button>
                {menuFor === openFolder.id ? (
                  <div
                    onPointerDown={(event) => event.stopPropagation()}
                    role="menu"
                    className="absolute top-7 left-0 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
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
              </div>
            </>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-[var(--muted)]" data-testid="files-count">
          {t('files.count', { count: visibleFiles.length })}
        </span>
      </header>

      <div className="flex items-center gap-2 p-3 pb-2">
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
        <input
          data-testid="files-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('shell.filterFiles')}
          aria-label={t('shell.filterFiles')}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleFolders.length > 0 ? (
          <ul data-testid="folder-list">
            {visibleFolders.map((folder) => (
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
                      {t('files.count', {
                        count: (files ?? []).filter((file) => file.folderId === folder.id).length,
                      })}
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
            ))}
          </ul>
        ) : null}

        {files === undefined ? null : visibleFiles.length === 0 && visibleFolders.length === 0 ? (
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
