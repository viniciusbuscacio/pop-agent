import { describe, expect, it } from 'vitest';
import { fallbackTitle } from './title.js';

describe('fallback chat title', () => {
  it('keeps the words that carry the meaning', () => {
    expect(fallbackTitle('can you help me plan the grocery shopping for tomorrow')).toBe(
      'Help Plan Grocery Shopping',
    );
  });

  it('works in Portuguese too', () => {
    expect(fallbackTitle('me ajuda a organizar as contas do mes que vem')).toBe(
      'Ajuda Organizar Contas Mes',
    );
  });

  it('never returns more than four words', () => {
    expect(fallbackTitle('alpha bravo charlie delta echo foxtrot').split(' ')).toHaveLength(4);
  });

  it('falls back to the raw words when everything is a stop-word', () => {
    expect(fallbackTitle('what is it')).toBe('What Is It');
  });

  it('strips markdown noise and punctuation', () => {
    expect(fallbackTitle('**deploy** the `server`, please!')).toBe('Deploy Server');
  });

  it('de-duplicates against titles already in use', () => {
    expect(fallbackTitle('deploy the server', ['Deploy Server'])).toBe('Deploy Server 2');
    expect(fallbackTitle('deploy the server', ['Deploy Server', 'Deploy Server 2'])).toBe(
      'Deploy Server 3',
    );
  });

  it('handles a message with nothing usable in it', () => {
    expect(fallbackTitle('...')).toBe('New chat');
    expect(fallbackTitle('')).toBe('New chat');
  });

  it('does not run away with a very long word', () => {
    expect(fallbackTitle('x'.repeat(500)).length).toBeLessThanOrEqual(60);
  });
});
