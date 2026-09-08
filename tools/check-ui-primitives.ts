import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const forbiddenNativeControls = new Set(['button', 'input', 'select', 'textarea']);
const skinnedPrimitives = new Set([
  'Button',
  'Card',
  'Checkbox',
  'IconButton',
  'Menu',
  'SearchField',
  'Select',
  'TextArea',
  'TextField',
]);
const forbiddenSkinClass = /(?:^|[\s'"`])(?:rounded(?:-|\b)|border(?:-|\b)|bg-|shadow(?:-|\b)|outline(?:-|\b)|focus:|ring(?:-|\b))/;
const implementationFile = 'web/src/ui/controls.tsx';
const settingsFiles = new Set([
  'settings-page.tsx', 'providers-section.tsx', 'oauth-section.tsx',
  'skill-editor.tsx', 'installation-section.tsx', 'backup-section.tsx',
  'rest-server-panel.tsx', 'rest-clients-panel.tsx', 'a2a-server-panel.tsx',
]);
const typedControls = new Set(['Button', 'TextField', 'TextArea', 'Select', 'SearchField']);
const typographyOverride = /(?:^|[\s'"`])(?:[\w-]+:)*(?:font-|text-(?:xs|sm|base|lg|[2-9]?xl)(?=[\s'"`])|leading-|tracking-)/;

export function uiPrimitiveErrors(root: string): string[] {
  const sourceRoot = join(root, 'web/src');
  const errors: string[] = [];
  for (const path of walk(sourceRoot)) {
    if (!path.endsWith('.tsx') || path.endsWith('.test.tsx')) continue;
    const repoPath = relative(root, path).replaceAll('\\', '/');
    if (repoPath === implementationFile) continue;
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function inspect(node: ts.Node): void {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (forbiddenNativeControls.has(tag)) {
          report(node, `native <${tag}> is forbidden; use a primitive from ui/controls.tsx`);
        }
        if (tag === 'div' && hasLiteralRole(node.attributes, 'menu', source)) {
          report(node, 'a hand-written role="menu" shell is forbidden; use <Menu>');
        }
        if (skinnedPrimitives.has(tag)) {
          const className = attributeSource(node.attributes, 'className', source);
          if (className !== undefined && forbiddenSkinClass.test(className)) {
            report(node, `${tag} className may contain layout only; its visual skin belongs to ui/controls.tsx`);
          }
          if (settingsFiles.has(repoPath.split('/').at(-1) ?? '') && typedControls.has(tag)
            && className !== undefined && typographyOverride.test(className)) {
            report(node, `${tag} Settings typography must use the shared primitive, not a className override`);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }

    function report(node: ts.Node, message: string): void {
      const at = source.getLineAndCharacterOfPosition(node.getStart(source));
      errors.push(`${repoPath}:${at.line + 1}:${at.character + 1} ${message}`);
    }

    inspect(source);
    for (const match of text.matchAll(/focus:border-\[var\(--accent\)\]/g)) {
      const before = text.slice(0, match.index);
      const line = before.split('\n').length;
      errors.push(`${repoPath}:${line}:1 duplicate focus border is forbidden; the global focus ring owns focus`);
    }
    for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const before = text.slice(0, match.index);
      const line = before.split('\n').length;
      errors.push(`${repoPath}:${line}:1 literal colors are forbidden; add a semantic token to styles/tokens.css`);
    }
  }
  return errors;
}

function attributeSource(
  attributes: ts.JsxAttributes,
  name: string,
  source: ts.SourceFile,
): string | undefined {
  const attribute = attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(source) === name,
  );
  return attribute?.getText(source);
}

function hasLiteralRole(
  attributes: ts.JsxAttributes,
  expected: string,
  source: ts.SourceFile,
): boolean {
  return attributes.properties.some((property) => {
    if (!ts.isJsxAttribute(property) || property.name.getText(source) !== 'role') return false;
    return property.initializer !== undefined && ts.isStringLiteral(property.initializer) && property.initializer.text === expected;
  });
}

function* walk(path: string): Generator<string> {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) yield* walk(child);
    else yield child;
  }
}

export function assertUiPrimitives(root: string): void {
  const errors = uiPrimitiveErrors(root);
  if (errors.length > 0) {
    throw new Error(`UI design-system check failed:\n- ${errors.join('\n- ')}`);
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    assertUiPrimitives(root);
    console.log('UI design-system check passed');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
