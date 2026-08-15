/**
 * Telling the agent where a message came from, and only when it is news
 * (pop-agent.spec §13).
 *
 * The naive version puts "this arrived through the CLI" on every turn. In a
 * fifty-turn conversation that is fifty copies of a fact that mattered once,
 * paid for on every request forever. What is worth saying is the CHANGE --
 * "we were on the phone, now you are at a terminal" -- because that is what
 * she cannot work out for herself and what actually changes an answer: there
 * are no buttons to press in a terminal, and no `apt install` on an iPhone.
 *
 * The first message of a conversation is news too: it establishes where this
 * one is happening, and there is nothing before it to compare against.
 */

const NAMES: Record<string, string> = {
  cli: 'the terminal (Pop Agent CLI)',
  web: 'the web app in a browser',
  pwa: 'the installed app',
  api: 'a script calling the API directly',
  task: 'a scheduled task, with nobody watching',
};

function describe(kind: string, platform: string | undefined): string {
  const name = NAMES[kind] ?? kind;
  return platform === undefined || platform.length === 0 ? name : `${name} on ${platform}`;
}

/**
 * The line to prepend to this turn's prompt, or undefined when there is
 * nothing new to say. Never includes the IP: that answers "who connected",
 * which is an audit question, and no answer of hers would change for it.
 */
export function channelNote(
  current: { kind: string; platform?: string } | undefined,
  previousKind: string | undefined,
): string | undefined {
  if (current === undefined) return undefined;
  if (previousKind === current.kind) return undefined;

  const now = describe(current.kind, current.platform);
  if (previousKind === undefined) {
    return `[Pop Agent: this message arrived through ${now}.]`;
  }
  return `[Pop Agent: this message arrived through ${now}; the earlier ones came through ${
    NAMES[previousKind] ?? previousKind
  }.]`;
}
