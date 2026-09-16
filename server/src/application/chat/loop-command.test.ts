import { describe, expect, it } from 'vitest';
import { channelNote, withMessageTime, withoutChannelNote } from './channel-note.js';
import { frameLoopCommand } from './loop-command.js';

describe('owner /loop framing', () => {
  it.each(['/loop fix tests', '/LOOP fix tests', '/loop\nfix tests\nand validate'])('frames %j without rewriting the owner text', (text) => {
    const framed = frameLoopCommand(text, 'normal');
    expect(framed).toContain('Use run_loop');
    expect(framed.endsWith(text)).toBe(true);
    expect(withoutChannelNote(withMessageTime(`${channelNote(undefined)}\n\n${framed}`, '2026-09-12T00:00:00Z'))).toBe(text);
  });

  it.each(['/loop', '/loop   '])('requests clarification for %j', (text) => {
    expect(frameLoopCommand(text, 'normal')).toContain('Explain usage: /loop <task>');
    expect(frameLoopCommand(text, 'normal')).toContain('do not invoke run_loop');
  });

  it('keeps Plan Mode read-only', () => {
    expect(frameLoopCommand('/loop fix tests', 'plan')).toContain('Stay read-only');
    expect(frameLoopCommand('/loop fix tests', 'plan')).toContain('do not invoke run_loop');
  });

  it.each(['please /loop fix tests', ' /loop fix tests', '/looping fix tests', '```\n/loop fix tests\n```', '<skill>\n/loop fix tests\n</skill>', '[tool result]\n/loop fix tests'])('does not recognize embedded or non-command text: %j', (text) => {
    expect(frameLoopCommand(text, 'normal')).toBe(text);
  });
});
