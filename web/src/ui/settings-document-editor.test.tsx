// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDocumentEditor } from './settings-document-editor';
import { SettingsSyncBoundary } from './settings-sync';
import { settingsResources } from '../services/settings-resources';
import { settingsCache } from '../services/settings-cache';
import { settingsService } from '../services/settings';
import { syncSetting } from '../services/settings-preload';
import { syncQueue } from '../services/sync-queue';
vi.mock('../services/settings-cache', () => ({ settingsCache: { read: vi.fn(), write: vi.fn(), clear: vi.fn() } }));
vi.mock('../services/settings', () => ({ settingsService: { readMemory: vi.fn(), writeMemory: vi.fn(), restoreMemory: vi.fn() } }));
vi.mock('../services/health', () => ({ healthMonitor: { getState: () => ({ kind: 'ok' }), subscribe: () => () => undefined } }));
vi.mock('../services/events', () => ({ eventStream: { onResume: () => () => undefined } }));
beforeEach(() => {
  settingsResources.clear(); vi.resetAllMocks();
  vi.mocked(settingsCache.read).mockResolvedValue(undefined);
  vi.mocked(settingsService.readMemory).mockResolvedValue({ doc: 'Original', hasBackup: false });
});
afterEach(() => { cleanup(); syncQueue.stop(); });
function show() { render(<SettingsSyncBoundary><SettingsDocumentEditor kind="memory" /></SettingsSyncBoundary>); }
async function ready() { await waitFor(() => expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('Original')); }

describe('Settings document recovery', () => {
  it('does not allow an unloaded or failed document to be saved as empty; Retry recovers', async () => {
    vi.mocked(settingsService.readMemory).mockRejectedValueOnce(new Error('offline'));
    show();
    await screen.findByText('Retry');
    expect((screen.getByTestId('settings-memory-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('settings-memory-save'));
    expect(settingsService.writeMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Retry'));
    await ready();
  });
  it('keeps cached text visible when the initial network read fails', async () => {
    vi.mocked(settingsCache.read).mockResolvedValue({ version: 1, savedAt: 1, data: { doc: 'Yesterday', hasBackup: false } });
    vi.mocked(settingsService.readMemory).mockRejectedValue(new Error('offline'));
    show();
    await screen.findByText('Could not refresh. Showing saved data; live status is unconfirmed.');
    expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('Yesterday');
    expect((screen.getByTestId('settings-memory-save') as HTMLButtonElement).disabled).toBe(true);
  });
  it('preserves dirty text and makes remote changes an explicit comparison', async () => {
    show(); await ready();
    fireEvent.change(screen.getByTestId('settings-memory'), { target: { value: 'My edit' } });
    act(() => settingsResources.accept('memory', { doc: 'Agent edit', hasBackup: true }));
    expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('My edit');
    expect((screen.getByLabelText('Latest server version') as HTMLTextAreaElement).value).toBe('Agent edit');
    expect((screen.getByTestId('settings-memory-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Keep my edits'));
    vi.mocked(settingsService.writeMemory).mockResolvedValue({ doc: 'My edit', hasBackup: true });
    fireEvent.click(screen.getByTestId('settings-memory-save'));
    await waitFor(() => expect(settingsService.writeMemory).toHaveBeenCalledWith('My edit', 'Agent edit'));
  });
  it('keeps typing available while an invalidated document refreshes, but blocks Save', async () => {
    show(); await ready();
    const field = screen.getByTestId('settings-memory') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Editing' } });
    act(() => settingsResources.invalidate('memory'));
    expect(field.closest('[inert]')).toBeNull();
    fireEvent.change(field, { target: { value: 'Still editing' } });
    expect(field.value).toBe('Still editing');
    expect(screen.getByTestId('settings-memory-save')).toHaveProperty('disabled', true);
  });
  it('preserves typing that happens while Save is in flight', async () => {
    show(); await ready();
    let done!: (value: { doc: string; hasBackup: boolean }) => void;
    vi.mocked(settingsService.writeMemory).mockReturnValue(new Promise((resolve) => { done = resolve; }));
    fireEvent.change(screen.getByTestId('settings-memory'), { target: { value: 'Submitted' } });
    fireEvent.click(screen.getByTestId('settings-memory-save'));
    fireEvent.change(screen.getByTestId('settings-memory'), { target: { value: 'Newer typing' } });
    await act(async () => done({ doc: 'Submitted', hasBackup: true }));
    expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('Newer typing');
    expect((screen.getByTestId('settings-memory-save') as HTMLButtonElement).disabled).toBe(false);
  });
  it('reconciles a changed resource after recovery without replacing a dirty draft', async () => {
    show(); await ready();
    fireEvent.change(screen.getByTestId('settings-memory'), { target: { value: 'Draft' } });
    vi.mocked(settingsService.readMemory).mockResolvedValue({ doc: 'Remote', hasBackup: true });
    await act(async () => { settingsResources.invalidate('memory'); await syncSetting('memory'); });
    await screen.findByLabelText('Latest server version');
    expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('Draft');
    fireEvent.click(screen.getByTestId('settings-memory-cancel'));
    expect((screen.getByTestId('settings-memory') as HTMLTextAreaElement).value).toBe('Remote');
  });
});
