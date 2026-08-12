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

function renderComposer(props: { editRequest?: QueuedMessageDTO } = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onUpdateQueued = vi.fn().mockResolvedValue(undefined);
  const onEditingDone = vi.fn();
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
      onSetModel={vi.fn()}
    />,
  );
  return { onSend, onUpdateQueued, onEditingDone };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('pending message composition', () => {
  it('contains horizontal overflow before and after the textarea receives focus', () => {
    renderComposer();

    const composer = screen.getByTestId('composer');
    const area = screen.getByTestId('composer-input');
    expect(composer.className).toContain('min-w-0');
    expect(composer.className).toContain('overflow-x-hidden');
    expect(area.className).toContain('overflow-x-hidden');

    fireEvent.focus(area);
    expect(composer.className).toContain('overflow-x-hidden');
    expect(area.className).toContain('overflow-x-hidden');
  });

  it('keeps sending enabled while a run is busy so several inputs can queue', async () => {
    const { onSend } = renderComposer();
    const area = screen.getByRole('textbox');
    fireEvent.change(area, { target: { value: 'another direction' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('another direction', [], [], 'steer'));
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
