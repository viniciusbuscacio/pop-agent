import type {
  BashOperations,
  EditOperations,
  ReadOperations,
  WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type { HandsRegistry } from '../../application/hands/hands-registry.js';

/**
 * pi's tools, pointed at the terminal instead of this disk (docs/cli.md,
 * step 3).
 *
 * pi separates *what a tool is* from *what touches the disk*, and says so in
 * as many words: "override these to delegate command execution to remote
 * systems". So nothing here re-implements a tool. The schemas, the output
 * truncation, the file size caps and the error shapes stay pi's, and stay
 * identical on both machines -- which is the point of registering the same
 * definitions twice rather than writing a second family of tools that would
 * drift on the next pi release.
 *
 * Everything is per chat, because the hands are: two conversations can be
 * attached to two different machines at the same time.
 *
 * Infrastructure, not application: it speaks pi's types, and the boundary
 * test is right to keep a third-party import out of the pure layer.
 */
export function remoteOperations(hands: HandsRegistry, chatId: string) {
  const call = (tool: string, input: unknown, onOutput: (chunk: string) => void = () => undefined) =>
    hands.call(chatId, { tool, input }, onOutput);

  const bash: BashOperations = {
    exec: async (command, cwd, options) => {
      // Output is streamed as it arrives, not handed over at the end: a build
      // that takes minutes should show its progress, and pi's own tool renders
      // exactly that.
      const result = await call('bash', { command, cwd, timeout: options.timeout }, (chunk) => {
        options.onData(Buffer.from(chunk, 'utf8'));
      });
      if (!result.ok && result.error !== undefined) throw new Error(result.error);
      return { exitCode: result.exitCode ?? 0 };
    },
  };

  const read: ReadOperations = {
    readFile: async (absolutePath) => {
      const result = await call('read', { path: absolutePath });
      if (!result.ok) throw new Error(result.error ?? `Could not read ${absolutePath}`);
      // base64 on the wire: a file is bytes, and JSON is text.
      return Buffer.from(result.output, 'base64');
    },
    access: async (absolutePath) => {
      const result = await call('access', { path: absolutePath });
      if (!result.ok) throw new Error(result.error ?? `Cannot read ${absolutePath}`);
    },
  };

  const write: WriteOperations = {
    writeFile: async (absolutePath, contents) => {
      const result = await call('write', { path: absolutePath, contents });
      if (!result.ok) throw new Error(result.error ?? `Could not write ${absolutePath}`);
    },
    mkdir: async (absolutePath) => {
      const result = await call('mkdir', { path: absolutePath });
      if (!result.ok) throw new Error(result.error ?? `Could not create ${absolutePath}`);
    },
  };

  const edit: EditOperations = {
    readFile: read.readFile,
    writeFile: write.writeFile,
    access: read.access,
  };

  return { bash, read, write, edit };
}
