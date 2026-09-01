import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { A2aAgentDTO, FileNodeDTO, McpServerDTO, SkillDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { useTrashUndo } from '../lib/trash-undo';
import { ApiError } from '../services/api';
import { filesService } from '../services/artifacts';
import { skillsService } from '../services/skills';
import { joinPath, parentDir, useFilesStore } from '../store/files';
import { useA2aStore } from '../store/a2a';
import { useMcpStore } from '../store/mcp';
import { useNotificationsStore } from '../store/notifications';
import { matchesSourceFilter, skillEnabled, type SkillSourceFilter, useSkillsStore } from '../store/skills';
import { Menu, Pressable } from '../ui/controls';
import { FolderIcon } from './files-page';

/**
 * The sidebar when Files is active: the folder tree.
 * The content pane on the right shows the selected folder; here is only
 * where-you-can-go, with counts, kept in sync through the shared store.
 */
export function FolderTree() {
  const navigate = useNavigate();
  const location = useLocation();
  const tree = useFilesStore((state) => state.tree);
  const reload = useFilesStore((state) => state.reload);
  const notify = useNotificationsStore((state) => state.notify);
  const announceTrash = useTrashUndo();
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
  // wherever you see it. Rename is a path edit now, and the
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
    const removed = await filesService.remove(folder.path);
    await reload();
    announceTrash([removed]);
    if (folder.path === currentPath) void navigate('/files');
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
  // helper, so the tree reconciles cleanly. Real top-level folders start one
  // level in because the permanent Files / row represents their root.
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
            <Pressable
              type="button"
              data-testid="tree-expand"
              aria-label={isOpen ? t('files.collapse') : t('files.expand')}
              aria-expanded={isOpen}
              onClick={() => toggle(folder.path)}
              className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
            >
              {isOpen ? '−' : '+'}
            </Pressable>
          ) : (
            <span className="h-5 w-4 shrink-0" aria-hidden="true" />
          )}
          <Pressable
            type="button"
            data-testid="tree-folder"
            onClick={() => void navigate(`/files/${folder.path}`)}
            className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
          >
            <FolderIcon />
            <span className="truncate text-sm">{folder.name}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
              {t('files.count', {
                count: (folder.children ?? []).filter((child) => child.kind === 'file').length,
              })}
            </span>
          </Pressable>
          <Pressable
            type="button"
            data-testid="tree-folder-menu"
            aria-label={t('shell.chatMenu')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMenuFor((v) => (v === folder.path ? undefined : folder.path))}
            className="shrink-0 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            ⋯
          </Pressable>
        </div>
        {menuFor === folder.path ? (
          <Menu
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute top-9 right-2 z-10"
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
          </Menu>
        ) : null}
        {kids.length > 0 && isOpen ? kids.map((child) => renderRow(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-20" data-testid="folder-tree">
      {/* The filesystem root is a place in its own right, even when it has no
          folders. Keeping it visible prevents an empty sidebar from looking
          broken and makes the pane on the right read as the contents of Files
          /. It is structural, so unlike a real folder it cannot be renamed,
          deleted or collapsed. */}
      <div
        className={`flex items-center pr-1 ${
          currentPath === ''
            ? 'bg-[var(--hover-overlay)] font-medium'
            : 'hover:bg-[var(--hover-overlay)]'
        }`}
      >
        <span className="h-5 w-4 shrink-0" aria-hidden="true" />
        <Pressable
          type="button"
          data-testid="tree-root"
          aria-current={currentPath === '' ? 'page' : undefined}
          onClick={() => void navigate('/files')}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
        >
          <FolderIcon />
          <span className="truncate text-sm">{t('files.rootCrumb')} /</span>
        </Pressable>
      </div>
      {(tree ?? [])
        .filter((node) => node.kind === 'dir')
        .map((folder) => renderRow(folder, 1))}
    </div>
  );
}

const SKILL_FILTER_OPTIONS: { value: SkillSourceFilter; labelKey: Parameters<typeof t>[0] }[] = [
  { value: 'all', labelKey: 'skills.filter.all' },
  { value: 'personal', labelKey: 'skills.filter.personal' },
  { value: 'auto', labelKey: 'skills.filter.auto' },
  { value: 'builtin', labelKey: 'skills.filter.builtin' },
];

const SKILL_FIELD_CLASS =
  'w-full truncate text-left rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--screen-fg)] outline-none';

/** Source filter dropdown, model-picker style. */
function SkillsSourceFilter() {
  const sourceFilter = useSkillsStore((state) => state.sourceFilter);
  const setSourceFilter = useSkillsStore((state) => state.setSourceFilter);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const baseLabel = t(
    SKILL_FILTER_OPTIONS.find((option) => option.value === sourceFilter)?.labelKey ??
      'skills.filter.all',
  );
  const buttonLabel = baseLabel;

  return (
    <div ref={root} className="relative min-w-0 px-3 pb-2">
      <span id="skills-source-filter-label" className="sr-only">
        {t('skills.filter.label')}
      </span>
      <Pressable
        type="button"
        data-testid="skills-source-filter"
        role="combobox"
        aria-label={t('skills.filter.label')}
        aria-controls="skills-source-filter-listbox"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((shown) => !shown)}
        className={SKILL_FIELD_CLASS}
      >
        {buttonLabel}
      </Pressable>
      {open ? (
        <div className="absolute top-full right-3 left-3 z-20 mt-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-1 shadow-lg">
          <div
            id="skills-source-filter-listbox"
            role="listbox"
            aria-label={t('skills.filter.label')}
            className="flex flex-col"
          >
            {SKILL_FILTER_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                type="button"
                role="option"
                data-testid={`skills-source-filter-${option.value}`}
                aria-selected={option.value === sourceFilter}
                onClick={() => {
                  setSourceFilter(option.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--screen-fg)] hover:bg-[var(--hover-overlay)]"
              >
                <span className="truncate">{t(option.labelKey)}</span>
                {option.value === sourceFilter ? (
                  <span className="ml-auto shrink-0 text-[var(--accent)]">✓</span>
                ) : null}
              </Pressable>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The skills list in the sidebar (docs/specs/Spec-Pop-General.md §8), the explorer twin of the
 * folder tree: the shared store keeps it in step with the editor pane, and a
 * row opens that skill on the right. Filtered by the sidebar search.
 */
export function SkillsList({ filter }: { filter: string }) {
  const navigate = useNavigate();
  const { slug } = useParams();
  const skills = useSkillsStore((state) => state.skills);
  const sourceFilter = useSkillsStore((state) => state.sourceFilter);
  const reload = useSkillsStore((state) => state.reload);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  useDismiss(menuFor !== undefined, () => setMenuFor(undefined));

  useEffect(() => {
    void reload();
  }, [reload]);

  async function removeSkill(skill: SkillDTO): Promise<void> {
    await skillsService.remove(skill.slug);
    await reload();
    if (slug === skill.slug) void navigate('/skills');
  }

  if (skills === undefined) return <div className="flex-1" />;

  const query = filter.trim().toLowerCase();
  const shown = skills.filter((skill) => {
    if (!matchesSourceFilter(skill, sourceFilter)) return false;
    if (query.length === 0) return true;
    return `${skill.slug} ${skill.name} ${skill.description} ${skill.whenToUse}`
      .toLowerCase()
      .includes(query);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SkillsSourceFilter />
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
                } ${skillEnabled(skill) ? '' : 'opacity-70'}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuFor(skill.slug);
                }}
              >
                <Pressable
                  type="button"
                  data-testid="skill-row"
                  onClick={() => void navigate(`/skills/${skill.slug}`)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{skill.name}</span>
                    {skill.source === 'builtin' ? (
                      <span className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--muted)]">
                        {t('skills.builtin')}
                      </span>
                    ) : null}
                    {!skillEnabled(skill) ? (
                      <span className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--muted)]">
                        {t('skills.disabled')}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-[var(--muted)]">{skill.description}</span>
                </Pressable>
                <Pressable
                  type="button"
                  data-testid="skill-row-menu"
                  aria-label={t('shell.chatMenu')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setMenuFor((v) => (v === skill.slug ? undefined : skill.slug))}
                  className="shrink-0 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                >
                  ⋯
                </Pressable>
              </div>
              {menuFor === skill.slug ? (
                <Menu
                  onPointerDown={(event) => event.stopPropagation()}
                  className="absolute top-9 right-2 z-10"
                >
                  <MenuItem
                    testId="skill-row-edit"
                    label={t('skills.edit')}
                    onClick={() => {
                      setMenuFor(undefined);
                      void navigate(`/skills/${skill.slug}`);
                    }}
                  />
                  {skill.source === 'builtin' ? null : (
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
                </Menu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

export function A2aSidebar({ filter }: { filter: string }) {
  const navigate = useNavigate();
  const agents = useA2aStore((state) => state.agents);
  const query = filter.trim().toLowerCase();
  const rows = (agents ?? []).filter((agent) =>
    `${agent.name} ${agent.description} ${agent.baseUrl} ${agent.status}`.toLowerCase().includes(query),
  );

  return (
    <div className="flex-1 overflow-y-auto pb-20" data-testid="a2a-list">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('a2a.none')}</p>
      ) : (
        <ul>
          {rows.map((agent: A2aAgentDTO) => (
            <li key={agent.id}>
              <Pressable
                type="button"
                data-testid="a2a-row"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hover-overlay)]"
                onClick={() => void navigate(`/a2a/${agent.id}`)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{agent.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {[agent.protocolVersion, agent.agentVersion].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-xs text-[var(--muted)]">
                  <span>{agent.status}</span>
                  <span>{agent.enabled ? t('a2a.enabled') : t('a2a.disabled')}</span>
                </span>
              </Pressable>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function McpSidebar({ filter }: { filter: string }) {
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
              <Pressable
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hover-overlay)]"
                onClick={() => void navigate(`/mcp/${server.id}`)}
              >
                <span className="min-w-0 truncate text-sm">{server.name}</span>
                <span className="flex shrink-0 flex-col items-end text-xs text-[var(--muted)]">
                  <span>{server.enabled ? server.status : t('mcp.disabled')}</span>
                  {server.protocolEra === undefined ? null : (
                    <span>
                      {server.protocolEra === 'modern' ? 'stateless' : 'legacy'}{' '}
                      {server.protocolVersion ?? ''}
                    </span>
                  )}
                </span>
              </Pressable>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How far a finger must travel before the swipe action fires. */

function MenuItem({ label, onClick, testId, danger = false }: {
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-1.5 text-left whitespace-nowrap hover:bg-[var(--hover-overlay)] ${danger ? 'text-[var(--danger)]' : ''}`}
    >
      {label}
    </Pressable>
  );
}
