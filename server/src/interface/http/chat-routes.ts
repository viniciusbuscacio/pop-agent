import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  HANDS_HEADER,
  isClientKind,
  type ChatDTO,
  type MessageDTO,
  type ModelDTO,
} from '@popy/shared';
import type { Chat, ChatSummary, Message, MessageClient } from '../../domain/chat/chat.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';
import type { EventTickets } from './event-tickets.js';
import type { SseHub } from './sse-hub.js';

/**
 * Conversations, runs and the event stream (popy.spec §13).
 *
 * Sending a message answers 202 with ids and nothing else: the reply itself
 * arrives over the stream. That split is what lets a run outlive the request
 * that started it, survive a reload, and be watched from a second device.
 */

const HEARTBEAT_MS = 25_000;
const MAX_MESSAGE_LENGTH = 32_000;

const patchSchema = z
  .object({
    title: z.string().optional(),
    archived: z.boolean().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
  })
  .strict();

/** 16 MB of file is ~21.4 MB of base64; the schema allows a little slack. */
const MAX_ATTACHMENT_DATA_URI = 22_400_000;
const MAX_ATTACHMENTS = 8;

const confirmSchema = z.object({ runId: z.string().min(1).max(80), allow: z.boolean() }).strict();

const sendSchema = z
  .object({
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    attachments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            type: z.string().max(100),
            dataUri: z.string().startsWith('data:').max(MAX_ATTACHMENT_DATA_URI),
          })
          .strict(),
      )
      .max(MAX_ATTACHMENTS)
      .optional(),
    /** Files already in Files, referenced by @ in the composer -- no re-upload. */
    artifactIds: z.array(z.string().min(1).max(60)).max(MAX_ATTACHMENTS).optional(),
  })
  .strict();

export interface ChatRoutesDeps {
  chats: ChatService;
  artifacts: ArtifactService;
  runs: RunService;
  providers: ProviderService;
  hub: SseHub;
  tickets: EventTickets;
}

/**
 * Who sent this, off the headers (popy.spec §13).
 *
 * Validated against the known list rather than stored as given: an unknown
 * value would end up in the model's context and in the history as if it meant
 * something. A client that says nothing is recorded as nothing -- which is
 * the truth, and better than guessing "web".
 *
 * Forgeable by anyone holding the token, which on a single-user install means
 * the owner. It is context, never a security decision.
 */
function readClient(c: Context): MessageClient | undefined {
  const kind = c.req.header(CLIENT_HEADER);
  if (kind === undefined || !isClientKind(kind)) return undefined;

  const platform = c.req.header(CLIENT_PLATFORM_HEADER);
  // Two sources, in that order. Behind a reverse proxy the socket is the
  // proxy and only the forwarded header knows the caller; connecting straight
  // to the port there IS no header, and reading only that recorded nothing at
  // all for every direct connection -- which is most of them.
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const socket = connInfo(c);
  const ip = forwarded !== undefined && forwarded.length > 0 ? forwarded : socket;

  return {
    kind,
    ...(platform === undefined || platform.length === 0 ? {} : { platform: platform.slice(0, 40) }),
    ...(ip === undefined ? {} : { ip }),
  };
}

/** The socket's own address, when the adapter can say. */
function connInfo(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    // ::ffff:127.0.0.1 is IPv4 wearing an IPv6 hat; store the address itself.
    return address === undefined ? undefined : address.replace(/^::ffff:/, '');
  } catch {
    // A runtime without connection info is not a reason to refuse a message.
    return undefined;
  }
}

export function createChatRoutes(deps: ChatRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/chats', (c) => {
    const archived = c.req.query('archived') === 'true';
    return c.json({ chats: deps.chats.list({ archived }).map(toChatDto) });
  });

  routes.post('/chats', (c) => c.json(toChatDto(deps.chats.create()), 201));

  routes.patch('/chats/:id', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const id = c.req.param('id');
    let chat = deps.chats.get(id);
    if (chat === undefined) return chatNotFound(c);

    if (parsed.data.title !== undefined) chat = deps.chats.rename(id, parsed.data.title) ?? chat;
    if (parsed.data.archived !== undefined) {
      chat = deps.chats.setArchived(id, parsed.data.archived) ?? chat;
    }
    if (parsed.data.model !== undefined) {
      // The pair is the identity: a model without a provider keeps the chat's
      // current provider; both empty means "back to the global default".
      const provider = parsed.data.provider ?? chat.provider;
      chat = deps.chats.setModel(id, parsed.data.model, provider) ?? chat;
    }

    return c.json(toChatDto(chat));
  });

  // Registered before '/chats/:id', which would otherwise read "archived"
  // as a chat id and answer 404.
  routes.delete('/chats/archived', (c) => {
    return c.json({ deleted: deps.chats.deleteArchived() });
  });

  routes.delete('/chats/:id', (c) => {
    if (!deps.chats.delete(c.req.param('id'))) return chatNotFound(c);
    return c.body(null, 204);
  });

  routes.get('/chats/:id/messages', (c) => {
    const before = c.req.query('before');
    const limitParam = c.req.query('limit');
    const limit = limitParam === undefined ? undefined : Number(limitParam);
    if (limit !== undefined && !Number.isFinite(limit)) {
      return apiError(c, 400, 'invalid_field', 'limit must be a number.');
    }

    const chatId = c.req.param('id');
    const messages = deps.chats.getMessages(chatId, {
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    });
    if (messages === undefined) return chatNotFound(c);

    // A client mounting mid-run gets what already streamed, not a blank
    // bubble; only the first page carries it -- history pages have no "now".
    const live = before === undefined ? deps.runs.liveRun(chatId) : undefined;
    return c.json({
      messages: messages.map(toMessageDto),
      ...(live === undefined ? {} : { live }),
    });
  });

  routes.post('/chats/:id/messages', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    // An @-mentioned file joins the run as a normal attachment, resolved
    // server-side so the bytes never round-trip through the client.
    const referenced: { name: string; type: string; dataUri: string }[] = [];
    for (const artifactId of parsed.data.artifactIds ?? []) {
      const opened = deps.artifacts.read(artifactId);
      if (opened === undefined) {
        return apiError(c, 404, 'not_found', `No such file: ${artifactId}`);
      }
      referenced.push({
        name: opened.artifact.name,
        type: opened.artifact.mime,
        dataUri: `data:${opened.artifact.mime};base64,${opened.bytes.toString('base64')}`,
      });
    }

    const client = readClient(c);
    // Which terminal typed this, if one did. Not validated here: the registry
    // answers "is that connection still attached", and an id that names
    // nobody costs the run its second pair of hands and nothing else.
    const hands = c.req.header(HANDS_HEADER);
    const result = deps.runs.startRun(
      c.req.param('id'),
      parsed.data.text,
      [...(parsed.data.attachments ?? []), ...referenced],
      {
        ...(client === undefined ? {} : { client }),
        ...(hands === undefined || hands.length === 0 ? {} : { handsConnectionId: hands }),
      },
    );
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return chatNotFound(c);
      return result.reason === 'llm_stopped'
        ? apiError(c, 503, 'llm_stopped', 'The LLM is stopped by the operator (Settings → Server).')
        : apiError(c, 409, 'run_in_progress', 'This chat is already waiting on an answer.');
    }

    // 202: accepted and started. The answer arrives on the stream.
    return c.json({ runId: result.runId, userMessageId: result.userMessageId }, 202);
  });

  routes.post('/chats/:id/stop', (c) => {
    const id = c.req.param('id');
    if (deps.chats.get(id) === undefined) return chatNotFound(c);
    return c.json({ stopped: deps.runs.stopRun(id) });
  });

  routes.post('/chats/:id/confirm', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const id = c.req.param('id');
    if (deps.chats.get(id) === undefined) return chatNotFound(c);
    return c.json({ answered: deps.runs.resolveConfirm(id, parsed.data.runId, parsed.data.allow) });
  });

  routes.get('/recent-models', (c) => {
    return c.json({
      models: deps.chats.recentModels().map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        usedAt: entry.usedAt,
      })),
    });
  });

  routes.get('/models', async (c) => {
    // The catalog is per provider (popy.spec §15); absent param means the
    // provider the next run would actually use.
    const provider = c.req.query('provider') ?? deps.providers.resolve().providerId;
    const catalog = await deps.providers.models(provider);
    return c.json({ models: catalog.models.map(toModelDto), source: catalog.source });
  });

  /** Trades a session for a short-lived ticket the EventSource URL can carry. */
  routes.post('/events/ticket', (c) => c.json({ ticket: deps.tickets.issue() }));

  routes.get('/events', (c) => {
    if (!deps.tickets.consume(c.req.query('ticket'))) {
      return apiError(c, 401, 'invalid_session', 'This stream needs a fresh ticket.');
    }

    return streamSSE(c, async (stream) => {
      const pending: string[] = [];
      let notify: (() => void) | undefined;

      const unsubscribe = deps.hub.subscribe((payload) => {
        pending.push(payload);
        notify?.();
      });

      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        notify?.();
      });

      while (open) {
        while (pending.length > 0) {
          const payload = pending.shift();
          if (payload !== undefined) await stream.writeSSE({ data: payload });
        }
        if (!open) break;

        // Wake on the next event, or on the heartbeat -- a comment line that
        // keeps proxies from deciding an idle stream is a dead one.
        const woken = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            notify = undefined;
            resolve(false);
          }, HEARTBEAT_MS);
          notify = () => {
            clearTimeout(timer);
            notify = undefined;
            resolve(true);
          };
        });
        if (!woken && open) await stream.write(':ka\n\n');
      }

      unsubscribe();
    });
  });

  return routes;
}

function chatNotFound(c: Context): Response {
  return apiError(c, 404, 'chat_not_found', 'That conversation does not exist.');
}

function toChatDto(chat: Chat | ChatSummary): ChatDTO {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    provider: chat.provider,
    archived: chat.archived,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    preview: 'preview' in chat ? chat.preview : '',
  };
}

function toModelDto(model: ModelInfo): ModelDTO {
  return {
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.context === undefined ? {} : { context: model.context }),
    ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
  };
}

function toMessageDto(message: Message): MessageDTO {
  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    content: message.content,
    thinking: message.thinking,
    tools: message.tools.map((tool) => ({
      name: tool.name,
      status: tool.status,
      detail: tool.detail,
    })),
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      dataUri: attachment.dataUri,
    })),
    createdAt: message.createdAt,
  };
}
