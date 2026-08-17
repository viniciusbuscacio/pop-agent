import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LocalMachineAccessDTO } from '@pop-agent/shared';
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
import { Button, Card, Select, SwitchField } from '../ui/controls';

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
  const [machines, setMachines] = useState<LocalMachineAccessDTO[]>([]);
  const [selectedConnection, setSelectedConnection] = useState(selectedLocalConnection() ?? '');
  const usableMachines = machines.filter((machine) => machine.enabled && machine.connected);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const response = await localAccessService.machines();
        if (!active) return;
        setMachines(response.machines);
        const usable = response.machines.filter((machine) => machine.enabled && machine.connected);
        const selectedStillWorks = usable.some((machine) => machine.machineId === selectedLocalConnection());
        if (!selectedStillWorks) {
          const automatic = usable.length === 1 ? usable[0]?.machineId : undefined;
          selectLocalConnection(automatic);
          setSelectedConnection(automatic ?? '');
        }
      } catch {
        if (active) setMachines([]);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function setMachineEnabled(machineId: string, enabled: boolean): Promise<void> {
    try {
      await localAccessService.setEnabled(machineId, enabled);
    } catch {
      return;
    }
    setMachines((current) => current.map((machine) =>
      machine.machineId === machineId ? { ...machine, enabled } : machine));
    if (enabled && selectedConnection === '') {
      selectLocalConnection(machineId);
      setSelectedConnection(machineId);
    } else if (!enabled && selectedConnection === machineId) {
      selectLocalConnection(undefined);
      setSelectedConnection('');
    }
  }

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
        {machines.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t('settings.installation.localAccessNone')}</p>
        ) : machines.map((machine) => (
          <div key={machine.machineId} className="rounded-[var(--radius-control)] border border-[var(--border)] p-3">
            <SwitchField
              id={`local-access-${machine.machineId}`}
              testId={`local-access-${machine.machineId}`}
              label={t('settings.installation.localAccessForMachine', { machine: machine.hostname })}
              hint={`${platformName(machine.platform)} — ${machine.connected
                ? t('settings.installation.localAccessOnline')
                : t('settings.installation.localAccessOffline')}`}
              checked={machine.enabled}
              onChange={(enabled) => void setMachineEnabled(machine.machineId, enabled)}
            />
          </div>
        ))}
        {usableMachines.length > 1 ? (
          <Select
            id="local-access-machine"
            label={t('settings.installation.localAccessUseFrom')}
            value={selectedConnection}
            onChange={(event) => {
              const value = event.currentTarget.value;
              selectLocalConnection(value === '' ? undefined : value);
              setSelectedConnection(value);
            }}
          >
            <option value="">{t('settings.installation.localAccessServerOnly')}</option>
            {usableMachines.map((machine) => (
              <option key={machine.machineId} value={machine.machineId}>
                {machine.hostname} — {platformName(machine.platform)}
              </option>
            ))}
          </Select>
        ) : null}
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
