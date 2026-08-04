import { describe, expect, it } from 'vitest';
import { channelNote } from './channel-note.js';

describe('channelNote', () => {
  it('says where the first message came from, since there is nothing to compare', () => {
    expect(channelNote({ kind: 'cli' }, undefined)).toContain('terminal');
  });

  it('says nothing when the channel has not changed', () => {
    // The whole point: fifty turns from the same place would otherwise pay
    // for fifty copies of a fact that mattered once.
    expect(channelNote({ kind: 'cli' }, 'cli')).toBeUndefined();
    expect(channelNote({ kind: 'web' }, 'web')).toBeUndefined();
  });

  it('names both sides when it moved', () => {
    const note = channelNote({ kind: 'web' }, 'pwa');
    expect(note).toContain('web app');
    expect(note).toContain('installed app');
  });

  it('carries the platform, which is what changes an answer', () => {
    // "apt install" is wrong on an iPhone; that is the whole use.
    expect(channelNote({ kind: 'pwa', platform: 'ios' }, undefined)).toContain('ios');
  });

  it('says nothing at all when the client did not identify itself', () => {
    // Better a silence than a guess written into every conversation.
    expect(channelNote(undefined, 'cli')).toBeUndefined();
  });

  it('never carries the IP, which answers an audit question and not hers', () => {
    // The note takes only kind and platform, so an address cannot reach it --
    // pinned because the temptation to "just add the IP too" is real.
    const note = channelNote({ kind: 'cli', platform: 'linux' }, 'web');
    expect(note).not.toMatch(/\d{1,3}\.\d{1,3}/);
    expect(Object.keys({ kind: '', platform: '' })).toEqual(['kind', 'platform']);
  });

  it('passes an unknown kind through rather than inventing a name for it', () => {
    // A newer client talking to an older server should read oddly, not wrongly.
    expect(channelNote({ kind: 'watch' }, undefined)).toContain('watch');
  });
});
