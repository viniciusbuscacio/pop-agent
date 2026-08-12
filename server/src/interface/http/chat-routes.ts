import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  LOCAL_CONNECTION_HEADER,
  isClientKind,
  type ChatDTO,
  type MessageDTO,
  type ModelDTO,
  type QueuedMessageDTO,
} from '@pop-agent/shared';
import type { Chat, ChatSummary, Message, MessageClient } from '../../domain/chat/chat.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { QueuedMessageService } from '../../application/chat/queued-message-service.js';
import type { QueuedMessage } from '../../application/ports/queued-message-repo.js';
import type { LocalConnectionRegistry } from '../../application/local-access/local-connection-registry.js';
import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import type { FilesService } from '../../application/files/files-service.js';
import { mimeOf } from '../../domain/files/mime.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';
import type { EventTickets } from './event-tickets.js';
import type { SseHub } from './sse-hub.js';

/**
 * Conversations, runs and the event stream (pop-agent.spec §13).
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
    pinned: z.boolean().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
  })
  .strict();

const keepChatSchema = z.object({ keepChatId: z.string().min(1).max(80) }).strict();

/** 16 MB of file is ~21.4 MB of base64; the schema allows a little slack. */
const MAX_ATTACHMENT_DATA_URI = 22_400_000;
const MAX_ATTACHMENTS = 8;

const confirmSchema = z.object({ runId: z.string().min(1).max(80), allow: z.boolean() }).strict();

const sendSchema = z
  .object({
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    /** Default joins the live loop; follow_up is the explicit /queue command. */
    delivery: z.enum(['steer', 'follow_up']).optional(),
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
    filePaths: z.array(z.string().min(1).max(1024)).max(MAX_ATTACHMENTS).optional(),
  })
  .strict();

export interface ChatRoutesDeps {
  chats: ChatService;
  files: FilesService;
  runs: RunService;
  queuedMessages: QueuedMessageService;
  providers: ProviderService;
  hub: SseHub;
  tickets: EventTickets;
  localConnections: LocalConnectionRegistry;
}

/**
 * Who sent this, off the headers (pop-agent.spec §13).
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

function selectLocalConnection(
  c: Context,
  registry: LocalConnectionRegistry,
  client: MessageClient | undefined,
): { ok: true; connectionId?: string } | { ok: false } {
  const explicit = c.req.header(LOCAL_CONNECTION_HEADER);
  if (explicit !== undefined && explicit.length > 0) {
    return registry.has(explicit) ? { ok: true, connectionId: explicit } : { ok: false };
  }
  // The managed connection belongs to the native Desktop host. A browser or
  // PWA with the same single-user session must not silently inherit access to
  // that Mac merely because it omitted an explicit connection header.
  if (client?.kind !== 'desktop') return { ok: true };
  const managed = registry.defaultConnection();
  return managed === undefined ? { ok: true } : { ok: true, connectionId: managed.id };
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

  routes.post('/chats/archive-others', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = keepChatSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const archived = deps.chats.archiveOthers(parsed.data.keepChatId);
    if (archived === undefined) return chatNotFound(c);
    return c.json({ archived });
  });

  routes.post('/chats/delete-others', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = keepChatSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const deleted = deps.chats.deleteOthers(parsed.data.keepChatId);
    if (deleted === undefined) return chatNotFound(c);
    return c.json({ deleted });
  });

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
    if (parsed.data.pinned !== undefined) {
      chat = deps.chats.setPinned(id, parsed.data.pinned) ?? chat;
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
    const pending = before === undefined ? deps.queuedMessages.list(chatId) : [];
    const queued = pending[0];
    return c.json({
      messages: messages.map(toMessageDto),
      ...(live === undefined ? {} : { live }),
      ...(pending.length === 0 ? {} : { pending: pending.map(toQueuedMessageDto) }),
      ...(queued === undefined ? {} : { queued: toQueuedMessageDto(queued) }),
    });
  });

  routes.post('/chats/:id/messages', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    // An @-mentioned file joins the run as a normal attachment, resolved
    // server-side so the bytes never round-trip through the client. The path
    // is the identifier now; the jail refuses the pathological ones.
    const referenced: { name: string; type: string; dataUri: string }[] = [];
    for (const filePath of parsed.data.filePaths ?? []) {
      let bytes;
      try {
        bytes = deps.files.read(filePath);
      } catch {
        bytes = undefined;
      }
      if (bytes === undefined) {
        return apiError(c, 404, 'not_found', `No such file: ${filePath}`);
      }
      const mime = mimeOf(filePath);
      referenced.push({
        name: filePath.split('/').at(-1) ?? filePath,
        type: mime,
        dataUri: `data:${mime};base64,${bytes.toString('base64')}`,
      });
    }

    const client = readClient(c);
    const selected = selectLocalConnection(c, deps.localConnections, client);
    if (!selected.ok) {
      return apiError(c, 409, 'local_connection_unavailable', 'The selected local connection is unavailable.');
    }
    const chatId = c.req.param('id');
    const origin = {
      ...(client === undefined ? {} : { client }),
      ...(selected.connectionId === undefined ? {} : { localConnectionId: selected.connectionId }),
    };
    const result = deps.runs.startRun(
      chatId,
      parsed.data.text,
      [...(parsed.data.attachments ?? []), ...referenced],
      origin,
    );
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return chatNotFound(c);
      if (result.reason === 'llm_stopped') {
        return apiError(c, 503, 'llm_stopped', 'The LLM is stopped by the operator (Settings → Server).');
      }
      const queued = deps.queuedMessages.enqueue(chatId, {
        text: parsed.data.text,
        deliveryMode: parsed.data.delivery ?? 'steer',
        attachments: parsed.data.attachments ?? [],
        filePaths: parsed.data.filePaths ?? [],
        ...origin,
      });
      if (!queued.ok) {
        return apiError(
          c,
          409,
          'queue_full',
          'This chat already has 1,024 pending messages.',
        );
      }
      return c.json(
        {
          queued: true as const,
          message: toQueuedMessageDto(queued.message),
          head: toQueuedMessageDto(queued.head),
        },
        202,
      );
    }

    // 202: accepted and started. The answer arrives on the stream.
    return c.json({ runId: result.runId, userMessageId: result.userMessageId }, 202);
  });

  const updateQueued = async (c: Context) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    for (const filePath of parsed.data.filePaths ?? []) {
      try {
        if (deps.files.read(filePath) === undefined) {
          return apiError(c, 404, 'not_found', `No such file: ${filePath}`);
        }
      } catch {
        return apiError(c, 404, 'not_found', `No such file: ${filePath}`);
      }
    }
    const client = readClient(c);
    const selected = selectLocalConnection(c, deps.localConnections, client);
    if (!selected.ok) {
      return apiError(c, 409, 'local_connection_unavailable', 'The selected local connection is unavailable.');
    }
    const chatId = c.req.param('id');
    if (chatId === undefined) return chatNotFound(c);
    const requestedId = c.req.param('messageId');
    const messageId = requestedId === undefined || requestedId.length === 0
      ? deps.queuedMessages.get(chatId)?.id
      : requestedId;
    if (messageId === undefined) {
      return apiError(c, 404, 'queue_not_found', 'This chat has no queued message.');
    }
    const updated = deps.queuedMessages.update(chatId, messageId, {
      text: parsed.data.text,
      attachments: parsed.data.attachments ?? [],
      filePaths: parsed.data.filePaths ?? [],
      ...(client === undefined ? {} : { client }),
      ...(selected.connectionId === undefined ? {} : { localConnectionId: selected.connectionId }),
    });
    if (!updated.ok) {
      return updated.reason === 'chat_not_found'
        ? chatNotFound(c)
        : apiError(c, 404, 'queue_not_found', 'This chat has no queued message.');
    }
    return c.json({ message: toQueuedMessageDto(updated.message) });
  };
  routes.put('/chats/:id/queue', updateQueued);
  routes.put('/chats/:id/queue/:messageId', updateQueued);

  const cancelQueued = (c: Context) => {
    const chatId = c.req.param('id');
    if (chatId === undefined) return chatNotFound(c);
    const requestedId = c.req.param('messageId');
    const messageId = requestedId === undefined || requestedId.length === 0
      ? deps.queuedMessages.get(chatId)?.id
      : requestedId;
    if (messageId === undefined) {
      return apiError(c, 404, 'queue_not_found', 'This chat has no queued message.');
    }
    const removed = deps.queuedMessages.cancel(chatId, messageId);
    if (!removed.ok) {
      return removed.reason === 'chat_not_found'
        ? chatNotFound(c)
        : apiError(c, 404, 'queue_not_found', 'This chat has no queued message.');
    }
    return c.body(null, 204);
  };
  routes.delete('/chats/:id/queue', cancelQueued);
  routes.delete('/chats/:id/queue/:messageId', cancelQueued);

  routes.post('/chats/:id/stop', (c) => {
    const id = c.req.param('id');
    if (deps.chats.get(id) === undefined) return chatNotFound(c);
    const stopped = deps.runs.stopRun(id);
    deps.queuedMessages.drain(id);
    return c.json({ stopped });
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
    // The catalog is per provider (pop-agent.spec §15); absent param means the
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
    pinned: chat.pinned,
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

function toQueuedMessageDto(message: QueuedMessage): QueuedMessageDTO {
  return {
    id: message.id,
    chatId: message.chatId,
    text: message.text,
    deliveryMode: message.deliveryMode,
    attachments: message.attachments,
    filePaths: message.filePaths,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
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
    ...(message.notice === undefined ? {} : { notice: message.notice }),
  };
}
