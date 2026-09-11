// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('local-access/setup/assets/index.html'), 'utf8');
const script = readFileSync(resolve('local-access/setup/assets/wizard.js'), 'utf8');
const element = (id: string): HTMLElement => document.getElementById(id)!;
const input = (id: string): HTMLInputElement => element(id) as HTMLInputElement;
const click = (id: string): void => element(id).click();
const visible = (step: string): boolean => !(document.querySelector(`[data-step="${step}"]`) as HTMLElement).hidden;
let api: { GetState: ReturnType<typeof vi.fn>; Install: ReturnType<typeof vi.fn>; Finish: ReturnType<typeof vi.fn>; Uninstall: ReturnType<typeof vi.fn>; Close: ReturnType<typeof vi.fn>; Minimize: ReturnType<typeof vi.fn>; OpenProject: ReturnType<typeof vi.fn> };

beforeEach(() => {
  document.body.innerHTML = html.split('<body>')[1]!.split('</body>')[0]!.replace(/<script[\s\S]*?<\/script>/g, '');
  api = {
    GetState: vi.fn().mockResolvedValue({ version: '0.2.91', installed: false, directory: 'C:\\fixture\\LocalAccess', server: 'https://fixture.test', startAtLogin: true, license: 'MIT fixture license', preview: false }),
    Install: vi.fn().mockResolvedValue(''), Finish: vi.fn().mockResolvedValue(''), Uninstall: vi.fn().mockResolvedValue(''),
    Close: vi.fn(), Minimize: vi.fn(), OpenProject: vi.fn(),
  };
  Object.defineProperty(window, 'go', { configurable: true, value: { main: { Setup: api } } });
});
afterEach(() => { Reflect.deleteProperty(window, 'go'); vi.restoreAllMocks(); });
async function start(): Promise<void> { window.eval(script); await vi.waitFor(() => expect(element('version').textContent).toContain('0.2.91')); }
async function ready(): Promise<void> { await start(); click('next'); expect(visible('license')).toBe(true); click('next'); input('password').value = 'fixture-secret'; click('next'); expect(visible('destination')).toBe(true); }

describe('PLA visual setup wizard', () => {
  it('cancels before installation without calling any privileged mutation', async () => {
    await ready(); click('cancel'); expect(api.Close).toHaveBeenCalledOnce(); expect(api.Install).not.toHaveBeenCalled(); expect(input('password').value).toBe('');
  });
  it('installs a fresh computer and explicitly applies finish choices', async () => {
    await ready(); click('next');
    await vi.waitFor(() => expect(visible('done')).toBe(true));
    expect(api.Install).toHaveBeenCalledWith('https://fixture.test', 'fixture-secret');
    expect(input('password').value).toBe('');
    input('startup').checked = false; click('next');
    await vi.waitFor(() => expect(api.Finish).toHaveBeenCalledWith(true, false, false, true));
  });
  it('preserves an existing disabled startup choice and offers saved sign-in', async () => {
    const state = await api.GetState();
    api.GetState.mockResolvedValue({ ...state, installed: true, installedVersion: '0.2.90', savedLogin: true, startAtLogin: false });
    await start(); expect(element('welcome-title').textContent).toContain('Update'); expect(input('startup').checked).toBe(false); expect(input('password').placeholder).toContain('saved sign-in');
  });
  it('reports failure without a false success screen and clears the password', async () => {
    api.Install.mockResolvedValue('Runtime preparation failed. Previous files were not replaced.');
    await ready(); click('next');
    await vi.waitFor(() => expect(element('error').textContent).toContain('Runtime preparation failed'));
    expect(visible('connection')).toBe(true); expect(visible('done')).toBe(false); expect(input('password').value).toBe(''); expect(api.Finish).not.toHaveBeenCalled();
  });
  it('disables cancel while the transaction is running', async () => {
    let finish!: (value: string) => void;
    api.Install.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
    await ready(); click('next');
    expect((element('cancel') as HTMLButtonElement).disabled).toBe(true); click('cancel'); expect(api.Close).not.toHaveBeenCalled();
    finish(''); await vi.waitFor(() => expect(visible('done')).toBe(true));
  });
  it('switches between family light and dark themes', async () => {
    await start(); const previous = document.documentElement.dataset['theme']; click('theme'); expect(document.documentElement.dataset['theme']).not.toBe(previous); click('theme'); expect(document.documentElement.dataset['theme']).toBe(previous);
  });
});
