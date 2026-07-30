import { useState } from 'react';
import { t } from '../i18n';
import { Button } from './controls';

/**
 * The recovery key, shown the only time it exists in the clear. Copy and
 * download both matter: copy is convenient, and a downloaded file is what
 * survives the browser being closed on the wrong tab.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  idPrefix,
}: {
  recoveryKey: string;
  idPrefix: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the key is on screen either way.
    }
  }

  function download(): void {
    const blob = new Blob([`${recoveryKey}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = t('setup.recovery.filename');
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        data-testid={`${idPrefix}-recovery-key`}
        className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-center font-mono text-base tracking-widest break-all select-all"
      >
        {recoveryKey}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          data-testid={`${idPrefix}-copy-key`}
          onClick={() => void copy()}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          data-testid={`${idPrefix}-download-key`}
          onClick={download}
        >
          {t('common.download')}
        </Button>
      </div>
    </div>
  );
}
