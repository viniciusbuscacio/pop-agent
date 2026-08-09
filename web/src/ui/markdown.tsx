import { Children, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../i18n';

/**
 * Assistant text as markdown (pop-agent.spec §14). Raw HTML is not enabled: the
 * content comes from a model, which means it comes from whatever the model
 * read, and a conversation should not be able to inject markup into the app.
 *
 * Code blocks are highlighted by Shiki, imported on demand so the highlighter
 * is not in the bundle that has to load before the login screen.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown flex flex-col gap-3 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: PreBlock,
          code: ({ className, children }) =>
            className === undefined ? (
              <code className="rounded bg-[var(--input-bg)] px-1.5 py-0.5 font-mono text-[0.9em]">
                {children}
              </code>
            ) : (
              <code className={className}>{children}</code>
            ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--border)] px-2 py-1 text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--border)] px-2 py-1">{children}</td>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function PreBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0] as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;

  const className = child?.props.className ?? '';
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'text';
  const code = String(child?.props.children ?? '').replace(/\n$/, '');

  return <CodeBlock code={code} language={language} />;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { highlightCode } = await import('../lib/syntax-highlighter');
        const highlighted = await highlightCode(code, language);
        if (!cancelled) setHtml(highlighted);
      } catch {
        // An unknown language (or a failed chunk load) simply stays plain.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied; the text is on screen either way
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="flex items-center justify-between bg-[var(--input-bg)] px-3 py-1 text-xs text-[var(--muted)]">
        <span>{language}</span>
        <button
          type="button"
          data-testid="code-copy"
          onClick={() => void copy()}
          className="rounded px-2 py-0.5 hover:bg-[var(--hover-overlay)]"
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      {html === undefined ? (
        <pre className="overflow-x-auto bg-[var(--input-bg)] p-3 font-mono text-sm">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="code-shiki overflow-x-auto text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}
