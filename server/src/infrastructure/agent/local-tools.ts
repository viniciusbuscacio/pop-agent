import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { HandsRegistry } from '../../application/hands/hands-registry.js';
import { remoteOperations } from './remote-operations.js';

/**
 * The second pair of hands: pi's own tools, pointed at the attached terminal
 * (docs/cli.md, step 3).
 *
 * The SAME definitions the server set uses, built again with remote
 * operations. Nothing is re-implemented, so the schemas, the truncation
 * limits and the error shapes cannot drift between the two machines -- and a
 * pi release improves both at once.
 *
 * Only the name and the wording change. The server's set keeps `bash`,
 * `read`, `write`, `edit`, because it is the one that is always there: a
 * phone session has only that, and a tool must not mean a different machine
 * depending on whether a terminal happens to be open. The prefix is what
 * tells the model -- and the taint guard -- which machine a call is bound
 * for.
 */

type Sdk = typeof import('@earendil-works/pi-coding-agent');

export function buildLocalTools(
  sdk: Sdk,
  hands: HandsRegistry,
  connectionId: string | undefined,
): ToolDefinition[] {
  const connection = hands.connection(connectionId);
  // No terminal, no second pair: the tools are absent from the prompt rather
  // than present and failing, so she can say she has no access to that
  // machine instead of trying and apologising. Both cases land here -- a
  // message from the PWA, which named no terminal, and a terminal that has
  // since left.
  if (connection === undefined) return [];

  const { machine } = connection;
  const where = `${machine.hostname} (${machine.platform}/${machine.arch})`;
  const operations = remoteOperations(hands, connection.id);

  // Typed by what it actually touches, not by ToolDefinition: each of pi's
  // definitions is a narrower generic, and the contravariant `renderCall`
  // makes the wide one refuse them. Renaming needs three string fields.
  const rename = <T extends { name: string; label: string; description: string }>(
    definition: T,
    name: string,
    what: string,
  ): T => ({
    ...definition,
    name,
    label: `${definition.label} (${machine.hostname})`,
    // The description carries the whole weight of the choice: it is the only
    // thing telling the model which machine this touches. The launch directory
    // belongs here too: pi uses it for relative paths, but its stock tool text
    // only says "current working directory" without naming that directory.
    description: `${what} on ${where} -- the machine the user is typing on, NOT the Pop Agent server. Current working directory: ${machine.cwd}. Relative paths start there. Use this for files and commands that live there. The unprefixed tools stay on the server.`,
  });

  return [
    rename(
      sdk.createBashToolDefinition(machine.cwd, { operations: operations.bash }),
      'local_bash',
      'Run a shell command',
    ),
    rename(
      sdk.createReadToolDefinition(machine.cwd, { operations: operations.read }),
      'local_read',
      'Read a file',
    ),
    rename(
      sdk.createWriteToolDefinition(machine.cwd, { operations: operations.write }),
      'local_write',
      'Write a file',
    ),
    rename(
      sdk.createEditToolDefinition(machine.cwd, { operations: operations.edit }),
      'local_edit',
      'Edit a file',
    ),
  ] as ToolDefinition[];
}
