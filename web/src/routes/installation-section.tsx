import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LocalConnectionDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import {
  installPwa,
  pwaInstallStatus,
  subscribePwaInstall,
} from '../services/pwa-install';
import { localAccessService } from '../services/local-access';
import {
  selectLocalConnection,
  selectedLocalConnection,
} from '../services/local-connection-selection';
import { Button, Card, Select } from '../ui/controls';

/**
 * Device setup instructions are generated from the origin that served this page.
 * This matters for personal installs: copying a product-wide example would point
 * the next device at somebody else's server instead of this one.
 */
export function InstallationSection() {
  const origin = window.location.origin.replace(/\/$/, '');
  const windowsCommand = `powershell -c "irm ${origin}/install.ps1 | iex"`;
  const unixCommands = `curl -fsSL ${origin}/install.sh | sh\n$HOME/.local/bin/pop login ${origin}`;
  const localAccessWindowsCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${origin}/install-local-access.ps1' | iex"`;
  const localAccessUnixCommand = `tmp="$(mktemp)"\ncurl -fsSL ${origin}/install-local-access.sh -o "$tmp" && bash "$tmp"; rm -f "$tmp"`;
  const pwaStatus = useSyncExternalStore(subscribePwaInstall, pwaInstallStatus, pwaInstallStatus);
  const [pwaDismissed, setPwaDismissed] = useState(false);
  const [connections, setConnections] = useState<LocalConnectionDTO[]>([]);
  const [selectedConnection, setSelectedConnection] = useState(selectedLocalConnection() ?? '');
  const selectedMachine = connections.find(
    (connection) => connection.id === selectedConnection,
  )?.machine.hostname;

  useEffect(() => {
    void localAccessService.connections().then(({ connections: live }) => {
      setConnections(live);
      if (selectedConnection !== '' && !live.some((connection) => connection.id === selectedConnection)) {
        selectLocalConnection(undefined);
        setSelectedConnection('');
      }
    }).catch(() => setConnections([]));
  }, [selectedConnection]);

  async function requestPwaInstall(): Promise<void> {
    setPwaDismissed(false);
    const result = await installPwa();
    if (result === 'dismissed') setPwaDismissed(true);
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

      <Card className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.webTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.webBody')}</p>
        </div>
        {pwaStatus === 'available' ? (
          <Button type="button" size="sm" data-testid="pwa-install" onClick={() => void requestPwaInstall()}>
            {t('settings.installation.pwaInstall')}
          </Button>
        ) : null}
        {pwaStatus === 'installed' ? (
          <p className="text-sm text-[var(--key-fg-dim)]" data-testid="pwa-installed">
            {t('settings.installation.pwaInstalled')}
          </p>
        ) : null}
        {pwaStatus === 'unavailable' ? (
          <p className="text-sm text-[var(--key-fg-dim)]" data-testid="pwa-install-manual">
            {t('settings.installation.pwaInstallManual')}
          </p>
        ) : null}
        {pwaDismissed ? (
          <p className="text-xs text-[var(--muted)]" data-testid="pwa-install-dismissed">
            {t('settings.installation.pwaInstallDismissed')}
          </p>
        ) : null}
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--key-fg-dim)]">
          <li>{t('settings.installation.webWindows')}</li>
          <li>{t('settings.installation.webMac')}</li>
          <li>{t('settings.installation.webIphone')}</li>
          <li>{t('settings.installation.webAndroid')}</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.localAccessTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.localAccessBody')}</p>
        </div>
        <Select
          id="local-access-machine"
          label={t('settings.installation.localAccessMachine')}
          hint={selectedMachine === undefined
            ? t('settings.installation.localAccessDisabled')
            : t('settings.installation.localAccessEnabled', { machine: selectedMachine })}
          value={selectedConnection}
          onChange={(event) => {
            const value = event.currentTarget.value;
            selectLocalConnection(value === '' ? undefined : value);
            setSelectedConnection(value);
          }}
        >
          <option value="">{t('settings.installation.localAccessServerOnly')}</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.machine.hostname} — {platformName(connection.machine.platform)} ({t('settings.installation.localAccessConnected')})
            </option>
          ))}
        </Select>
        <h3 className="border-t border-[var(--border)] pt-4 text-sm font-semibold">
          {t('settings.installation.localAccessInstallTitle')}
        </h3>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('settings.installation.localAccessWindows')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.localAccessWindowsHint')}</p>
          <CopyBlock value={localAccessWindowsCommand} testId="installation-local-access-windows" />
        </section>
        <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-semibold">{t('settings.installation.localAccessUnix')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.localAccessUnixHint')}</p>
          <CopyBlock value={localAccessUnixCommand} testId="installation-local-access-unix" />
        </section>
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

    </div>
  );
}

function platformName(platform: string): string {
  if (platform === 'darwin') return 'Mac';
  if (platform === 'win32') return 'Windows PC';
  if (platform === 'linux') return 'Linux computer';
  return 'Computer';
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
