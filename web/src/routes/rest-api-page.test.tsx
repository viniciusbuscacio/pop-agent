import userEvent from '@testing-library/user-event';
// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { RestApiPage } from './rest-api-page';
import { integrationsService } from '../services/integrations';
vi.mock('./shell-header', () => ({ ShellFooter: () => <div>Settings navigation</div> }));
vi.mock('../services/integrations', () => ({ integrationsService: { settings: vi.fn(async () => ({ serverEnabled: true, clientEnabled: true })), updateSettings: vi.fn(async (patch) => ({ serverEnabled: true, clientEnabled: true, ...patch })), list: vi.fn(async () => ({ tokens: [] })), clients: vi.fn(async () => ({ clients: [] })), reference: vi.fn(async () => ({ endpoints: [], openapi: {} })), create: vi.fn(async () => ({ secret: 'popi_test_once', token: {} })), saveClient: vi.fn(async () => ({ client: {} })), test: vi.fn(async () => ({ ok: true })) } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('REST API page', () => {
    it('keeps the overview simple and defaults new server tokens to observation only', async () => {
        render(<MemoryRouter><RestApiPage /></MemoryRouter>);
        await screen.findByRole('switch', { name: 'REST API Server' });
        expect(screen.getByRole('switch', { name: 'REST API Client' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New token' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(integrationsService.list).not.toHaveBeenCalled();
        expect(integrationsService.clients).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Edit REST API Server' }));
        fireEvent.click(screen.getByRole('button', { name: 'New token' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Observer' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
        await waitFor(() => expect(integrationsService.create).toHaveBeenCalledWith('Observer', ['activity:read'], 30));
        expect(await screen.findByText('popi_test_once')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByText('popi_test_once')).toBeNull();
    });
    it('does not save client configuration when Cancel is selected', async () => {
        render(<MemoryRouter><RestApiPage /></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit REST API Client' }));
        fireEvent.click(screen.getByRole('button', { name: 'New client' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(integrationsService.saveClient).not.toHaveBeenCalled();
        await waitFor(() => expect(integrationsService.clients).toHaveBeenCalled());
    });
});

it('persists a switch without changing the other module and retains the confirmed state on failure', async () => {
  render(<MemoryRouter><RestApiPage /></MemoryRouter>);
  const server = await screen.findByRole('switch', { name: 'REST API Server' });
  fireEvent.click(server);
  await waitFor(() => expect((server as HTMLInputElement).checked).toBe(false));
  expect(integrationsService.updateSettings).toHaveBeenCalledWith({ serverEnabled: false });
  expect((screen.getByRole('switch', { name: 'REST API Client' }) as HTMLInputElement).checked).toBe(true);
  vi.mocked(integrationsService.updateSettings).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(server);
  await screen.findByRole('alert');
  expect((server as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Edit REST API Server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect((screen.getByRole('switch', { name: 'REST API Server' }) as HTMLInputElement).checked).toBe(false);
});

it('offers retry instead of editable controls when settings fail to load', async () => {
  vi.mocked(integrationsService.settings).mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter><RestApiPage /></MemoryRouter>);
  await screen.findByRole('alert');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('switch', { name: 'REST API Server' });
});

it('adding/removing operations and cancelling a valid client never submits the form', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><RestApiPage /></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: 'Edit REST API Client' }));
  await user.click(screen.getByRole('button', { name: 'New client' }));
  await user.type(screen.getByLabelText('Name'), 'Valid draft');
  await user.type(screen.getByLabelText('Base URL (HTTPS)'), 'https://example.invalid');
  await user.click(screen.getByRole('button', { name: 'Add operation' }));
  expect(screen.getAllByLabelText('Operation ID')).toHaveLength(2);
  expect(integrationsService.saveClient).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole('button', { name: 'Remove operation' })[1]!);
  expect(screen.getAllByLabelText('Operation ID')).toHaveLength(1);
  expect(integrationsService.saveClient).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(integrationsService.saveClient).not.toHaveBeenCalled();
});

it('starts and stops the server from its editor without changing the client switch', async () => {
  render(<MemoryRouter initialEntries={['/rest-api?edit=server']}><RestApiPage /></MemoryRouter>);
  const stop = await screen.findByTestId('rest-server-power');
  expect(stop.textContent).toBe('Stop');
  fireEvent.click(stop);
  await waitFor(() => expect(stop.textContent).toBe('Start'));
  expect(integrationsService.updateSettings).toHaveBeenLastCalledWith({ serverEnabled: false });
  expect((screen.getByTestId('ui-connect') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(stop);
  await waitFor(() => expect(stop.textContent).toBe('Stop'));
  expect(integrationsService.updateSettings).toHaveBeenLastCalledWith({ serverEnabled: true });
});
