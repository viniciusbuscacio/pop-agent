// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshButton } from './shell-header';
import { syncQueue } from '../services/sync-queue';
import { refreshClientData } from '../services/client-sync';

vi.mock('../services/client-sync', () => ({ refreshClientData: vi.fn() }));
afterEach(() => { cleanup(); syncQueue.stop(); vi.resetAllMocks(); });

describe('data refresh wheel', () => {
  it('spins for shared work and preserves mounted content, draft and location', async () => {
    let finish!: () => void;
    vi.mocked(refreshClientData).mockImplementation(() => syncQueue.add('test', () => new Promise<void>(resolve => { finish = resolve; })));
    render(<><RefreshButton /><textarea aria-label="Draft" defaultValue="Keep my text" /></>);
    const draft = screen.getByLabelText('Draft') as HTMLTextAreaElement;
    const location = window.location.href;
    fireEvent.click(screen.getByTestId('shell-refresh'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('shell-refresh')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('shell-refresh').querySelector('span')?.className).toContain('animate-spin');
    fireEvent.change(draft, { target: { value: 'Still typing' } });
    await act(async () => finish());
    expect(screen.getByTestId('shell-refresh')).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft.value).toBe('Still typing'); expect(window.location.href).toBe(location);
    expect(refreshClientData).toHaveBeenCalledOnce();
  });
  it('shows background synchronization without a manual click', async () => {
    render(<RefreshButton />); let finish!: () => void;
    await act(async () => { void syncQueue.add('startup', () => new Promise<void>(resolve => { finish = resolve; })); });
    expect(screen.getByTestId('shell-refresh')).toHaveProperty('disabled', true);
    await act(async () => finish());
    expect(screen.getByTestId('shell-refresh')).toHaveProperty('disabled', false);
  });
});
