import type { StreamEvent } from '@pop-agent/shared';

/**
 * Reading `text/event-stream` off a `fetch` body (docs/cli.md, step 2).
 *
 * Node has no `EventSource`, and the browser one could not carry a bearer
 * token anyway -- which is why the server issues a one-time ticket. So the
 * parsing is here, and it is small: SSE frames are separated by a blank line
 * and Pop Agent only ever sends `data:`.
 *
 * The buffer is split on the frame boundary rather than on newlines, because
 * a chunk arrives where TCP decides, not where a message ends: a `delta`
 * carrying a paragraph can be delivered in three pieces, and treating each
 * piece as a frame would produce three broken JSON parses.
 */
export async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  const body = response.body;
  if (body === null) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event !== undefined) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // Releasing matters on the one-shot path: the process should exit when the
    // answer is done, not linger holding a socket the server is still writing.
    reader.cancel().catch(() => undefined);
  }
}

function parseFrame(frame: string): StreamEvent | undefined {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data.length === 0) return undefined;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    // A heartbeat comment or a frame from a newer server: skipping one event
    // is always better than killing the stream over it.
    return undefined;
  }
}
