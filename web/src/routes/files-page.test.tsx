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
vi.mock('../services/artifacts', () => ({ filesService: { upload: vi.fn(async()=>{}), mkdir: vi.fn(async()=>{}), remove: vi.fn(), tree: vi.fn(), search: vi.fn() } }));
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

it('mouse click selects, the second click does not undo selection, and double click opens', () => {
  mount();const row=screen.getAllByTestId('file-row')[0]!;
  fireEvent.pointerDown(row,{pointerType:'mouse'});fireEvent.click(row,{detail:1});
  expect(screen.getByRole('checkbox',{name:'a.md'})).toHaveProperty('checked',true);
  expect(screen.queryByTestId('viewer')).toBeNull();
  fireEvent.click(row,{detail:2});fireEvent.doubleClick(row);
  expect(screen.getByRole('checkbox',{name:'a.md'})).toHaveProperty('checked',true);
  expect(screen.getByTestId('viewer')).toBeTruthy();
});
it('touch taps open and touch double taps do not invoke desktop double-click behavior', () => {
  mount();const row=screen.getAllByTestId('file-row')[0]!;
  fireEvent.pointerDown(row,{pointerType:'touch'});fireEvent.pointerUp(row);fireEvent.click(row,{detail:1});
  expect(screen.getByTestId('viewer')).toBeTruthy();
  expect(screen.queryByTestId('file-check')).toBeNull();
});
it('Space selects and Enter opens even while selecting', () => {
  mount();const row=screen.getAllByTestId('file-row')[0]!;
  fireEvent.keyDown(row,{key:' '});
  expect(screen.getByRole('checkbox',{name:'a.md'})).toHaveProperty('checked',true);
  fireEvent.keyDown(row,{key:'Enter'});expect(screen.getByTestId('viewer')).toBeTruthy();
});
it('folder double click navigates after a single click selects', () => {
  mount();const row=screen.getByTestId('folder-row');
  fireEvent.pointerDown(row,{pointerType:'mouse'});fireEvent.click(row,{detail:1});
  expect(screen.getByRole('checkbox',{name:'Docs'})).toHaveProperty('checked',true);
  fireEvent.doubleClick(row);
  expect(screen.queryByTestId('file-row')).toBeNull();
});

it('shows Select all beside the toolbar after checking one file and selects the entire folder', () => {
  mount();fireEvent.click(screen.getByTestId('files-select'));
  fireEvent.click(screen.getByRole('checkbox',{name:'a.md'}));
  const top=screen.getByTestId('files-select');
  expect(top.textContent).toBe('Select all items');expect(top).toHaveProperty('disabled',false);
  fireEvent.click(top);
  expect(screen.getByText('3 selected')).toBeTruthy();
  expect(screen.getByRole('checkbox',{name:'b.md'})).toHaveProperty('checked',true);
  expect(screen.getByRole('checkbox',{name:'Docs'})).toHaveProperty('checked',true);
  expect(top).toHaveProperty('disabled',true);
});

 it('top bin deletes selected items instead of navigating to Trash, and respects cancellation', async () => {
  mount();
  expect(screen.getByTestId('files-trash').textContent).toContain('Trash');
  fireEvent.click(screen.getByTestId('files-select'));
  expect(screen.getByTestId('files-trash')).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'a.md' }));
  fireEvent.click(screen.getByTestId('files-select'));
  expect(screen.queryByTestId('files-trash')).toBeNull();
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByTestId('files-delete-toolbar'));
  expect(filesService.remove).not.toHaveBeenCalled();
  expect(screen.getByText('3 selected')).toBeTruthy();
  fireEvent.click(screen.getByTestId('files-delete-toolbar'));
  await waitFor(() => expect(filesService.remove).toHaveBeenCalledTimes(3));
  expect(vi.mocked(filesService.remove).mock.calls.map(([path]) => path)).toEqual(['a.md', 'b.md', 'Docs']);
  await waitFor(() => expect(screen.getByTestId('files-trash')).toBeTruthy());
  expect(screen.queryByTestId('files-batch-bar')).toBeNull();
 });

it('uploads a dropped folder under the current folder and preserves empty children', async () => {
  render(<MemoryRouter initialEntries={['/files/Docs']}><Routes><Route path="/files/*" element={<FilesPage />} /></Routes></MemoryRouter>);
  const f=new File(['report'],'report.txt');
  let batch=0;
  const root={name:'Reports',isDirectory:true,createReader:()=>({readEntries:(done:(entries:unknown[])=>void)=>done(batch++===0?[
    {name:'report.txt',isFile:true,file:(done:(file:File)=>void)=>done(f)},
    {name:'empty',isDirectory:true,createReader:()=>({readEntries:(done:(entries:unknown[])=>void)=>done([])})},
  ]:[])})};
  fireEvent.drop(screen.getByTestId('files-view'),{dataTransfer:{files:[],items:[{kind:'file',webkitGetAsEntry:()=>root,getAsFile:()=>null}]}});
  await waitFor(()=>expect(filesService.upload).toHaveBeenCalledWith(f,'Docs/Reports',expect.any(AbortSignal)));
  expect(filesService.mkdir).toHaveBeenCalledWith('Docs/Reports/empty');
});

it('right click preserves a selected group and targets only an unselected item',()=>{
 mount();fireEvent.click(screen.getByTestId('files-select'));for(const check of screen.getAllByTestId('file-check'))fireEvent.click(check);
 fireEvent.contextMenu(screen.getAllByTestId('file-row')[0]!,{clientX:900,clientY:500});expect(screen.getByTestId('context-delete-selected')).toBeTruthy();expect(screen.getByText('2 selected',{selector:'span.px-4'})).toBeTruthy();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 fireEvent.contextMenu(screen.getByTestId('folder-row'),{clientX:900,clientY:500});expect(screen.getByRole('checkbox',{name:'Docs'})).toHaveProperty('checked',true);expect(screen.getByRole('checkbox',{name:'a.md'})).toHaveProperty('checked',false);expect(screen.getByTestId('folder-open')).toBeTruthy();expect(filesService.remove).not.toHaveBeenCalled();
});
it('blank-space menu preserves the search field native menu',()=>{
 mount();const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});screen.getByTestId('files-filter').dispatchEvent(e);expect(e.defaultPrevented).toBe(false);
 fireEvent.contextMenu(screen.getByTestId('files-view'),{clientX:800,clientY:500});expect(screen.getByTestId('context-new-folder')).toBeTruthy();expect(screen.getByTestId('context-upload-folder')).toBeTruthy();
});

it('does not select the whole folder through the background menu while searching',()=>{
 mount();fireEvent.change(screen.getByTestId('files-filter'),{target:{value:'one result'}});
 fireEvent.contextMenu(screen.getByTestId('files-view'));expect(screen.queryByTestId('context-select-all')).toBeNull();expect(screen.getByTestId('context-upload')).toBeTruthy();
});
