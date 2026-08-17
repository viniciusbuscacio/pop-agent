/**
 * Which uploads may be shown in the browser instead of saved to disk
 * (docs/specs/Spec-Pop-General.md §14, RF-004–008).
 *
 * "Open file" is worth having, but serving arbitrary uploaded bytes inline
 * from Pop Agent's own origin is how a file steals a session: an uploaded .html or
 * .svg rendered inline runs its own script with access to this origin's
 * storage, which is where the session token lives. So the answer is an
 * allowlist of things that cannot execute -- never a denylist, because the
 * next dangerous type is always one the denylist has not heard of.
 *
 * `text/html` and `image/svg+xml` are the two that look harmless and are not.
 * They are absent on purpose; they download, like everything unrecognised.
 *
 * Text that is not `text/plain` (markdown, csv, json, source code) would be
 * downloaded by the browser rather than displayed, so it is shown AS plain
 * text: the bytes are unchanged, only the label the browser reads. That
 * relabelling is also what makes it safe -- an .md full of markup is text,
 * not a document.
 */

/** Exact types the browser renders without running anything. */
const VIEWABLE_EXACT = new Set(['application/pdf', 'text/plain']);

/** Whole families that are decoded, never executed. */
const VIEWABLE_FAMILIES = ['image/', 'audio/', 'video/'];

/** Scriptable types that a family rule would otherwise wave through. */
const NEVER_INLINE = new Set(['image/svg+xml', 'text/html', 'text/xml', 'application/xhtml+xml']);

/** Text-ish types shown as plain text rather than offered as a download. */
const AS_PLAIN_TEXT = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
];

export interface InlineView {
  /** What the browser should be told the bytes are. */
  contentType: string;
}

/**
 * The content type to serve inline for `mime`, or undefined when the file has
 * to be downloaded instead. Undefined is the safe answer and the default.
 */
export function inlineView(mime: string): InlineView | undefined {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.length === 0) return undefined;
  if (NEVER_INLINE.has(type)) return undefined;

  if (VIEWABLE_EXACT.has(type)) return { contentType: type };
  if (VIEWABLE_FAMILIES.some((family) => type.startsWith(family))) return { contentType: type };
  // Relabelled, not reinterpreted: the browser shows the characters as they
  // are instead of saving the file.
  if (AS_PLAIN_TEXT.some((family) => type.startsWith(family))) {
    return { contentType: 'text/plain; charset=utf-8' };
  }

  return undefined;
}
