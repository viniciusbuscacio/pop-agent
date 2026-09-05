import type { RestGateway } from '../../application/ports/rest-gateway.js';
import { createScreenedA2aFetch } from '../a2a/screened-fetch.js';
export class ScreenedRestGateway implements RestGateway {
  async call(input: Parameters<RestGateway['call']>[0]): ReturnType<RestGateway['call']> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 30000);
    const signal = AbortSignal.any([deadline.signal, ...(input.signal ? [input.signal] : [])]);
    let rejectAbort: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error('REST request cancelled or timed out.'));
        signal.addEventListener('abort', rejectAbort, {once:true});
      });
      const transport = createScreenedA2aFetch({timeoutMs:30000,allowedCredentialOrigin:new URL(input.url).origin,...(input.credential?{credentialHeader:input.credential}:{}),operationSignal:()=>signal});
      const operation = async (): Promise<{status:number;body:string}> => {
        const response = await transport(input.url,{method:input.method,signal,headers:{accept:'application/json','content-type':'application/json'},...(input.body===undefined?{}:{body:input.body})});
        return {status:response.status,body:(await response.text()).slice(0,64000)};
      };
      return await Promise.race([operation(),aborted]);
    } finally {
      clearTimeout(timer);
      if(rejectAbort)signal.removeEventListener('abort',rejectAbort);
    }
  }
}
