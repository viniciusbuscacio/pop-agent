import { AgentCard, Role, Task, TaskState, type StreamResponse } from '@a2a-js/sdk';
import { JsonRpcTransportHandler, ServerCallContext, type A2ARequestHandler } from '@a2a-js/sdk/server';
import { RequestMalformedError, TaskNotFoundError, TaskNotCancelableError, UnsupportedOperationError } from '@a2a-js/sdk/errors';
import type { A2aServerProtocol } from '../../application/ports/a2a-server.js';
import { A2aInboundError, type A2aInboundService, type InboundTask } from '../../application/a2a/a2a-inbound-service.js';

export class SdkA2aServer implements A2aServerProtocol {
  constructor(private readonly service: A2aInboundService) {}
  private agentCard(origin: string): AgentCard {
    return AgentCard.fromJSON({
      name: 'Pop Agent', description: 'Private personal agent. Send text tasks and retrieve their results.',
      version: '1', supportedInterfaces: [{ url: origin + '/a2a/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer', bearerFormat: 'Pop A2A access key', description: 'Owner-issued A2A key' } } },
      securityRequirements: [{ schemes: { bearer: { list: [] } } }],
      skills: [{ id: 'chat', name: 'Personal agent', description: 'Answer text requests using the configured Pop Agent.', tags: ['assistant'], inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    });
  }
  card(origin: string): Record<string, unknown> { return AgentCard.toJSON(this.agentCard(origin)) as Record<string, unknown>; }
  async handle(body: Record<string, unknown>, origin: string, signal: AbortSignal, authorize: () => void): Promise<Record<string, unknown>> {
    const unsupported = async (): Promise<never> => { throw new UnsupportedOperationError('This A2A operation is not supported.'); };
    async function* unsupportedStream(): AsyncGenerator<StreamResponse> { yield* []; throw new UnsupportedOperationError('Streaming is not supported.'); }
    const invoke = async (operation: () => InboundTask | Promise<InboundTask>): Promise<Task> => {
      try { return toTask(await operation()); }
      catch (error) {
        if (error instanceof A2aInboundError) {
          if (error.code === 'not_found') throw new TaskNotFoundError(error.message);
          if (error.code === 'not_cancelable') throw new TaskNotCancelableError(error.message);
          throw new RequestMalformedError(error.message);
        }
        throw new RequestMalformedError('The A2A operation could not complete. Refresh the task before retrying.');
      }
    };
    const handler: A2ARequestHandler = {
      getAgentCard: async () => this.agentCard(origin),
      getAuthenticatedExtendedAgentCard: unsupported,
      sendMessage: async params => {
        const message = params.message;
        if (!message || message.role !== Role.ROLE_USER || !message.parts.length ||
            message.parts.some(part => part.content?.$case !== 'text') ||
            message.referenceTaskIds.length || params.configuration?.taskPushNotificationConfig ||
            (params.configuration?.acceptedOutputModes.length && !params.configuration.acceptedOutputModes.includes('text/plain')))
          throw new RequestMalformedError('Only user text messages and text/plain output are supported.');
        return invoke(async () => {
          authorize();
          const task = this.service.send({ messageId: message.messageId, contextId: message.contextId,
            taskId: message.taskId, author: reportedAuthor(message.metadata), text: message.parts.map(part => part.content?.value as string).join('\n') });
          return params.configuration?.returnImmediately ? task : this.service.wait(task.id, signal, authorize);
        });
      },
      getTask: params => invoke(() => this.service.get(params.id)),
      cancelTask: params => invoke(() => this.service.cancel(params.id)),
      listTasks: unsupported,
      sendMessageStream: unsupportedStream, resubscribe: unsupportedStream,
      createTaskPushNotificationConfig: unsupported, getTaskPushNotificationConfig: unsupported,
      listTaskPushNotificationConfigs: unsupported, deleteTaskPushNotificationConfig: unsupported,
    };
    const result = await new JsonRpcTransportHandler(handler).handle(body,
      new ServerCallContext({ requestedVersion: '1.0', user: { isAuthenticated: true, userName: 'a2a-owner' } }));
    if (Symbol.asyncIterator in result) throw new UnsupportedOperationError('Streaming is not supported.');
    return result as unknown as Record<string, unknown>;
  }
}
function toTask(value: InboundTask): Task {
  const states = { working: TaskState.TASK_STATE_WORKING, completed: TaskState.TASK_STATE_COMPLETED,
    failed: TaskState.TASK_STATE_FAILED, canceled: TaskState.TASK_STATE_CANCELED };
  return Task.fromJSON({ id: value.id, contextId: value.contextId,
    status: { state: states[value.state], timestamp: value.timestamp,
      ...(value.text ? { message: { messageId: value.id + '-response', contextId: value.contextId,
        taskId: value.id, role: Role.ROLE_AGENT, parts: [{ text: value.text, mediaType: 'text/plain' }] } } : {}) },
  });
}

function reportedAuthor(metadata: Record<string, unknown> | undefined): 'owner' | 'agent' | 'unknown' {
  const value = metadata?.['popAgent'];
  if (typeof value !== 'object' || value === null) return 'unknown';
  const author = (value as Record<string, unknown>)['author'];
  return author === 'owner' || author === 'agent' ? author : 'unknown';
}
