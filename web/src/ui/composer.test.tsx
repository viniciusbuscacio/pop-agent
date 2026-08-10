// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageDTO } from '@pop-agent/shared';
import { Composer } from './composer';

function queued(deliveryMode: QueuedMessageDTO['deliveryMode']): QueuedMessageDTO {
  return {
    id: 'queued-1',
    chatId: 'chat-1',
    text: 'Change course',
    deliveryMode,
    attachments: [],
    filePaths: [],
    createdAt: '',
    updatedAt: '',
  };
}

function renderComposer(queuedMessage: QueuedMessageDTO) {
  return render(
    <Composer
      chatId="chat-1"
      busy
      queuedMessage={queuedMessage}
      onSend={vi.fn()}
      onUpdateQueued={vi.fn()}
      onCancelQueued={vi.fn()}
      onStop={vi.fn()}
      onNewChat={vi.fn()}
      models={[]}
      activeProvider=""
      activeModel=""
      onSetModel={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('pending message presentation', () => {
  it('does not show a steering status above the composer', () => {
    renderComposer(queued('steer'));

    expect(screen.queryByTestId('composer-queued')).toBeNull();
    expect(screen.queryByText(/Guiding this run/i)).toBeNull();
  });

  it('keeps the explicit follow-up queue controls', () => {
    renderComposer(queued('follow_up'));

    expect(screen.getByTestId('composer-queued').textContent).toContain('Queued: Change course');
    expect(screen.getByTestId('queue-edit')).toBeTruthy();
    expect(screen.getByTestId('queue-cancel')).toBeTruthy();
  });
});
