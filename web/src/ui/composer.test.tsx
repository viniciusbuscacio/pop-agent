// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageDTO } from '@pop-agent/shared';
import { ApiError } from '../services/api';
import { providersService } from '../services/providers';
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
    quoteRequest?: {chatId:string;text:string;id:string};
    executionMode?: 'normal' | 'plan';
    currentProvider?: string;
    currentProviderLabel?: string;
    currentModel?: string;
    models?: ModelChoice[];
    locked?: boolean;
    chatId?: string;
    onSend?: ReturnType<typeof vi.fn>;
    onUpdateQueued?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onSend = props.onSend ?? vi.fn().mockResolvedValue(undefined);
  const onUpdateQueued = props.onUpdateQueued ?? vi.fn().mockResolvedValue(undefined);
  const onEditingDone = vi.fn();
  const onSetExecutionMode = vi.fn().mockResolvedValue(undefined);
  const onShowSystemMessage = vi.fn();
  const onSetModel = vi.fn().mockResolvedValue(undefined);
  const onCommand = vi.fn().mockResolvedValue(undefined);
  render(
    <Composer
      chatId={props.chatId ?? 'chat-1'}
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
      currentProviderLabel={props.currentProviderLabel ?? ''}
      currentModel={props.currentModel ?? ''}
      onShowSystemMessage={onShowSystemMessage}
      onCommand={onCommand}
      executionMode={props.executionMode ?? 'normal'}
      onSetExecutionMode={onSetExecutionMode}
      onSetModel={onSetModel}
    />,
  );
  return { onSend, onUpdateQueued, onEditingDone, onSetExecutionMode, onShowSystemMessage, onSetModel, onCommand };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('composer action placement', () => {
  it('compacts the Add gutter while retaining the original right margin, one-line height and touch target', () => {
    renderComposer();
    const composer = screen.getByTestId('composer');
    const input = screen.getByTestId('composer-input');
    expect(composer.classList.contains('pl-[env(safe-area-inset-left)]')).toBe(true);
    expect(composer.classList.contains('pr-[max(0.75rem,env(safe-area-inset-right))]')).toBe(true);
    expect(screen.getByTestId('composer-row').classList.contains('gap-0')).toBe(true);
    expect(composer.classList.contains('px-3')).toBe(false);
    expect(input.getAttribute('rows')).toBe('1');
    expect(input.classList.contains('max-h-[33dvh]')).toBe(true);
    expect(screen.getByTestId('composer-actions').classList.contains('w-8')).toBe(true);
  });

  it.each([375, 1280])('keeps Add before and outside the box at viewport width %i, with Send inside', async (width) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    const user = userEvent.setup();
    // Happy DOM does not load Tailwind; keep the file picker out of tab order as in the browser.
    render(<style>{'.hidden { display: none; }'}</style>);
    renderComposer();
    const row = screen.getByTestId('composer-row');
    const box = screen.getByTestId('composer-box');
    const add = screen.getByTestId('composer-actions');
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'A multiline draft\nwith another line' } });
    const send = screen.getByTestId('composer-send');
    const toolbar = screen.getByTestId('composer-toolbar');

    expect(Array.from(row.children)).toEqual([add.parentElement, box]);
    expect(box.contains(add)).toBe(false);
    expect(box.contains(input)).toBe(true);
    expect(toolbar.contains(send)).toBe(true);
    expect(box.lastElementChild).toBe(toolbar);
    expect(within(row).getAllByRole('button')).toEqual([add, send]);
    // These unprefixed layout classes keep the same bottom-aligned row on all viewports.
    expect(row.className).toBe('flex min-w-0 items-end gap-0');
    expect(add.parentElement?.className).toBe('shrink-0 pb-1.5');
    expect(box.classList.contains('items-end')).toBe(true);
    expect(toolbar.classList.contains('pb-1.5')).toBe(true);
    for (const button of [add, send]) {
      expect(button.classList.contains('h-8')).toBe(true);
      expect(button.classList.contains('w-8')).toBe(true);
    }
    expect(add.id).toBe('composer-add'); // Retains the existing no-accent focus/tap styles.

    add.focus();
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab();
    expect(document.activeElement).toBe(send);
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(add);
  });

  it.each([
    { viewportWidth: 1280, triggerLeft: 400, expectedLeft: 400, expectedWidth: 352 },
    { viewportWidth: 1280, triggerLeft: 0, expectedLeft: 8, expectedWidth: 352 },
    { viewportWidth: 1280, triggerLeft: 1220, expectedLeft: 920, expectedWidth: 352 },
    { viewportWidth: 320, triggerLeft: 12, expectedLeft: 8, expectedWidth: 304 },
  ])('anchors the menu to the left trigger with viewport clamping: $viewportWidth / $triggerLeft', ({
    viewportWidth, triggerLeft, expectedLeft, expectedWidth,
  }) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewportWidth);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    renderComposer();
    const add = screen.getByTestId('composer-actions');
    vi.spyOn(add, 'getBoundingClientRect').mockReturnValue(new DOMRect(triggerLeft, 700, 32, 32));
    vi.spyOn(screen.getByTestId('composer-box'), 'getBoundingClientRect').mockReturnValue(new DOMRect(triggerLeft + 36, 600, 200, 140));

    fireEvent.click(add);
    const menu = screen.getByTestId('composer-actions-panel');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe(`${String(expectedLeft)}px`);
    expect(menu.style.width).toBe(`${String(expectedWidth)}px`);
    expect(menu.style.bottom).toBe('208px'); // Eight pixels above the growing message box.
    expect(menu.style.maxHeight).toBe('584px');
    expect(menu.classList.contains('overflow-y-auto')).toBe(true);

    fireEvent.click(screen.getByTestId('composer-model'));
    expect(menu.style.left).toBe(`${String(expectedLeft)}px`);
    expect(menu.style.width).toBe(`${String(expectedWidth)}px`);
  });

  it('reclamps an open menu when the viewport narrows', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    renderComposer();
    const add = screen.getByTestId('composer-actions');
    const rect = vi.spyOn(add, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 700, 32, 32));
    fireEvent.click(add);
    const menu = screen.getByTestId('composer-actions-panel');
    expect(menu.style.left).toBe('400px');
    expect(menu.style.width).toBe('352px');

    width.mockReturnValue(320);
    rect.mockReturnValue(new DOMRect(12, 700, 32, 32));
    fireEvent(window, new Event('resize'));
    expect(menu.style.left).toBe('8px');
    expect(menu.style.width).toBe('304px');
  });
});

describe('pending message composition', () => {
  it('keeps exactly two persistent actions and navigates models without sending the draft', () => {
    const { onSend } = renderComposer();
    const toolbar = screen.getByTestId('composer-row');
    expect(within(toolbar).getAllByRole('button')).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'preserve this draft' } });
    fireEvent.click(screen.getByTestId('composer-actions'));
    expect(screen.getByRole('switch', { name: 'Show Thinking' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('composer-model'));
    expect(screen.getByRole('listbox', { name: 'Model' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('switch', { name: 'Show Thinking' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('composer-actions'));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'preserve this draft');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps switches open and closes direct attachment actions without losing the draft', () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('composer-actions'));
    const thinking = screen.getByRole('switch', { name: 'Show Thinking' });
    const previous = (thinking as HTMLInputElement).checked;
    fireEvent.click(thinking);
    expect(thinking).toHaveProperty('checked', !previous);
    expect(screen.getByRole('dialog')).toBeTruthy();
    const pick = vi.spyOn(screen.getByTestId('composer-file-input'), 'click');
    fireEvent.click(screen.getByTestId('composer-attach'));
    expect(pick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks the whole composer while a session operation is running', () => {
    renderComposer({ locked: true });

    const composer = screen.getByTestId('composer');
    const area = screen.getByTestId('composer-input');
    expect(composer.getAttribute('aria-busy')).toBe('true');
    expect(composer.hasAttribute('inert')).toBe(true);
    expect(composer.className).toContain('pointer-events-none');
    expect(area).toHaveProperty('disabled', true);
  });

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

    fireEvent.click(screen.getByTestId('composer-actions'));
    fireEvent.click(screen.getByTestId('composer-model'));
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    expect(listbox.closest('[role=dialog]')?.parentElement).toBe(document.body);

    fireEvent.focus(area);
    expect(composer.className).toContain('overflow-x-clip');
    expect(area.className).toContain('overflow-x-hidden');
  });

  it('keeps the model picker visually neutral while a model is active', () => {
    renderComposer({
      currentProvider: 'openai-codex',
      currentProviderLabel: 'OpenAI Codex',
      currentModel: 'gpt-5.6-sol',
    });

    const picker = screen.getByTestId('composer-actions');
    expect(picker.className).toContain('text-[var(--muted)]');
    expect(picker.className).not.toContain('bg-[var(--input-bg)]');
  });

  it('shows the effective model instead of an opaque default-model selection', () => {
    renderComposer({
      currentProvider: 'openai-codex',
      currentProviderLabel: 'OpenAI Codex',
      currentModel: 'gpt-5.6-sol',
    });

    fireEvent.click(screen.getByTestId('composer-actions'));
    fireEvent.click(screen.getByTestId('composer-model'));

    const effectiveDefault = screen.getByRole('option', {
      name: /^OpenAI Codex \/ gpt-5\.6-sol/,
    });
    expect(effectiveDefault.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('option', { name: 'Default model' })).toBeNull();
  });

  it('announces the selected model in the chat after changing it', async () => {
    const { onSetModel, onShowSystemMessage } = renderComposer({
      models: [
        {
          provider: 'openai-codex',
          providerLabel: 'OpenAI Codex',
          model: 'gpt-5.6-sol',
          label: 'gpt-5.6-sol',
        },
      ],
    });

    fireEvent.click(screen.getByTestId('composer-actions'));
    fireEvent.click(screen.getByTestId('composer-model'));
    fireEvent.click(screen.getByRole('option', { name: /^OpenAI Codex/ }));
    fireEvent.click(screen.getByRole('option', { name: 'gpt-5.6-sol' }));

    await waitFor(() => {
      expect(onSetModel).toHaveBeenCalledWith('gpt-5.6-sol', 'openai-codex');
      expect(onShowSystemMessage).toHaveBeenCalledWith(
        'Provider: OpenAI Codex · Model: gpt-5.6-sol',
      );
    });
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

  it('executes pi session commands locally instead of sending them to the model', async () => {
    const { onCommand, onSend } = renderComposer();
    const area = screen.getByRole('textbox');
    fireEvent.change(area, { target: { value: '/compact keep decisions' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith('compact', 'keep decisions'));
    expect(onSend).not.toHaveBeenCalled();
    expect((area as HTMLTextAreaElement).value).toBe('');
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

    fireEvent.click(screen.getByTestId('composer-actions'));
    fireEvent.click(screen.getByTestId('composer-model'));
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

  it('sends an attachment-only message with Enter', async () => {
    const { onSend } = renderComposer();
    const area = screen.getByRole('textbox');
    const file = new File(['image'], 'photo.png', { type: 'image/png' });

    fireEvent.change(screen.getByTestId('composer-file-input'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByTestId('attachment-tray')).toBeTruthy());
    fireEvent.keyDown(area, { key: 'Enter' });

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        '',
        [
          expect.objectContaining({
            name: 'photo.png',
            type: 'image/png',
            dataUri: expect.stringMatching(/^data:image\/png/),
          }),
        ],
        [],
        'steer',
        'normal',
      ),
    );
  });

  it('turns an image clipboard item into a normal attachment', async () => {
    const { onSend } = renderComposer();
    const area = screen.getByRole('textbox');
    const image = new File(['clipboard image'], 'pasted.png', { type: 'image/png' });

    const ordinaryPasteContinues = fireEvent.paste(area, {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => image }],
        files: [],
      },
    });

    expect(ordinaryPasteContinues).toBe(false);
    expect(await screen.findByText('pasted.png')).toBeTruthy();
    fireEvent.keyDown(area, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      '',
      [expect.objectContaining({
        name: 'pasted.png',
        type: 'image/png',
        dataUri: expect.stringMatching(/^data:image\/png/),
      })],
      [],
      'steer',
      'normal',
    ));
  });

  it('uses clipboard files as a fallback without duplicating item/file overlap', async () => {
    renderComposer();
    const area = screen.getByRole('textbox');
    const itemImage = new File(['first'], 'item.png', { type: 'image/png', lastModified: 1 });
    const overlappingFallback = new File(['first'], 'item.png', { type: 'image/png', lastModified: 1 });
    const fallbackImage = new File(['second'], 'fallback.png', { type: 'image/png' });

    fireEvent.paste(area, {
      clipboardData: {
        items: [
          { kind: 'file', getAsFile: () => itemImage },
          { kind: 'file', getAsFile: () => null },
        ],
        files: [overlappingFallback, fallbackImage],
      },
    });

    await waitFor(() => expect(screen.getByText('fallback.png')).toBeTruthy());
    expect(screen.getAllByText('item.png')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
  });

  it('leaves ordinary text paste to the textarea', async () => {
    const user = userEvent.setup();
    renderComposer();
    const area = screen.getByRole('textbox');
    area.focus();

    await user.paste('ordinary text');

    expect(area).toHaveProperty('value', 'ordinary text');
    expect(screen.queryByTestId('attachment-tray')).toBeNull();
  });

  it('ignores clipboard files while the composer is locked', () => {
    renderComposer({ locked: true });
    const image = new File(['clipboard image'], 'locked.png', { type: 'image/png' });

    const ordinaryPasteContinues = fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => image }],
        files: [image],
      },
    });

    expect(ordinaryPasteContinues).toBe(true);
    expect(screen.queryByTestId('attachment-tray')).toBeNull();
  });

  it('refuses a selection over the 100 MB aggregate attachment limit before sending', async () => {
    renderComposer();
    const files = Array.from({ length: 5 }, (_, index) => {
      const file = new File(['a'], `file-${String(index)}.bin`, { type: 'application/octet-stream' });
      Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 });
      return file;
    });

    fireEvent.change(screen.getByTestId('composer-file-input'), {
      target: { files },
    });

    expect(await screen.findByText('Attachments must be 100 MB or less in total.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('file-0.bin')).toBeTruthy());
    expect(screen.queryByText('file-4.bin')).toBeNull();
  });

  it('starts only one audio transcription from a multi-file selection', async () => {
    const transcribe = vi
      .spyOn(providersService, 'transcribe')
      .mockReturnValue(new Promise<never>(() => undefined));
    renderComposer();
    const first = new File(['audio'], 'first.webm', { type: 'audio/webm' });
    const second = new File(['audio'], 'second.webm', { type: 'audio/webm' });

    fireEvent.change(screen.getByTestId('composer-file-input'), {
      target: { files: [first, second] },
    });

    expect(await screen.findByText('Wait for the current audio note to finish transcribing.')).toBeTruthy();
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
  });

  it('requests a synchronized mode change and sends the controlled Plan value', async () => {
    const { onSend, onSetExecutionMode } = renderComposer({ executionMode: 'plan' });
    fireEvent.click(screen.getByTestId('composer-actions'));
    expect(screen.getByTestId('plan-mode')).toHaveProperty('checked', true);
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

  it.each([
    [
      'server_unreachable',
      'Server reconnecting… Your draft and attachments were kept. Sending will unlock automatically when the server is back.',
    ],
    [
      'local_connection_unavailable',
      'The selected computer is offline. Open Pop Local Access from the system tray, or install it in Settings > Installation. To chat without computer access, select Server only there. Your draft and attachments were kept.',
    ],
    [
      'local_connection_unknown',
      'The saved local machine selection no longer exists and was reset. Choose a computer again in Settings, then retry. Your draft and attachments were kept.',
    ],
  ])('keeps the exact draft and attachment with an actionable %s notice', async (code, notice) => {
    const onSend = vi.fn().mockRejectedValue(new ApiError(code, 'rejected', 409));
    renderComposer({ onSend });
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    const file = new File(['image'], 'keep.png', { type: 'image/png' });
    fireEvent.change(area, { target: { value: 'keep this exact draft' } });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('attachment-tray')).toBeTruthy());

    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(notice));
    expect(area.value).toBe('keep this exact draft');
    expect(screen.getByText('keep.png')).toBeTruthy();
    expect(localStorage.getItem('pop-agent.draft.chat-1')).toBe('keep this exact draft');
  });

  it('shows the local-machine notice for a failed queued-message update', async () => {
    const onUpdateQueued = vi.fn().mockRejectedValue(
      new ApiError('local_connection_unavailable', 'offline', 409),
    );
    renderComposer({ editRequest: pending, onUpdateQueued });
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toBe('Change course'));
    fireEvent.change(area, { target: { value: 'keep queued edit' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
      'The selected computer is offline.',
    ));
    expect(area.value).toBe('keep queued edit');
  });

  it('recalls submitted messages from newest to oldest and restores the current draft', async () => {
    localStorage.setItem(
      'pop-agent.composerHistory.chat-1',
      JSON.stringify(['older message', 'newer message']),
    );
    localStorage.setItem('pop-agent.draft.chat-1', 'unfinished draft');
    renderComposer();
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toBe('unfinished draft'));

    area.setSelectionRange(0, 0);
    fireEvent.keyDown(area, { key: 'ArrowUp' });
    expect(area.value).toBe('newer message');

    fireEvent.keyDown(area, { key: 'ArrowUp' });
    expect(area.value).toBe('older message');

    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(area.value).toBe('newer message');
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(area.value).toBe('unfinished draft');
  });

  it('adds a message to only its chat history after a successful send', async () => {
    const { onSend } = renderComposer({ chatId: 'chat-specific' });
    const area = screen.getByRole('textbox');
    fireEvent.change(area, { target: { value: 'remember this' } });
    fireEvent.keyDown(area, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem('pop-agent.composerHistory.chat-specific') ?? '[]')).toEqual([
      'remember this',
    ]);
    expect(localStorage.getItem('pop-agent.composerHistory.chat-1')).toBeNull();
  });

  it('leaves ArrowUp available for caret movement inside an unsent message', () => {
    renderComposer();
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'first line\nsecond line' } });
    area.setSelectionRange(area.value.length, area.value.length);

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    area.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(area.value).toBe('first line\nsecond line');
  });
});

it('quotes into the existing draft without sending and ignores requests for another chat', async()=>{
 localStorage.setItem('pop-agent.draft.chat-1','My draft');
 const {onSend}=renderComposer({quoteRequest:{chatId:'chat-1',text:'First line\nSecond line',id:'quote-1'}});
 await waitFor(()=>expect(localStorage.getItem('pop-agent.draft.chat-1')).toBe('My draft\n\n> First line\n> Second line\n\n'));
 expect(onSend).not.toHaveBeenCalled();
 const textarea=document.querySelector('textarea')!;expect(document.activeElement).toBe(textarea);expect(textarea.selectionStart).toBe(textarea.value.length);
 cleanup();renderComposer({chatId:'chat-2',quoteRequest:{chatId:'chat-1',text:'stale',id:'quote-2'}});
 expect(localStorage.getItem('pop-agent.draft.chat-2')).toBeNull();
});
