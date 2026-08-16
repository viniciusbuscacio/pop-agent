// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './chat-message';

afterEach(cleanup);

const base = { role: 'system' as const, content: '', thinking: '', tools: [], attachments: [] };

describe('streaming performance', () => {
  it('memoizes settled rows instead of revisiting them for every live fragment', () => {
    expect(ChatMessage).toHaveProperty('$$typeof', Symbol.for('react.memo'));
  });
});

describe('horizontal overflow containment', () => {
  it('wraps an unbroken user message inside its bubble', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'user',
          content: 'x'.repeat(2_000),
        }}
      />,
    );

    const message = screen.getByTestId('message-user');
    expect(message.className).toContain('min-w-0');
    expect(message.firstElementChild?.className).toContain('[overflow-wrap:anywhere]');
  });

  it('constrains tool output while retaining its local overflow area', async () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'long-tool-name'.repeat(100), status: 'done', detail: 'x'.repeat(2_000) }],
        }}
      />,
    );

    await userEvent.click(screen.getByTestId('tool-toggle'));
    const output = screen.getByTestId('tool-output');
    expect(screen.getByTestId('message-assistant').className).toContain('min-w-0');
    expect(output.className).toContain('max-w-full');
    expect(output.className).toContain('overflow-x-auto');
    expect(output.className).toContain('[overflow-wrap:anywhere]');
  });
});

describe('system messages', () => {
  it('renders local informational output as quiet transcript text', () => {
    render(
      <ChatMessage
        systemTone="info"
        message={{ ...base, content: 'Provider: openai-codex · Model: gpt-5.6-sol' }}
      />,
    );

    const message = screen.getByTestId('message-system');
    expect(message.className).toContain('text-[var(--muted)]');
    expect(message.className).not.toContain('text-[var(--danger)]');
  });
});

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
