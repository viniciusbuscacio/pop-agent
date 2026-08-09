// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './chat-message';

afterEach(cleanup);

const base = { role: 'system' as const, content: '', thinking: '', tools: [], attachments: [] };

describe('provider fallback notices', () => {
  it('shows both model pairs and opens model selection', async () => {
    const changeModel = vi.fn();
    render(
      <ChatMessage
        message={{
          ...base,
          notice: {
            kind: 'model-fallback',
            failed: {
              providerId: 'openai',
              modelId: 'gpt-5',
              code: 'provider_error',
              status: 429,
            },
            fallback: { providerId: 'anthropic', modelId: 'claude-sonnet' },
          },
        }}
        onChangeModel={changeModel}
      />,
    );

    expect(screen.getByTestId('message-fallback').textContent).toContain('openai · gpt-5 failed');
    expect(screen.getByTestId('message-fallback').textContent).toContain(
      'Switched this answer to anthropic · claude-sonnet',
    );
    await userEvent.click(screen.getByTestId('message-change-model'));
    expect(changeModel).toHaveBeenCalledOnce();
  });

  it('offers retry and model selection after the final provider fails', async () => {
    const resend = vi.fn();
    const changeModel = vi.fn();
    render(
      <ChatMessage
        message={{
          ...base,
          notice: {
            kind: 'run-failure',
            failed: { providerId: 'anthropic', modelId: 'claude-sonnet', code: 'network_error' },
          },
        }}
        onResend={resend}
        onChangeModel={changeModel}
      />,
    );

    expect(screen.getByTestId('message-failure').textContent).toContain('could not answer');
    await userEvent.click(screen.getByTestId('message-resend'));
    await userEvent.click(screen.getByTestId('message-change-model'));
    expect(resend).toHaveBeenCalledOnce();
    expect(changeModel).toHaveBeenCalledOnce();
  });
});
