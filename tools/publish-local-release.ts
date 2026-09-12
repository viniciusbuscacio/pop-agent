import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { validateClientLock } from './client-release.ts';
import { resumePublication, type DraftState, type RemoteAsset } from './release-publication.ts';
import { AUDIO_SOURCE } from './audio-runtime.ts';
import { fileHash, git, glibcVersion, validateManifest } from './server-runtime.ts';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? '');
const mode = process.argv[3];
if (!process.argv[2] || !['--check', '--publish'].includes(mode ?? '')) throw new Error('Usage: publish-local-release.ts OUTPUT --check|--publish');
const commit = git(root, ['rev-parse', 'HEAD']);
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const proof = JSON.parse(readFileSync(join(output, 'verified.json'), 'utf8')) as { commit?: string; verifiedAt?: string };
if (proof.commit !== commit || !Number.isFinite(Date.parse(proof.verifiedAt ?? ''))) throw new Error('Missing production installation verification for this commit');
if (process.env['EXPECTED_COMMIT'] && process.env['EXPECTED_COMMIT'] !== commit) throw new Error('Selected batch changed');
if (git(root, ['status', '--porcelain']) !== '') throw new Error('Publish only a clean committed batch');
const manifestName = `pop-agent-${version}-linux-amd64.json`;
const manifest = validateManifest(JSON.parse(readFileSync(join(output, manifestName), 'utf8')), {
  version, commit, tree: git(root, ['rev-parse', 'HEAD^{tree}']), node: process.version,
  architecture: 'amd64', glibc: glibcVersion(),
});
const files = new Set([manifestName, manifest.file, AUDIO_SOURCE.file]);
async function verify(name: string, size: number, sha256: string): Promise<void> {
  if (basename(name) !== name || !/^[\w.-]+$/.test(name)) throw new Error('Unsafe release asset name');
  const path = join(output, name);
  if (!statSync(path).isFile() || statSync(path).size !== size || await fileHash(path) !== sha256) throw new Error(`Release asset integrity failed: ${name}`);
}
await verify(manifest.file, manifest.size, manifest.sha256);
await verify(AUDIO_SOURCE.file, AUDIO_SOURCE.size, AUDIO_SOURCE.sha256);
const members = execFileSync('tar', ['-tf', join(output, manifest.file), 'cli/pack'], { encoding: 'utf8' }).split('\n');
const inherited = members.includes('cli/pack/client-release.json')
  ? validateClientLock(JSON.parse(execFileSync('tar', ['-xOf', join(output, manifest.file), 'cli/pack/client-release.json'], { encoding: 'utf8' }))) : undefined;
if (inherited?.source.version === version) {
  const snapshot = inherited.source.archive;
  await verify(snapshot.file, snapshot.size, snapshot.sha256);
  files.add(snapshot.file);
}
if (inherited) {
  for (const [name, entry] of Object.entries(inherited.files)) {
    const bytes = execFileSync('tar', ['-xOf', join(output, manifest.file), `cli/pack/${name}`], { maxBuffer: 64 * 1024 * 1024 });
    if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Inherited client mismatch: ${name}`);
  }
}
for (const category of ['launcher', 'local-access']) {
  const packed = JSON.parse(execFileSync('tar', ['-xOf', join(output, manifest.file), `cli/pack/${category}/manifest.json`], { encoding: 'utf8' })) as { artifacts: Record<string, {file: string; size: number; sha256: string}> };
  for (const asset of Object.values(packed.artifacts)) {
    const source = inherited?.sources?.[`${category}/${asset.file}`];
    if (inherited && source?.version !== version) continue;
    await verify(asset.file, asset.size, asset.sha256); files.add(asset.file);
  }
}
console.log(`Verified ${files.size} release assets for ${version} at ${commit.slice(0, 12)}.`);
if (mode === '--publish') {
  const repository = 'viniciusbuscacio/pop-agent';
  const tag = `v${version}`;
  mkdirSync(homedir(), { recursive: true, mode: 0o700 });
  const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async <T>(path: string): Promise<T | undefined> => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
    return await response.json() as T;
  };
  type GitObject = { type: string; sha: string };
  const tagCommit = async (): Promise<string | undefined> => {
    let object = (await api<{ object: GitObject }>(`git/ref/tags/${tag}`))?.object;
    for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
      object = (await api<{ object: GitObject }>(`git/tags/${object.sha}`))?.object;
      if (!object) throw new Error('Cannot resolve release tag');
    }
    if (object && object.type !== 'commit') throw new Error('Release tag does not resolve to a commit');
    return object?.sha;
  };
  const releaseState = async (): Promise<DraftState | undefined> => {
    const release = await api<{ id: number; draft: boolean }>(`releases/tags/${tag}`);
    if (!release) return undefined;
    const assets: RemoteAsset[] = [];
    for (let page = 1; ; page++) {
      const batch = await api<RemoteAsset[]>(`releases/${release.id}/assets?per_page=100&page=${page}`);
      if (!batch) throw new Error('Draft disappeared');
      assets.push(...batch);
      if (batch.length < 100) break;
    }
    return { ...release, assets };
  };
  // Validate notes before creating a tag, so a metadata error cannot strand a release.
  const changes = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(`## ${version} —`)[1]?.split('\n').slice(1).join('\n').split('\n## ')[0]?.trim();
  if (!changes) throw new Error('Missing release changelog');
  const notes = changes + '\n\nBuilt and validated on the owner-managed Ubuntu 24.04 AMD64 builder. The exact committed tree passed the full gate and the production installation probe. Minimal audio-only FFmpeg and Whisper are included; corresponding FFmpeg source is attached.';
  const assets = await Promise.all([...files].map(async name => ({ name, size: statSync(join(output, name)).size, sha256: await fileHash(join(output, name)) })));
  const temporary = mkdtempSync(join(tmpdir(), 'pop-publish-'));
  try {
    const notesFile = join(temporary, 'release-notes.md');
    writeFileSync(notesFile, notes);
    await resumePublication(commit, assets, {
      tagCommit,
      release: releaseState,
      async ensureTag() {
        const remote = await tagCommit();
        if (remote !== undefined) {
          if (remote !== commit) throw new Error('Remote tag changed');
          return;
        }
        const local = git(root, ['tag', '--list', tag]);
        if (local) {
          if (git(root, ['rev-parse', `${tag}^{commit}`]) !== commit) throw new Error('Local tag points to a different commit');
        } else {
          const name = git(root, ['show', '-s', '--format=%cn', commit]);
          const email = git(root, ['show', '-s', '--format=%ce', commit]);
          execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'tag', '-a', tag, commit, '-m', `Pop Agent ${version}`], { cwd: root, stdio: 'inherit' });
        }
        execFileSync('gh', ['auth', 'setup-git', '--hostname', 'github.com'], { stdio: 'inherit' });
        execFileSync('git', ['push', '--atomic', `https://github.com/${repository}.git`, `${commit}:refs/heads/main`, `refs/tags/${tag}`], { cwd: root, stdio: 'inherit' });
      },
      async createDraft() {
        execFileSync('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', `Pop Agent ${version}`, '--notes-file', notesFile], { stdio: 'inherit' });
      },
      async hashAsset(asset) {
        const destination = join(temporary, String(asset.id));
        try {
          execFileSync('gh', ['release', 'download', tag, '--repo', repository, '--pattern', asset.name, '--output', destination], { stdio: 'inherit' });
          return await fileHash(destination);
        } finally { rmSync(destination, { force: true }); }
      },
      async removeStarter(asset) {
        execFileSync('gh', ['api', '--method', 'DELETE', `repos/${repository}/releases/assets/${asset.id}`], { stdio: 'inherit' });
      },
      async upload(asset) {
        execFileSync('gh', ['release', 'upload', tag, '--repo', repository, join(output, asset.name)], { stdio: 'inherit' });
      },
      async publish() {
        execFileSync('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'], { stdio: 'inherit' });
      },
    });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  console.log(`Published ${tag}. Interrupted drafts can resume with the same verified batch; published releases remain immutable.`);
}
