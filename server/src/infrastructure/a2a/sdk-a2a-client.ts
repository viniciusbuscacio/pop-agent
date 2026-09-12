import { randomUUID } from 'node:crypto';
import { ClientSecretCredential } from '@azure/identity';
import {
  Role,
  TaskState,
  type AgentCard,
  type Message,
  type Part,
  type Task,
} from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
  type Client,
} from '@a2a-js/sdk/client';
import type {
  A2aClient,
  A2aClientFactory,
  A2aTaskResult,
  DiscoveredA2aAgent,
} from '../../application/ports/a2a-client.js';
import type { A2aAgent, A2aTaskState } from '../../application/ports/a2a-repo.js';
import {
  A2aNetworkError,
  createScreenedA2aFetch,
  parseA2aUrl,
  screenA2aUrl,
  type ScreenedFetchOptions,
} from './screened-fetch.js';

const MAX_REMOTE_TEXT = 64_000;

export interface SdkA2aClientFactoryOptions {
  allowedPrivateIps?: () => string[];
  fetchDeps?: Pick<ScreenedFetchOptions, 'resolve' | 'retrieve'>;
  entraCredential?: (
    tenantId: string,
    clientId: string,
    clientSecret: string,
  ) => {
    getToken(
      scope: string,
      options: { abortSignal: AbortSignal },
    ): Promise<{ token: string } | null>;
  };
}

/** Official A2A SDK adapter. Protocol-owned types never leave infrastructure. */
export class SdkA2aClientFactory implements A2aClientFactory {
  constructor(private readonly options: SdkA2aClientFactoryOptions = {}) {}

  create(agent: A2aAgent, credential: string | undefined): A2aClient {
    const base = parseA2aUrl(agent.baseUrl);
    const operation: { signal: AbortSignal | undefined } = { signal: undefined };
    const authentication = authOptions(agent, credential, this.options.entraCredential);
    const fetchImpl = createScreenedA2aFetch({
      timeoutMs: agent.timeoutMs,
      allowedPrivateIps: this.options.allowedPrivateIps?.() ?? [],
      allowedCredentialOrigin: base.origin,
      ...authentication,
      operationSignal: () => operation.signal,
      ...this.options.fetchDeps,
    });
    const resolver = new DefaultAgentCardResolver({
      fetchImpl,
      path: agent.agentCardPath,
    });
    const cardBaseUrl = agent.agentCardPath === '.well-known/agent-card.json'
      ? agent.baseUrl
      : `${agent.baseUrl.replace(/\/+$/, '')}/`;
    const factory = new ClientFactory({
      transports: [
        new JsonRpcTransportFactory({ fetchImpl }),
        new RestTransportFactory({ fetchImpl }),
      ],
      cardResolver: resolver,
    });
    const validateInterface = (url: string) => this.options.fetchDeps?.resolve === undefined
      ? screenA2aUrl(url, undefined, new URL(url).origin === base.origin ? this.options.allowedPrivateIps?.() ?? [] : [])
      : screenA2aUrl(url, this.options.fetchDeps.resolve, new URL(url).origin === base.origin ? this.options.allowedPrivateIps?.() ?? [] : []);
    return new SdkA2aClient(cardBaseUrl, resolver, factory, operation, validateInterface);
  }
}

class SdkA2aClient implements A2aClient {
  private cardPromise: Promise<AgentCard> | undefined;
  private clientPromise: Promise<Client> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly resolver: DefaultAgentCardResolver,
    private readonly factory: ClientFactory,
    private readonly operation: { signal: AbortSignal | undefined },
    private readonly validateInterface: (url: string) => Promise<URL>,
  ) {}

  async discover(signal?: AbortSignal): Promise<DiscoveredA2aAgent> {
    const card = await this.withSignal(signal, async () => {
      const discovered = await this.card();
      await this.client(); // Validate that at least one supported v1 transport is selectable.
      await Promise.all(discovered.supportedInterfaces.map((entry) => this.validateInterface(entry.url)));
      return discovered;
    });
    return {
      protocolVersion: card.supportedInterfaces[0]?.protocolVersion ?? '',
      agentVersion: card.version,
      interfaces: card.supportedInterfaces.map((entry) => ({
        url: entry.url,
        protocolBinding: entry.protocolBinding,
        protocolVersion: entry.protocolVersion,
      })),
      skills: card.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        examples: skill.examples,
        inputModes: skill.inputModes,
        outputModes: skill.outputModes,
      })),
    };
  }

  async sendText(text: string, signal?: AbortSignal, author: 'owner' | 'agent' | 'unknown' = 'unknown'): Promise<A2aTaskResult> {
    return this.withSignal(signal, async () => mapSdkA2aResult(await (await this.client()).sendMessage(
      sendRequest(text, '', '', author),
      signal === undefined ? undefined : { signal },
    )));
  }

  async getTask(remoteTaskId: string, signal?: AbortSignal): Promise<A2aTaskResult> {
    return this.withSignal(signal, async () => mapSdkA2aTask(await (await this.client()).getTask(
      { tenant: '', id: remoteTaskId, historyLength: 20 },
      signal === undefined ? undefined : { signal },
    )));
  }

  async cancelTask(remoteTaskId: string, signal?: AbortSignal): Promise<A2aTaskResult> {
    return this.withSignal(signal, async () => mapSdkA2aTask(await (await this.client()).cancelTask(
      { tenant: '', id: remoteTaskId, metadata: undefined },
      signal === undefined ? undefined : { signal },
    )));
  }

  async continueTask(
    remoteTaskId: string,
    contextId: string,
    text: string,
    signal?: AbortSignal,
    author: 'owner' | 'agent' | 'unknown' = 'unknown',
  ): Promise<A2aTaskResult> {
    return this.withSignal(signal, async () => mapSdkA2aResult(await (await this.client()).sendMessage(
      sendRequest(text, contextId, remoteTaskId, author),
      signal === undefined ? undefined : { signal },
    )));
  }

  private card(): Promise<AgentCard> {
    this.cardPromise ??= this.resolver.resolve(this.baseUrl);
    return this.cardPromise;
  }

  private client(): Promise<Client> {
    this.clientPromise ??= this.card().then((card) => this.factory.createFromAgentCard(card));
    return this.clientPromise;
  }

  private async withSignal<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    this.operation.signal = signal;
    try {
      return await operation();
    } finally {
      this.operation.signal = undefined;
    }
  }
}

function authOptions(
  agent: A2aAgent,
  credential: string | undefined,
  entraCredential: SdkA2aClientFactoryOptions['entraCredential'],
): Pick<ScreenedFetchOptions, 'credentialHeader' | 'credentialHeaderProvider'> {
  if (agent.authKind === 'none') return {};
  if (credential === undefined || credential === '') {
    throw Object.assign(new Error('The configured A2A credential is missing.'), { code: 'authentication' });
  }
  if (agent.authKind === 'microsoft-entra') {
    const tokenCredential = entraCredential?.(
      agent.entraTenantId,
      agent.entraClientId,
      credential,
    ) ?? new ClientSecretCredential(
      agent.entraTenantId,
      agent.entraClientId,
      credential,
    );
    return {
      credentialHeaderProvider: async (signal) => {
        const token = await tokenCredential.getToken(agent.entraScope, { abortSignal: signal });
        if (token === null || token.token === '') {
          throw new Error('Microsoft Entra returned no access token.');
        }
        return { name: 'Authorization', value: `Bearer ${token.token}` };
      },
    };
  }
  if (agent.authKind === 'bearer') {
    return { credentialHeader: { name: agent.authHeader || 'Authorization', value: `Bearer ${credential}` } };
  }
  if (agent.authKind === 'api-key') {
    return { credentialHeader: { name: agent.authHeader || 'X-API-Key', value: credential } };
  }
  if (agent.authHeader === '') {
    throw Object.assign(new Error('A custom A2A header name is required.'), { code: 'authentication' });
  }
  return { credentialHeader: { name: agent.authHeader, value: credential } };
}

function sendRequest(text: string, contextId = '', taskId = '', author: 'owner' | 'agent' | 'unknown' = 'unknown') {
  return {
    tenant: '',
    message: {
      messageId: randomUUID(),
      contextId,
      taskId,
      role: Role.ROLE_USER,
      parts: [textPart(text)],
      metadata: { popAgent: { author } },
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      historyLength: 20,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

export function mapSdkA2aResult(result: Message | Task): A2aTaskResult {
  return 'status' in result ? mapSdkA2aTask(result) : {
    remoteTaskId: result.taskId || result.messageId,
    contextId: result.contextId,
    state: 'completed',
    responseText: messageText(result),
  };
}

export function mapSdkA2aTask(task: Task): A2aTaskResult {
  const statusText = task.status?.message === undefined ? '' : messageText(task.status.message);
  const artifactText = task.artifacts.length === 0 ? '' : '[unsupported A2A artifacts omitted]';
  const historyText = [...task.history].reverse().find((message) => message.role === Role.ROLE_AGENT);
  return {
    remoteTaskId: task.id,
    contextId: task.contextId,
    state: mapState(task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED),
    responseText: bounded([statusText, artifactText, historyText === undefined ? '' : messageText(historyText)]
      .filter(Boolean).join('\n')),
  };
}

function mapState(state: TaskState): A2aTaskState {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED: return 'submitted';
    case TaskState.TASK_STATE_WORKING: return 'working';
    case TaskState.TASK_STATE_COMPLETED: return 'completed';
    case TaskState.TASK_STATE_FAILED: return 'failed';
    case TaskState.TASK_STATE_CANCELED: return 'canceled';
    case TaskState.TASK_STATE_INPUT_REQUIRED: return 'input-required';
    case TaskState.TASK_STATE_AUTH_REQUIRED: return 'auth-required';
    case TaskState.TASK_STATE_REJECTED: return 'rejected';
    default: throw Object.assign(new Error('The remote A2A task has an unknown state.'), { code: 'protocol_error' });
  }
}

function messageText(message: Message): string {
  return bounded(partsText(message.parts));
}

function partsText(parts: Part[]): string {
  const values = parts.map((part) => {
    if (part.content?.$case === 'text') return part.content.value;
    return '[unsupported A2A content omitted]';
  });
  return values.join('\n');
}

function bounded(value: string): string {
  return value.length <= MAX_REMOTE_TEXT
    ? value
    : `${value.slice(0, MAX_REMOTE_TEXT)}\n[truncated at A2A response limit]`;
}

export function a2aErrorCode(error: unknown): string {
  if (error instanceof A2aNetworkError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const code = (error as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }
  return 'protocol_error';
}
