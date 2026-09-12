import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { menuAnchor, menuKeyboard, nativeContext, type MenuAnchor } from '../lib/context-menu';
import { useNotificationsStore } from '../store/notifications';
import { ContextMenu, MenuItem, Pressable } from './controls';
export interface ContextAction { id: string; label: string; run: () => void | Promise<unknown>; danger?: boolean }
/** Adds the same menu through right-click, keyboard and a visible touch target. */
export function ActionSurface({children, actions, className = '', showTrigger = true, label = t('context.actions')}: {children: ReactNode; actions: ContextAction[]; className?: string; showTrigger?: boolean; label?: string}) {
  const [anchor,setAnchor]=useState<MenuAnchor>();
  const notify=useNotificationsStore(state=>state.notify);
  if (actions.length===0) return <>{children}</>;
  return <div className={`relative ${className}`} onKeyDown={menuKeyboard} onContextMenu={event=>{if(nativeContext(event.target))return;event.preventDefault();event.stopPropagation();setAnchor(menuAnchor(event));}}>
    {children}
    {showTrigger ? <Pressable type="button" data-testid="context-actions" aria-label={label} className="absolute right-1 top-1 rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover-overlay)]" onClick={event=>{event.stopPropagation();setAnchor(menuAnchor(event));}}>⋯</Pressable> : null}
    {anchor ? <ContextMenu anchor={anchor} onClose={()=>setAnchor(undefined)}>{actions.map(action=><MenuItem key={action.id} testId={`context-${action.id}`} label={action.label} danger={action.danger ?? false} onClick={()=>{setAnchor(undefined);void Promise.resolve().then(action.run).catch(()=>notify(t('context.failed')));}} />)}</ContextMenu> : null}
  </div>;
}
