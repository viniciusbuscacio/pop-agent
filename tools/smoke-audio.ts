import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertPcmWav, probeAudioBinary } from './audio-runtime.ts';
import { fileHash } from './server-runtime.ts';

const root = resolve(import.meta.dirname, '..');
const cache = process.env['POP_AGENT_BUILD_CACHE'] ?? join(homedir(), '.cache/pop-agent/audio');
mkdirSync(cache, { recursive: true });
function download(name: string, url: string, algorithm: string, digest: string): string {
  const path = join(cache, name);
  const verified = () => existsSync(path) && createHash(algorithm).update(readFileSync(path)).digest('hex') === digest;
  if (!verified()) execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--output', path, url]);
  if (!verified()) throw new Error(`Audio fixture checksum failed: ${name}`);
  return path;
}
const sample = download('jfk.wav', 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/b4938/samples/jfk.wav', 'sha256', '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e');
const model = download('ggml-tiny.bin', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin', 'sha1', 'bd577a113a864445d4c299885e0cb97d4ba92b5f');
const binary = join(root, 'server/dist/audio/ffmpeg');
probeAudioBinary(binary);
const { WhisperTranscriber } = await import(pathToFileURL(join(root, 'server/dist/infrastructure/voice/whisper-transcriber.js')).href);
const transcriber = new WhisperTranscriber({ ffmpeg: binary,
  whisperCli: process.env['POP_AGENT_WHISPER_CLI'] ?? join(homedir(), '.local/share/pop-agent/server-toolchain/current/whisper/whisper-cli'),
  resolveModel: async () => model });
const temporary = mkdtempSync(join(tmpdir(), 'pop-voice-release-'));
try {
  // Encode real speech using the full builder-only FFmpeg; decode/transcribe using only the shipped binary.
  for (const [format, codec, extra] of [
    ['webm', 'libopus', []], ['mp4', 'aac', ['-movflags', 'frag_keyframe+empty_moov']],
    ['m4a', 'aac', []], ['wav', 'pcm_f32le', []], ['mp3', 'libmp3lame', []],
    ['ogg', 'libvorbis', []], ['flac', 'flac', []], ['aac', 'aac', []],
  ] as const) {
    const input = join(temporary, `speech.${format}`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sample, '-ac', '2', '-c:a', codec, ...extra, input], { timeout: 30_000 });
    const output = join(temporary, 'converted.wav');
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], { timeout: 30_000 });
    assertPcmWav(output);
    const transcript: string = await transcriber.transcribe({ format, audioBase64: readFileSync(input).toString('base64') });
    if (!/country/i.test(transcript) || !/you/i.test(transcript)) throw new Error(`Unexpected speech result for ${format}: ${transcript}`);
    console.log(`Audio ${format}: conversion and real Whisper transcription passed`);
  }
  writeFileSync(join(root, 'server/dist/audio/smoke.json'), JSON.stringify({ sha256: await fileHash(binary), architecture: process.arch, formats: ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'ogg', 'flac', 'aac'], whisper: 'b4938', model: 'tiny', passed: true }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
