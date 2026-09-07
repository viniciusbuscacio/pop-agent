// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { apiDownload, apiUpload, apiRequest, setSessionLostHandler } from './api';
import { session } from './session';
import { filesService } from './artifacts';
import { useFilesStore } from '../store/files';
import { createEventStream } from './events';
import { SESSION_TOKEN_HEADER } from '@pop-agent/shared';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); session.clear(); localStorage.clear(); setSessionLostHandler(() => undefined); });
const requests = [
    { name: 'JSON', run: () => apiRequest('/settings') },
    { name: 'download', run: () => apiDownload('/backup') },
    { name: 'upload', run: () => apiUpload('/files', new FormData()) },
];
it.each(requests)('$name: ignores old rejection after a new login', async ({ run }) => {
    session.start('old-session', false);
    const reply = deferred<Response>();
    const lost = vi.fn();
    setSessionLostHandler(lost);
    vi.stubGlobal('fetch', () => reply.promise);
    const request = run().catch(() => undefined);
    session.start('new-session', false);
    reply.resolve(new Response(JSON.stringify({ error: { code: 'invalid_session' } }), { status: 401 }));
    await request;
    expect(session.token()).toBe('new-session');
    expect(lost).not.toHaveBeenCalled();
});
it.each(requests)('$name: ignores renewal after sign-out', async ({ run }) => {
    session.start('old-session', false);
    const reply = deferred<Response>();
    vi.stubGlobal('fetch', () => reply.promise);
    const request = run();
    session.clear();
    reply.resolve(new Response('{}', { headers: { [SESSION_TOKEN_HEADER]: 'renewed-old-session' } }));
    await request;
    expect(session.token()).toBeUndefined();
});
it.each(requests)('$name: applies current renewal but rejects a later obsolete renewal', async ({ run }) => {
    session.start('old-session', true);
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const firstRequest = run();
    const secondRequest = run();
    second.resolve(new Response('{}', { headers: { [SESSION_TOKEN_HEADER]: 'new-token' } }));
    await secondRequest;
    first.resolve(new Response('{}', { headers: { [SESSION_TOKEN_HEADER]: 'obsolete-token' } }));
    await firstRequest;
    expect(session.token()).toBe('new-token');
    expect(localStorage.getItem('pop-agent.token')).toBe('new-token');
});
it('does not apply a Files reload after the session ends', async () => {
    session.start('old-session', false);
    useFilesStore.setState({ tree: [] });
    const reply = deferred<Awaited<ReturnType<typeof filesService.tree>>>();
    vi.spyOn(filesService, 'tree').mockReturnValue(reply.promise);
    const request = useFilesStore.getState().reload();
    session.clear();
    reply.resolve({ tree: [{ name: 'private.txt', path: 'private.txt', kind: 'file', size: 1, mtime: '2026-09-07T00:00:00Z' }] });
    await request;
    expect(useFilesStore.getState().tree).toEqual([]);
});
it('an older Files snapshot cannot restore a deleted item in the UI', async () => {
    const old = deferred<Awaited<ReturnType<typeof filesService.tree>>>(), fresh = deferred<Awaited<ReturnType<typeof filesService.tree>>>();
    vi.spyOn(filesService, 'tree').mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const first = useFilesStore.getState().reload();
    const second = useFilesStore.getState().reload();
    fresh.resolve({ tree: [] });
    await second;
    old.resolve({ tree: [{ name: 'deleted.txt', path: 'deleted.txt', kind: 'file', size: 1, mtime: '2026-09-07T00:00:00Z' }] });
    await first;
    expect(useFilesStore.getState().tree).toEqual([]);
});
it('foreground refresh includes completion during replacement connection', async () => {
    const pending = deferred<string>();
    let calls = 0;
    const sources: EventTarget[] = [];
    const doc = new EventTarget() as Document;
    let visibility = 'visible';
    Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
    const win = new EventTarget() as Window;
    const stream = createEventStream({ issueTicket: () => ++calls === 1 ? Promise.resolve('first') : pending.promise,
        open: () => { const source = new EventTarget(); Object.assign(source, { close: () => undefined }); sources.push(source); return source as EventSource; },
        document: doc, window: win, schedule: (cb, ms) => setTimeout(cb, ms), cancel: clearTimeout });
    let canonical = 'running';
    let rendered = 'running';
    let snapshots = 0;
    stream.onResume(() => { snapshots++; rendered = canonical; });
    stream.start();
    await Promise.resolve();
    sources[0]!.dispatchEvent(new Event('open'));
    visibility = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    canonical = 'finished'; // The server event is emitted while no subscription exists.
    pending.resolve('second');
    await Promise.resolve();
    await Promise.resolve();
    sources[1]!.dispatchEvent(new Event('open'));
    expect(snapshots).toBe(1);
    expect(rendered).toBe('finished');
    expect(canonical).toBe('finished');
    stream.stop();
});
