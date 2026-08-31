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

    const failures = await uploadFileBatch(
      [good, broken, oversized],
      (file) => `inbox/${file.name}`,
      upload,
      progress,
    );

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, good, 'inbox/good.txt');
    expect(upload).toHaveBeenNthCalledWith(2, broken, 'inbox/broken.txt');
    expect(failures).toEqual([
      { name: 'broken.txt', reason: 'failed' },
      { name: 'large.bin', reason: 'too-large' },
    ]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });
});
