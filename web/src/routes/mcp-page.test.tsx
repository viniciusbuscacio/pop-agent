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
const create = vi.fn();

vi.mock('../services/mcp', () => ({
  mcpService: {
    list: () => list() as Promise<unknown>,
    toggle: (id: string) => toggle(id) as Promise<unknown>,
    create: (body: unknown) => create(body) as Promise<unknown>,
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
  create.mockReset();
  useMcpStore.setState({ servers: undefined, error: undefined });
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

  it('reports a failed toggle and leaves the visible state unchanged', async () => {
    list.mockResolvedValue({ servers: [server(true)] });
    toggle.mockRejectedValue(new Error('toggle failed'));
    render(
      <MemoryRouter initialEntries={['/mcp']}>
        <Routes><Route path="/mcp" element={<McpPage />} /></Routes>
      </MemoryRouter>,
    );

    const enabledSwitch = await screen.findByRole('switch', { name: 'Microsoft Learn enabled' });
    await userEvent.click(enabledSwitch);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'toggle failed');
    expect(enabledSwitch).toHaveProperty('checked', true);
  });

  it('preserves spaces inside stdio arguments by treating one line as one argv item', async () => {
    list.mockResolvedValue({ servers: [] });
    create.mockResolvedValue({ server: server(true) });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/mcp/new']}>
        <Routes><Route path="/mcp/*" element={<McpPage />} /></Routes>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText('Name'), 'Local tools');
    await user.selectOptions(screen.getByLabelText('Transport'), 'stdio');
    await user.type(screen.getByLabelText('Command'), 'node');
    await user.type(screen.getByLabelText('Arguments (one per line)'), '--root\n/path with spaces');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--root', '/path with spaces'] }),
      ),
    );
  });
});
