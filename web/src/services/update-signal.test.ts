import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForAndApplyUpdate,
  setUpdateApplier,
  setUpdateChecker,
  type UpdateCheckResult,
} from './update-signal';

const check = vi.fn<() => Promise<UpdateCheckResult>>();
const apply = vi.fn<() => Promise<void>>();

beforeEach(() => {
  check.mockReset();
  apply.mockReset().mockResolvedValue(undefined);
  setUpdateChecker(check);
  setUpdateApplier(apply);
});

describe('manual device refresh', () => {
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
