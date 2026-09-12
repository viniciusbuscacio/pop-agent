import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FilesService } from '../../application/files/files-service.js';
import { buildFileLink } from '../../application/files/files-download.js';
import { createFilesDownloadRoutes } from './files-download-routes.js';
vi.mock('node:fs', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs')>();
    return { ...original, createReadStream: vi.fn(original.createReadStream) };
});
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pop-audit-files-'));
    const clock = { now: () => Date.now() }, secretKey = Buffer.alloc(32, 1);
    const files = new FilesService({ root, clock });
    const app = createFilesDownloadRoutes({ files, clock, secretKey });
    return { files, app, root, link: (name: string) => buildFileLink(secretKey, name, clock.now()).url };
}
it.each(['', '&inline=1'])('Unicode filenames support download and preview %s', async (suffix) => {
    const f = fixture();
    try {
        f.files.write('報告.txt', Buffer.from('hello'));
        const response = await f.app.request(f.link('報告.txt') + suffix);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''%E5%A0%B1%E5%91%8A.txt");
        expect(await response.text()).toBe('hello');
        await new Promise(r => setTimeout(r, 20));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
it('file downloads respect backpressure and cancel the disk stream', async () => {
    const f = fixture();
    try {
        f.files.write('large.bin', Buffer.alloc(2 * 1024 * 1024, 1));
        const response = await f.app.request(f.link('large.bin'));
        const stream = vi.mocked(createReadStream).mock.results.at(-1)!.value as ReturnType<typeof createReadStream>;
        await new Promise(r => setTimeout(r, 50));
        expect(response.bodyUsed).toBe(false);
        expect(stream.bytesRead).toBeGreaterThan(0);
        expect(stream.bytesRead).toBeLessThan(2 * 1024 * 1024);
        await response.body?.cancel();
        expect(stream.destroyed).toBe(true);
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
it('streams the complete binary file without truncation', async () => {
    const f = fixture();
    try {
        const bytes = Buffer.alloc(2 * 1024 * 1024);
        for (let index = 0; index < bytes.length; index++)
            bytes[index] = index % 251;
        f.files.write('complete.bin', bytes);
        const response = await f.app.request(f.link('complete.bin'));
        expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
