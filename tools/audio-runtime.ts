import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const AUDIO_SOURCE = {
  version: '9.0.1', file: 'ffmpeg-9.0.1.tar.xz', size: 12036420,
  sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
  url: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
};
export const AUDIO_CONFIGURE = [
  '--disable-everything', '--disable-autodetect', '--disable-network', '--disable-doc',
  '--disable-debug', '--disable-ffplay', '--disable-ffprobe', '--disable-avdevice',
  '--disable-swscale', '--disable-x86asm', '--enable-small', '--enable-ffmpeg',
  '--enable-protocol=file', '--enable-demuxer=matroska,mov,ogg,wav,mp3,flac,aac',
  '--enable-decoder=aac,aac_fixed,mp3,mp3float,opus,vorbis,flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,pcm_u8,pcm_alaw,pcm_mulaw,adpcm_ima_wav,adpcm_ms',
  '--enable-parser=aac,aac_latm,mpegaudio,opus,vorbis,flac', '--enable-encoder=pcm_s16le',
  '--enable-muxer=wav', '--enable-filter=abuffer,abuffersink,anull,aformat,aresample',
];

export function assertPcmWav(path: string): void {
  const wav = readFileSync(path);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Audio conversion did not produce WAV');
  let format = false;
  let data = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (offset + 8 + size > wav.length) throw new Error('Truncated WAV');
    if (name === 'fmt ') format = size >= 16 && wav.readUInt16LE(offset + 8) === 1
      && wav.readUInt16LE(offset + 10) === 1 && wav.readUInt32LE(offset + 12) === 16000 && wav.readUInt16LE(offset + 22) === 16;
    if (name === 'data') data = size > 0;
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error('Expected nonempty mono PCM16 WAV at 16 kHz');
}

export function probeAudioBinary(binary: string): void {
  const temporary = mkdtempSync(join(tmpdir(), 'pop-audio-probe-'));
  try {
    const input = join(temporary, 'input.wav');
    const output = join(temporary, 'output.wav');
    const wav = Buffer.alloc(44 + 1600);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(1600, 40);
    writeFileSync(input, wav);
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], { timeout: 15_000, stdio: 'pipe' });
    assertPcmWav(output);
    const dependencies = execFileSync('ldd', [binary], { encoding: 'utf8' });
    if (/not found|libX|libxcb|libSDL|libwayland|libavdevice|libcuda|libvulkan/i.test(dependencies)) throw new Error('Unexpected audio runtime dependencies');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
