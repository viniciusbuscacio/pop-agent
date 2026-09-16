import type { ExecutionMode } from '../../domain/chat/chat.js';

const LOOP_NOTE = /^\[Pop Loop command: [^\r\n]*\]\n\n/u;

/** Interpret only the raw owner turn, before channel, attachment or skill framing. */
export function frameLoopCommand(text: string, mode: ExecutionMode): string {
  const match = /^\/loop(?:\s+([\s\S]*))?$/i.exec(text);
  if (match === null) return text;
  const task = (match[1] ?? '').trim();
  const instruction = task.length === 0
    ? 'No task was supplied. Explain usage: /loop <task>. Ask for the task and target Git repository; do not invoke run_loop.'
    : mode === 'plan'
      ? 'Plan Mode is active. Stay read-only, explain that Loop requires Normal Mode, and do not invoke run_loop or implement the task.'
      : 'The owner explicitly requests Pop Loop for the task below. Use run_loop, not direct implementation or delegate_worker. Resolve the target absolute Git repository from owner-authorized context; ask for clarification if the task or repository is unclear. If Loop is unavailable or fails, report it without falling back to direct writes. Approval is a private handoff: inspect and integrate it, validate and commit within the owner-requested scope. It does not independently authorize publication or activation.';
  return `[Pop Loop command: ${instruction}]\n\n${text}`;
}

/** Runtime instructions must not influence skill relevance. */
export function withoutLoopCommandNote(prompt: string): string {
  return prompt.replace(LOOP_NOTE, '');
}
