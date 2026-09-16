import { describe, expect, it } from 'vitest';
import { parseComposerDelivery, slashCommands } from './slash-menu';

describe('/loop', () => {
  it('is discoverable and retains its original text on the normal message path', () => {
    expect(slashCommands().find((command) => command.name === 'loop')?.description).toContain('/loop <task>');
    expect(parseComposerDelivery('/loop fix tests')).toEqual({ text: '/loop fix tests', delivery: 'steer' });
    expect(parseComposerDelivery('/queue /loop fix tests')).toEqual({ text: '/loop fix tests', delivery: 'follow_up' });
  });
});

describe('/queue', () => {
  it('appears with the inherited pi session commands', () => {
    expect(slashCommands().map((command) => command.name)).toEqual(
      expect.arrayContaining(['queue', 'compact', 'session', 'name', 'export', 'fork']),
    );
  });

  it('strips the command and selects the old follow-up behavior', () => {
    expect(parseComposerDelivery('/queue summarize this later')).toEqual({
      text: 'summarize this later',
      delivery: 'follow_up',
    });
  });

  it('keeps ordinary messages on steering by default', () => {
    expect(parseComposerDelivery('change course now')).toEqual({
      text: 'change course now',
      delivery: 'steer',
    });
  });
});
