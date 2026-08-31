// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerDTO } from '@pop-agent/shared';
import { useMcpStore } from '../store/mcp';
import { McpPage } from './mcp-page';

const list = vi.fn();
const toggle = vi.fn();

vi.mock('../services/mcp', () => ({
  mcpService: {
    list: () => list() as Promise<unknown>,
    toggle: (id: string) => toggle(id) as Promise<unknown>,
  },
}));

function server(enabled: boolean): McpServerDTO {
  return {
    id: 'mcp-learn',
    name: 'Microsoft Learn',
    description: '',
    transport: 'streamable-http',
    endpoint: 'https://learn.microsoft.com/api/mcp',
    command: '',
    args: [],
    authKind: 'none',
    authHeader: '',
    enabled,
    timeoutMs: 60000,
    status: 'connected',
    lastError: '',
    cwd: '',
    capabilities: [],
  };
}

beforeEach(() => {
  list.mockReset();
  toggle.mockReset();
  useMcpStore.setState({ servers: undefined });
});

afterEach(cleanup);

describe('MCP server list', () => {
  it('uses the themed switch control to toggle a server', async () => {
    list
      .mockResolvedValueOnce({ servers: [server(true)] })
      .mockResolvedValueOnce({ servers: [server(false)] });
    toggle.mockResolvedValue({ server: server(false) });

    render(
      <MemoryRouter initialEntries={['/mcp']}>
        <Routes>
          <Route path="/mcp" element={<McpPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const enabledSwitch = await screen.findByRole('switch', { name: 'Microsoft Learn enabled' });
    expect(enabledSwitch).toHaveProperty('checked', true);
    expect(screen.queryByRole('button', { name: 'OFF' })).toBeNull();

    await userEvent.click(enabledSwitch);

    expect(toggle).toHaveBeenCalledWith('mcp-learn');
    await waitFor(() => expect(enabledSwitch).toHaveProperty('checked', false));
  });
});
