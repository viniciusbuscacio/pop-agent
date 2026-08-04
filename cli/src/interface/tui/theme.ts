import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui';

/**
 * The look, and the ANSI to paint it (docs/cli.md, "Screen").
 *
 * pi-tui ships no default theme -- its own README imports one from its test
 * folder -- so every component that takes a theme needs one written here.
 * That is the seam where "Popy's head in pi's shape" actually happens: the
 * widgets and the rendering come from the library, the colours are ours.
 *
 * Hand-rolled escapes rather than a colour library: the whole need is eight
 * SGR codes, and `@popy/cli` is meant to install anywhere without dragging a
 * dependency tree behind it.
 */

const ESC = '[';
const wrap = (open: number, close: number) => (text: string) =>
  text.length === 0 ? text : `${ESC}${String(open)}m${text}${ESC}${String(close)}m`;

export const paint = {
  dim: wrap(2, 22),
  bold: wrap(1, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  strike: wrap(9, 29),
  cyan: wrap(36, 39),
  blue: wrap(34, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  grey: wrap(90, 39),
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: paint.cyan,
  selectedText: paint.cyan,
  description: paint.dim,
  scrollInfo: paint.dim,
  noMatch: paint.dim,
};

export const editorTheme: EditorTheme = {
  borderColor: paint.grey,
  selectList: selectListTheme,
};

/**
 * Markdown in a terminal. Code blocks are left unhighlighted on purpose:
 * `highlightCode` is optional, and a syntax highlighter is a large dependency
 * to carry for something the eye reads fine in one colour.
 */
export const markdownTheme: MarkdownTheme = {
  heading: (text) => paint.bold(paint.cyan(text)),
  link: paint.blue,
  linkUrl: paint.dim,
  code: paint.yellow,
  codeBlock: (text) => text,
  codeBlockBorder: paint.grey,
  quote: paint.dim,
  quoteBorder: paint.grey,
  hr: paint.grey,
  listBullet: paint.cyan,
  bold: paint.bold,
  italic: paint.italic,
  strikethrough: paint.strike,
  underline: paint.underline,
};
