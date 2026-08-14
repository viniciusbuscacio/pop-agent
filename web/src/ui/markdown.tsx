import { Children, memo, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable } from './controls';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../i18n';
import { saveFromLink } from '../lib/download';
import { filesService } from '../services/artifacts';

/**
 * Assistant text as markdown (pop-agent.spec §14). Raw HTML is not enabled: the
 * content comes from a model, which means it comes from whatever the model
 * read, and a conversation should not be able to inject markup into the app.
 *
 * Code blocks are highlighted by Shiki, imported on demand so the highlighter
 * is not in the bundle that has to load before the login screen.
 */
function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown flex min-w-0 flex-col gap-3 leading-relaxed break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
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
          // `urlTransform` keeps the internal image scheme long enough for
          // MarkdownImage to resolve it. Links still get the stock sanitizer:
          // an assistant cannot turn attachment:// into an external app launch.
          a: ({ href, children }) => {
            const safe = defaultUrlTransform(href ?? '');
            return (
              <a
                href={safe.length === 0 ? undefined : safe}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--accent)] underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          img: MarkdownImage,
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
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

/** Parsing GFM and highlighting code is skipped when an unchanged row is revisited. */
export const Markdown = memo(MarkdownView);

/**
 * A generated image is persisted in Files, not copied into the message row.
 * Keep a stable path in markdown and mint a fresh signed URL when it is viewed:
 * unlike a URL saved in message content, this still works after the 30-day link
 * lifetime. The browser's load event is the final witness that the bytes really
 * decoded; file existence on the server alone cannot prove that.
 */
function MarkdownImage({
  src = '',
  alt = '',
}: {
  src?: string | undefined;
  alt?: string | undefined;
}) {
  const path = internalFilePath(src);
  const [resolved, setResolved] = useState<{ preview: string; download: string } | undefined>(
    path === undefined && src.length > 0 ? { preview: src, download: src } : undefined,
  );
  const [failed, setFailed] = useState(src.length === 0);

  useEffect(() => {
    let cancelled = false;
    setFailed(src.length === 0);

    if (path === undefined) {
      setResolved(src.length === 0 ? undefined : { preview: src, download: src });
      return () => {
        cancelled = true;
      };
    }

    setResolved(undefined);
    void filesService.link(path).then(
      (download) => {
        if (!cancelled) setResolved({ preview: `${download}&inline=1`, download });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, src]);

  const label = alt.length > 0 ? alt : (path?.split('/').at(-1) ?? t('chat.image'));
  if (failed) {
    return (
      <span
        className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--muted)]"
        data-testid="markdown-image-fallback"
      >
        <span>{t('chat.imagePreviewFailed', { name: label })}</span>
        {resolved === undefined ? (
          <a className="text-[var(--accent)] underline underline-offset-2" href="/files">
            {t('chat.openFiles')}
          </a>
        ) : path === undefined ? (
          <a
            className="text-[var(--accent)] underline underline-offset-2"
            href={resolved.download}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('chat.openImage')}
          </a>
        ) : (
          <Pressable
            type="button"
            className="text-[var(--accent)] underline underline-offset-2"
            onClick={() => saveFromLink(resolved.download)}
          >
            {t('chat.downloadImage')}
          </Pressable>
        )}
      </span>
    );
  }

  if (resolved === undefined) {
    return (
      <span className="text-sm text-[var(--muted)]" data-testid="markdown-image-loading">
        {t('chat.imageLoading', { name: label })}
      </span>
    );
  }

  return (
    <img
      src={resolved.preview}
      alt={alt}
      loading="lazy"
      className="max-h-[32rem] max-w-full rounded-xl object-contain"
      data-testid="markdown-image"
      onLoad={(event) => {
        // A load with no decoded dimensions is still a broken preview (notably
        // malformed image bytes returned with a plausible extension).
        if (event.currentTarget.naturalWidth === 0 || event.currentTarget.naturalHeight === 0) {
          setFailed(true);
        }
      }}
      onError={() => setFailed(true)}
    />
  );
}

/** Preserve only Pop Agent's internal image references; sanitize everything else normally. */
function markdownUrlTransform(value: string): string {
  return internalFilePath(value) === undefined ? defaultUrlTransform(value) : value;
}

/** A Files-relative path carried by current, future, or already-persisted messages. */
export function internalFilePath(source: string): string | undefined {
  let raw: string | undefined;
  let encoded = true;
  if (source.startsWith('attachment://')) raw = source.slice('attachment://'.length);
  else if (source.startsWith('files://')) raw = source.slice('files://'.length);
  else if (source.startsWith('Files/')) raw = source.slice('Files/'.length);
  else if (source.startsWith('./Files/')) raw = source.slice('./Files/'.length);
  else if (source.startsWith('/Files/')) raw = source.slice('/Files/'.length);
  else if (source.startsWith('/files/download?')) {
    try {
      // URLSearchParams already decodes once. Decoding it again would turn a
      // literal "%20" in a filename into a space when an old link is renewed.
      raw = new URL(source, 'http://pop.invalid').searchParams.get('path') ?? undefined;
      encoded = false;
    } catch {
      return undefined;
    }
  }
  if (raw === undefined) return undefined;

  let path: string;
  try {
    path = (encoded ? decodeURIComponent(raw) : raw).replace(/^\/+/, '');
  } catch {
    return undefined;
  }
  if (
    path.length === 0 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    return undefined;
  }
  return path;
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

    // Plain text has nothing to highlight. Keeping its original <pre> avoids
    // replacing the whole block after the large Shiki chunk loads, which is a
    // visible flash for short hashes, commit IDs and command output.
    if (isPlainCodeLanguage(language)) {
      return () => {
        cancelled = true;
      };
    }

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
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="flex min-w-0 items-center justify-between bg-[var(--input-bg)] px-3 py-1 text-xs text-[var(--muted)]">
        <span className="min-w-0 truncate">{language}</span>
        <Pressable
          type="button"
          data-testid="code-copy"
          onClick={() => void copy()}
          className="rounded px-2 py-0.5 hover:bg-[var(--hover-overlay)]"
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Pressable>
      </div>
      {html === undefined ? (
        <pre className="max-w-full overflow-x-auto bg-[var(--input-bg)] p-3 font-mono text-sm">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="code-shiki max-w-full overflow-x-auto text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

function isPlainCodeLanguage(language: string): boolean {
  return language === 'text' || language === 'txt' || language === 'plaintext';
}
