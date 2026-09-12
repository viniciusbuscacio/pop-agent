import { describe, expect, it } from 'vitest';
import { resumePublication, type DraftState, type PublicationAsset, type PublicationPort } from './release-publication.ts';
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
