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

  it('contains a long MCP tool name in the collapsed card', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{
            name: 'mcp_mcp_M4qrBZjO1ie_microsoft_docs_search'.repeat(20),
            status: 'done',
            detail: '',
          }],
        }}
      />,
    );

    const name = screen.getByTestId('tool-name');
    expect(name.className).toContain('min-w-0');
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');
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

describe('tool status', () => {
  it('uses the same quiet text color as the thinking card', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          thinking: 'Checking the repository.',
          tools: [{ name: 'bash', status: 'done', detail: 'done' }],
        }}
      />,
    );

    expect(screen.getByTestId('thinking-toggle').className).toContain('text-[var(--muted)]');
    expect(screen.getByTestId('tool-name').className).toContain('text-[var(--muted)]');
  });

  it('stops an unfinished tool indicator when persisted content says the run was interrupted', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          content: 'Partial answer\n\n*— interrupted by a server restart —*',
          tools: [{ name: 'bash', status: 'output', detail: 'partial output' }],
        }}
      />,
    );

    expect(screen.getByTestId('tool-interrupted').textContent).toBe('interrupted');
    expect(screen.getByTestId('tool-card').querySelector('.animate-spin')).toBeNull();
  });

  it('keeps an unfinished live tool spinning without the interruption marker', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'bash', status: 'start', detail: '' }],
        }}
      />,
    );

    expect(screen.queryByTestId('tool-interrupted')).toBeNull();
    expect(screen.getByTestId('tool-card').querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('system messages', () => {
  it('renders compact completion from durable history as a timeline event', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          content: 'Context compacted.',
          notice: { kind: 'context-compacted' },
        }}
      />,
    );

    const message = screen.getByTestId('message-system');
    expect(message.textContent).toBe('Context compacted.');
    expect(message.className).toContain('w-full');
    expect(message.className).toContain('text-[var(--muted)]');
  });

  it('renders local informational output as a quiet timeline event', () => {
    render(
      <ChatMessage
        systemTone="info"
        message={{ ...base, content: 'Provider: openai-codex · Model: gpt-5.6-sol' }}
      />,
    );

    const message = screen.getByTestId('message-system');
    expect(message.className).toContain('w-full');
    expect(message.className).toContain('text-[var(--muted)]');
    expect(message.className).not.toContain('text-[var(--danger)]');
    expect(message.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
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
