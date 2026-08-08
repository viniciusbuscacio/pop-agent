import { Hono } from 'hono';
import { upgradeWebSocket } from '@hono/node-server';
import { compareVersions, installCommand, MIN_CLIENT_VERSION } from '@pop-agent/shared';
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
 *
 * The attach is also where client and server compare versions (docs/cli.md,
 * Version compatibility). Three outcomes, and the asymmetry is deliberate:
 * silence when they are compatible, a line the client may print when it is
 * merely behind, and a refusal carrying the install command when it is below
 * the minimum. A protocol error nobody can read is the thing being prevented,
 * and it is prevented by never letting that pair connect at all.
 */

/** What a terminal sends to introduce itself. Anything else is refused. */
interface AttachFrame {
  kind: 'attach';
  machine: HandsMachine;
}

export interface HandsRoutesDeps {
  hands: HandsRegistry;
  /** This server's own version, for the comparison on attach. */
  versions: { popAgentVersion: string };
}

export function createHandsRoutes(deps: HandsRoutesDeps): Hono {
  const routes = new Hono();

  routes.get(
    '/hands',
    upgradeWebSocket((c) => {
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

            const client = typeof machine.clientVersion === 'string' ? machine.clientVersion : '';
            const server = deps.versions.popAgentVersion;
            const install = installCommand(originOf(c.req.url), server);

            if (client.length === 0 || compareVersions(client, MIN_CLIENT_VERSION) < 0) {
              // Refused, not tolerated: this pair cannot speak, and letting
              // them try produces exactly the unreadable failure the version
              // check exists to prevent. The command comes with the refusal
              // because the client is stuck until someone runs it.
              ws.send(
                JSON.stringify({
                  kind: 'outdated',
                  minimum: MIN_CLIENT_VERSION,
                  server,
                  install,
                }),
              );
              ws.close();
              return;
            }

            attached = true;
            deps.hands.attach({
              id,
              machine,
              send: (payload) => ws.send(JSON.stringify(payload)),
              close: () => ws.close(),
            });
            // The id goes back because the terminal has to name itself when
            // it posts a message: that is what binds a run to THIS machine
            // (docs/cli.md, Whose hands). Attaching alone claims nothing.
            //
            // `update` rides along only when the client is behind, and the
            // client shows it as one dim line. Not a prompt: a question asked
            // on every launch is answered `n` on reflex, and then the reflex
            // is what answers the one that mattered.
            const behind = compareVersions(client, server) < 0;
            ws.send(
              JSON.stringify({
                kind: 'attached',
                id,
                ...(behind ? { update: { server, install } } : {}),
              }),
            );
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

/**
 * The address this server was reached at, so the install command names the
 * host the user actually typed -- a tailnet name from the laptop, localhost
 * on the server itself. A README cannot get that right; the request can.
 */
function originOf(requestUrl: string): string {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return '';
  }
}
