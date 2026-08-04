import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entityId } from '../../domain/ids.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { McpCapability, McpRepo, McpServer } from '../ports/mcp-repo.js';

export class McpService {
  constructor(private readonly deps: { repo: McpRepo; secrets: SecretsRepo; dataDir: string }) {}
  list(): Array<McpServer & { capabilities: McpCapability[] }> { return this.deps.repo.list().map((s) => ({ ...s, capabilities: this.deps.repo.capabilities(s.id) })); }
  get(id:string): (McpServer & { capabilities:McpCapability[] })|undefined { const s=this.deps.repo.get(id); return s===undefined?undefined:{...s,capabilities:this.deps.repo.capabilities(id)}; }
  create(input: Omit<McpServer,'id'|'createdAt'|'updatedAt'|'status'|'lastError'|'cwd'> & { env?: Record<string,string> | undefined }): McpServer {
    const now=new Date().toISOString(); const id=entityId('mcp'); const cwd=join(this.deps.dataDir,'mcp',id); mkdirSync(cwd,{recursive:true});
    const { env, ...fields } = input;
    const server: McpServer={...fields,id,cwd,status:'unknown',lastError:'',createdAt:now,updatedAt:now};
    this.deps.repo.create(server); this.saveSecrets(id,env); return server;
  }
  update(id:string, patch:{ [K in keyof McpServer]?: McpServer[K] | undefined } & {env?:Record<string,string>|undefined}): McpServer|undefined { if(patch.env!==undefined)this.saveSecrets(id,patch.env); const rest={...patch}; delete (rest as {env?:Record<string,string>}).env; return this.deps.repo.update(id,rest); }
  delete(id:string):boolean { this.deps.secrets.delete(secretKey(id)); return this.deps.repo.delete(id); }
  async test(id:string):Promise<{server:McpServer;capabilities:McpCapability[]}> { const server=this.deps.repo.get(id); if(server===undefined) throw new Error('No such MCP server.'); try { const client=new SimpleMcpClient(server,this.deps.secrets.get(secretKey(id)),this.deps.dataDir); await client.initialize(); const capabilities=await client.capabilities(); this.deps.repo.replaceCapabilities(id,capabilities); const updated=this.deps.repo.update(id,{status:'connected',lastError:'',lastConnectedAt:new Date().toISOString()})!; await client.close(); return {server:updated,capabilities}; } catch(error) { const message=error instanceof Error?error.message:'MCP connection failed'; const updated=this.deps.repo.update(id,{status:'error',lastError:message})!; throw Object.assign(new Error(message),{server:updated}); } }
  secret(id:string):string|undefined { return this.deps.secrets.get(secretKey(id)); }
  async callTool(serverId:string, name:string, args:Record<string,unknown>):Promise<string> { const server=this.deps.repo.get(serverId); if(server===undefined||!server.enabled)throw new Error('MCP server is disabled or missing.'); const client=new SimpleMcpClient(server,this.deps.secrets.get(secretKey(serverId)),this.deps.dataDir); try { await client.initialize(); const result=await client.callTool(name,args); return JSON.stringify(result); } finally { await client.close(); } }
  private saveSecrets(id:string, env:Record<string,string>|undefined):void { if(env!==undefined)this.deps.secrets.set(secretKey(id),JSON.stringify(env)); }
  static secretKey(id:string):string { return secretKey(id); }
}
function secretKey(id:string):string{return `mcp:${id}:env`;}

class SimpleMcpClient {
  constructor(private readonly server:McpServer, private readonly envJson:string|undefined, private readonly dataDir:string) {}
  private id=0; private child: import('node:child_process').ChildProcessWithoutNullStreams|undefined;
  async initialize():Promise<void>{ const result=await this.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'popy',version:'0.2.0'}}); if(result===undefined)throw new Error('MCP initialize returned no result'); }
  async callTool(name:string,args:Record<string,unknown>):Promise<unknown>{ return this.request('tools/call',{name,arguments:args}); }
  async capabilities():Promise<McpCapability[]>{ const result=await this.request('tools/list',{}); const raw=(result as {tools?:unknown[]}|undefined)?.tools??[]; return raw.filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object').map((x)=>({id:entityId('mcp-capability'),serverId:this.server.id,kind:'tool',name:String(x['name']??''),description:String(x['description']??''),inputSchema:(x['inputSchema'] as Record<string,unknown>)??{},metadata:{},updatedAt:new Date().toISOString()})); }
  async close():Promise<void>{ if(this.child!==undefined){this.child.kill('SIGTERM');this.child=undefined;} }
  private async request(method:string,params:Record<string,unknown>):Promise<unknown>{ if(this.server.transport==='stdio')return this.stdio(method,params); const headers=new Headers({'content-type':'application/json','accept':'application/json, text/event-stream'}); const secret=this.envJson; if(secret!==undefined){ try { const parsed=JSON.parse(secret) as Record<string,string>; const value=parsed['token']??parsed['value']??Object.values(parsed)[0]; if(value!==undefined) headers.set(this.server.authHeader|| (this.server.authKind==='bearer'?'authorization':'x-api-key'),this.server.authKind==='bearer'?`Bearer ${value}`:value); } catch { /* malformed secret is ignored */ } } const response=await fetch(this.server.endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++this.id,method,params}),signal:AbortSignal.timeout(this.server.timeoutMs)}); if(!response.ok)throw new Error(`MCP HTTP ${response.status}`); const text=await response.text(); const line=text.split('\n').find((l)=>l.startsWith('data:'))?.slice(5).trim()??text; const parsed=JSON.parse(line) as {result?:unknown;error?:{message?:string}}; if(parsed.error)throw new Error(parsed.error.message??'MCP error'); return parsed.result; }
  private async stdio(method:string,params:Record<string,unknown>):Promise<unknown>{ if(this.child===undefined){ const {spawn}=await import('node:child_process'); const env={...process.env,...parseEnv(this.envJson)}; this.child=spawn(this.server.command,this.server.args,{cwd:this.server.cwd,env,stdio:['pipe','pipe','pipe']}); } const child=this.child; return new Promise((resolve,reject)=>{ const id=++this.id; const timer=setTimeout(()=>reject(new Error('MCP timeout')),this.server.timeoutMs); const onData=(chunk:Buffer):void=>{ for(const line of chunk.toString().split('\n')){ if(!line.trim())continue; try{const msg=JSON.parse(line) as {id?:number;result?:unknown;error?:{message?:string}}; if(msg.id!==id)continue; clearTimeout(timer); child.stdout.off('data',onData); if(msg.error)reject(new Error(msg.error.message??'MCP error')); else resolve(msg.result); }catch { /* non-JSON stdout is ignored until a complete message arrives */ } } }; child.stdout.on('data',onData); child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); }); }
}
function parseEnv(value:string|undefined):Record<string,string>{if(value===undefined)return{};try{const x=JSON.parse(value) as unknown;return x&&typeof x==='object'?x as Record<string,string>:{};}catch{return{};}}
