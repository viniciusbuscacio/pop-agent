import { describe, expect, it } from 'vitest';
import { shouldResumeFollowing } from './chat-follow';

describe('live chat following', () => {
  it('stays suspended when a reader starts moving toward older content near the bottom', () => {
    expect(shouldResumeFollowing(500, 496, 4, 40)).toBe(false);
  });

  it('stays suspended when layout changes leave the reader at the same position', () => {
    expect(shouldResumeFollowing(500, 500, 0, 40)).toBe(false);
  });

  it('resumes after the reader moves toward and reaches the bottom', () => {
    expect(shouldResumeFollowing(480, 500, 0, 40)).toBe(true);
  });

  it('does not resume while the reader is still far from the bottom', () => {
    expect(shouldResumeFollowing(300, 350, 150, 40)).toBe(false);
  });
});
