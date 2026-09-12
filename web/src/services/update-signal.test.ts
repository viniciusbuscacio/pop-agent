import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForAndApplyUpdate,
  refreshAppSoftware,
  setUpdateApplier,
  setUpdateChecker,
  type UpdateCheckResult,
} from './update-signal';
import { hardRefreshPage } from './hard-refresh';
vi.mock('./hard-refresh', () => ({ hardRefreshPage: vi.fn(async () => undefined) }));

afterEach(() => vi.unstubAllGlobals());

const check = vi.fn<() => Promise<UpdateCheckResult>>();
const apply = vi.fn<() => Promise<void>>();

beforeEach(() => {
  check.mockReset();
  apply.mockReset().mockResolvedValue(undefined);
  vi.mocked(hardRefreshPage).mockReset().mockResolvedValue(undefined);
  setUpdateChecker(check);
  setUpdateApplier(apply);
});

describe('manual device refresh', () => {
  it('lets the native updater restart without interrupting it with a web reload', async () => {
    const native = vi.fn().mockResolvedValue('restarting');
    vi.stubGlobal('window', { __popDesktopUpdate: native });
    expect(await refreshAppSoftware()).toBe('update-found');
    expect(native).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
    expect(hardRefreshPage).not.toHaveBeenCalled();
  });
  it('refreshes web assets after the native component is confirmed current', async () => {
    vi.stubGlobal('window', { __popDesktopUpdate: vi.fn().mockResolvedValue('current') });
    check.mockResolvedValue('unavailable');
    await refreshAppSoftware();
    expect(hardRefreshPage).toHaveBeenCalledOnce();
  });
  it('keeps the current page when native updating fails', async () => {
    vi.stubGlobal('window', { __popDesktopUpdate: vi.fn().mockRejectedValue(new Error('failed')) });
    await expect(refreshAppSoftware()).rejects.toThrow('failed');
    expect(hardRefreshPage).not.toHaveBeenCalled();
  });
  it('recovers a failed activation with one fresh-shell navigation', async () => {
    check.mockResolvedValue('update-found'); apply.mockRejectedValue(new Error('failed'));
    await refreshAppSoftware();
    expect(hardRefreshPage).toHaveBeenCalledOnce();
  });
  it('fetches the latest shell even when the worker reports no update', async () => {
    check.mockResolvedValue('up-to-date'); await refreshAppSoftware();
    expect(hardRefreshPage).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
  });
  it('surfaces failed fresh-shell recovery instead of retrying indefinitely', async () => {
    check.mockResolvedValue('update-found'); apply.mockRejectedValue(new Error('failed'));
    vi.mocked(hardRefreshPage).mockRejectedValueOnce(new Error('offline'));
    await expect(refreshAppSoftware()).rejects.toThrow('offline');
    expect(hardRefreshPage).toHaveBeenCalledOnce();
  });
  it('activates a newer PWA immediately', async () => {
    check.mockResolvedValue('update-found');

    await expect(checkForAndApplyUpdate()).resolves.toBe('update-found');

    expect(check).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each(['up-to-date', 'unavailable', 'error'] as const)(
    'does not reload for %s',
    async (result) => {
      check.mockResolvedValue(result);

      await expect(checkForAndApplyUpdate()).resolves.toBe(result);

      expect(apply).not.toHaveBeenCalled();
    },
  );
});
