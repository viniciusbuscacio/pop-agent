/** Per-message client-reported origin; never infer it from earlier turns. */

const NAMES: Record<string, string> = {
  desktop: 'Pop Agent Desktop',
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

/** Keep each turn self-contained, including missing metadata. Never include IPs. */
export function channelNote(
  current: { kind: string; platform?: string } | undefined,
  _previousKind?: string,
): string {
  if (current === undefined) {
    return '[Pop Agent: this message arrived through an unidentified client; device and platform are unknown. Do not infer them from earlier messages.]';
  }
  return `[Pop Agent: this message arrived through ${describe(current.kind, current.platform)}. Client-reported origin for this message only; do not infer other messages or the local-tool destination from it.]`;
}

/** Exclude Pop's transport metadata from per-message skill relevance. */
export function withoutChannelNote(prompt: string): string {
  return withoutMessageTime(prompt).replace(/^\[Pop Agent: this message arrived through [^\r\n]*\.\]\r?\n\r?\n/u, '').replace(/^\[Pop attachment archive: [^\r\n]*\]\n\n/u, '');
}


/** Validate device-supplied formatting metadata before it reaches a prompt. */
export function validTimeZone(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 80) return undefined;
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return undefined; }
}

const MESSAGE_TIME = /^\[Pop message time: (\{[^\r\n]*\})\]\n\n/u;

/** Persist this framing in the run journal/pi transcript, never in message text. */
export function withMessageTime(prompt: string, receivedAt: string, timeZone?: string): string {
  const zone = validTimeZone(timeZone);
  return `[Pop message time: ${JSON.stringify({ receivedAt, ...(zone === undefined ? {} : { timeZone: zone }) })}]\n\n${prompt}`;
}

export function withoutMessageTime(prompt: string): string { return prompt.replace(MESSAGE_TIME, ''); }

/** Recomputed at each actual prompt/steering preparation, not session creation. */
export function currentTimeNote(prompt: string, now: number): string {
  const match = MESSAGE_TIME.exec(prompt);
  let receivedAt: string | undefined;
  let zone: string | undefined;
  if (match?.[1] !== undefined) {
    try {
      const value = JSON.parse(match[1]) as { receivedAt?: string; timeZone?: string };
      if (typeof value.receivedAt === 'string' && Number.isFinite(Date.parse(value.receivedAt))) receivedAt = new Date(value.receivedAt).toISOString();
      if (typeof value.timeZone === 'string') zone = validTimeZone(value.timeZone);
    } catch { /* Old or malformed framing must not prevent a response. */ }
  }
  const date = new Date(now);
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone ?? 'UTC', dateStyle: 'full', timeStyle: 'long', hourCycle: 'h23',
  }).format(date);
  return `[Pop current time: ${date.toISOString()}; local: ${local}; time zone: ${zone ?? 'UTC (device time zone unavailable)'}.${receivedAt === undefined ? '' : ` Original message received at: ${receivedAt}.`} This clock is current for this turn; older timestamped turns are historical. Interpret relative dates using the message time and its stated zone; ask if a delayed message makes the intended date ambiguous.]`;
}
