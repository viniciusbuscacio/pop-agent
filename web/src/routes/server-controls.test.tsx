// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerControls } from './settings-page';
import { serverService } from '../services/server';
vi.mock('../services/pwa-update', () => ({ applyUpdate: vi.fn(), checkForUpdateNow: vi.fn() }));
vi.mock('../services/server', () => ({ serverService: {
  llmStop: vi.fn(), llmStart: vi.fn(), restart: vi.fn(), stop: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Server controls', () => {
  it('pauses and resumes responses only after successful requests', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(serverService.llmStop).mockResolvedValue({ ok: true, interrupted: 1 });
    vi.mocked(serverService.llmStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ServerControls llmStopped={false} />);
    await user.click(screen.getByRole('button', { name: 'Pause responses' }));
    await user.click(await screen.findByRole('button', { name: 'Resume responses' }));
    expect(await screen.findByText('Responses are enabled.')).toBeTruthy();
    expect(serverService.stop).not.toHaveBeenCalled();
    expect(serverService.restart).not.toHaveBeenCalled();
  });
  it('retains the state and reports failures instead of pretending the model stopped', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(serverService.llmStop).mockRejectedValue(new Error('offline'));
    render(<ServerControls llmStopped={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause responses' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume responses' })).toBeNull();
  });
  it('keeps shutdown collapsed and respects cancellation of broad actions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ServerControls llmStopped={false} />);
    expect(screen.getByText('Shut down server…').closest('details')?.open).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Reset AI sessions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restart Pop Agent' }));
    expect(serverService.llmStart).not.toHaveBeenCalled();
    expect(serverService.restart).not.toHaveBeenCalled();
  });
  it('requires both shutdown confirmations', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
    render(<ServerControls llmStopped={false} />);
    await userEvent.click(screen.getByText('Shut down server…'));
    await userEvent.click(screen.getByTestId('server-stop'));
    expect(serverService.stop).not.toHaveBeenCalled();
  });
  it('does not guess response state before server information is available', () => {
    render(<ServerControls llmStopped={undefined} />);
    expect((screen.getByTestId('server-llm-stop') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('server-llm-start') as HTMLButtonElement).disabled).toBe(true);
  });
});
