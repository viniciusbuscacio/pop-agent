import { execFile } from 'node:child_process';

/**
 * Versions of the tools the server leans on for voice and document
 * extraction (docs/specs/Spec-Pop-General.md §14/§15) -- the Environment card of Settings →
 * Updates. Visibility only: these are apt/system packages, and updating
 * them stays a deliberate shell act, never something the process does.
 * Best-effort by contract: a missing binary reports as such.
 */

const TIMEOUT_MS = 4000;

interface Probe {
  name: string;
  cmd: string;
  args: string[];
}

export async function readEnvironmentVersions(): Promise<{ name: string; version: string }[]> {
  const whisperCli = process.env['POP_AGENT_WHISPER_CLI'] ?? 'whisper-cli';
  const probes: Probe[] = [
    { name: 'ffmpeg', cmd: 'ffmpeg', args: ['-version'] },
    { name: 'poppler (pdftotext)', cmd: 'pdftotext', args: ['-v'] },
    { name: 'tesseract', cmd: 'tesseract', args: ['--version'] },
    // whisper-cli has no version flag; reaching its usage text proves it runs.
    { name: 'whisper.cpp', cmd: whisperCli, args: ['--help'] },
  ];
  return Promise.all(
    probes.map(async (probe) => ({ name: probe.name, version: await version(probe) })),
  );
}

async function version(probe: Probe): Promise<string> {
  const output = await run(probe.cmd, probe.args);
  if (output === undefined) return 'not found';
  if (probe.cmd.endsWith('whisper-cli')) return 'installed';
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(output);
  return match?.[1] ?? 'installed';
}

function run(cmd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      // Some of these print the version and exit non-zero (pdftotext -v).
      const text = `${stdout}\n${stderr}`.trim();
      if (error !== null && text.length === 0) resolve(undefined);
      else resolve(text);
    });
  });
}
