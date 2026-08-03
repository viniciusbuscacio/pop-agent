// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { usePullToRefresh } from './pull-to-refresh';

/**
 * happy-dom has no Touch constructor, and the hook only ever reads clientX/
 * clientY off touches[0] -- so the event carries exactly that.
 */
function touch(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
  return event;
}

function scroller(scrollTop = 0): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollTop', { value: scrollTop, writable: true });
  document.body.append(element);
  return element;
}

/** Drags from (0,0) to (x,y) on the element and lets go. */
function drag(element: HTMLElement, x: number, y: number): void {
  element.dispatchEvent(touch('touchstart', 0, 0));
  element.dispatchEvent(touch('touchmove', x / 2, y / 2));
  element.dispatchEvent(touch('touchmove', x, y));
  element.dispatchEvent(touch('touchend', x, y));
}

function mount(element: HTMLElement, onRefresh: () => Promise<void>) {
  const ref = createRef<HTMLElement>();
  Object.defineProperty(ref, 'current', { value: element, writable: true });
  return renderHook(() => usePullToRefresh(ref, onRefresh));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('usePullToRefresh', () => {
  it('refreshes on a long downward pull from the top', async () => {
    const element = scroller();
    const onRefresh = vi.fn(() => Promise.resolve());
    mount(element, onRefresh);

    // 200px of finger is 100px of indicator at half resistance -- past the
    // 64px trigger.
    drag(element, 0, 200);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('does nothing when the pull stops short of the trigger', async () => {
    const element = scroller();
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = mount(element, onRefresh);

    drag(element, 0, 40);

    await waitFor(() => expect(result.current.distance).toBe(0));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('leaves a sideways drag alone, so a chat row keeps its swipe', async () => {
    const element = scroller();
    const onRefresh = vi.fn(() => Promise.resolve());
    mount(element, onRefresh);

    // Mostly across, a little down: this is delete/archive, not a refresh.
    drag(element, 200, 30);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores a pull on a list that is already scrolled', async () => {
    const element = scroller(120);
    const onRefresh = vi.fn(() => Promise.resolve());
    mount(element, onRefresh);

    drag(element, 0, 200);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('keeps the spinner up while the refresh runs', async () => {
    const element = scroller();
    let release = (): void => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { result } = mount(element, onRefresh);

    drag(element, 0, 200);

    await waitFor(() => expect(result.current.refreshing).toBe(true));
    release();
    await waitFor(() => expect(result.current.refreshing).toBe(false), { timeout: 2000 });
    await waitFor(() => expect(result.current.distance).toBe(0));
  });
});
