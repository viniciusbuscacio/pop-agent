import { useEffect, useState } from 'react';
import type { DesktopSetupReleaseResponse } from '@pop-agent/shared';
import { t } from '../i18n';
import { desktopSetupRelease, desktopSetupTicket } from '../services/installation';
import { Button, Card } from '../ui/controls';

/**
 * Device setup instructions are generated from the origin that served this page.
 * This matters for personal installs: copying a product-wide example would point
 * the next device at somebody else's server instead of this one.
 */
export function InstallationSection() {
  const origin = window.location.origin.replace(/\/$/, '');
  const windowsCommand = `powershell -c "irm ${origin}/install.ps1 | iex"`;
  const unixCommands = `curl -fsSL ${origin}/install.sh | sh\n$HOME/.local/bin/pop login ${origin}`;
  const [setupRelease, setSetupRelease] = useState<DesktopSetupReleaseResponse>();
  const [setupUnavailable, setSetupUnavailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    let current = true;
    void desktopSetupRelease().then(
      (release) => { if (current) setSetupRelease(release); },
      () => { if (current) setSetupUnavailable(true); },
    );
    return () => { current = false; };
  }, []);

  async function downloadSetup(): Promise<void> {
    setDownloading(true);
    setDownloadError(false);
    try {
      try { await navigator.clipboard.writeText(origin); } catch { /* Setup can still ask for it. */ }
      const ticket = await desktopSetupTicket();
      const link = document.createElement('a');
      link.href = ticket.downloadPath;
      link.download = 'Pop Desktop Setup.dmg';
      link.click();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.addressTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.intro')}</p>
        </div>
        <CopyBlock value={origin} testId="installation-server-url" />
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.webTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.webBody')}</p>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--key-fg-dim)]">
          <li>{t('settings.installation.webWindows')}</li>
          <li>{t('settings.installation.webMac')}</li>
          <li>{t('settings.installation.webIphone')}</li>
          <li>{t('settings.installation.webAndroid')}</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.cliTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.cliBody')}</p>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('settings.installation.cliWindows')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.cliWindowsHint')}</p>
          <CopyBlock value={windowsCommand} testId="installation-cli-windows" />
        </section>
        <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-semibold">{t('settings.installation.cliUnix')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.cliUnixHint')}</p>
          <CopyBlock value={unixCommands} testId="installation-cli-unix" />
        </section>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.desktopTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.desktopBody')}</p>
        </div>
        <section className="flex flex-col items-start gap-2">
          <h3 className="text-sm font-semibold">{t('settings.installation.desktopMac')}</h3>
          <p className="text-sm text-[var(--key-fg-dim)]">{t('settings.installation.desktopMacSteps')}</p>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.desktopMacRequirements')}</p>
          {setupRelease !== undefined ? (
            <p className="text-xs text-[var(--muted)]" data-testid="desktop-setup-version">
              {t('settings.installation.desktopMacRelease')
                .replace('{version}', setupRelease.version)
                .replace('{size}', formatMegabytes(setupRelease.size))}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="desktop-setup-download"
            disabled={setupRelease === undefined || setupUnavailable || downloading}
            onClick={() => void downloadSetup()}
          >
            {downloading ? t('settings.installation.desktopMacDownloading') : t('settings.installation.desktopMacDownload')}
          </Button>
          {setupUnavailable ? <p className="text-xs text-[var(--muted)]">{t('settings.installation.desktopMacUnavailable')}</p> : null}
          {downloadError ? <p role="alert" className="text-xs text-[var(--danger)]">{t('settings.installation.desktopMacDownloadError')}</p> : null}
        </section>
        <section className="flex flex-col gap-1 border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-semibold">{t('settings.installation.desktopWindows')}</h3>
          <p className="text-sm text-[var(--key-fg-dim)]">{t('settings.installation.desktopWindowsBody')}</p>
        </section>
      </Card>
    </div>
  );
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CopyBlock({ value, testId }: { value: string; testId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <pre
        data-testid={testId}
        className="max-w-full overflow-x-auto rounded bg-[var(--input-bg)] p-3 font-mono text-xs"
      >
        {value}
      </pre>
      <Button type="button" size="sm" variant="ghost" data-testid={`${testId}-copy`} onClick={() => void copy()}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}
