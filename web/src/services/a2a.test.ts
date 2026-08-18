import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { a2aService } from './a2a';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify({ tasks: [], task: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('A2A browser service', () => {
  it('loads an agent task list through the canonical bounded query endpoint', async () => {
    await a2aService.tasks('agent/id');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/a2a/tasks?agentId=agent%2Fid');
  });

  it('sends and continues plain text as JSON objects', async () => {
    await a2aService.send('agent-1', 'hello');
    await a2aService.continue('task-1', 'more');
    const first = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const second = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(first.body))).toEqual({ text: 'hello' });
    expect(JSON.parse(String(second.body))).toEqual({ text: 'more' });
  });
});
