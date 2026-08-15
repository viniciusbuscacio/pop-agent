// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageDTO } from '@pop-agent/shared';
import { useNotificationsStore } from '../store/notifications';
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
  props: {
    editRequest?: QueuedMessageDTO;
    executionMode?: 'normal' | 'plan';
    currentProvider?: string;
    currentModel?: string;
  } = {},
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
      currentProvider={props.currentProvider ?? ''}
      currentModel={props.currentModel ?? ''}
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
  useNotificationsStore.getState().dismiss();
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
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    expect(listbox.parentElement?.className).toContain('fixed');
    expect(listbox.parentElement?.parentElement).toBe(document.body);

    fireEvent.focus(area);
    expect(composer.className).toContain('overflow-x-clip');
    expect(area.className).toContain('overflow-x-hidden');
  });

  it('reports only the active provider and model for /model list', () => {
    const { onSend } = renderComposer({
      currentProvider: 'openai-codex',
      currentModel: 'gpt-5.6-sol',
    });
    const area = screen.getByRole('textbox');

    fireEvent.change(area, { target: { value: '/model list' } });
    expect(screen.queryByTestId('slash-menu')).toBeNull();
    fireEvent.keyDown(area, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect((area as HTMLTextAreaElement).value).toBe('');
    expect(useNotificationsStore.getState().toast?.message).toBe(
      'Provider: openai-codex · Model: gpt-5.6-sol',
    );
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
