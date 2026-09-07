// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { A2aModulePage } from './a2a-module-page';
import { a2aModuleService } from '../services/a2a-module';
vi.mock('./a2a-page', () => ({ A2aOverview: () => <div>Remote agents</div> }));
vi.mock('../services/a2a-module', () => ({ a2aModuleService: {
  settings: vi.fn(async () => ({ serverEnabled: false, clientEnabled: false })),
  update: vi.fn(async patch => ({ serverEnabled: false, clientEnabled: false, ...patch })),
  accessKey: vi.fn(async () => ({ secret: 'popa_first' })),
  rotateAccessKey: vi.fn(async () => ({ secret: 'popa_second' })),
  allowedIps: vi.fn(async () => ({ entries: ['127.0.0.1/32'] })),
  setAllowedIps: vi.fn(async entries => ({ entries })),
  outboundIps: vi.fn(async () => ({ entries: [] })),
  setOutboundIps: vi.fn(async entries => ({ entries })),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('uses independent module switches and exposes no module delete action', async () => {
  render(<MemoryRouter><A2aModulePage /></MemoryRouter>);
  const server = await screen.findByRole('switch', { name: 'A2A Server' });
  expect(screen.getByRole('switch', { name: 'A2A Client' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  fireEvent.click(server);
  await waitFor(() => expect(a2aModuleService.update).toHaveBeenCalledWith({ serverEnabled: true }));
  expect((screen.getByRole('switch', { name: 'A2A Client' }) as HTMLInputElement).checked).toBe(false);
});
it('copies current A2A instructions and replaces only the A2A key', async () => {
  render(<MemoryRouter><A2aModulePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit A2A server' }));
  await waitFor(() => expect(screen.getByTestId('a2a-agent-instructions').textContent).toContain('Bearer popa_first'));
  expect(screen.getByTestId('a2a-agent-instructions').textContent).toContain('/a2a/rpc');
  expect(screen.getByTestId('a2a-agent-instructions').textContent).not.toContain('/integration/ui');
  fireEvent.click(screen.getByRole('button', { name: 'Generate new key' }));
  await waitFor(() => expect(screen.getByTestId('a2a-agent-instructions').textContent).toContain('Bearer popa_second'));
  expect(screen.getByText('127.0.0.1/32')).toBeTruthy();
});
it('cancels private-destination edits without writing and retains remote configuration', async () => {
  render(<MemoryRouter initialEntries={['/a2a?edit=client']}><A2aModulePage /></MemoryRouter>);
  const field = await screen.findByLabelText('Allowed private destinations');
  await waitFor(() => expect((field as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(field, { target: { value: '100.70.1.2/32' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((field as HTMLTextAreaElement).value).toBe('');
  expect(a2aModuleService.setOutboundIps).not.toHaveBeenCalled();
  expect(screen.getByText('Remote agents')).toBeTruthy();
});
