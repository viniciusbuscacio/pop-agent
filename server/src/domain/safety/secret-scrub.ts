const LABELED_SECRET = /(?:password|passphrase|token|secret|api[_ -]?key|bearer|credential|private[_ -]?key)\s*[:=]/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g;
const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b/gi,
];

/**
 * Deterministic floor for durable prose stores. It is intentionally
 * conservative: memory and generated skills are context, not secret stores.
 */
export function scrubSecrets(text: string): string {
  let scrubbed = text.replace(PRIVATE_KEY_BLOCK, '[redacted secret]');
  for (const pattern of TOKEN_PATTERNS) scrubbed = scrubbed.replace(pattern, '[redacted secret]');
  return scrubbed
    .split('\n')
    .map((line) => (LABELED_SECRET.test(line) ? '[redacted secret]' : line))
    .join('\n');
}
