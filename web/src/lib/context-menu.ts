import type { MouseEvent as ReactMouseEvent, KeyboardEvent } from 'react';
export interface MenuAnchor { x: number; y: number; trigger: HTMLElement }
export function nativeContext(target: EventTarget | null, media = true): boolean {
  return target instanceof Element && target.closest(media ? 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a,img,video,audio,iframe' : 'input,textarea,select,[contenteditable]:not([contenteditable="false"])') !== null;
}
export function menuAnchor(event: ReactMouseEvent<HTMLElement>): MenuAnchor {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,[tabindex]') : null;
  const trigger = target ?? event.currentTarget;
  const box = trigger.getBoundingClientRect();
  return { x: event.clientX || box.left, y: event.clientY || box.bottom, trigger };
}
export function menuKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
    if (nativeContext(event.target, false)) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }
}
export function selectionIn(element: Element): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode
    || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return '';
  return selection.toString();
}
export function fitMenu(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { left: Math.max(8, Math.min(x, viewportWidth - width - 8)), top: Math.max(8, Math.min(y, viewportHeight - height - 8)) };
}
