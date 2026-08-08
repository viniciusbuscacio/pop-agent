import { useState } from 'react';
import { t } from '../i18n';
import { useDismiss } from '../lib/dismiss';
import { MenuItem } from './controls';

/**
 * Where you are, and the way back (pop-agent.spec §14).
 *
 * The app's own text colour rather than the link blue: this is a title that
 * happens to be clickable, so it is the heaviest thing on the screen after the
 * navigation. Always on screen, the root included -- a line that appears only
 * once you are deep makes the screen jump, and "Files" on its own is the title
 * of the root (Vinicius, 03/08).
 *
 * Past `limit` steps the ones in front collapse into a … that lists them in
 * order. Seven on a wide screen, four on a phone, where names truncate long
 * before they do on a desktop.
 *
 * Shared rather than copied: Files and its Trash are the same place seen from
 * two angles, and the field controls already taught this codebase what happens
 * to a look that is hand-copied into a second screen (see FIELD_BASE).
 */
export interface Crumb {
  /** '' is the root; anything else is what `onOpen` gets handed back. */
  id: string;
  name: string;
}

export function Breadcrumb({
  crumbs,
  limit,
  onOpen,
}: {
  crumbs: Crumb[];
  limit: number;
  onOpen: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  useDismiss(menu, () => setMenu(false));

  const deep = crumbs.length > limit;
  const collapsed = deep ? crumbs.slice(0, crumbs.length - (limit - 1)) : [];
  const shown = deep ? crumbs.slice(-(limit - 1)) : crumbs;

  return (
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
          aria-expanded={menu}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMenu((value) => !value)}
          className="rounded px-1 text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
        >
          …
        </button>
      ) : null}

      {shown.map((crumb, index) => (
        <span key={crumb.id === '' ? 'root' : crumb.id} className="flex min-w-0 items-center gap-1.5">
          {index > 0 || collapsed.length > 0 ? (
            <span className="shrink-0 text-[var(--muted)]">&gt;</span>
          ) : null}
          {index === shown.length - 1 ? (
            <span className="truncate" data-testid="crumb-current">
              {crumb.name}
            </span>
          ) : (
            <button
              type="button"
              data-testid="crumb-link"
              onClick={() => onOpen(crumb.id)}
              className="truncate hover:underline"
            >
              {crumb.name}
            </button>
          )}
        </span>
      ))}

      {menu ? (
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
                setMenu(false);
                onOpen(crumb.id);
              }}
            />
          ))}
        </div>
      ) : null}
    </nav>
  );
}
