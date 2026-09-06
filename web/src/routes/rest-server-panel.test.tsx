// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IntegrationTokenDTO } from '@pop-agent/shared';
import { RestServerPanel } from './rest-server-panel';
import { integrationsService } from '../services/integrations';
vi.mock('../services/integrations', () => ({ integrationsService: {
  list: vi.fn(), reference: vi.fn(async () => ({ endpoints: [], openapi: {} })), revoke: vi.fn(async () => ({ ok: true })),
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const token = (index: number): IntegrationTokenDTO => ({ id: String(index), name: 'Token ' + index, scopes: ['activity:read'], createdAt: Date.now(), expiresAt: Date.now() + 60000, lastUsedAt: null, revokedAt: null });
function expand(summary: HTMLElement, open = true) {
  const details = summary.closest('details')!;
  details.open = open;
  fireEvent(details, new Event('toggle'));
}
it('starts collapsed, excludes inactive tokens, and renders only ten rows at a time', async () => {
  vi.mocked(integrationsService.list).mockResolvedValue({ tokens: [...Array.from({ length: 11 }, (_, i) => token(i)), { ...token(20), revokedAt: Date.now() }, { ...token(21), expiresAt: Date.now() }] });
  render(<RestServerPanel />);
  const summary = await screen.findByText('11 active tokens');
  expect(screen.queryByText('Token 0')).toBeNull();
  expand(summary);
  const table = screen.getByRole('table', { name: 'Active integration tokens' });
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  expect(screen.queryByText('Token 10')).toBeNull();
  expect(screen.queryByText('Token 20')).toBeNull();
  expect(screen.queryByText('Token 21')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(screen.getByText('Token 10')).toBeTruthy();
  expect(screen.queryByText('Token 0')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(screen.getByText('Token 0')).toBeTruthy();
  expand(summary, false);
  expect(screen.queryByText('Token 0')).toBeNull();
});
it('clamps the last page after revocation and refreshes the active count', async () => {
  const tokens = Array.from({ length: 11 }, (_, i) => token(i));
  vi.mocked(integrationsService.list).mockResolvedValueOnce({ tokens }).mockResolvedValue({ tokens: tokens.slice(0, 10) });
  render(<RestServerPanel />);
  expand(await screen.findByText('11 active tokens'));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await screen.findByText('10 active tokens');
  expect(integrationsService.revoke).toHaveBeenCalledWith('10');
  expect(screen.queryByText('Token 10')).toBeNull();
  expect(screen.getByText('Token 0')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});
it('removes a token that expires while the section is open', async () => {
  vi.useFakeTimers();
  vi.mocked(integrationsService.list).mockResolvedValue({ tokens: [{ ...token(1), expiresAt: Date.now() + 2000 }] });
  await act(async () => { render(<RestServerPanel />); });
  expand(screen.getByText('1 active token'));
  expect(screen.getByText('Token 1')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
  expect(screen.getByText('0 active tokens')).toBeTruthy();
  expect(screen.queryByText('Token 1')).toBeNull();
});
