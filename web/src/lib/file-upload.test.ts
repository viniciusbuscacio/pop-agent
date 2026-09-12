// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_UPLOAD_BYTES, uploadFileBatch } from './file-upload';

describe('uploadFileBatch', () => {
  it('continues after a failure, skips oversized files, and preserves destinations', async () => {
    const good = new File(['ok'], 'good.txt');
    const broken = new File(['no'], 'broken.txt');
    const oversized = new File(['large'], 'large.bin');
    Object.defineProperty(oversized, 'size', { value: MAX_FILE_UPLOAD_BYTES + 1 });
    const upload = vi.fn((file: File, _dir: string) =>
      file === broken ? Promise.reject(new Error('network')) : Promise.resolve(),
    );
    const progress = vi.fn();

    const result = await uploadFileBatch(
      [good, broken, oversized],
      (file) => `inbox/${file.name}`,
      upload,
      progress,
    );

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, good, 'inbox/good.txt', undefined);
    expect(upload).toHaveBeenNthCalledWith(2, broken, 'inbox/broken.txt', undefined);
    expect(result.cancelled).toBe(false);
    expect(result.failures).toEqual([
      { file: broken, destination: 'inbox/broken.txt', name: 'broken.txt', reason: 'failed' },
      { file: oversized, destination: 'inbox/large.bin', name: 'large.bin', reason: 'too-large' },
    ]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it('retries a transient failure exactly once', async () => {
    const file = new File(['ok'], 'retry.txt');
    const upload = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'server_unreachable', status: 0 }))
      .mockResolvedValueOnce(undefined);

    const result = await uploadFileBatch([file], () => 'inbox', upload, vi.fn());

    expect(upload).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ failures: [], cancelled: false });
  });

  it('aborts the active request and leaves remaining files untouched', async () => {
    const first = new File(['one'], 'one.txt');
    const second = new File(['two'], 'two.txt');
    const controller = new AbortController();
    const upload = vi.fn(async (_file: File, _dir: string, signal?: AbortSignal) => {
      controller.abort();
      signal?.throwIfAborted();
    });

    const result = await uploadFileBatch(
      [first, second],
      () => 'inbox',
      upload,
      vi.fn(),
      controller.signal,
    );

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ failures: [], cancelled: true });
  });
});
