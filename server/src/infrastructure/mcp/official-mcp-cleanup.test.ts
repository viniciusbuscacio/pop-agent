import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { McpServer } from '../../application/ports/mcp-repo.js';
import { OfficialMcpClientFactory } from './official-mcp-client.js';
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});
function configured(patch: Partial<McpServer> = {}): McpServer {
    const cwd = mkdtempSync(join(tmpdir(), 'pop-official-mcp-'));
    roots.push(cwd);
    return {
        id: 'mcp-test', name: 'test', description: '', transport: 'streamable-http',
        endpoint: '', command: '', args: [], authKind: 'none', authHeader: '', enabled: true,
        timeoutMs: 2000, status: 'unknown', lastError: '', cwd, createdAt: 'T', updatedAt: 'T',
        ...patch,
    };
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk as Uint8Array));
    const text = Buffer.concat(chunks).toString();
    return text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>;
}
function json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
}
async function httpFixture(handler: (request: IncomingMessage, response: ServerResponse, message: Record<string, unknown>) => void): Promise<{
    url: string;
    close(): Promise<void>;
}> {
    const server = createServer((request, response) => {
        void body(request).then((message) => handler(request, response, message));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
        throw new Error('no test address');
    return {
        url: `http://127.0.0.1:${String(address.port)}/mcp`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}
function result(message: Record<string, unknown>, value: unknown) {
    return { jsonrpc: '2.0', id: message['id'], result: value };
}
it('legacy MCP cleanup aborts an unresponsive session DELETE', async () => {
    let deleteSeen = false;
    const fixture = await httpFixture((request, response, message) => {
        if (request.method === 'DELETE') {
            deleteSeen = true;
            return;
        }
        if (request.method === 'GET') {
            response.writeHead(405).end();
            return;
        }
        if (message['method'] === 'server/discover')
            json(response, 400, { jsonrpc: '2.0', id: message['id'], error: { code: -32601, message: 'missing' } });
        else if (message['method'] === 'initialize') {
            response.setHeader('mcp-session-id', 'audit-session');
            json(response, 200, result(message, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'audit', version: '1' } }));
        }
        else if (message['method'] === 'notifications/initialized')
            response.writeHead(202).end();
        else
            json(response, 200, result(message, { tools: [] }));
    });
    let connection: Awaited<ReturnType<OfficialMcpClientFactory['connect']>> | undefined;
    let cleanup: Promise<void> | undefined;
    try {
        connection = await new OfficialMcpClientFactory().connect(configured({ endpoint: fixture.url, timeoutMs: 100 }), undefined);
        cleanup = connection.close();
        const state = await Promise.race([cleanup.then(() => 'closed'), new Promise<string>(r => setTimeout(() => r('still-pending'), 600))]);
        expect(deleteSeen).toBe(true);
        expect(state).toBe('closed');
    }
    finally {
        await fixture.close();
        await cleanup?.catch(() => undefined);
    }
});
