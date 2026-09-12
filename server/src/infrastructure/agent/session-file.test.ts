import { describe, expect, it, vi } from 'vitest';
import { resumeOrCreate } from './session-file.js';

describe('resumeOrCreate', () => {
  it('resumes an existing session', () => {
    const create = vi.fn(() => 'new');

    expect(resumeOrCreate({ sessionFile: '/sessions/chat.jsonl', create, open: () => 'old' })).toBe(
      'old',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('starts fresh when the stored session disappeared', () => {
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const onMissing = vi.fn();

    expect(
      resumeOrCreate({
        sessionFile: '/old-data/chat.jsonl',
        create: () => 'new',
        open: () => {
          throw missing;
        },
        onMissing,
      }),
    ).toBe('new');
    expect(onMissing).toHaveBeenCalledWith('/old-data/chat.jsonl');
  });

  it('does not hide corrupt or unreadable sessions', () => {
    expect(() =>
      resumeOrCreate({
        sessionFile: '/sessions/chat.jsonl',
        create: () => 'new',
        open: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      }),
    ).toThrow('denied');
  });
});
