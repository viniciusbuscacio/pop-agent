import { Hono } from 'hono';
import { upgradeWebSocket } from '@hono/node-server';
import { entityId } from '../../domain/ids.js';
import type { HandsMachine, HandsRegistry } from '../../application/hands/hands-registry.js';

/**
 * The hands channel (docs/cli.md, step 3): a WebSocket, one per attached
 * terminal, carrying tool calls out and their results back.
 *
 * A channel of its own rather than teaching the event stream to address
 * someone. `SseHub` is a set of subscribers with no identity, on purpose --
 * every event goes to every connection, which is right for a word of an
 * answer. "Run this on your machine" has exactly one addressee, and a phone
 * with the PWA open would otherwise receive it.
 *
 * WebSocket rather than long-poll because ping/pong is a frame with a
 * deadline the server sets, and noticing a closed laptop lid is the whole
 * problem: the socket stays standing for minutes after the machine is gone.
 * The `confirm` round trip argues for long-poll and it is a fair argument,
 * but confirm waits seconds for a human and this waits hours for a machine
 * that may quietly vanish.
 *
 * Session-guarded like everything under `/v1`: the handshake is an ordinary
 * GET, so the bearer token is checked before any frame is exchanged.
 */

/** What a terminal sends to introduce itself. Anything else is refused. */
interface AttachFrame {
  kind: 'attach';
  machine: HandsMachine;
}

export interface HandsRoutesDeps {
  hands: HandsRegistry;
}

export function createHandsRoutes(deps: HandsRoutesDeps): Hono {
  const routes = new Hono();

  routes.get(
    '/hands',
    upgradeWebSocket(() => {
      // Per connection, and deliberately outside the handlers: `onOpen` has
      // no machine to report yet, so the registry only hears about this one
      // once its `attach` frame arrives.
      const id = entityId('hands');
      let attached = false;

      return {
        onMessage(event, ws) {
          const raw = typeof event.data === 'string' ? event.data : '';
          let frame: { kind?: string };
          try {
            frame = JSON.parse(raw) as { kind?: string };
          } catch {
            // A terminal that speaks nonsense is not a reason to drop the
            // socket; the next frame may be fine.
            return;
          }

          // Anything at all proves the machine is alive, not just a pong.
          deps.hands.heard(id);

          if (frame.kind === 'attach' && !attached) {
            const machine = (frame as AttachFrame).machine;
            if (machine === undefined || typeof machine.hostname !== 'string') return;
            attached = true;
            deps.hands.attach({
              id,
              machine,
              send: (payload) => ws.send(JSON.stringify(payload)),
              close: () => ws.close(),
            });
            ws.send(JSON.stringify({ kind: 'attached', id }));
            return;
          }

          // A command still running, streaming as it goes.
          if (frame.kind === 'output' && attached) {
            const { callId, chunk } = frame as { callId?: string; chunk?: string };
            if (typeof callId === 'string' && typeof chunk === 'string') {
              deps.hands.output(callId, chunk);
            }
            return;
          }

          if (frame.kind === 'result' && attached) {
            const result = frame as {
              callId?: string;
              ok?: boolean;
              output?: string;
              exitCode?: number | null;
              error?: string;
            };
            if (typeof result.callId !== 'string') return;
            deps.hands.settle(result.callId, {
              ok: result.ok === true,
              output: typeof result.output === 'string' ? result.output : '',
              ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
              ...(result.error === undefined ? {} : { error: result.error }),
            });
            return;
          }

          if (frame.kind === 'claim' && attached) {
            const chatId = (frame as { chatId?: string }).chatId;
            if (typeof chatId !== 'string' || chatId.length === 0) return;
            const owner = deps.hands.claim(chatId, id);
            // Told either way: a terminal that did not get the hands is a
            // spectator and should say so rather than look broken.
            ws.send(JSON.stringify({ kind: 'claimed', chatId, mine: owner === id }));
          }
        },

        onClose() {
          deps.hands.detach(id);
        },

        onError() {
          deps.hands.detach(id);
        },
      };
    }),
  );

  return routes;
}
