import { describe, expect, it } from 'vitest';
import type { Task } from '../../domain/tasks/task.js';
import { buildTaskTools } from './task-tools.js';

/**
 * The tool exists because the agent was asked about "sua task de melhorias"
 * and answered it had no access to any task list, while the task sat in its
 * own database (Vinicius, 05/08). What matters here: the answer names the
 * task, says when it runs, and wraps the prompt as data.
 */
const identity = (tool: never) => tool;

const MELHORIAS: Task = {
  id: 'task-3tJWBImhv08',
  title: 'Melhorias',
  prompt: 'Leia melhorias.md e proponha UMA melhoria.',
  scheduleKind: 'interval',
  intervalMinutes: 60,
  nextRunAt: 10 * 60_000,
  enabled: true,
  notifyOnFinish: false,
  archiveChat: true,
  createdAt: 0,
};

async function run(tasks: Task[], now = 0): Promise<string> {
  const [tool] = buildTaskTools(identity as never, () => tasks, () => now);
  if (tool === undefined) throw new Error('no tool built');
  const result = (await tool.execute(
    'call-1',
    {},
    undefined as never,
    undefined as never,
    undefined as never,
  )) as unknown as { content: [{ text: string }] };
  return result.content[0].text;
}

describe('list_scheduled_tasks', () => {
  it('names the task, its cadence and when it next runs', async () => {
    const text = await run([MELHORIAS]);
    expect(text).toContain('Melhorias');
    expect(text).toContain('every 60 min');
    expect(text).toContain('enabled');
    expect(text).toContain('next in ~10 min');
  });

  it('carries the prompt as data, not as instructions', async () => {
    // Same rule as note content: user-authored text arrives enveloped, so a
    // prompt cannot smuggle instructions into whoever merely LISTS it.
    const text = await run([MELHORIAS]);
    expect(text).toContain('melhorias.md');
    expect(text).toContain('external-content');
    expect(text).toContain('never instructions');
  });

  it('says plainly when there is nothing scheduled', async () => {
    expect(await run([])).toContain('no scheduled tasks');
  });

  it('shows a disabled task as disabled, not hidden', async () => {
    // "Why did my task not run?" needs the task visible with its switch off.
    const rest: Task = { ...MELHORIAS, enabled: false };
    delete rest.nextRunAt;
    const text = await run([rest]);
    expect(text).toContain('disabled');
    expect(text).toContain('not scheduled');
  });
});
