// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { RestApiPage } from './rest-api-page';
import { integrationsService } from '../services/integrations';
vi.mock('../services/integrations', () => ({ integrationsService: { list: vi.fn(async () => ({ tokens: [] })), clients: vi.fn(async () => ({ clients: [] })), reference: vi.fn(async () => ({ endpoints: [], openapi: {} })), create: vi.fn(async () => ({ secret: 'popi_test_once', token: {} })), saveClient: vi.fn(async () => ({ client: {} })), test: vi.fn(async () => ({ ok: true })) } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('REST API page', () => {
    it('shows Server and Clients on the same page and defaults to observation only', async () => {
        render(<MemoryRouter><RestApiPage /></MemoryRouter>);
        expect(screen.getByRole('heading', { name: 'Server' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Clients' })).toBeTruthy();
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
        fireEvent.click(screen.getByRole('button', { name: 'New client' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(integrationsService.saveClient).not.toHaveBeenCalled();
        await waitFor(() => expect(integrationsService.clients).toHaveBeenCalled());
    });
});
