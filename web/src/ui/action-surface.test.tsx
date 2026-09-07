// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionSurface } from './action-surface';
afterEach(cleanup);
it('opens the same actions by pointer and keyboard, supports arrows and restores focus on Escape',()=>{
 const run=vi.fn();render(<ActionSurface actions={[{id:'one',label:'One',run},{id:'two',label:'Two',run}]}><p>Target</p><input aria-label="draft" /></ActionSurface>);
 const trigger=screen.getByTestId('context-actions');trigger.focus();fireEvent.keyDown(trigger,{key:'F10',shiftKey:true});
 expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'One'}));
 fireEvent.keyDown(document.activeElement!,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Two'}));
 fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'One'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
 const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});screen.getByRole('textbox').dispatchEvent(event);expect(event.defaultPrevented).toBe(false);expect(screen.queryByRole('menu')).toBeNull();
 fireEvent.contextMenu(screen.getByText('Target'),{clientX:380,clientY:830});expect(screen.getAllByRole('menuitem')).toHaveLength(2);expect(run).not.toHaveBeenCalled();
 fireEvent.pointerDown(document.body);expect(screen.queryByRole('menu')).toBeNull();
});
it('only one menu stays open across surfaces',()=>{
 render(<><ActionSurface actions={[{id:'one',label:'One',run:()=>{}}]}><p>First</p></ActionSurface><ActionSurface actions={[{id:'two',label:'Two',run:()=>{}}]}><p>Second</p></ActionSurface></>);
 fireEvent.contextMenu(screen.getByText('First'));fireEvent.contextMenu(screen.getByText('Second'));expect(screen.getAllByRole('menu')).toHaveLength(1);expect(screen.getByRole('menuitem',{name:'Two'})).toBeTruthy();
});
