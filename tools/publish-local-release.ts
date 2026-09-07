import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
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
for (const category of ['launcher', 'local-access']) {
  const packed = JSON.parse(execFileSync('tar', ['-xOf', join(output, manifest.file), `cli/pack/${category}/manifest.json`], { encoding: 'utf8' })) as { artifacts: Record<string, {file: string; size: number; sha256: string}> };
  for (const asset of Object.values(packed.artifacts)) { await verify(asset.file, asset.size, asset.sha256); files.add(asset.file); }
}
console.log(`Verified ${files.size} release assets for ${version} at ${commit.slice(0, 12)}.`);
if (mode === '--publish') {
  const repository = 'viniciusbuscacio/pop-agent';
  const tag = `v${version}`;
  mkdirSync(homedir(), { recursive: true, mode: 0o700 });
  const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const release = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, { headers });
  if (release.status !== 404) throw new Error(release.ok ? 'This version already has a release; never replace its bytes.' : `GitHub preflight failed: HTTP ${release.status}`);
  const tagRef = await fetch(`https://api.github.com/repos/${repository}/git/ref/tags/${tag}`, { headers });
  if (tagRef.status !== 404) throw new Error(tagRef.ok ? 'This tag already exists; never replace it.' : `GitHub tag preflight failed: HTTP ${tagRef.status}`);
  const repo = await fetch(`https://api.github.com/repos/${repository}`, { headers });
  if (!repo.ok) throw new Error(`GitHub repository access failed: HTTP ${repo.status}`);
  // Publication is an explicit batch operation. Never force-push or replace a tag.
  execFileSync('gh', ['auth', 'setup-git', '--hostname', 'github.com'], { stdio: 'inherit' });
  const authorName = git(root, ['show', '-s', '--format=%cn', commit]);
  const authorEmail = git(root, ['show', '-s', '--format=%ce', commit]);
  execFileSync('git', ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'tag', '-a', tag, commit, '-m', `Pop Agent ${version}`], { cwd: root, stdio: 'inherit' });
  execFileSync('git', ['push', '--atomic', `https://github.com/${repository}.git`, `${commit}:refs/heads/main`, `refs/tags/${tag}`], { cwd: root, stdio: 'inherit' });
  const changes = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(`## ${version} —`)[1]?.split('\n').slice(1).join('\n').split('\n## ')[0]?.trim();
  if (!changes) throw new Error('Missing release changelog');
  const notes = changes + '\n\n' + 'Built and validated on the owner-managed Ubuntu 24.04 AMD64 builder. The exact committed tree passed the full gate and the production installation probe. Minimal audio-only FFmpeg and Whisper are included; corresponding FFmpeg source is attached.';
  execFileSync('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', `Pop Agent ${version}`, '--notes', notes], { stdio: 'inherit' });
  execFileSync('gh', ['release', 'upload', tag, '--repo', repository, ...[...files].map(name => join(output, name))], { stdio: 'inherit' });
  execFileSync('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'], { stdio: 'inherit' });
  console.log(`Published ${tag}. If upload fails, the draft remains unpublished for inspection; do not overwrite an existing published release.`);
}
