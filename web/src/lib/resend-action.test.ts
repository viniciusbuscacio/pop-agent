// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { useResendAction } from './resend-action';
const source = { content: 'Hello', attachments: [{ name: 'photo.png', type: 'image/png', dataUri: 'data:image/png;base64,YQ==' }] };
describe('resend action', () => {
  it('reports uncertain delivery, unlocks retry and retains the original attachments', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('server_unreachable', 'Offline', 0)).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useResendAction('chat-a', send));
    await act(() => result.current.resend('message-a', source));
    expect(result.current.resendError).toContain('Could not confirm');
    expect(result.current.resendingId).toBeUndefined();
    await act(() => result.current.resend('message-a', source));
    expect(result.current.resendError).toBeUndefined();
    expect(send).toHaveBeenLastCalledWith('chat-a', 'Hello', source.attachments);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('shows a definite API rejection without swallowing its reason', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError('local_connection_unavailable', 'Selected computer is offline.', 409));
    const { result } = renderHook(() => useResendAction('chat-a', send));
    await act(() => result.current.resend('message-a', source));
    expect(result.current.resendError).toBe('Could not resend: Selected computer is offline.');
  });
  it('prevents two concurrent requests even before React rerenders', async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useResendAction('chat-a', send));
    let first!: Promise<void>;
    act(() => { first = result.current.resend('bubble', source); void result.current.resend('menu', source); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.resendingId).toBe('bubble');
    await act(async () => { finish(); await first; });
    expect(result.current.resendingId).toBeUndefined();
  });
  it('does not show a late failure in another conversation', async () => {
    let fail!: (reason: Error) => void;
    const send = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const { result, rerender } = renderHook(({ chatId }) => useResendAction(chatId, send), { initialProps: { chatId: 'chat-a' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.resend('message-a', source); });
    rerender({ chatId: 'chat-b' });
    await act(async () => { fail(new Error('Network')); await pending; });
    expect(result.current.resendError).toBeUndefined();
    expect(result.current.resendingId).toBeUndefined();
  });
});
