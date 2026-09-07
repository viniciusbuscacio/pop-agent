// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RestServerPanel } from './rest-server-panel';
import { integrationsService } from '../services/integrations';
vi.mock('../services/integrations', () => ({ integrationsService: { allowedIps: vi.fn(async () => ({ entries: ['127.0.0.1/32'] })), setAllowedIps: vi.fn(async entries => ({ entries })),
  accessKey: vi.fn(), rotateAccessKey: vi.fn(), reference: vi.fn(async () => ({ endpoints: [], openapi: {} })),
} }));
const copy = vi.fn(async () => undefined);
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  vi.mocked(integrationsService.accessKey).mockResolvedValue({ secret: 'popi_saved_key' });
  vi.mocked(integrationsService.rotateAccessKey).mockResolvedValue({ secret: 'popi_new_key' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('loads the saved key after reopening and copies complete instructions with no token list', async () => {
  const page = render(<RestServerPanel enabled onToggle={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('rest-agent-instructions').textContent).toContain('Bearer popi_saved_key'));
  fireEvent.click(screen.getByTestId('rest-copy-instructions'));
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('Bearer popi_saved_key'));
  expect(screen.queryByText('API tokens')).toBeNull();
  expect(screen.queryByText('API reference and examples')).toBeNull();
  expect(screen.queryByText('Connection port')).toBeNull();
  expect(screen.queryByText('HTTPS', {exact:true})).toBeNull();
  expect(screen.getByRole('button', {name:'Download OpenAPI'})).toBeTruthy();
  expect(screen.getByTestId('rest-agent-instructions').hasAttribute('data-ui-private')).toBe(true);
  page.unmount(); render(<RestServerPanel enabled onToggle={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('rest-agent-instructions').textContent).toContain('Bearer popi_saved_key'));
  expect(integrationsService.rotateAccessKey).not.toHaveBeenCalled();
});
it('replaces the key and immediately copies the new instructions', async () => {
  render(<RestServerPanel enabled onToggle={() => undefined} />);
  await screen.findByRole('button', { name: 'Generate new key' });
  fireEvent.click(screen.getByTestId('rest-rotate-key'));
  await waitFor(() => expect(screen.getByTestId('rest-agent-instructions').textContent).toContain('Bearer popi_new_key'));
  fireEvent.click(screen.getByTestId('rest-copy-instructions'));
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('Bearer popi_new_key'));
  expect(copy).not.toHaveBeenCalledWith(expect.stringContaining('popi_saved_key'));
});
it('reads back after a lost rotation response without rotating twice', async () => {
  vi.mocked(integrationsService.rotateAccessKey).mockRejectedValueOnce(new Error('connection lost'));
  vi.mocked(integrationsService.accessKey).mockResolvedValueOnce({ secret: 'popi_old' }).mockResolvedValue({ secret: 'popi_committed' });
  render(<RestServerPanel enabled onToggle={() => undefined} />);
  await screen.findByRole('button', { name: 'Generate new key' });
  fireEvent.click(screen.getByTestId('rest-rotate-key'));
  await waitFor(() => expect(screen.getByTestId('rest-agent-instructions').textContent).toContain('Bearer popi_committed'));
  expect(integrationsService.rotateAccessKey).toHaveBeenCalledOnce();
  expect(await screen.findByRole('alert')).toBeTruthy();
});
