import { it, expect, vi } from 'vitest';
import { IntegrationService } from './integration-service.js';
import type { IntegrationRepo } from '../ports/integration-repo.js';
import type { RunService } from '../chat/run-service.js';
import type { ChatService } from '../chat/chat-service.js';
import type { QueuedMessageService } from '../chat/queued-message-service.js';
it('never cancels a successor run when the requested run has already finished', () => {
    const stop = vi.fn();
    const repo = { activities: () => [], activity: () => ({ chatId: 'chat', runId: 'old', state: 'completed' }) } as unknown as IntegrationRepo;
    const runs = { liveRun: () => ({ runId: 'new' }), stopRun: stop } as unknown as RunService;
    const service = new IntegrationService(repo, { runs, chats: {} as ChatService, queue: {} as QueuedMessageService, now: () => 0 });
    expect(service.cancel('old')).toEqual({ runId: 'old', state: 'completed' });
    expect(stop).not.toHaveBeenCalled();
});
