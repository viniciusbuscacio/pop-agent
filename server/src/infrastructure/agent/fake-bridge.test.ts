import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../application/ports/agent-bridge.js';
import { FakeAgentBridge } from './fake-bridge.js';

/** Fast-forwarded: the scripts are about shape and order, not wall time. */
const bridge = new FakeAgentBridge(200);

async function collect(prompt: string, signal?: AbortSignal): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await bridge.run({
    chatId: 'chat-000000000000',
    prompt,
    model: '',
    onEvent: (event) => events.push(event),
    signal: signal ?? new AbortController().signal,
  });
  return events;
}

describe('fake agent bridge', () => {
  it('streams a default answer in fragments that echo the prompt', async () => {
    const events = await collect('what is the plan');

    expect(events.every((event) => event.kind === 'delta')).toBe(true);
    expect(events.length).toBeGreaterThan(10);
    expect(events.map((event) => (event.kind === 'delta' ? event.text : '')).join('')).toContain(
      'what is the plan',
    );
  });

  it('stages thinking before the answer', async () => {
    const events = await collect('think: something hard');

    const kinds = events.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === 'thinking')).toHaveLength(5);
    expect(kinds.indexOf('thinking')).toBeLessThan(kinds.indexOf('delta'));
  });

  it('stages a tool call that starts, streams output and finishes', async () => {
    const events = await collect('tool: list the files');

    const tools = events.filter((event) => event.kind === 'tool');
    expect(tools.map((event) => (event.kind === 'tool' ? event.status : ''))).toEqual([
      'start',
      'output',
      'output',
      'output',
      'output',
      'output',
      'output',
      'done',
    ]);
    // The answer comes after the tool finished, like a real run.
    const lastTool = events.lastIndexOf(tools[tools.length - 1] as AgentEvent);
    expect(events.slice(lastTool).some((event) => event.kind === 'delta')).toBe(true);
  });

  it('stages a provider failure after a few words', async () => {
    const events = await collect('error: pretend the provider is down');

    const last = events[events.length - 1];
    expect(last).toEqual({ kind: 'error', code: 'provider_error' });
    expect(events.filter((event) => event.kind === 'delta').length).toBeGreaterThan(0);
  });

  it('stops the moment it is aborted, mid-script', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const events = await collect('slow: keep going for a while', controller.signal);

    expect(events[events.length - 1]).toEqual({ kind: 'error', code: 'aborted' });
    // Sixty words would have taken thirty real seconds; it gave up early.
    expect(events.filter((event) => event.kind === 'delta').length).toBeLessThan(60);
  });

  it('reports an already-aborted run without emitting anything else', async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect('anything', controller.signal);

    expect(events).toEqual([{ kind: 'error', code: 'aborted' }]);
  });

  it('offers models so the picker has something to show', async () => {
    expect(await bridge.listModels()).toEqual([{ id: 'fake/model-1' }, { id: 'fake/model-2' }]);
  });
});
