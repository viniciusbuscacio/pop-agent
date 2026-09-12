import { useId, useState } from 'react';
import { updateDiagnostics } from '../services/update-diagnostics';
import { Button, TextArea } from './controls';
import { t } from '../i18n';

export function UpdateDiagnostics() {
  const id = useId();
  const [fallback, setFallback] = useState<string>();
  const [copied, setCopied] = useState(false);
  async function copy() {
    const text = updateDiagnostics();
    try { await navigator.clipboard.writeText(text); setCopied(true); setFallback(undefined); }
    catch { setFallback(text); setCopied(false); }
  }
  return <div className="flex max-w-full flex-col gap-2">
    <Button type="button" variant="ghost" data-testid="update-copy-diagnostics" onClick={() => void copy()}>
      {t(copied ? 'common.copied' : 'update.copyDiagnostics')}
    </Button>
    {fallback !== undefined ? <TextArea id={id} aria-label={t('update.diagnostics')} value={fallback} readOnly rows={6} onFocus={event => event.target.select()} /> : null}
  </div>;
}
