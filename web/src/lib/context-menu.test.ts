// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { fitMenu, nativeContext, selectionIn } from './context-menu';
it('fits all edges, including an oversized menu',()=>{
 expect(fitMenu(999,999,200,100,390,844)).toEqual({left:182,top:736});
 expect(fitMenu(-20,-40,500,900,390,844)).toEqual({left:8,top:8});
});
it('preserves editable fields, images and links, including descendants',()=>{
 const root=document.createElement('div');root.innerHTML='<textarea></textarea><div contenteditable="true"><span>draft</span></div><a href="/test"><strong>link</strong></a><img src="x">';
 for(const e of Array.from(root.querySelectorAll('textarea,span,strong,img')))expect(nativeContext(e)).toBe(true);
 expect(nativeContext(root)).toBe(false);
});
it('uses a selection only when both endpoints belong to the target',()=>{
 const one=document.createElement('div'),two=document.createElement('div');one.textContent='one';two.textContent='two';document.body.append(one,two);
 const range=document.createRange();range.selectNodeContents(one);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 expect(selectionIn(one)).toBe('one');expect(selectionIn(two)).toBe('');
 window.getSelection()!.removeAllRanges();one.remove();two.remove();
});
