// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageDTO } from '@pop-agent/shared';
import { Composer } from './composer';

const pending: QueuedMessageDTO = {
  id: 'queued-1',
  chatId: 'chat-1',
  text: 'Change course',
  deliveryMode: 'steer',
  attachments: [],
  filePaths: [],
  createdAt: '',
  updatedAt: '',
};

function renderComposer(
  props: { editRequest?: QueuedMessageDTO; executionMode?: 'normal' | 'plan' } = {},
) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onUpdateQueued = vi.fn().mockResolvedValue(undefined);
  const onEditingDone = vi.fn();
  const onSetExecutionMode = vi.fn().mockResolvedValue(undefined);
  render(
    <Composer
      chatId="chat-1"
      busy
      {...props}
      onSend={onSend}
      onUpdateQueued={onUpdateQueued}
      onEditingDone={onEditingDone}
      onStop={vi.fn()}
      onNewChat={vi.fn()}
      models={[]}
      activeProvider=""
      activeModel=""
      executionMode={props.executionMode ?? 'normal'}
      onSetExecutionMode={onSetExecutionMode}
      onSetModel={vi.fn()}
    />,
  );
  return { onSend, onUpdateQueued, onEditingDone, onSetExecutionMode };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('pending message composition', () => {
  it('contains horizontal overflow without clipping the model menu above the composer', () => {
    renderComposer();

    const composer = screen.getByTestId('composer');
    const area = screen.getByTestId('composer-input');
    expect(composer.className).toContain('min-w-0');
    // `hidden` on one axis computes the other axis to `auto`, which trapped
    // the upward-opening model picker inside the short composer row.
    expect(composer.className).toContain('overflow-x-clip');
    expect(composer.className).not.toContain('overflow-x-hidden');
    expect(area.className).toContain('overflow-x-hidden');
    expect(area.className).not.toContain('focus:border-[var(--accent)]');

    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByRole('listbox', { name: 'Model' })).toBeTruthy();

    fireEvent.focus(area);
    expect(composer.className).toContain('overflow-x-clip');
    expect(area.className).toContain('overflow-x-hidden');
  });

  it('keeps sending enabled while a run is busy so several inputs can queue', async () => {
    const { onSend } = renderComposer();
    const area = screen.getByRole('textbox');
    fireEvent.change(area, { target: { value: 'another direction' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('another direction', [], [], 'steer', 'normal'));
  });

  it('requests a synchronized mode change and sends the controlled Plan value', async () => {
    const { onSend, onSetExecutionMode } = renderComposer({ executionMode: 'plan' });
    expect(screen.getByTestId('plan-mode').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('plan-mode'));
    expect(onSetExecutionMode).toHaveBeenCalledWith('normal');
    expect(localStorage.getItem('pop-agent.plan.chat-1')).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'inspect this' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('inspect this', [], [], 'steer', 'plan'),
    );
  });

  it('edits the pending item identified by the request', async () => {
    const { onUpdateQueued, onEditingDone } = renderComposer({ editRequest: pending });
    const area = screen.getByRole('textbox');
    await waitFor(() => expect((area as HTMLTextAreaElement).value).toBe('Change course'));
    fireEvent.change(area, { target: { value: 'Edited direction' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(onUpdateQueued).toHaveBeenCalledWith(pending.id, 'Edited direction', [], []),
    );
    expect(onEditingDone).toHaveBeenCalled();
  });
});
