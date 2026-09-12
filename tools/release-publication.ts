export interface PublicationAsset { name: string; size: number; sha256: string }
export interface RemoteAsset { name: string; size: number; state: string; id: number }
export interface DraftState { id: number; draft: boolean; assets: RemoteAsset[] }
export interface PublicationPort {
  tagCommit(): Promise<string | undefined>;
  release(): Promise<DraftState | undefined>;
  ensureTag(): Promise<void>;
  createDraft(): Promise<void>;
  hashAsset(asset: RemoteAsset): Promise<string>;
  removeStarter(asset: RemoteAsset): Promise<void>;
  upload(asset: PublicationAsset): Promise<void>;
  publish(): Promise<void>;
}

/** Retry only this verified batch; never replace uploaded bytes or published releases. */
export async function resumePublication(commit: string, assets: PublicationAsset[], port: PublicationPort): Promise<void> {
  async function state(draftId?: number): Promise<DraftState | undefined> {
    const tag = await port.tagCommit();
    const release = await port.release();
    if (tag !== undefined && tag !== commit) throw new Error('Release tag points to a different commit');
    if (release && !release.draft) throw new Error('Release is already published; its bytes are immutable');
    if (draftId !== undefined && release?.id !== draftId) throw new Error('Draft identity changed');
    if (release && tag === undefined) throw new Error('Draft has no matching remote tag');
    return release;
  }
  let draft = await state();
  await port.ensureTag();
  if (!draft) { await port.createDraft(); draft = await state(); }
  if (!draft) throw new Error('Draft creation did not complete');
  const draftId = draft.id;
  const expected = new Map(assets.map(asset => [asset.name, asset]));
  if (expected.size !== assets.length) throw new Error('Duplicate expected asset');
  const present = new Set<string>();
  const starters: RemoteAsset[] = [];
  for (const remote of draft.assets) {
    const asset = expected.get(remote.name);
    if (!asset || present.has(remote.name)) throw new Error(`Unexpected or duplicate draft asset: ${remote.name}`);
    present.add(remote.name);
    if (remote.state === 'starter' && remote.size === 0) { starters.push(remote); continue; }
    if (remote.state !== 'uploaded' || remote.size !== asset.size || await port.hashAsset(remote) !== asset.sha256) {
      throw new Error(`Draft asset differs from verified batch: ${remote.name}`);
    }
  }
  // Check all existing bytes before modifying the draft. Only empty failed uploads are removable.
  for (const remote of starters) { await state(draftId); await port.removeStarter(remote); present.delete(remote.name); }
  for (const asset of assets) if (!present.has(asset.name)) { await state(draftId); await port.upload(asset); }
  const final = await state(draftId);
  if (!final || final.id !== draft.id || final.assets.length !== assets.length) throw new Error('Draft inventory changed');
  const checked = new Set<string>();
  for (const remote of final.assets) {
    const asset = expected.get(remote.name);
    if (!asset || checked.has(remote.name) || remote.state !== 'uploaded' || remote.size !== asset.size
      || await port.hashAsset(remote) !== asset.sha256) throw new Error('Final draft verification failed');
    checked.add(remote.name);
  }
  await port.publish();
}
