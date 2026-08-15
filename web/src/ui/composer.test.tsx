// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageDTO } from '@pop-agent/shared';
import { Composer } from './composer';
import type { ModelChoice } from './slash-menu';

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
    models?: ModelChoice[];
  } = {},
) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onUpdateQueued = vi.fn().mockResolvedValue(undefined);
  const onEditingDone = vi.fn();
  const onSetExecutionMode = vi.fn().mockResolvedValue(undefined);
  const onShowSystemMessage = vi.fn();
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
      models={props.models ?? []}
      activeProvider=""
      activeModel=""
      currentProvider={props.currentProvider ?? ''}
      currentModel={props.currentModel ?? ''}
      onShowSystemMessage={onShowSystemMessage}
      executionMode={props.executionMode ?? 'normal'}
      onSetExecutionMode={onSetExecutionMode}
      onSetModel={vi.fn()}
    />,
  );
  return { onSend, onUpdateQueued, onEditingDone, onSetExecutionMode, onShowSystemMessage };
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
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    expect(listbox.parentElement?.className).toContain('fixed');
    expect(listbox.parentElement?.parentElement).toBe(document.body);

    fireEvent.focus(area);
    expect(composer.className).toContain('overflow-x-clip');
    expect(area.className).toContain('overflow-x-hidden');
  });

  it('reports only the active provider and model for /model list', () => {
    const { onSend, onShowSystemMessage } = renderComposer({
      currentProvider: 'openai-codex',
      currentModel: 'gpt-5.6-sol',
    });
    const area = screen.getByRole('textbox');

    fireEvent.change(area, { target: { value: '/model list' } });
    expect(screen.queryByTestId('slash-menu')).toBeNull();
    fireEvent.keyDown(area, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect((area as HTMLTextAreaElement).value).toBe('');
    expect(onShowSystemMessage).toHaveBeenCalledWith(
      'Provider: openai-codex · Model: gpt-5.6-sol',
    );
  });

  it('shows providers first, then every searchable model from the chosen provider', () => {
    const openRouterModels: ModelChoice[] = Array.from({ length: 55 }, (_, index) => ({
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      providerOrder: 0,
      model: `alpha-${String(index).padStart(2, '0')}`,
      label: `OpenRouter · alpha-${String(index).padStart(2, '0')}`,
    }));
    openRouterModels.push({
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      providerOrder: 0,
      model: 'beta-fast',
      label: 'OpenRouter · beta-fast',
    });
    renderComposer({
      models: [
        ...openRouterModels,
        { provider: 'openai-codex', providerLabel: 'OpenAI Codex', providerOrder: 1, model: 'gpt-5.6', label: 'OpenAI Codex · gpt-5.6' },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByText('Providers')).toBeTruthy();
    expect(screen.getByRole('option', { name: /OpenRouter/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /OpenAI Codex/ })).toBeTruthy();
    expect(screen.queryByText('alpha-00')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /OpenRouter/ }));
    expect(screen.getByRole('searchbox', { name: 'Search models…' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'alpha-00' })).toBeTruthy();
    // The 56th model is present before filtering: provider catalogues are not truncated.
    expect(screen.getByRole('option', { name: 'beta-fast' })).toBeTruthy();
    expect(screen.queryByText('gpt-5.6')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
    expect(screen.queryByText('alpha-00')).toBeNull();
    expect(screen.getByRole('option', { name: 'beta-fast' })).toBeTruthy();
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
