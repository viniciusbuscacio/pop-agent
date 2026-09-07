// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { collectDroppedFiles } from './file-drop';
function file(name: string): FileSystemEntry {
  return { name, isFile: true, isDirectory: false, file: (resolve: (file: File) => void) => resolve(new File([name], name)) } as unknown as FileSystemEntry;
}
function folder(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  return { name, isDirectory: true, isFile: false, createReader: () => {
    let offset=0;
    return { readEntries: (resolve: (entries: FileSystemEntry[]) => void) => resolve(batches[offset++] ?? []) };
  } } as unknown as FileSystemEntry;
}
function drop(entries: FileSystemEntry[]): DataTransfer {
  return { files: [], items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })) } as unknown as DataTransfer;
}
it('reads every directory batch and preserves nested, empty and mixed roots', async () => {
  const many=Array.from({length:205},(_,i)=>file(`${i}.txt`));
  const result=await collectDroppedFiles(drop([
    folder('Reports',[many.slice(0,100),many.slice(100,200),many.slice(200),[folder('Q1',[[file('same.txt')]]),folder('empty',[])]]),
    folder('Other',[[file('same.txt')]]),file('loose.txt'),
  ]));
  expect(result.files).toHaveLength(208);
  expect(result.files.filter(e=>e.file.name==='same.txt').map(e=>e.directory)).toEqual(['Reports/Q1','Other']);
  expect(result.files.at(-1)?.directory).toBe('');
  expect(result.emptyDirectories).toEqual(['Reports/empty']);
});
it('captures all handles before awaiting directory reads', async () => {
  const data=drop([folder('one',[[file('one.txt')]]),folder('two',[[file('two.txt')]])]);
  const work=collectDroppedFiles(data);
  Object.defineProperty(data,'items',{get(){throw Error('expired drag store');}});
  expect((await work).files.map(e=>e.directory)).toEqual(['one','two']);
});
it('retains ordinary file drops when entry APIs are unavailable', async () => {
  const f=new File(['hello'],'hello.txt');
  const data={files:[f],items:[{kind:'file',getAsFile:()=>f}]} as unknown as DataTransfer;
  expect((await collectDroppedFiles(data)).files).toEqual([{file:f,directory:''}]);
  expect((await collectDroppedFiles({files:[f],items:[]} as unknown as DataTransfer)).files).toHaveLength(1);
});
it('propagates unreadable directories and cancellation without partial success', async () => {
  const broken={name:'broken',isDirectory:true,createReader:()=>({readEntries: (_ok: unknown, fail: (error: Error)=>void)=>fail(new Error('unreadable'))})} as unknown as FileSystemEntry;
  await expect(collectDroppedFiles(drop([file('first.txt'),broken]))).rejects.toThrow('unreadable');
  const controller=new AbortController();controller.abort();
  const reader=vi.fn();const entry=folder('cancelled',[]);Object.assign(entry,{createReader:reader});
  await expect(collectDroppedFiles(drop([entry]),controller.signal)).rejects.toThrow();expect(reader).not.toHaveBeenCalled();
});
