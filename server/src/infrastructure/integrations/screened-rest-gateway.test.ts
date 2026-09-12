import {it,expect,vi,afterEach} from 'vitest';
import {ScreenedRestGateway} from './screened-rest-gateway.js';
vi.mock('../a2a/screened-fetch.js',()=>({createScreenedA2aFetch:()=>()=>new Promise(()=>{})}));
afterEach(()=>vi.useRealTimers());
it('bounds a stalled DNS/transport promise instead of waiting indefinitely',async()=>{
  vi.useFakeTimers();const pending=new ScreenedRestGateway().call({url:'https://example.com',method:'GET'});
  const assertion=expect(pending).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(30000);await assertion;expect(vi.getTimerCount()).toBe(0);
});
it('honors cancellation before starting network work',async()=>{
  const controller=new AbortController();controller.abort();await expect(new ScreenedRestGateway().call({url:'https://example.com',method:'GET',signal:controller.signal})).rejects.toThrow();
});
