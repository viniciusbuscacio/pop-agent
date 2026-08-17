const DEFAULT_MAX_EVENTS = 4_096;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

interface PendingPayload {
  payload: string;
  bytes: number;
}

/** Bounded per-connection SSE backlog; false means the caller must disconnect. */
export class SsePendingBuffer {
  private readonly entries: PendingPayload[] = [];
  private bytes = 0;

  constructor(
    private readonly maxEvents = DEFAULT_MAX_EVENTS,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {}

  push(payload: string): boolean {
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (this.entries.length >= this.maxEvents || this.bytes + bytes > this.maxBytes) return false;
    this.entries.push({ payload, bytes });
    this.bytes += bytes;
    return true;
  }

  shift(): string | undefined {
    const entry = this.entries.shift();
    if (entry === undefined) return undefined;
    this.bytes -= entry.bytes;
    return entry.payload;
  }

  get length(): number {
    return this.entries.length;
  }
}
