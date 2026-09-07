// @vitest-environment happy-dom
import { renderHook, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { A2aAgentDTO } from '@pop-agent/shared';
import { useAgentContextActions } from './agent-context-actions';
import { a2aService } from '../services/a2a';
import { useA2aStore } from '../store/a2a';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('does not send an A2A message until the user supplies one, and hides it for disabled agents',async()=>{
 const agent={id:'remote-1',name:'Remote',enabled:true} as A2aAgentDTO;
 const send=vi.spyOn(a2aService,'send').mockResolvedValue({} as Awaited<ReturnType<typeof a2aService.send>>);
 const load=vi.spyOn(useA2aStore.getState(),'loadTasks').mockResolvedValue();
 const prompt=vi.spyOn(window,'prompt').mockReturnValue(null);
 const {result}=renderHook(useAgentContextActions,{wrapper:MemoryRouter});
 expect(result.current.a2a({...agent,enabled:false}).some(a=>a.id==='conversation')).toBe(false);
 const action=result.current.a2a(agent).find(a=>a.id==='conversation')!;
 expect(send).not.toHaveBeenCalled();await action.run();expect(send).not.toHaveBeenCalled();
 prompt.mockReturnValue('  Hello  ');await action.run();expect(send).toHaveBeenCalledExactlyOnceWith('remote-1','Hello');expect(load).toHaveBeenCalledWith('remote-1');
});
