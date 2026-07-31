import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

/**
 * Best-effort text extraction from an artifact's bytes (popy.spec §14,
 * RF-011/012), using system binaries rather than heavy JS dependencies:
 *
 *   - PDF  → `pdftotext` (poppler)
 *   - DOCX → `unzip` of `word/document.xml`, tags stripped
 *   - image → `tesseract` OCR
 *
 * Every path is best-effort: a failure (missing binary, timeout, unreadable
 * file) returns undefined, and the caller falls back to "binary, not inlined".
 * Extracted text is still untrusted content -- the caller wraps it in the
 * safety envelope before the model sees it.
 */
export interface ArtifactExtractor {
  extract(bytes: Buffer, mime: string, name: string): Promise<string | undefined>;
}

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 200_000;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const OCR_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'image/bmp']);

export interface BinaryExtractorOptions {
  pdftotext?: string;
  unzip?: string;
  tesseract?: string;
  /** OCR languages, tesseract syntax. Default por+eng. */
  ocrLanguages?: string;
}

export class BinaryArtifactExtractor implements ArtifactExtractor {
  private readonly pdftotext: string;
  private readonly unzip: string;
  private readonly tesseract: string;
  private readonly ocrLanguages: string;

  constructor(options: BinaryExtractorOptions = {}) {
    this.pdftotext = options.pdftotext ?? 'pdftotext';
    this.unzip = options.unzip ?? 'unzip';
    this.tesseract = options.tesseract ?? 'tesseract';
    this.ocrLanguages = options.ocrLanguages ?? 'por+eng';
  }

  async extract(bytes: Buffer, mime: string, name: string): Promise<string | undefined> {
    try {
      if (mime === 'application/pdf') return await this.pdf(bytes);
      if (mime === DOCX_MIME) return await this.docx(bytes);
      if (OCR_MIMES.has(mime)) return await this.ocr(bytes, name);
      return undefined;
    } catch {
      // Best-effort: an extraction that fails is not an error, just no text.
      return undefined;
    }
  }

  private async pdf(bytes: Buffer): Promise<string | undefined> {
    const out = await run(this.pdftotext, ['-q', '-', '-'], bytes);
    return nonEmpty(out);
  }

  private async docx(bytes: Buffer): Promise<string | undefined> {
    return withTempFile(bytes, '.docx', async (file) => {
      const xml = await run(this.unzip, ['-p', file, 'word/document.xml'], undefined);
      return nonEmpty(docxXmlToText(xml));
    });
  }

  private async ocr(bytes: Buffer, name: string): Promise<string | undefined> {
    const ext = extname(name) || '.png';
    return withTempFile(bytes, ext, async (file) => {
      const out = await run(this.tesseract, [file, 'stdout', '-l', this.ocrLanguages], undefined);
      return nonEmpty(out);
    });
  }
}

/** Turns Word's document XML into plain text: paragraphs become newlines. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nonEmpty(text: string): string | undefined {
  const trimmed = text.slice(0, MAX_OUTPUT_CHARS).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

async function withTempFile<T>(
  bytes: Buffer,
  ext: string,
  use: (file: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'popy-extract-'));
  const file = join(dir, `input${ext.startsWith('.') ? ext : `.${ext}`}`);
  try {
    writeFileSync(file, bytes);
    return await use(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[], input: Buffer | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    let settled = false;

    const finish = (error: Error | undefined, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else resolve(value ?? '');
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${cmd} timed out`));
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (out.length < MAX_OUTPUT_CHARS) out += chunk;
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) =>
      code === 0 ? finish(undefined, out) : finish(new Error(`${cmd} exited ${String(code)}`)),
    );

    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}
