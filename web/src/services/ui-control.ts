import type { UiCommandDTO, UiControlDTO, UiReplyDTO, UiStateDTO } from '@pop-agent/shared';
import { apiRequest, pendingUiRequests } from './api';
interface Connection { id: string; key: string }
let connection: Connection | undefined;
let starting = false;
let generation = 0;
let stream: MediaStream | undefined;
let video: HTMLVideoElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let snapshot = { connected: false, sessionId: '', sharing: false, error: '' };
const listeners = new Set<() => void>();
function emit(error = ''): void { snapshot = { connected: !!connection, sessionId: connection?.id ?? '', sharing: !!stream, error }; listeners.forEach(fn => fn()); }
function visible(e: HTMLElement): boolean { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; }
function controls(): HTMLElement[] { return Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).filter(visible).slice(0, 1000); }
function disabled(e: HTMLElement): boolean { return e.matches(':disabled,[aria-disabled="true"]') || !!e.closest('[inert]'); }
export function collectUiState(): UiStateDTO {
  const counts = new Map<string, number>();
  const entries: UiControlDTO[] = controls().map(e => {
    const testid = e.dataset.testid!; const index = counts.get(testid) ?? 0; counts.set(testid, index + 1);
    const value = e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement ? e.value : undefined;
    const secret = !!e.querySelector('[data-ui-private],input[type="password"]') || e instanceof HTMLInputElement && e.type === 'password' || !!e.closest('[data-ui-private]');
    return { testid, index, role: e.getAttribute('role') ?? e.tagName.toLowerCase(), name: secret ? '[private]' : (e.getAttribute('aria-label') ?? e.innerText ?? e.textContent ?? '').slice(0, 300), disabled: disabled(e), ...(value === undefined || secret ? {} : { value: value.slice(0, 32000) }) };
  });
  return { url: location.pathname + location.search, title: document.title, width: innerWidth, height: innerHeight, controls: entries, text: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,[role="alert"]')).filter(e => visible(e) && !e.closest('[data-ui-private]')).map(e => e.innerText).join('\n').slice(0, 16000), screenshotAvailable: !!stream, pendingRequests: pendingUiRequests() };
}
const fail = (code: string, message: string): UiReplyDTO => ({ error: { code, message } });
function target(cmd: UiCommandDTO): HTMLElement | UiReplyDTO {
  const nodes = controls().filter(e => e.dataset.testid === cmd.testid);
  if (!nodes.length) return fail('unknown_testid', 'No visible control has that testid.');
  if (cmd.index === undefined && nodes.length > 1) return fail('ambiguous_testid', 'Use the index from UI state.');
  const e = nodes[cmd.index ?? 0]; if (!e) return fail('unknown_testid', 'No visible control has that index.');
  if (disabled(e)) return fail('disabled_control', 'The control is disabled.');
  return e;
}
async function settle(): Promise<void> {
  await new Promise(r => setTimeout(r, 50));
  const deadline = Date.now() + 3000;
  while (pendingUiRequests() > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 50));
}
export async function performUiCommand(cmd: UiCommandDTO): Promise<UiReplyDTO> {
  if (Date.now() >= cmd.expiresAt) return fail('ui_timeout', 'Command expired before execution.');
  if (cmd.kind === 'screenshot') {
    if (!video || !stream?.active || !video.videoWidth) return fail('screen_not_shared', 'Start screen sharing in the connected browser first.');
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 1920 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png').split(',')[1]!;
    return png.length > 3_500_000 ? fail('screenshot_too_large', 'Choose a smaller shared window.') : { png };
  }
  if (cmd.kind === 'key') {
    const parts = (cmd.key ?? '').split(/\+(?=.)/u); const key = parts.pop() ?? '';
    const modifiers = parts.map(p => p.toLowerCase());
    const e = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const init = { key, bubbles: true, cancelable: true, ctrlKey: modifiers.includes('ctrl') || modifiers.includes('control'), shiftKey: modifiers.includes('shift'), altKey: modifiers.includes('alt'), metaKey: modifiers.includes('meta') || modifiers.includes('cmd') };
    const accepted = e.dispatchEvent(new KeyboardEvent('keydown', init));
    if (accepted && (key === 'Enter' || key === ' ') && e instanceof HTMLButtonElement && !disabled(e)) e.click();
    e.dispatchEvent(new KeyboardEvent('keyup', init));
  } else if (cmd.kind !== 'state') {
    const found = target(cmd); if (!(found instanceof HTMLElement)) return found; const e = found;
    if (cmd.kind === 'input') {
      if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) || e instanceof HTMLInputElement && ['file', 'checkbox', 'radio', 'button', 'submit'].includes(e.type) || 'readOnly' in e && e.readOnly) return fail('unsupported_control', 'This control does not accept text input.');
      e.focus();
      const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, cmd.value ?? '');
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      e.focus();
      for (const detail of cmd.kind === 'dblclick' ? [1, 2] : [1]) {
        e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
        e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }));
        e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
      }
      if (cmd.kind === 'dblclick') e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    }
  }
  await settle(); return { state: collectUiState() };
}
async function poll(c: Connection): Promise<void> {
  if (connection !== c) return;
  try {
    const { command } = await apiRequest<{ command: UiCommandDTO | null }>('/ui/sessions/' + c.id + '/poll', { uiKey: c.key, signal: AbortSignal.timeout(5000) });
    if (connection !== c) return;
    if (command) {
      let reply: UiReplyDTO;
      try { reply = await performUiCommand(command); } catch { reply = fail('ui_operation_failed', 'The interface operation failed. Inspect state before retrying.'); }
      if (connection !== c) return;
      await apiRequest('/ui/sessions/' + c.id + '/ack', { method: 'POST', uiKey: c.key, body: { commandId: command.id, reply }, signal: AbortSignal.timeout(5000) });
    }
    if (connection === c) timer = setTimeout(() => void poll(c), 750);
  } catch { if (connection === c) { uiControl.stop(); emit('UI access disconnected. Connect this tab again to resume.'); } }
}
export const uiControl = {
  getState: () => snapshot,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  async start(name: string): Promise<void> {
    if (connection || starting) return;
    starting = true; const attempt = ++generation;
    try {
      const c = await apiRequest<Connection>('/ui/sessions', { method: 'POST', body: { name }, signal: AbortSignal.timeout(5000) });
      if (attempt !== generation) { void apiRequest('/ui/sessions/' + c.id, { method: 'DELETE', uiKey: c.key }).catch(() => undefined); return; }
      connection = c; emit(); window.addEventListener('pagehide', uiControl.stop); void poll(c);
    } finally { starting = false; }
  },
  stop(): void {
    ++generation; clearTimeout(timer); const old = connection; connection = undefined;
    uiControl.stopSharing(); window.removeEventListener('pagehide', uiControl.stop); emit();
    if (old) void apiRequest('/ui/sessions/' + old.id, { method: 'DELETE', uiKey: old.key, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  },
  async share(): Promise<void> {
    if (!connection) throw new Error('Connect this tab first.');
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is unavailable in this browser.');
    const c = connection;
    const capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (connection !== c) { capture.getTracks().forEach(track => track.stop()); return; }
    uiControl.stopSharing(); stream = capture; video = document.createElement('video'); video.muted = true; video.srcObject = stream; try { await video.play(); } catch (error) { uiControl.stopSharing(); throw error; }
    capture.getVideoTracks()[0]?.addEventListener('ended', uiControl.stopSharing); emit();
  },
  stopSharing(): void { stream?.getTracks().forEach(track => track.stop()); stream = undefined; if (video) { video.pause(); video.srcObject = null; } video = undefined; emit(); },
};
