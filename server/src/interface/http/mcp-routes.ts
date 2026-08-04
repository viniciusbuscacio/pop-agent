import { Hono } from 'hono';
import { z } from 'zod';
import type { McpServerDTO, McpCapabilityDTO } from '@popy/shared';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';
import { McpService } from '../../application/mcp/mcp-service.js';
import type { McpCapability, McpServer } from '../../application/ports/mcp-repo.js';

const schema=z.object({name:z.string().min(1).max(120),description:z.string().max(500).default(''),transport:z.enum(['stdio','sse','streamable-http']),endpoint:z.string().max(2000).default(''),command:z.string().max(500).default(''),args:z.array(z.string().max(500)).max(50).default([]),authKind:z.enum(['none','bearer','api-key','custom-header']).default('none'),authHeader:z.string().max(200).default(''),env:z.record(z.string(),z.string().max(4000)).optional(),enabled:z.boolean().default(true),timeoutMs:z.number().int().min(1000).max(300000).default(60000)}).strict();
export function createMcpRoutes(service:McpService):Hono { const r=new Hono();
 r.get('/mcp/servers',(c)=>c.json({servers:service.list().map(toDto)}));
 r.post('/mcp/servers',async(c)=>{const body=await readJson(c);if(body===undefined)return badBody(c);const p=schema.safeParse(body);if(!p.success)return schemaError(c,p.error);const s=service.create(p.data);return c.json({server:toDto({...s,capabilities:[]})},201);});
 r.put('/mcp/servers/:id',async(c)=>{const body=await readJson(c);if(body===undefined)return badBody(c);const p=schema.partial().safeParse(body);if(!p.success)return schemaError(c,p.error);const s=service.update(c.req.param('id'),p.data);return s===undefined?apiError(c,404,'not_found','No such MCP server.'):c.json({server:toDto({...s,capabilities:service.get(s.id)?.capabilities??[]})});});
 r.delete('/mcp/servers/:id',(c)=>service.delete(c.req.param('id'))?c.body(null,204):apiError(c,404,'not_found','No such MCP server.'));
 r.post('/mcp/servers/:id/test',async(c)=>{try{const result=await service.test(c.req.param('id'));return c.json({server:toDto({...result.server,capabilities:result.capabilities}),capabilities:result.capabilities.map(capabilityDto)});}catch(e){return apiError(c,502,'mcp_unavailable',e instanceof Error?e.message:'MCP connection failed');}});
 r.post('/mcp/servers/:id/toggle',async(c)=>{const s=service.get(c.req.param('id'));if(s===undefined)return apiError(c,404,'not_found','No such MCP server.');const next=service.update(s.id,{enabled:!s.enabled});return c.json({server:toDto({...next!,capabilities:s.capabilities})});});
 return r; }
function capabilityDto(c:McpCapability):McpCapabilityDTO{return {id:c.id,kind:c.kind,name:c.name,description:c.description,...(Object.keys(c.inputSchema).length===0?{}:{inputSchema:c.inputSchema}),...(Object.keys(c.metadata).length===0?{}:{metadata:c.metadata})};}
function toDto(s:McpServer&{capabilities:McpCapability[]}):McpServerDTO{return {id:s.id,name:s.name,description:s.description,transport:s.transport,endpoint:s.endpoint,command:s.command,args:s.args,authKind:s.authKind,authHeader:s.authHeader,enabled:s.enabled,timeoutMs:s.timeoutMs,status:s.status,lastError:s.lastError,...(s.lastConnectedAt===undefined?{}:{lastConnectedAt:s.lastConnectedAt}),cwd:s.cwd,capabilities:s.capabilities.map(capabilityDto)};}
