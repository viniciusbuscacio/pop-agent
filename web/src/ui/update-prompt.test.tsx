// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePrompt } from './update-prompt';
import { logUpdate } from '../services/update-diagnostics';

const { applyUpdate, startUpdateChecks } = vi.hoisted(() => ({
  applyUpdate: vi.fn(),
  startUpdateChecks: vi.fn(),
}));

vi.mock('../services/pwa-update', () => ({
  applyUpdate,
  checkForUpdateNow: vi.fn(),
  startUpdateChecks,
}));

describe('automatic PWA update prompt', () => {
  afterEach(cleanup);
  beforeEach(() => {
    applyUpdate.mockReset().mockResolvedValue(undefined);
    startUpdateChecks.mockReset();
  });

  it('applies a ready worker without asking for approval', async () => {
    applyUpdate.mockImplementation(() => new Promise(() => undefined));
    render(<UpdatePrompt />);
    const onNeedRefresh = startUpdateChecks.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(onNeedRefresh).toBeTypeOf('function');

    onNeedRefresh?.();

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledOnce());
    expect(screen.getByTestId('update-reloading')).toBeTruthy();
    expect(screen.queryByText('A new version is ready.')).toBeNull();
  });

  it('clears Updating when an attempt settles without page navigation', async () => {
    render(<UpdatePrompt />);
    const callback = startUpdateChecks.mock.calls[0]?.[0] as () => void;
    callback();
    await waitFor(() => expect(applyUpdate).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('update-prompt')).toBeNull());
    callback();
    await waitFor(() => expect(applyUpdate).toHaveBeenCalledTimes(2));
  });

  it('offers an explicit retry only after automatic activation fails', async () => {
    applyUpdate.mockRejectedValueOnce(new Error('activation failed')).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    const onNeedRefresh = startUpdateChecks.mock.calls[0]?.[0] as (() => void) | undefined;

    onNeedRefresh?.();
    expect(await screen.findByText('The app update could not be applied.')).toBeTruthy();
    logUpdate('activated', 'timeout');
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByTestId('update-copy-diagnostics'));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('"phase": "activated"'));
    await user.click(screen.getByTestId('update-reload'));

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledTimes(2));
  });
  it('offers selectable diagnostics when clipboard permission is denied', async () => {
    applyUpdate.mockRejectedValue(new Error('failed'));
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    render(<UpdatePrompt />);
    (startUpdateChecks.mock.calls[0]?.[0] as () => void)();
    await user.click(await screen.findByTestId('update-copy-diagnostics'));
    expect(await screen.findByLabelText('Update diagnostics — select and copy')).toHaveProperty('readOnly', true);
  });
});
