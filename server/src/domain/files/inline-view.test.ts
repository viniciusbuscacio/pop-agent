import { describe, expect, it } from 'vitest';
import { inlineView } from './inline-view.js';

describe('inlineView', () => {
  it('shows the types a browser renders without running them', () => {
    expect(inlineView('application/pdf')).toEqual({ contentType: 'application/pdf' });
    expect(inlineView('image/png')).toEqual({ contentType: 'image/png' });
    expect(inlineView('audio/mpeg')).toEqual({ contentType: 'audio/mpeg' });
    expect(inlineView('video/mp4')).toEqual({ contentType: 'video/mp4' });
    expect(inlineView('text/plain')).toEqual({ contentType: 'text/plain' });
  });

  it('refuses the scriptable types that hide inside safe-looking families', () => {
    // An uploaded page shown inline runs on Popy's origin, where the session
    // token lives. These two are the whole reason the rule is an allowlist.
    expect(inlineView('image/svg+xml')).toBeUndefined();
    expect(inlineView('text/html')).toBeUndefined();
    expect(inlineView('application/xhtml+xml')).toBeUndefined();
  });

  it('downloads anything it does not recognise', () => {
    expect(inlineView('application/zip')).toBeUndefined();
    expect(
      inlineView('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBeUndefined();
    expect(inlineView('application/octet-stream')).toBeUndefined();
    expect(inlineView('')).toBeUndefined();
  });

  it('relabels text-ish files so they are read instead of saved', () => {
    for (const mime of ['text/markdown', 'application/json', 'text/csv']) {
      expect(inlineView(mime)).toEqual({ contentType: 'text/plain; charset=utf-8' });
    }
  });

  it('reads the type out of a full header, case and parameters included', () => {
    expect(inlineView('APPLICATION/PDF')).toEqual({ contentType: 'application/pdf' });
    expect(inlineView('text/plain; charset=iso-8859-1')).toEqual({ contentType: 'text/plain' });
    expect(inlineView('IMAGE/SVG+XML; foo=bar')).toBeUndefined();
  });
});
