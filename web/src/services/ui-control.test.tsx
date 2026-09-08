// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { collectUiState, performUiCommand } from './ui-control';
vi.mock('./api', () => ({ apiRequest: vi.fn(), pendingUiRequests: () => 0 }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function visible(): void { vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON: () => ({}) }); }
const command = { id: 'command-test', expiresAt: Date.now() + 60_000 };
it('uses the native setter so React sees typed and cleared text', async () => {
  visible(); function Editor() { const [value, setValue] = useState('old'); return <textarea data-testid="editor" value={value} onChange={e => setValue(e.target.value)} />; }
  render(<Editor />);
  expect(await performUiCommand({ ...command, kind: 'input', testid: 'editor', value: 'hello' })).toMatchObject({ state: { controls: [{ value: 'hello' }] } });
  await performUiCommand({ ...command, kind: 'input', testid: 'editor', value: '' });
  expect((screen.getByTestId('editor') as HTMLTextAreaElement).value).toBe('');
});
it('does not choose between repeated controls and refuses missing/disabled targets', async () => {
  visible(); const click = vi.fn(); render(<><button data-testid="item" onClick={click}>A</button><button data-testid="item">B</button><button data-testid="disabled" disabled>Disabled</button></>);
  expect(await performUiCommand({ ...command, kind: 'press', testid: 'item' })).toMatchObject({ error: { code: 'ambiguous_testid' } });
  expect(await performUiCommand({ ...command, kind: 'press', testid: 'missing' })).toMatchObject({ error: { code: 'unknown_testid' } });
  expect(await performUiCommand({ ...command, kind: 'press', testid: 'disabled' })).toMatchObject({ error: { code: 'disabled_control' } });
  expect(click).not.toHaveBeenCalled();
  await performUiCommand({ ...command, kind: 'press', testid: 'item', index: 0 }); expect(click).toHaveBeenCalledOnce();
});
it('discovers and operates every visible interactive control without requiring a testid', async () => {
  visible(); const click = vi.fn(); render(<button onClick={click}>Unlabelled in source</button>);
  const control = collectUiState().controls.find(item => item.name === 'Unlabelled in source');
  expect(control).toMatchObject({ role: 'button' });
  expect(control?.testid).toBeUndefined();
  await performUiCommand({ ...command, kind: 'press', controlId: control!.controlId });
  expect(click).toHaveBeenCalledOnce();
});
it('scrolls the viewport or an addressed visible container', async () => {
  visible(); render(<div data-testid="scroll-region" />);
  const viewportScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  const region = screen.getByTestId('scroll-region');
  const regionScroll = vi.fn();
  Object.defineProperty(region, 'scrollBy', { configurable: true, value: regionScroll });

  await performUiCommand({ ...command, kind: 'scroll', deltaY: 600 });
  expect(viewportScroll).toHaveBeenCalledWith({ left: 0, top: 600, behavior: 'auto' });

  const control = collectUiState().controls.find(item => item.testid === 'scroll-region');
  await performUiCommand({ ...command, kind: 'scroll', controlId: control!.controlId, deltaX: 120 });
  expect(regionScroll).toHaveBeenCalledWith({ left: 120, top: 0, behavior: 'auto' });
});
it('omits password values and private descendants from state', () => {
  visible(); render(<><input data-testid="password" type="password" defaultValue="never-export" /><div data-testid="wrapper"><code data-ui-private>private-token</code></div></>);
  const state = JSON.stringify(collectUiState()); expect(state).not.toContain('never-export'); expect(state).not.toContain('private-token');
});
it('expired actions and screenshots without consent do not operate the interface', async () => {
  visible(); const click = vi.fn(); render(<button data-testid="save" onClick={click}>Save</button>);
  expect(await performUiCommand({ ...command, kind: 'press', testid: 'save', expiresAt: 0 })).toMatchObject({ error: { code: 'ui_timeout' } });
  expect(await performUiCommand({ ...command, kind: 'screenshot' })).toMatchObject({ error: { code: 'screen_not_shared' } });
  expect(click).not.toHaveBeenCalled();
});
