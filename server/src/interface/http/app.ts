import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { StreamEvent } from '@popy/shared';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  // Skeleton hello-world: streams a fake run over the real SSE channel so
  // the transport can be exercised end to end (curl, tests, smoke) before
  // the pi bridge lands. Replaced by real run events in the next step.
  app.get('/v1/events', (c) =>
    streamSSE(c, async (stream) => {
      const chatId = 'chat-000000000000';
      const runId = 'run-hello';
      const words = ['Hello', 'from', 'Popy.', 'Streaming', 'works.'];
      for (const [i, word] of words.entries()) {
        const event: StreamEvent = {
          kind: 'delta',
          chatId,
          runId,
          text: i === 0 ? word : ` ${word}`,
        };
        await stream.writeSSE({ data: JSON.stringify(event) });
        await stream.sleep(150);
      }
      const done: StreamEvent = {
        kind: 'done',
        chatId,
        runId,
        messageId: 'msg-0000000000000000',
      };
      await stream.writeSSE({ data: JSON.stringify(done) });
    }),
  );

  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: 'Route not found', status: 404 } },
      404,
    ),
  );

  return app;
}
