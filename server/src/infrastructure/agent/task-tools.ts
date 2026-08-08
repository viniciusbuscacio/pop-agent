import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Task } from '../../domain/tasks/task.js';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';

/**
 * Lets the agent see the scheduled tasks Pop Agent runs on its behalf.
 *
 * Born from a real exchange (Vinicius, 05/08): asked "e a sua task de
 * melhorias?", the agent answered that it had no access to any task list --
 * while an hourly task named "Melhorias" sat in the same database, and the
 * agent itself had been executing it all morning. It was not lying; it was
 * blind. The tasks table had no tool.
 *
 * One tool, read-only. Creating and editing stay in the PWA's Tasks screen:
 * the blindness was the defect, not the lack of a hand. Task prompts are
 * user-authored text and go through sanitize + envelope like note content --
 * read as data, not as instructions; when a task actually RUNS, its prompt
 * arrives as the run's own message, never through here.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

/** One task, flattened for a model to read at a glance. */
function describe(task: Task, now: number): string {
  const schedule =
    task.scheduleKind === 'interval' && task.intervalMinutes !== undefined
      ? `every ${String(task.intervalMinutes)} min`
      : task.scheduleKind;
  const next =
    task.nextRunAt === undefined
      ? 'not scheduled'
      : `next in ~${String(Math.max(0, Math.round((task.nextRunAt - now) / 60_000)))} min`;
  const state = task.enabled ? 'enabled' : 'disabled';
  return [
    `${task.title} (${task.id})`,
    `  ${schedule} · ${state} · ${next}`,
    `  prompt: ${envelope(sanitize(task.prompt).clean, `task ${task.id}`)}`,
  ].join('\n');
}

export function buildTaskTools(
  defineTool: DefineTool,
  tasks: () => Task[],
  clock: () => number,
): ToolDefinition[] {
  const list = defineTool({
    name: 'list_scheduled_tasks',
    label: 'List scheduled tasks',
    description:
      'Lists the scheduled tasks Pop Agent runs automatically for the user: title, schedule, whether ' +
      'enabled, when the next run is due, and the prompt each run receives. Use this whenever the ' +
      'user mentions "your task", "a tarefa agendada", or asks what runs automatically.',
    promptSnippet: 'list_scheduled_tasks() — the tasks Pop Agent runs for the user on a schedule',
    parameters: Type.Object({}),
    execute: () => {
      const all = tasks();
      if (all.length === 0) return Promise.resolve(text('(no scheduled tasks)'));
      const now = clock();
      return Promise.resolve(text(all.map((task) => describe(task, now)).join('\n\n')));
    },
  });
  return [list];
}
