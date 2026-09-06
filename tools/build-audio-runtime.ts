import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AUDIO_CONFIGURE, AUDIO_SOURCE, probeAudioBinary } from './audio-runtime.ts';
import { fileHash } from './server-runtime.ts';

const root = resolve(import.meta.dirname, '..');
const cache = process.env['POP_AGENT_BUILD_CACHE'] ?? join(homedir(), '.cache/pop-agent/audio');
mkdirSync(cache, { recursive: true, mode: 0o700 });
const archive = join(cache, AUDIO_SOURCE.file);
if (!existsSync(archive) || statSync(archive).size !== AUDIO_SOURCE.size || await fileHash(archive) !== AUDIO_SOURCE.sha256) {
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-filesize', String(AUDIO_SOURCE.size), '--output', archive, AUDIO_SOURCE.url], { stdio: 'inherit' });
}
if (statSync(archive).size !== AUDIO_SOURCE.size || await fileHash(archive) !== AUDIO_SOURCE.sha256) throw new Error('FFmpeg source integrity failed');
const staging = mkdtempSync(join(cache, '.build-'));
try {
  execFileSync('tar', ['--no-same-owner', '-xJf', archive, '-C', staging]);
  const source = join(staging, `ffmpeg-${AUDIO_SOURCE.version}`);
  execFileSync('./configure', AUDIO_CONFIGURE, { cwd: source, stdio: 'inherit' });
  execFileSync('make', [`-j${Math.min(4, availableParallelism())}`, 'ffmpeg'], { cwd: source, stdio: 'inherit' });
  probeAudioBinary(join(source, 'ffmpeg'));
  const destination = join(root, 'server/dist/audio');
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(source, 'ffmpeg'), join(destination, 'ffmpeg'));
  copyFileSync(join(source, 'COPYING.LGPLv2.1'), join(destination, 'COPYING.LGPLv2.1'));
  writeFileSync(join(destination, 'build.json'), JSON.stringify({ ...AUDIO_SOURCE, configure: AUDIO_CONFIGURE, platform: process.platform, architecture: process.arch }, null, 2));
  writeFileSync(join(destination, 'NOTICE'), `FFmpeg ${AUDIO_SOURCE.version}, LGPL 2.1 or later.\nAudio-only build, no GPL/nonfree components enabled.\nCorresponding source: ${AUDIO_SOURCE.url}\nThe source archive is also distributed with this Pop Agent release.\nBuild configuration: build.json and tools/build-audio-runtime.ts in the source checkout.\n`);
  const releaseDirectory = process.argv[2];
  if (releaseDirectory !== undefined) {
    mkdirSync(releaseDirectory, { recursive: true });
    copyFileSync(archive, join(releaseDirectory, AUDIO_SOURCE.file));
  }
  console.log(`Built minimal FFmpeg: ${statSync(join(destination, 'ffmpeg')).size} bytes`);
  if (!readFileSync(join(destination, 'COPYING.LGPLv2.1'), 'utf8').includes('GNU LESSER GENERAL PUBLIC LICENSE')) throw new Error('Missing FFmpeg license');
} finally { rmSync(staging, { recursive: true, force: true }); }
