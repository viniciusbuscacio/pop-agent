// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThinkingStore } from '../store/thinking';
import { ChatMessage } from './chat-message';

const renderPdfThumbnail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../services/pdf-thumbnail', () => ({ renderPdfThumbnail }));

afterEach(() => {
  cleanup();
  renderPdfThumbnail.mockClear();
  useThinkingStore.setState({ show: true });
});

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

  it('renders attachments without inventing content for an attachment-only user message', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'user',
          attachments: [
            { name: 'photo.png', type: 'image/png', dataUri: 'data:image/png;base64,aW1hZ2U=' },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('message-attachments')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeTruthy();
    expect(screen.getByTestId('message-user').children).toHaveLength(1);
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

describe('thinking visibility', () => {
  it('hides thinking, ordinary tools, and subagents together', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          content: 'Final answer',
          thinking: 'Reasoning',
          tools: [
            { name: 'bash', status: 'done', detail: 'ordinary result' },
            { name: 'delegate_worker', status: 'done', detail: 'worker result' },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('thinking-card')).toBeTruthy();
    expect(screen.getByTestId('tool-card')).toBeTruthy();
    expect(screen.getByTestId('subagents-card')).toBeTruthy();

    act(() => useThinkingStore.setState({ show: false }));

    expect(screen.queryByTestId('thinking-card')).toBeNull();
    expect(screen.queryByTestId('tool-card')).toBeNull();
    expect(screen.queryByTestId('subagents-card')).toBeNull();
    expect(screen.getByText('Final answer')).toBeTruthy();
  });
});

describe('worker delegation tools', () => {
  it('separates delegation from ordinary tools and exposes each card detail', async () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [
            { name: 'bash', status: 'done', detail: 'ordinary result' },
            { name: 'delegate_worker', status: 'done', detail: 'worker progress and handoff' },
            { name: 'read', status: 'done', detail: 'another ordinary result' },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('tool-name').textContent).toBe('Ran 2 tools');
    expect(screen.getByTestId('subagents-card').textContent).toContain('Subagents');
    expect(screen.getByTestId('tool-card').textContent).not.toContain('delegate_worker');

    await userEvent.click(screen.getByTestId('subagents-toggle'));
    await userEvent.click(screen.getByTestId('tool-toggle'));

    const delegatedOutput = screen.getByTestId('subagent-output');
    expect(delegatedOutput.textContent).toBe('worker progress and handoff');
    expect(delegatedOutput.className).toContain('max-w-full');
    expect(delegatedOutput.className).toContain('overflow-x-auto');
    expect(screen.getAllByTestId('tool-output').map((output) => output.textContent)).toEqual([
      'ordinary result',
      'another ordinary result',
    ]);
  });

  it('orders the cards by the first tool call of each kind', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [
            { name: 'bash', status: 'done', detail: '' },
            { name: 'delegate_worker', status: 'done', detail: '' },
          ],
        }}
      />,
    );

    expect(
      Array.from(screen.getByTestId('message-assistant').children).map((child) =>
        child.getAttribute('data-testid'),
      ),
    ).toEqual(['tool-card', 'subagents-card']);
  });

  it('places a delegation card first when delegation was the first tool call', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [
            { name: 'delegate_worker', status: 'done', detail: '' },
            { name: 'bash', status: 'done', detail: '' },
          ],
        }}
      />,
    );

    expect(
      Array.from(screen.getByTestId('message-assistant').children).map((child) =>
        child.getAttribute('data-testid'),
      ),
    ).toEqual(['subagents-card', 'tool-card']);
  });

  it('uses the existing active, done, and failure status semantics', () => {
    const { rerender } = render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'delegate_worker', status: 'start', detail: 'launching' }],
        }}
      />,
    );

    expect(screen.getByTestId('subagents-card').querySelector('.animate-spin')).not.toBeNull();

    rerender(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'delegate_worker', status: 'done', detail: 'complete' }],
        }}
      />,
    );
    expect(screen.getByTestId('subagents-card').querySelector('.animate-spin')).toBeNull();
    expect(screen.getByTestId('subagents-card').textContent).toContain('✓');

    rerender(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'delegate_worker', status: 'error', detail: 'worker failed' }],
        }}
      />,
    );
    expect(screen.getByTestId('subagents-card').querySelector('.animate-spin')).toBeNull();
    expect(screen.getByTestId('subagents-card').textContent).toContain('failed');
  });

  it('has an accessible expansion state and reveals progress only when expanded', async () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'delegate_worker', status: 'output', detail: 'tests are running' }],
        }}
      />,
    );

    const toggle = screen.getByTestId('subagents-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('subagent-output')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('subagent-output').textContent).toBe('tests are running');
  });

  it('does not render an empty ordinary tool card for delegation-only runs', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          tools: [{ name: 'delegate_worker', status: 'done', detail: 'handoff' }],
        }}
      />,
    );

    expect(screen.getByTestId('subagents-card')).toBeTruthy();
    expect(screen.queryByTestId('tool-card')).toBeNull();
  });

  it('stops delegated work spinning when persisted content says the run was interrupted', () => {
    render(
      <ChatMessage
        message={{
          ...base,
          role: 'assistant',
          content: 'Partial answer\n\n*— interrupted by a server restart —*',
          tools: [{ name: 'delegate_worker', status: 'output', detail: 'partial progress' }],
        }}
      />,
    );

    expect(screen.getByTestId('tool-interrupted').textContent).toBe('interrupted');
    expect(screen.getByTestId('subagents-card').querySelector('.animate-spin')).toBeNull();
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
    expect(screen.getByTestId('tool-toggle').className).toContain('text-[var(--muted)]');
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

it.each([
  ['owner', 'Remote user → Pop'],
  ['agent', 'Remote agent → Pop'],
  ['unknown', 'A2A peer → Pop'],
] as const)('labels incoming A2A %s messages without presenting them as local owner input', (author, label) => {
  render(<ChatMessage message={{ ...base, role: 'user', content: 'hello', a2aAuthor: author }} />);
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByTitle('Origin reported by the authenticated A2A peer')).toBeTruthy();
});

it('opens an attached image with bounded zoom controls and closes without navigation', async () => {
  const user = userEvent.setup();
  render(<ChatMessage message={{ ...base, role: 'user', attachments: [{ name: 'Photo.png', type: 'image/png', dataUri: 'data:image/png;base64,YQ==' }] }} />);
  await user.click(screen.getByRole('button', { name: 'Preview: Photo.png' }));
  const dialog = screen.getByRole('dialog', { name: 'Photo.png' });
  expect(document.activeElement).toBe(dialog);
  expect(screen.getByRole('button', { name: 'Close' })).not.toBe(document.activeElement);

  const image = screen.getByTestId('image-preview-image');
  const canvas = image.parentElement;
  const viewport = screen.getByTestId('image-preview-viewport');
  Object.defineProperties(viewport, {
    scrollWidth: { value: 1_250, configurable: true },
    clientWidth: { value: 1_000, configurable: true },
    scrollHeight: { value: 1_000, configurable: true },
    clientHeight: { value: 800, configurable: true },
  });
  expect(canvas?.style.width).toBe('100%');
  await user.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(canvas?.style.width).toBe('125%');
  expect(viewport.scrollLeft).toBe(125);
  expect(viewport.scrollTop).toBe(100);
  await user.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(canvas?.style.width).toBe('100%');
  await user.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(image.style.transform).toBe('scale(0.75)');

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows an inline PDF thumbnail, opens it full screen and releases the modal URL', async () => {
  const user = userEvent.setup();
  const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('data:application/pdf,pdf');
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const dataUri = 'data:application/pdf;base64,JVBERi0xLjQ=';
  render(<ChatMessage message={{ ...base, role: 'user', attachments: [{ name: 'Document.pdf', type: 'application/pdf', dataUri }] }} />);

  const thumbnail = await screen.findByTestId('pdf-thumbnail-canvas');
  expect(thumbnail.className).toContain('max-h-full');
  expect(screen.getByTestId('pdf-thumbnail').textContent).toContain('Document.pdf');
  expect(renderPdfThumbnail).toHaveBeenCalledWith(dataUri, thumbnail, expect.any(AbortSignal));
  expect(objectUrl).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Preview: Document.pdf' }));
  const dialog = screen.getByRole('dialog', { name: 'Document.pdf' });
  expect(document.activeElement).toBe(dialog);
  const frame = await screen.findByTestId('pdf-preview-frame');
  expect(objectUrl).toHaveBeenCalledOnce();
  expect(frame.getAttribute('src')).toBe('data:application/pdf,pdf');

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(revokeObjectUrl).toHaveBeenCalledWith('data:application/pdf,pdf');
});

it('offers a touch-accessible resend action on the interrupted user bubble', async () => {
  const resend = vi.fn();
  render(<ChatMessage message={{ ...base, role: 'user', content: 'Try again' }} onResend={resend} />);
  await userEvent.click(screen.getByTestId('message-resend'));
  expect(resend).toHaveBeenCalledTimes(1);
});
