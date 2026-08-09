import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from 'shiki/langs/bash.mjs';
import csharp from 'shiki/langs/csharp.mjs';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import powershell from 'shiki/langs/powershell.mjs';
import python from 'shiki/langs/python.mjs';
import sql from 'shiki/langs/sql.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import xml from 'shiki/langs/xml.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';

/**
 * A deliberately small Shiki bundle. Importing `shiki` itself registers every
 * grammar and theme, which made the service worker pre-cache roughly 10 MB of
 * syntax files on every phone. These cover the formats an agent normally emits;
 * an unknown language remains a perfectly usable plain code block.
 */
const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [
    bash,
    csharp,
    css,
    html,
    javascript,
    json,
    markdown,
    powershell,
    python,
    sql,
    tsx,
    typescript,
    xml,
    yaml,
  ],
  engine: createJavaScriptRegexEngine(),
});

export async function highlightCode(code: string, language: string): Promise<string> {
  const instance = await highlighter;
  return instance.codeToHtml(code, {
    lang: language,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}
