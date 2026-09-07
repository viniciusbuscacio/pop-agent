// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { FilesPage } from './files-page';
import { useFilesStore } from '../store/files';
import { filesService } from '../services/artifacts';
const reloadFiles = useFilesStore.getState().reload;
const mocks = vi.hoisted(() => ({ undo: vi.fn(), notify: vi.fn() }));
vi.mock('../services/artifacts', () => ({ filesService: { remove: vi.fn(), tree: vi.fn(), search: vi.fn() } }));
vi.mock('../lib/trash-undo', () => ({ useTrashUndo: () => mocks.undo }));
vi.mock('./shell-header', () => ({ ShellFooter: () => null }));
vi.mock('../ui/pull-to-refresh', () => ({ PullToRefresh: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../ui/file-viewer', () => ({ FileViewer: () => <div data-testid="viewer" /> }));
vi.mock('../store/notifications', () => ({ useNotificationsStore: (select: (value: { notify: typeof mocks.notify }) => unknown) => select({ notify: mocks.notify }) }));
function mount() { return render(<MemoryRouter initialEntries={['/files']}><Routes><Route path="/files/*" element={<FilesPage />} /></Routes></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ tree: [
    { name: 'a.md', path: 'a.md', kind: 'file', size: 12, mtime: '' },
    { name: 'b.md', path: 'b.md', kind: 'file', size: 12, mtime: '' },
    { name: 'Docs', path: 'Docs', kind: 'dir', size: 0, mtime: '', children: [] },
  ], reload: vi.fn(async () => {}) });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(filesService.remove).mockImplementation(async path => ({ name: path, originalPath: path, deletedAt: new Date().toISOString(), purgeAt: new Date().toISOString(), kind: 'file' as const, size: 12 }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('Select exposes checkboxes; row taps toggle, select all includes folders and Cancel exits', () => {
  mount(); fireEvent.click(screen.getByTestId('files-select'));
  fireEvent.click(screen.getAllByTestId('file-row')[0]!);
  expect(screen.getByRole('checkbox', { name: 'a.md' })).toHaveProperty('checked', true);
  expect(screen.queryByTestId('viewer')).toBeNull();
  fireEvent.click(screen.getByTestId('folder-row'));
  expect(screen.getByRole('checkbox', { name: 'Docs' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByTestId('files-select-all'));
  expect(screen.getByText('3 selected')).toBeTruthy();
  fireEvent.click(screen.getByTestId('files-select-cancel'));
  expect(screen.queryByTestId('file-check')).toBeNull();
});
it('touch hold selects its file and suppresses the release click', () => {
  vi.useFakeTimers(); mount(); const row=screen.getAllByTestId('file-row')[0]!;
  fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 20, clientY: 20 });
  act(() => { vi.advanceTimersByTime(500); });
  fireEvent.pointerUp(row); fireEvent.click(row);
  expect(screen.getByRole('checkbox', { name: 'a.md' })).toHaveProperty('checked', true);
  expect(screen.queryByTestId('viewer')).toBeNull();
});
it.each(['move', 'cancel', 'release', 'mouse'])('does not select after %s', kind => {
  vi.useFakeTimers(); mount(); const row=screen.getAllByTestId('file-row')[0]!;
  fireEvent.pointerDown(row, { pointerType: kind==='mouse'?'mouse':'touch', clientX: 20, clientY: 20 });
  if(kind==='move')fireEvent.pointerMove(row, { clientX: 20, clientY: 45 });
  if(kind==='cancel')fireEvent.pointerCancel(row);
  if(kind==='release')fireEvent.pointerUp(row);
  act(() => { vi.advanceTimersByTime(600); });
  expect(screen.queryByTestId('file-check')).toBeNull();
});
it('canceling confirmation does not delete; a partial failure retains only failed selections', async () => {
  mount(); fireEvent.click(screen.getByTestId('files-select'));
  for(const row of screen.getAllByTestId('file-row'))fireEvent.click(row);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByTestId('files-delete-selected'));
  expect(filesService.remove).not.toHaveBeenCalled();
  vi.mocked(filesService.remove).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByTestId('files-delete-selected'));
  await waitFor(() => expect(screen.getByTestId('files-delete-selected')).toHaveProperty('disabled', false));
  expect(filesService.remove).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('checkbox', { name: 'a.md' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'b.md' })).toHaveProperty('checked', false);
  expect(mocks.undo).toHaveBeenCalledWith([expect.objectContaining({ originalPath: 'b.md' })]);
  expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('1 item(s)'));
});
it('prevents double submission while deleting', async () => {
  let finish!: () => void;
  vi.mocked(filesService.remove).mockImplementation(() => new Promise(resolve => { finish=()=>resolve({name:'a.md',originalPath:'a.md',deletedAt:new Date().toISOString(),purgeAt:new Date().toISOString(),kind:'file',size:12}); }));
  mount(); fireEvent.click(screen.getByTestId('files-select')); fireEvent.click(screen.getAllByTestId('file-row')[0]!);
  fireEvent.click(screen.getByTestId('files-delete-selected')); fireEvent.click(screen.getByTestId('files-delete-selected'));
  expect(filesService.remove).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(screen.queryByTestId('files-batch-bar')).toBeNull();
});

it('keeps the last known file list when refresh fails', async () => {
  const previous=useFilesStore.getState().tree;
  vi.mocked(filesService.tree).mockRejectedValueOnce(new Error('offline'));
  await reloadFiles();
  expect(useFilesStore.getState().tree).toBe(previous);
});
