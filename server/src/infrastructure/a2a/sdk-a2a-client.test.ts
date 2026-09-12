import { Role, TaskState, type Message, type Task } from '@a2a-js/sdk';
import { describe, expect, it } from 'vitest';
import type { A2aAgent } from '../../application/ports/a2a-repo.js';
import { SdkA2aClientFactory, mapSdkA2aResult, mapSdkA2aTask } from './sdk-a2a-client.js';

function agent(patch: Partial<A2aAgent> = {}): A2aAgent {
  return {
    id: 'a2a-agent-1',
    name: 'Remote',
    description: '',
    baseUrl: 'https://agent.example',
    agentCardPath: '.well-known/agent-card.json',
    authKind: 'bearer',
    authHeader: '',
    entraTenantId: '',
    entraClientId: '',
    entraScope: '',
    enabled: true,
    timeoutMs: 1_000,
    status: 'unknown',
    lastError: '',
    protocolVersion: '',
    agentVersion: '',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...patch,
  };
}

const textPart = (value: string) => ({
  content: { $case: 'text' as const, value },
  metadata: undefined,
  filename: '',
  mediaType: 'text/plain',
});

describe('official A2A SDK adapter', () => {
  it('discovers a v1 Agent Card through the screened authenticated fetch', async () => {
    let authorization: string | null = null;
    const factory = new SdkA2aClientFactory({
      fetchDeps: {
        resolve: async () => ['8.8.8.8'],
        retrieve: async (request) => {
          authorization = request.headers.get('authorization');
          return new Response(JSON.stringify({
            name: 'Review Agent',
            description: 'Reviews changes',
            supportedInterfaces: [{
              url: 'https://agent.example/a2a',
              protocolBinding: 'JSONRPC',
              protocolVersion: '1.0',
              tenant: '',
            }],
            version: '2.4.0',
            capabilities: { streaming: false, pushNotifications: false, extensions: [] },
            securitySchemes: {},
            securityRequirements: [],
            defaultInputModes: ['text/plain'],
            defaultOutputModes: ['text/plain'],
            skills: [{
              id: 'review', name: 'Review', description: 'Review code', tags: ['code'],
              examples: ['Review this diff'], inputModes: ['text/plain'], outputModes: ['text/plain'],
              securityRequirements: [],
            }],
            signatures: [],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    });

    const discovered = await factory.create(agent(), 'token-value').discover();

    expect(authorization).toBe('Bearer token-value');
    expect(discovered).toEqual({
      protocolVersion: '1.0',
      agentVersion: '2.4.0',
      interfaces: [{ url: 'https://agent.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      skills: [{
        id: 'review', name: 'Review', description: 'Review code', tags: ['code'],
        examples: ['Review this diff'], inputModes: ['text/plain'], outputModes: ['text/plain'],
      }],
    });
  });

  it('sends foreground text through the official JSON-RPC transport', async () => {
    const requests: string[] = [];
    const factory = new SdkA2aClientFactory({
      fetchDeps: {
        resolve: async () => ['8.8.8.8'],
        retrieve: async (request) => {
          requests.push(request.url);
          if (request.method === 'GET') {
            return new Response(JSON.stringify({
              name: 'Echo', description: '', version: '1.0.0',
              supportedInterfaces: [{
                url: 'https://agent.example/a2a', protocolBinding: 'JSONRPC',
                protocolVersion: '1.0', tenant: '',
              }],
              capabilities: { streaming: false, pushNotifications: false, extensions: [] },
              securitySchemes: {}, securityRequirements: [],
              defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
              skills: [], signatures: [],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          const rpc = JSON.parse(await request.text()) as { id: unknown; method: string };
          expect(rpc.method).toBe('SendMessage');
          return new Response(JSON.stringify({
            jsonrpc: '2.0', id: rpc.id,
            result: {
              message: {
                messageId: 'reply-1', contextId: 'context-1', taskId: '',
                role: 'ROLE_AGENT', parts: [{ text: 'Hello from remote' }],
                extensions: [], referenceTaskIds: [],
              },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    });

    await expect(factory.create(agent({ authKind: 'none' }), undefined).sendText('Hello'))
      .resolves.toEqual({
        remoteTaskId: 'reply-1', contextId: 'context-1', state: 'completed',
        responseText: 'Hello from remote',
      });
    expect(requests).toEqual([
      'https://agent.example/.well-known/agent-card.json',
      'https://agent.example/a2a',
    ]);
  });

  it('uses a custom same-origin card path and dynamically acquired Entra token', async () => {
    let requestedUrl = '';
    let authorization = '';
    let requestedScope = '';
    const factory = new SdkA2aClientFactory({
      entraCredential: (tenantId, clientId, clientSecret) => {
        expect([tenantId, clientId, clientSecret]).toEqual(['tenant-id', 'client-id', 'client-secret']);
        return {
          getToken: async (scope) => {
            requestedScope = scope;
            return { token: 'short-lived-token' };
          },
        };
      },
      fetchDeps: {
        resolve: async () => ['8.8.8.8'],
        retrieve: async (request) => {
          requestedUrl = request.url;
          authorization = request.headers.get('authorization') ?? '';
          return new Response(JSON.stringify({
            name: 'Foundry Agent', description: 'A Foundry peer',
            supportedInterfaces: [{
              url: 'https://agent.example/a2a', protocolBinding: 'JSONRPC',
              protocolVersion: '1.0', tenant: '',
            }],
            version: '1.0.0',
            capabilities: { streaming: false, pushNotifications: false, extensions: [] },
            securitySchemes: {}, securityRequirements: [],
            defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
            skills: [], signatures: [],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    });

    await factory.create(agent({
      baseUrl: 'https://agent.example/a2a',
      agentCardPath: 'agentCard/v1.0',
      authKind: 'microsoft-entra',
      entraTenantId: 'tenant-id',
      entraClientId: 'client-id',
      entraScope: 'https://ai.azure.com/.default',
    }), 'client-secret').discover();

    expect(requestedUrl).toBe('https://agent.example/a2a/agentCard/v1.0');
    expect(requestedScope).toBe('https://ai.azure.com/.default');
    expect(authorization).toBe('Bearer short-lived-token');
  });

  it('maps direct messages and task state/text without exposing unsupported content', () => {
    const message: Message = {
      messageId: 'message-1', contextId: 'context-1', taskId: '', role: Role.ROLE_AGENT,
      parts: [textPart('hello'), { content: { $case: 'url', value: 'https://files.example/x' }, metadata: undefined, filename: 'x', mediaType: 'text/plain' }],
      metadata: undefined, extensions: [], referenceTaskIds: [],
    };
    expect(mapSdkA2aResult(message)).toEqual({
      remoteTaskId: 'message-1', contextId: 'context-1', state: 'completed',
      responseText: 'hello\n[unsupported A2A content omitted]',
    });

    const task: Task = {
      id: 'remote-1', contextId: 'context-1',
      status: { state: TaskState.TASK_STATE_INPUT_REQUIRED, message, timestamp: undefined },
      artifacts: [], history: [], metadata: undefined,
    };
    expect(mapSdkA2aTask(task)).toMatchObject({
      remoteTaskId: 'remote-1', contextId: 'context-1', state: 'input-required',
    });
  });

  it('fails closed for unknown remote states and missing credentials', async () => {
    const task: Task = {
      id: 'remote-1', contextId: 'context-1',
      status: { state: TaskState.TASK_STATE_UNSPECIFIED, message: undefined, timestamp: undefined },
      artifacts: [], history: [], metadata: undefined,
    };
    expect(() => mapSdkA2aTask(task)).toThrow('unknown state');
    expect(() => new SdkA2aClientFactory().create(agent(), undefined)).toThrow('credential is missing');
  });
});
