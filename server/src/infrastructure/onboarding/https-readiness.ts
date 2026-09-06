import { get } from 'node:https';

export function probeTailnetHttps(origin: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(origin);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.username !== ''
      || url.password !== '' || url.port !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return Promise.resolve(false);
  } catch { return Promise.resolve(false); }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    // Native TLS validation remains enabled. No redirects, cookies or credentials.
    const request = get(new URL('/healthz', url), (response) => {
      let body = '';
      response.on('data', (bytes: Buffer) => {
        body += bytes.toString('utf8');
        if (body.length > 1024) { finish(false); response.destroy(); }
      });
      response.on('error', () => finish(false));
      response.on('end', () => {
        try { finish(response.statusCode === 200 && (JSON.parse(body) as { ok?: unknown }).ok === true); }
        catch { finish(false); }
      });
    });
    const timer = setTimeout(() => { finish(false); request.destroy(); }, 5_000);
    request.on('error', () => finish(false));
  });
}

export async function waitForTailnetHttps(origin: string,
  probe = probeTailnetHttps,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1_000)),
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await probe(origin)) return true;
    if (attempt < 9) await pause();
  }
  return false;
}
