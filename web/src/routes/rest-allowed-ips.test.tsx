// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RestAllowedIps } from './rest-allowed-ips';
import { integrationsService } from '../services/integrations';
vi.mock('../services/integrations',()=>({integrationsService:{allowedIps:vi.fn(async()=>({entries:['127.0.0.1']})),setAllowedIps:vi.fn(async entries=>({entries}))}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('adds with Enter, removes an entry and keeps the final entry',async()=>{
  render(<RestAllowedIps/>);await screen.findByText('127.0.0.1');
  expect((screen.getByRole('button',{name:'Remove 127.0.0.1'}) as HTMLButtonElement).disabled).toBe(true);
  const input=screen.getByLabelText('IP address or CIDR');fireEvent.change(input,{target:{value:'100.64.0.0/10'}});fireEvent.submit(input.closest('form')!);
  await screen.findByText('100.64.0.0/10');expect(integrationsService.setAllowedIps).toHaveBeenCalledWith(['127.0.0.1','100.64.0.0/10']);
  fireEvent.click(screen.getByRole('button',{name:'Remove 127.0.0.1'}));await waitFor(()=>expect(screen.queryByText('127.0.0.1')).toBeNull());
  expect((screen.getByRole('button',{name:'Remove 100.64.0.0/10'}) as HTMLButtonElement).disabled).toBe(true);
});
it('preserves the list and draft after a rejected entry',async()=>{
  vi.mocked(integrationsService.setAllowedIps).mockRejectedValueOnce(new Error('invalid'));
  render(<RestAllowedIps/>);await screen.findByText('127.0.0.1');
  const input=screen.getByLabelText('IP address or CIDR');fireEvent.change(input,{target:{value:'bad'}});fireEvent.click(screen.getByRole('button',{name:'Add'}));
  await screen.findByRole('alert');expect(screen.getByText('127.0.0.1')).toBeTruthy();expect((input as HTMLInputElement).value).toBe('bad');
});
