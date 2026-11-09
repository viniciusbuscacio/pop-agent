import { describe, expect, it, vi } from 'vitest';
import { findRelease, resumePublication, type DraftState, type PublicationAsset, type PublicationPort, type RemoteRelease } from './release-publication.ts';
const tag = 'v0.3.2';
const draftRelease: RemoteRelease = { id: 439545776, draft: true, tag_name: tag };
const fullPage = (): RemoteRelease[] => Array.from({ length: 100 }, (_, id) => ({ id, draft: true, tag_name: `other-${id}` }));
function discoveryFixture(pages: (RemoteRelease[] | undefined | Error)[], direct?: RemoteRelease | Error) {
  const api = vi.fn(async (path: string) => {
    const result = path === `releases/tags/${tag}` ? direct
      : pages[Number(new URLSearchParams(path.split('?')[1]).get('page')) - 1];
    if (result instanceof Error) throw result;
    return result;
  });
  return { api, find: () => findRelease(tag, async <T>(path: string) => await api(path) as T | undefined) };
}

describe('authenticated publication release discovery', () => {
  it.each([true, false])('uses an existing by-tag release (draft=%s) without listing', async draft => {
    const release = { ...draftRelease, draft };
    const f = discoveryFixture([], release);
    expect(await f.find()).toEqual(release);
    expect(f.api.mock.calls).toEqual([[`releases/tags/${tag}`]]);
  });
  it('finds an exact draft tag in the authenticated list after by-tag 404', async () => {
    const f = discoveryFixture([[{ ...draftRelease, id: 1, tag_name: `${tag}-rc1` }, draftRelease]]);
    expect(await f.find()).toEqual(draftRelease);
    expect(f.api.mock.calls).toEqual([[`releases/tags/${tag}`], ['releases?per_page=100&page=1']]);
  });
  it('returns missing only after exhausting the list without an exact match', async () => {
    const f = discoveryFixture([fullPage(), [{ ...draftRelease, tag_name: '0.3.2' }]]);
    expect(await f.find()).toBeUndefined();
    expect(f.api).toHaveBeenLastCalledWith('releases?per_page=100&page=2');
  });
  it('finds a draft on a later page and checks remaining pages', async () => {
    const second = fullPage(); second[0] = draftRelease;
    const f = discoveryFixture([fullPage(), second, []]);
    expect(await f.find()).toEqual(draftRelease);
    expect(f.api).toHaveBeenLastCalledWith('releases?per_page=100&page=3');
  });
  it.each([true, false])('refuses multiple exact matches, including published=%s', async published => {
    const f = discoveryFixture([[draftRelease, { ...draftRelease, id: 2, draft: !published }]]);
    await expect(f.find()).rejects.toThrow('Multiple releases match tag');
  });
  it('refuses duplicates on later pages rather than returning the first match', async () => {
    const first = fullPage(); first[0] = draftRelease;
    const f = discoveryFixture([first, [{ ...draftRelease, id: 2 }]]);
    await expect(f.find()).rejects.toThrow('Multiple releases match tag');
  });
  it('propagates non-404 by-tag failures without falling back', async () => {
    const f = discoveryFixture([[draftRelease]], new Error('HTTP 403'));
    await expect(f.find()).rejects.toThrow('HTTP 403');
    expect(f.api).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, new Error('HTTP 503')])('fails closed on listing errors even after a match', async error => {
    const first = fullPage(); first[0] = draftRelease;
    const f = discoveryFixture([first, error]);
    await expect(f.find()).rejects.toThrow(error ? 'HTTP 503' : 'Cannot list releases');
  });
  it.each([true, false])('fails closed at the pagination bound (match=%s)', async matched => {
    const pages = Array.from({ length: 100 }, fullPage);
    if (matched) pages[0]![0] = draftRelease;
    const f = discoveryFixture(pages);
    await expect(f.find()).rejects.toThrow('pagination limit exceeded');
    expect(f.api).toHaveBeenCalledTimes(101);
    expect(f.api).toHaveBeenLastCalledWith('releases?per_page=100&page=100');
  });
  it('refuses a mismatched by-tag response', async () => {
    const f = discoveryFixture([], { ...draftRelease, tag_name: 'other' });
    await expect(f.find()).rejects.toThrow('does not match');
  });
});

const assets: PublicationAsset[] = [{ name: 'server.tgz', size: 10, sha256: 'server-hash' }, { name: 'manifest.json', size: 2, sha256: 'manifest-hash' }];
function fixture() {
  const state: { tag?: string; draft?: DraftState; failUpload?: string; failPublish?: boolean; hashes: Record<string, string>; actions: string[] } = { hashes: {}, actions: [] };
  const port: PublicationPort = {
    async tagCommit() { return state.tag; },
    async release() { return state.draft ? structuredClone(state.draft) : undefined; },
    async ensureTag() { if (!state.tag) { state.tag = 'commit'; state.actions.push('tag'); } },
    async createDraft() { state.draft = { id: 1, draft: true, assets: [] }; state.actions.push('draft'); },
    async hashAsset(asset) { return state.hashes[asset.name] ?? ''; },
    async removeStarter(asset) { state.draft!.assets = state.draft!.assets.filter(item => item.id !== asset.id); state.actions.push('remove starter'); },
    async upload(asset) {
      if (state.failUpload === asset.name) throw new Error('network interrupted');
      state.draft!.assets.push({ id: state.draft!.assets.length + 1, name: asset.name, size: asset.size, state: 'uploaded' });
      state.hashes[asset.name] = asset.sha256; state.actions.push('upload ' + asset.name);
    },
    async publish() { if (state.failPublish) throw new Error('publish interrupted'); state.draft!.draft = false; state.actions.push('publish'); },
  };
  return { state, port, run: () => resumePublication('commit', assets, port) };
}
describe('verified publication recovery', () => {
  it('completes draft creation when by-tag stays 404 but listing sees the new draft', async () => {
    const f = fixture();
    f.port.release = async () => {
      const release = await discoveryFixture([f.state.draft ? [{ ...draftRelease, id: f.state.draft.id, draft: f.state.draft.draft }] : []]).find();
      return release ? { ...release, assets: structuredClone(f.state.draft!.assets) } : undefined;
    };
    await f.run();
    expect(f.state.actions).toEqual(['tag', 'draft', 'upload server.tgz', 'upload manifest.json', 'publish']);
  });
  it.each(['duplicates', 'published', 'wrong commit'])('refuses a listed %s release without mutations', async scenario => {
    const f = fixture(); f.state.tag = scenario === 'wrong commit' ? 'other' : 'commit';
    const releases = scenario === 'duplicates' ? [draftRelease, { ...draftRelease, id: 2 }]
      : [{ ...draftRelease, draft: scenario !== 'published' }];
    f.port.release = async () => {
      const release = await discoveryFixture([releases]).find();
      return release ? { ...release, assets: [] } : undefined;
    };
    await expect(f.run()).rejects.toThrow(scenario === 'duplicates' ? 'Multiple releases' : scenario === 'published' ? 'already published' : 'different commit');
    expect(f.state.actions).toEqual([]);
  });
  it('publishes a fresh verified batch', async () => {
    const f = fixture(); await f.run();
    expect(f.state.actions).toEqual(['tag', 'draft', 'upload server.tgz', 'upload manifest.json', 'publish']);
  });
  it('resumes after the tag was pushed but no draft was created', async () => {
    const f = fixture(); f.state.tag = 'commit'; await f.run();
    expect(f.state.actions[0]).toBe('draft');
  });
  it('resumes a partial upload without uploading completed bytes again', async () => {
    const f = fixture(); f.state.failUpload = 'manifest.json';
    await expect(f.run()).rejects.toThrow('network interrupted');
    delete f.state.failUpload; await f.run();
    expect(f.state.actions.filter(action => action === 'upload server.tgz')).toHaveLength(1);
    expect(f.state.draft?.draft).toBe(false);
  });
  it('resumes after all uploads when final publication failed', async () => {
    const f = fixture(); f.state.failPublish = true; await expect(f.run()).rejects.toThrow('publish interrupted');
    f.state.failPublish = false; await f.run();
    expect(f.state.actions.filter(action => action.startsWith('upload'))).toHaveLength(2);
  });
  it('refuses already published releases without mutations', async () => {
    const f = fixture(); await f.run(); f.state.actions = [];
    await expect(f.run()).rejects.toThrow('already published'); expect(f.state.actions).toEqual([]);
  });
  it('refuses a tag for another commit', async () => {
    const f = fixture(); f.state.tag = 'other';
    await expect(f.run()).rejects.toThrow('different commit'); expect(f.state.actions).toEqual([]);
  });
  it('refuses conflicting bytes and unexpected assets without deleting them', async () => {
    const f = fixture(); f.state.failPublish = true; await expect(f.run()).rejects.toThrow();
    f.state.hashes['server.tgz'] = 'different'; f.state.actions = [];
    await expect(f.run()).rejects.toThrow('differs'); expect(f.state.actions).toEqual([]);
    f.state.hashes['server.tgz'] = 'server-hash'; f.state.draft!.assets[0]!.name = 'unexpected';
    await expect(f.run()).rejects.toThrow('Unexpected'); expect(f.state.actions).toEqual([]);
  });
  it('replaces only an empty starter left by a failed upload', async () => {
    const f = fixture(); f.state.tag = 'commit';
    f.state.draft = { id: 1, draft: true, assets: [{ id: 99, name: 'server.tgz', size: 0, state: 'starter' }] };
    await f.run(); expect(f.state.actions).toContain('remove starter');
  });
  it('refuses a draft without a matching tag', async () => {
    const f = fixture(); f.state.draft = { id: 1, draft: true, assets: [] };
    await expect(f.run()).rejects.toThrow('no matching remote tag'); expect(f.state.actions).toEqual([]);
  });
});
