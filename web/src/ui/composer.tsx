import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AttachmentDTO, ExecutionMode, MessageDelivery, QueuedMessageDTO, SessionCommandName } from '@pop-agent/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { appendComposerHistory, readComposerHistory } from '../services/composer-history';
import { providersService } from '../services/providers';
import { flattenFiles, useFilesStore } from '../store/files';
import { useThinkingStore } from '../store/thinking';
import { useNotificationsStore } from '../store/notifications';
import {
  ModelMenu,
  SlashMenu,
  parseComposerDelivery,
  slashCommands,
  type ModelChoice,
  type SlashCommand,
} from './slash-menu';
import { FileInput, ModelPicker, TextArea, Pressable } from './controls';

/**
 * The composer, in aw's shape: the textarea on the left, then attach, mic
 * and an icon-only send/stop on the right. Enter sends,
 * Shift+Enter breaks a line, Escape stops a run. Files arrive through the
 * picker or by dropping them anywhere on the composer; images show a
 * thumbnail chip, everything else a file chip. aw's 16 MB cap applies here
 * before a byte leaves the phone.
 *
 * The draft is kept per chat in localStorage: half-written messages survive a
 * reload, a tab switch, and the phone deciding to reclaim the page.
 */

const MAX_ATTACH_BYTES = 16 * 1024 * 1024;
const MAX_ATTACH_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function Composer({
  chatId,
  busy,
  locked = false,
  editRequest,
  onSend,
  onUpdateQueued,
  onEditingDone,
  onStop,
  onNewChat,
  models,
  activeProvider,
  activeModel,
  currentProvider,
  currentProviderLabel,
  currentModel,
  onShowSystemMessage,
  onCommand,
  executionMode,
  onSetExecutionMode,
  onSetModel,
  modelPickerRequest = 0,
}: {
  chatId: string;
  busy: boolean;
  locked?: boolean;
  editRequest?: QueuedMessageDTO;
  onSend: (
    text: string,
    attachments: AttachmentDTO[],
    filePaths?: string[],
    delivery?: MessageDelivery,
    executionMode?: ExecutionMode,
  ) => Promise<void>;
  onUpdateQueued: (messageId: string, text: string, attachments: AttachmentDTO[], filePaths?: string[]) => Promise<void>;
  onEditingDone: () => void;
  onStop: () => void;
  onNewChat: () => void;
  models: ModelChoice[];
  activeProvider: string;
  activeModel: string;
  /** The effective pair after resolving the chat override or global default. */
  currentProvider: string;
  currentProviderLabel: string;
  currentModel: string;
  onShowSystemMessage: (message: string) => void;
  onCommand?: (command: SessionCommandName, argument: string) => Promise<void>;
  executionMode: ExecutionMode;
  onSetExecutionMode: (executionMode: ExecutionMode) => Promise<void>;
  onSetModel: (model: string, provider: string) => Promise<void>;
  modelPickerRequest?: number;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [voice, setVoice] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [sending, setSending] = useState(false);
  const [editingQueuedId, setEditingQueuedId] = useState<string | undefined>(undefined);
  const showThinking = useThinkingStore((state) => state.show);
  const toggleThinking = useThinkingStore((state) => state.toggle);
  const notify = useNotificationsStore((state) => state.notify);
  // @-mentions: files already in Files, attached by reference (no re-upload).
  // The path is the identifier the server gets; the name is what the menu and
  // the chip show.
  const [mentions, setMentions] = useState<{ path: string; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  // Slash commands: a "/" as the very first character opens the command menu.
  const [slashQuery, setSlashQuery] = useState<string | undefined>(undefined);
  // Picking /model swaps the command menu for the model list, same spot.
  const [slashMode, setSlashMode] = useState<'commands' | 'models'>('commands');
  const [slashActive, setSlashActive] = useState(0);
  // The mention pool is the Files tree the whole app shares, flattened to its
  // files; the store fetches it once and keeps every pane in step.
  const filesTree = useFilesStore((state) => state.tree);
  const reloadFiles = useFilesStore((state) => state.reload);
  const mentionCaret = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const voiceJob = useRef(false);
  // Live mirrors, because MediaRecorder.onstop closes over stale state (aw's
  // fix): what was typed or attached DURING the recording must survive it.
  const textRef = useRef('');
  const attachmentsRef = useRef<AttachmentDTO[]>([]);
  const mentionsRef = useRef<{ path: string; name: string }[]>([]);
  const autoSendRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | undefined>(undefined);
  const historyDraftRef = useRef('');
  const storageKey = `pop-agent.draft.${chatId}`;

  textRef.current = text;
  attachmentsRef.current = attachments;
  mentionsRef.current = mentions;

  useEffect(() => {
    try {
      setText(localStorage.getItem(storageKey) ?? '');
    } catch {
      setText('');
    }
    historyRef.current = readComposerHistory(chatId);
    historyIndexRef.current = undefined;
    historyDraftRef.current = '';
    setAttachments([]);
    setMentions([]);
    setMentionQuery(undefined);
    setSlashQuery(undefined);
    setSlashMode('commands');
    setNotice(undefined);
    setEditingQueuedId(undefined);
  }, [chatId, storageKey]);

  useEffect(() => {
    if (editRequest === undefined) {
      setEditingQueuedId(undefined);
      return;
    }
    persist(editRequest.text);
    setAttachments(editRequest.attachments);
    setMentions(
      editRequest.filePaths.map((path) => ({ path, name: path.split('/').at(-1) ?? path })),
    );
    setEditingQueuedId(editRequest.id);
    queueMicrotask(() => area.current?.focus());
  }, [editRequest]);

  useEffect(() => {
    const element = area.current;
    if (element === null) return;
    // Grow with the content, but never past a third of the screen. scrollHeight
    // excludes the border, which height (border-box) includes — without adding
    // it back the box sits 2px short and a scrollbar shows on a single line.
    element.style.height = 'auto';
    const border = element.offsetHeight - element.clientHeight;
    const wanted = element.scrollHeight + border;
    const max = window.innerHeight / 3;
    element.style.height = `${String(Math.min(wanted, max))}px`;
    // The scrollbar belongs only to the capped state, like aw's composer.
    element.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [text]);

  function persist(value: string): void {
    setText(value);
    try {
      if (value.length > 0) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // storage denied; the draft simply will not survive a reload
    }
  }

  function remember(value: string): void {
    historyRef.current = appendComposerHistory(chatId, value);
    historyIndexRef.current = undefined;
    historyDraftRef.current = '';
  }

  function recallHistory(direction: 'older' | 'newer'): void {
    const history = historyRef.current;
    if (history.length === 0) return;

    const current = historyIndexRef.current;
    if (direction === 'older') {
      if (current === undefined) {
        historyDraftRef.current = text;
        historyIndexRef.current = history.length - 1;
      } else {
        historyIndexRef.current = Math.max(0, current - 1);
      }
      persist(history[historyIndexRef.current] ?? text);
    } else {
      if (current === undefined) return;
      if (current < history.length - 1) {
        historyIndexRef.current = current + 1;
        persist(history[historyIndexRef.current] ?? text);
      } else {
        historyIndexRef.current = undefined;
        persist(historyDraftRef.current);
      }
    }
    queueMicrotask(() => {
      const element = area.current;
      if (element !== null) element.setSelectionRange(element.value.length, element.value.length);
    });
  }

  function updateMention(value: string, caret: number): void {
    const before = value.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (match?.[1] === undefined) {
      setMentionQuery(undefined);
      return;
    }
    mentionCaret.current = caret;
    setMentionQuery(match[1]);
    if (filesTree === undefined) void reloadFiles();
  }

  function updateSlash(value: string, caret: number): void {
    // Slash commands live at position zero only -- a "/" mid-sentence is prose.
    const before = value.slice(0, caret);
    const match = /^\/([a-z]*)$/.exec(before);
    setSlashMode('commands');
    setSlashQuery(match?.[1]);
  }

  function pickSlash(command: SlashCommand): void {
    if (command.name === 'help') {
      // The menu with every description IS the help: reopen it unfiltered.
      persist('/');
      setSlashQuery('');
      setSlashActive(0);
      area.current?.focus();
      return;
    }
    if (command.name === 'queue') {
      persist('/queue ');
      setSlashQuery(undefined);
      area.current?.focus();
      return;
    }
    if (['compact', 'session', 'name', 'export', 'fork'].includes(command.name)) {
      persist(`/${command.name} `);
      setSlashQuery(undefined);
      area.current?.focus();
      return;
    }
    persist('');
    setSlashQuery(undefined);
    area.current?.focus();
    if (command.name === 'new') onNewChat();
    if (command.name === 'model') {
      setSlashMode('models');
      setSlashActive(0);
    }
  }

  async function selectModel(choice: ModelChoice): Promise<void> {
    await onSetModel(choice.model, choice.provider);
    const provider =
      choice.provider.length > 0
        ? choice.providerLabel ?? choice.provider
        : currentProviderLabel || currentProvider;
    const model = choice.model.length > 0 ? choice.model : currentModel;
    onShowSystemMessage(
      provider.length === 0 || model.length === 0
        ? t('chat.currentModelUnavailable')
        : t('chat.currentModel', { provider, model }),
    );
  }

  function pickModel(choice: ModelChoice): void {
    setSlashMode('commands');
    setSlashQuery(undefined);
    void selectModel(choice);
    area.current?.focus();
  }

  const slashMatches =
    slashQuery === undefined
      ? []
      : slashCommands().filter((command) => command.name.startsWith(slashQuery.toLowerCase()));

  function pickMention(file: { path: string; name: string }): void {
    const caret = mentionCaret.current;
    const query = mentionQuery ?? '';
    const next = `${text.slice(0, caret - query.length)}${file.name} ${text.slice(caret)}`;
    persist(next);
    setMentions((current) =>
      current.some((entry) => entry.path === file.path) ? current : [...current, file],
    );
    setMentionQuery(undefined);
    area.current?.focus();
  }

  const mentionMatches =
    mentionQuery === undefined
      ? []
      : flattenFiles(filesTree ?? [])
          .map((node) => ({ path: node.path, name: node.name }))
          .filter((file) => file.name.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6);

  function addFiles(files: FileList | null): void {
    if (files === null) return;
    setNotice(undefined);
    let plannedCount = attachments.length;
    let plannedBytes = attachments.reduce(
      (total, attachment) => total + dataUriPayloadBytes(attachment.dataUri),
      0,
    );
    for (const file of Array.from(files)) {
      // An audio file is a voice note that arrived as a file (aw's routing):
      // it goes to transcription, not to the attachment tray.
      if (file.type.startsWith('audio/')) {
        if (file.size > MAX_AUDIO_BYTES) {
          setNotice(t('chat.audioTooLarge', { name: file.name }));
          continue;
        }
        if (voice !== 'idle' || voiceJob.current) {
          setNotice(t('chat.audioOneAtATime'));
          continue;
        }
        voiceJob.current = true;
        setVoice('transcribing');
        readAsDataUri(
          file,
          (dataUri) => void transcribe(dataUri),
          () => {
            voiceJob.current = false;
            setVoice('idle');
            setNotice(t('chat.transcribeFailed', { message: '' }));
          },
        );
        continue;
      }
      if (plannedCount >= MAX_ATTACHMENTS) {
        setNotice(t('chat.attachCount'));
        continue;
      }
      if (file.size > MAX_ATTACH_BYTES) {
        setNotice(t('chat.attachTooLarge', { name: file.name }));
        continue;
      }
      if (plannedBytes + file.size > MAX_ATTACH_TOTAL_BYTES) {
        setNotice(t('chat.attachTotalTooLarge'));
        continue;
      }
      plannedCount += 1;
      plannedBytes += file.size;
      readAsDataUri(file, (dataUri) => {
        const attachment: AttachmentDTO = {
          name: file.name,
          type: file.type.length > 0 ? file.type : 'application/octet-stream',
          dataUri,
        };
        setAttachments((current) =>
          current.length >= MAX_ATTACHMENTS ? current : [...current, attachment],
        );
      });
    }
  }

  async function transcribe(dataUri: string): Promise<void> {
    voiceJob.current = true;
    setVoice('transcribing');
    try {
      const result = await providersService.transcribe(dataUri);
      if (!result.ok || result.text === undefined) {
        setNotice(t('chat.transcribeFailed', { message: result.message ?? '' }));
        autoSendRef.current = false;
        return;
      }
      const existing = textRef.current.trim();
      const merged = existing.length > 0 ? `${existing}\n${result.text}` : result.text;
      // A voice note is meant to be sent: the transcript (with any typed draft
      // in front of it) goes to the chat automatically (docs/specs/Spec-Pop-General.md §14).
      autoSendRef.current = false;
      try {
        await onSend(
          merged,
          attachmentsRef.current,
          mentionsRef.current.map((m) => m.path),
          'steer',
          executionMode,
        );
      } catch (error) {
        // The transcription succeeded; it is the send/queue that failed. Put
        // the merged words into the durable draft instead of misreporting a
        // transcription failure or dropping the voice note.
        persist(merged);
        setNotice(sendFailureNotice(error));
        return;
      }
      remember(merged);
      setMentions([]);
      persist('');
      setAttachments([]);
    } catch {
      setNotice(t('chat.transcribeFailed', { message: '' }));
      autoSendRef.current = false;
    } finally {
      voiceJob.current = false;
      setVoice('idle');
    }
  }

  async function toggleRecording(): Promise<void> {
    if (voice === 'recording') {
      recorder.current?.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined' || navigator.mediaDevices === undefined) {
      setNotice(t('chat.micUnavailable'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recording = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recording.onerror = () => {
        setNotice(t('chat.micFailed'));
        setVoice('idle');
      };
      recording.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        recorder.current = null;
        const blob = new Blob(chunks, { type: recording.mimeType || 'audio/webm' });
        if (blob.size > MAX_AUDIO_BYTES) {
          setNotice(t('chat.audioTooLarge', { name: 'Voice note' }));
          setVoice('idle');
          return;
        }
        voiceJob.current = true;
        setVoice('transcribing');
        readAsDataUri(
          blob,
          (dataUri) => void transcribe(dataUri),
          () => {
            voiceJob.current = false;
            setVoice('idle');
            setNotice(t('chat.micFailed'));
          },
        );
      };

      recorder.current = recording;
      setNotice(undefined);
      setVoice('recording');
      recording.start();
    } catch {
      setNotice(t('chat.micUnavailable'));
    }
  }

  // A recording left running when the chat changes must not keep the mic hot.
  useEffect(() => {
    return () => {
      recorder.current?.stop();
    };
  }, [chatId]);

  const canSend =
    text.trim().length > 0 || attachments.length > 0 || mentions.length > 0 || voice !== 'idle';

  async function submit(): Promise<void> {
    if (locked) return;
    // Send while talking means "stop, transcribe and send" (aw's errand).
    if (voice === 'recording') {
      autoSendRef.current = true;
      recorder.current?.stop();
      return;
    }
    if (voice === 'transcribing') {
      autoSendRef.current = true;
      return;
    }
    if (!canSend || sending) return;
    const sessionCommand = /^\/(compact|session|name|export|fork)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (sessionCommand?.[1] !== undefined) {
      setSending(true);
      setNotice(undefined);
      try {
        if (onCommand === undefined) throw new Error('Session commands are unavailable.');
        await onCommand(sessionCommand[1].toLowerCase() as SessionCommandName, sessionCommand[2] ?? '');
        persist('');
      } catch {
        setNotice(t('chat.sendFailed'));
      } finally {
        setSending(false);
      }
      area.current?.focus();
      return;
    }
    if (/^\/model\s+list$/i.test(text.trim())) {
      persist('');
      setSlashMode('commands');
      setSlashQuery(undefined);
      onShowSystemMessage(
        currentProvider.length === 0 || currentModel.length === 0
          ? t('chat.currentModelUnavailable')
          : t('chat.currentModel', { provider: currentProvider, model: currentModel }),
      );
      area.current?.focus();
      return;
    }
    setSending(true);
    setNotice(undefined);
    try {
      const filePaths = mentions.map((mention) => mention.path);
      const outgoing = parseComposerDelivery(text);
      if (outgoing.text.length === 0 && attachments.length === 0 && filePaths.length === 0) return;
      if (editingQueuedId !== undefined) {
        await onUpdateQueued(editingQueuedId, outgoing.text, attachments, filePaths);
      } else {
        await onSend(outgoing.text, attachments, filePaths, outgoing.delivery, executionMode);
      }
      remember(text);
      persist('');
      setAttachments([]);
      setMentions([]);
      setEditingQueuedId(undefined);
      onEditingDone();
    } catch (error) {
      // Most importantly, do not clear anything: the exact draft and its files
      // remain available for another tap.
      setNotice(sendFailureNotice(error));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (slashMode === 'models') {
      const count = models.length + 1;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActive((current) =>
          (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickModel(
          slashActive === 0
            ? { provider: '', model: '', label: '' }
            : (models[slashActive - 1] ?? { provider: '', model: '', label: '' }),
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashMode('commands');
        setSlashQuery(undefined);
        return;
      }
    } else if (slashQuery !== undefined && slashMatches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActive((current) =>
          (current + (event.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) %
          slashMatches.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const picked = slashMatches[Math.min(slashActive, slashMatches.length - 1)];
        if (picked !== undefined) pickSlash(picked);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashQuery(undefined);
        return;
      }
    }
    if (mentionQuery !== undefined && mentionMatches.length > 0) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const first = mentionMatches[0];
        if (first !== undefined) pickMention(first);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(undefined);
        return;
      }
    }
    if (
      event.key === 'ArrowUp' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd &&
      (historyIndexRef.current !== undefined || event.currentTarget.selectionStart === 0)
    ) {
      if (historyRef.current.length > 0) {
        event.preventDefault();
        recallHistory('older');
      }
      return;
    }
    if (
      event.key === 'ArrowDown' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      historyIndexRef.current !== undefined &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd &&
      event.currentTarget.selectionEnd === text.length
    ) {
      event.preventDefault();
      recallHistory('newer');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <div
      data-testid="composer"
      aria-busy={locked}
      inert={locked}
      className={`min-w-0 overflow-x-clip border-t border-[var(--border)] bg-[var(--bg)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${locked ? 'pointer-events-none opacity-60' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!locked) addFiles(event.dataTransfer.files);
      }}
    >
      {notice !== undefined ? (
        <p role="alert" className="mb-2 text-xs text-[var(--danger)]">
          {notice}
        </p>
      ) : null}

      {attachments.length > 0 || mentions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="attachment-tray">
          {mentions.map((mention) => (
            <span
              key={mention.path}
              data-testid="mention-chip"
              className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--key-fg-dim)]"
            >
              <span className="truncate">@{mention.name}</span>
              <Pressable
                type="button"
                aria-label={t('chat.attachRemove', { name: mention.name })}
                onClick={() =>
                  setMentions((current) => current.filter((entry) => entry.path !== mention.path))
                }
                className="text-[var(--muted)] hover:text-[var(--screen-fg)]"
              >
                ✕
              </Pressable>
            </span>
          ))}
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${String(index)}`}
              className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--key-fg-dim)]"
            >
              {attachment.type.startsWith('image/') ? (
                <img
                  src={attachment.dataUri}
                  alt=""
                  className="h-6 w-6 rounded object-cover"
                />
              ) : (
                <FileIcon />
              )}
              <span className="truncate">{attachment.name}</span>
              <Pressable
                type="button"
                aria-label={t('chat.attachRemove', { name: attachment.name })}
                onClick={() =>
                  setAttachments((current) => current.filter((_, at) => at !== index))
                }
                className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--screen-fg)]"
              >
                <CloseIcon />
              </Pressable>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
        <FileInput
          inputRef={picker}
          multiple
          className="hidden"
          data-testid="composer-file-input"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {voice === 'idle' ? (
          <div className="relative w-full min-w-0 sm:flex-1">
          {slashMode === 'models' ? (
            <ModelMenu
              models={models}
              active={slashActive}
              activeProvider={activeProvider}
              activeModel={activeModel}
              onPick={pickModel}
            />
          ) : slashQuery !== undefined && slashMatches.length > 0 ? (
            <SlashMenu options={slashMatches} active={slashActive} onPick={pickSlash} />
          ) : null}
          {mentionQuery !== undefined && mentionMatches.length > 0 ? (
            <div
              data-testid="mention-menu"
              className="absolute bottom-full left-0 z-20 mb-1 flex max-h-56 w-72 flex-col overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
            >
              {mentionMatches.map((file) => (
                <Pressable
                  key={file.path}
                  type="button"
                  data-testid="mention-option"
                  onClick={() => pickMention(file)}
                  className="truncate px-3 py-1.5 text-left hover:bg-[var(--hover-overlay)]"
                >
                  @{file.name}
                </Pressable>
              ))}
            </div>
          ) : null}
          <TextArea
            id="composer-input"
            inputRef={area}
            data-testid="composer-input"
            rows={1}
            value={text}
            disabled={locked}
            onChange={(event) => {
              persist(event.target.value);
              updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
              updateSlash(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyDown={onKeyDown}
            placeholder={executionMode === 'plan' ? t('chat.planPlaceholder') : t('chat.placeholder')}
            aria-label={executionMode === 'plan' ? t('chat.planPlaceholder') : t('chat.placeholder')}
            // block (not inline-block): an inline textarea leaves baseline
            // descender space in the wrapper, and with the row's items-end the
            // buttons aligned to that phantom bottom, sitting ~7px too low.
            size="composer"
            shape="composer"
            className="block max-h-[33dvh] w-full resize-none overflow-x-hidden"
          />
          </div>
        ) : (
          <div
            data-testid={voice === 'recording' ? 'voice-recording' : 'voice-transcribing'}
            className="flex w-full items-center gap-2 rounded-2xl border border-[var(--accent)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--muted)] sm:flex-1"
          >
            {voice === 'recording' ? (
              <>
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--danger)]" aria-hidden="true" />
                <RecordingTimer />
              </>
            ) : (
              <>
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--muted)]" aria-hidden="true" />
                {t('chat.transcribing')}
              </>
            )}
          </div>
        )}

        <div className="relative flex max-w-full shrink-0 items-center justify-end gap-2">
        <ModelPicker
          id="composer-model"
          label={t('chat.model')}
          placeholder={t('chat.searchModels')}
          noResults={t('chat.noModelsFound')}
          groupsLabel={t('chat.providers')}
          backToGroupsLabel={t('chat.backToProviders')}
          compactLabel="M"
          openRequest={modelPickerRequest}
          value={activeModel === '' ? '' : `${activeProvider}||${activeModel}`}
          options={[
            {
              value: '',
              label:
                currentProviderLabel.length > 0 && currentModel.length > 0
                  ? `${currentProviderLabel} / ${currentModel}`
                  : t('chat.defaultModel'),
            },
            ...models.map((choice) => ({
              value: `${choice.provider}||${choice.model}`,
              label: choice.model,
              group: choice.provider,
              groupLabel: choice.providerLabel ?? choice.provider,
              ...(choice.providerOrder === undefined ? {} : { groupOrder: choice.providerOrder }),
            })),
          ]}
          onChange={(value) => {
            const [provider = '', model = ''] = value.split('||');
            const choice = models.find(
              (candidate) => candidate.provider === provider && candidate.model === model,
            ) ?? {
              provider,
              model,
              label: model,
            };
            void selectModel(choice);
          }}
        />

        <PlanButton
          enabled={executionMode === 'plan'}
          onToggle={() => {
            const next = executionMode === 'plan' ? 'normal' : 'plan';
            void onSetExecutionMode(next)
              .then(() => notify(next === 'plan' ? t('chat.planShown') : t('chat.planHidden')))
              .catch(() => notify(t('chat.planChangeFailed')));
          }}
        />

        <ThinkingButton
          show={showThinking}
          onToggle={() => {
            // Announce the new state through the in-app notification channel;
            // `showThinking` is still the pre-toggle value here.
            toggleThinking();
            notify(showThinking ? t('chat.thinkingHidden') : t('chat.thinkingShown'));
          }}
        />

        <IconButton
          testId="composer-attach"
          label={t('chat.attach')}
          onClick={() => picker.current?.click()}
        >
          <AttachIcon />
        </IconButton>

        {voice === 'recording' ? (
          <IconButton testId="composer-mic-stop" label={t('chat.micStop')} stop onClick={() => void toggleRecording()}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            testId="composer-mic"
            label={t('chat.mic')}
            disabled={voice === 'transcribing'}
            onClick={() => void toggleRecording()}
          >
            <MicIcon />
          </IconButton>
        )}

        {busy && !canSend ? (
          <IconButton testId="composer-stop" label={t('chat.stop')} stop onClick={onStop}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            testId="composer-send"
            label={editingQueuedId !== undefined ? t('chat.queueSave') : busy ? t('chat.queue') : t('chat.send')}
            primary
            disabled={!canSend || sending}
            onClick={() => void submit()}
          >
            <SendIcon />
          </IconButton>
        )}
        </div>
      </div>
    </div>
  );
}

function sendFailureNotice(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'server_unreachable') return t('chat.serverReconnecting');
    if (error.code === 'local_connection_unavailable') return t('chat.localMachineOffline');
    if (error.code === 'local_connection_unknown') return t('chat.localMachineReset');
  }
  return t('chat.sendFailed');
}

/** Per-chat execution policy; the server still enforces the selected mode. */
function PlanButton({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Pressable
      type="button"
      data-testid="plan-mode"
      aria-pressed={enabled}
      aria-label={enabled ? t('chat.planOn') : t('chat.planOff')}
      title={enabled ? t('chat.planOn') : t('chat.planOff')}
      onClick={onToggle}
      className={`grid h-10 w-10 place-items-center rounded-full border text-sm font-semibold transition-colors ${
        enabled
          ? 'border-[var(--accent)] bg-[var(--hover-overlay)] text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--muted)]'
      }`}
    >
      <span aria-hidden="true">P</span>
    </Pressable>
  );
}

/** The thinking visibility control sits beside the attachment action. */
function ThinkingButton({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <Pressable
      type="button"
      data-testid="thinking-visibility"
      aria-pressed={show}
      aria-label={show ? t('chat.thinkingOn') : t('chat.thinkingOff')}
      title={show ? t('chat.thinkingShowing') : t('chat.thinkingHiding')}
      onClick={onToggle}
      className={`grid h-10 w-10 place-items-center rounded-full border border-[var(--border)] text-sm font-semibold transition-colors ${
        show
          ? 'bg-[var(--hover-overlay)] text-[var(--screen-fg)]'
          : 'text-[var(--muted)]'
      }`}
    >
      <span aria-hidden="true">T</span>
    </Pressable>
  );
}

/** aw's 34px icon button, in Pop Agent's rounder skin. */
function IconButton({
  testId,
  label,
  onClick,
  disabled = false,
  primary = false,
  stop = false,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  stop?: boolean;
  children: ReactNode;
}) {
  const skin = primary
    ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-transparent disabled:opacity-40'
    : stop
      ? 'border-[var(--border)] text-[var(--danger)] hover:bg-[var(--hover-overlay)]'
      : 'border-[var(--border)] text-[var(--key-fg-dim)] opacity-70 hover:bg-[var(--hover-overlay)] hover:opacity-100';

  return (
    <Pressable
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-10 w-10 flex-none place-items-center rounded-full border ${skin}`}
    >
      {children}
    </Pressable>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/** Elapsed time of the recording in flight, aw's m:ss. */
function RecordingTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="tabular-nums">
      {`${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`}
    </span>
  );
}

function readAsDataUri(
  file: Blob,
  onReady: (dataUri: string) => void,
  onError: () => void = () => undefined,
): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') onReady(reader.result);
    else onError();
  };
  reader.onerror = onError;
  reader.readAsDataURL(file);
}

function dataUriPayloadBytes(dataUri: string): number {
  const payload = dataUri.slice(dataUri.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
