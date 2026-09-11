import { useSettingsLoad } from '../ui/settings-sync';
import { settingsResources } from '../services/settings-resources';
import { useSettingsDetail } from './settings-breadcrumbs';
import { useState, useSyncExternalStore } from 'react';
import type { LocalMachineAccessDTO } from '@pop-agent/shared';
import { clientEnvironment } from '../services/api';
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
import { BackButton, Button, Card, LinkButton, Select, SwitchField } from '../ui/controls';

/**
 * Device setup instructions are generated from the origin that served this page.
 * This matters for personal installs: copying a product-wide example would point
 * the next device at somebody else's server instead of this one.
 */
export function InstallationSection() {
  const origin = window.location.origin.replace(/\/$/, '');
  const windowsCommand = `powershell -c "irm ${origin}/install.ps1 | iex"`;
  const unixCommands = `curl -fsSL ${origin}/install.sh | sh\n$HOME/.local/bin/pop login ${origin}`;
  const [platform, setPlatform] = useState(currentPlatform);
  const pwaStatus = useSyncExternalStore(subscribePwaInstall, pwaInstallStatus, pwaInstallStatus);
  const [pwaDismissed, setPwaDismissed] = useState(false);
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

      <PlatformChoice platform={platform} onChange={setPlatform} />
      <Card className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.webTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.webBody')}</p>
        </div>
        {platform === currentPlatform() && pwaStatus === 'available' ? (
          <Button type="button" size="md" data-testid="pwa-install" onClick={() => void requestPwaInstall()}>
            {t('settings.installation.pwaInstall')}
          </Button>
        ) : null}
        {platform === currentPlatform() && pwaStatus === 'installed' ? (
          <p className="text-sm text-[var(--muted)]" data-testid="pwa-installed">
            {t('settings.installation.pwaInstalled')}
          </p>
        ) : null}
        {platform === currentPlatform() && pwaStatus === 'unavailable' ? (
          <p className="text-sm text-[var(--muted)]" data-testid="pwa-install-manual">
            {t('settings.installation.pwaInstallManual')}
          </p>
        ) : null}
        {platform === currentPlatform() && pwaDismissed ? (
          <p className="text-sm text-[var(--muted)]" data-testid="pwa-install-dismissed">
            {t('settings.installation.pwaInstallDismissed')}
          </p>
        ) : null}
        <p className="text-sm text-[var(--muted)]">{t(WEB_INSTRUCTIONS[platform])}</p>
      </Card>

      {isLocalAccessInstallPlatform(platform) ? (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold">{t('settings.installation.localAccessTitle')}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.localAccessBody')}</p>
          </div>
          {platform === 'windows' ? (
            <LinkButton
              href={`${origin}/local-access-installer?platform=windows&arch=amd64`}
              download
              variant="accent"
              size="md"
              className="self-start"
              data-testid="installation-local-access-windows-download"
            >
              {t('settings.installation.localAccessDownloadWindows')}
            </LinkButton>
          ) : null}
          <LocalAccessInstallInstructions origin={origin} platform={platform} />
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.cliTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.installation.cliBody')}</p>
        </div>
        {platform === 'windows' ? <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('settings.installation.cliWindows')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.cliWindowsHint')}</p>
          <CopyBlock value={windowsCommand} testId="installation-cli-windows" />
        </section> : platform === 'macos' || platform === 'linux' ? <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('settings.installation.cliUnix')}</h3>
          <p className="text-xs text-[var(--muted)]">{t('settings.installation.cliUnixHint')}</p>
          <CopyBlock value={unixCommands} testId="installation-cli-unix" />
        </section> : <p className="text-sm text-[var(--muted)]">{t('settings.installation.cliDesktopOnly')}</p>}
      </Card>

    </div>
  );
}

/** Daily computer access management is separate from installing the app. */
export function DevicesSection() {
  const [removing, setRemoving] = useState<string>();
  const [removeError, setRemoveError] = useState(false);
  const [changingAccess, setChangingAccess] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [connecting, setConnecting] = useState(false);
  useSettingsDetail(connecting ? t('settings.devices.connect') : undefined, () => setConnecting(false));
  const [platform, setPlatform] = useState<InstallPlatform>(() => {
    const current = currentPlatform();
    return current === 'ios' || current === 'android' ? 'windows' : current;
  });
  const origin = window.location.origin.replace(/\/$/, '');
  const [machines, setMachines] = useState<LocalMachineAccessDTO[]>([]);
  const [selectedConnection, setSelectedConnection] = useState(selectedLocalConnection() ?? '');

  const machineState = useSettingsLoad('devices', () => localAccessService.machines(), (response) => {
    setMachines(response.machines);
    if (!settingsResources.state('devices').fresh) return;
    const selectedId = selectedLocalConnection();
    const selected = response.machines.find((machine) => machine.machineId === selectedId);
    if (selectedId !== undefined && (!selected || !selected.enabled)) {
      selectLocalConnection(undefined); setSelectedConnection('');
    } else setSelectedConnection(selectedId ?? '');
  });

  async function setMachineEnabled(machineId: string, enabled: boolean): Promise<void> {
    if (changingAccess) return;
    setChangingAccess(true);
    setAccessError(false);
    try {
      await localAccessService.setEnabled(machineId, enabled);
      if (enabled) selectLocalConnection(machineId);
      else if (selectedLocalConnection() === machineId) selectLocalConnection(undefined);
      const selected = selectedLocalConnection() ?? '';
      setSelectedConnection(selected);
      if (enabled && selected !== machineId) setAccessError(true);
      const current = settingsResources.state('devices').data as { machines: LocalMachineAccessDTO[] } | undefined;
      settingsResources.accept('devices', { machines: (current?.machines ?? machines).map((machine) => machine.machineId === machineId ? { ...machine, enabled } : machine) });
    } catch {
      setAccessError(true);
    } finally {
      setChangingAccess(false);
    }
  }


  async function removeMachine(machine: LocalMachineAccessDTO): Promise<void> {
    if (!window.confirm(t('settings.devices.removeConfirm', { name: machine.hostname }))) return;
    setRemoving(machine.machineId);
    setRemoveError(false);
    try {
      await localAccessService.remove(machine.machineId);
      settingsResources.accept('devices', { machines: machines.filter((entry) => entry.machineId !== machine.machineId) });
      setMachines((current) => current.filter((entry) => entry.machineId !== machine.machineId));
      if (selectedLocalConnection() === machine.machineId) {
        selectLocalConnection(undefined);
        setSelectedConnection('');
      }
    } catch { setRemoveError(true); }
    finally { setRemoving(undefined); }
  }

  if (connecting) return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BackButton aria-label="Back to Devices" onClick={() => setConnecting(false)} />
        <h2 className="text-base font-semibold">{t('settings.devices.connect')}</h2>
      </div>
      <PlatformChoice platform={platform} onChange={setPlatform} desktopOnly />
      <Card className="flex flex-col gap-3">
        <LocalAccessInstallInstructions
          origin={origin}
          platform={platform === 'windows' ? 'windows' : 'macos'}
        />
      </Card>
    </div>
  );

  return <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('settings.installation.localAccessTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('settings.devices.intro')}</p>
        </div>
        {machines.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t('settings.installation.localAccessNone')}</p>
        ) : machines.map((machine) => (
          <div key={machine.machineId} className="flex flex-col items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] p-3">
            <p className="text-sm font-medium">{machine.hostname}</p>
            <div className="w-full"><SwitchField
              id={`local-access-${machine.machineId}`}
              testId={`local-access-${machine.machineId}`}
              label={t('settings.installation.localAccessForMachine')}
              hint={`${platformName(machine.platform)} — ${!machineState.fresh ? t('settings.sync.unconfirmed') : machine.connected
                ? t('settings.installation.localAccessOnline')
                : t('settings.installation.localAccessOffline')}`}
              checked={machine.enabled && selectedConnection === machine.machineId}
              disabled={removing !== undefined || changingAccess}
              onChange={(enabled) => void setMachineEnabled(machine.machineId, enabled)}
            /></div>
            <Button type="button" size="md" variant="danger" disabled={removing !== undefined || changingAccess}
              onClick={() => void removeMachine(machine)}>{t('settings.devices.remove')}</Button>
          </div>
        ))}
        <p role="status" className="text-sm text-[var(--muted)]">{selectedConnection
          ? t('settings.devices.usingComputer', { name: machines.find((machine) => machine.machineId === selectedConnection)?.hostname ?? selectedConnection })
          : t('settings.installation.localAccessServerOnly')}</p>
        {accessError ? <p role="alert" className="text-sm text-[var(--danger)]">{t('settings.devices.accessFailed')}</p> : null}
        {removeError ? <p role="alert" className="text-sm text-[var(--danger)]">{t('settings.devices.removeFailed')}</p> : null}
        <div><Button type="button" data-testid="devices-connect" onClick={() => setConnecting(true)}>
          {t('settings.devices.connect')}
        </Button></div>
      </Card>
  </div>;
}

type InstallPlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android';
type LocalAccessInstallPlatform = Extract<InstallPlatform, 'windows' | 'macos'>;

const WEB_INSTRUCTIONS: Record<InstallPlatform, Parameters<typeof t>[0]> = {
  windows: 'settings.installation.webWindows', macos: 'settings.installation.webMac',
  linux: 'settings.installation.webLinux', ios: 'settings.installation.webIphone', android: 'settings.installation.webAndroid',
};
function currentPlatform(): InstallPlatform {
  const platform = clientEnvironment().platform;
  return platform in WEB_INSTRUCTIONS ? platform as InstallPlatform : 'windows';
}

function isLocalAccessInstallPlatform(platform: InstallPlatform): platform is LocalAccessInstallPlatform {
  return platform === 'windows' || platform === 'macos';
}

function localAccessInstallCommand(origin: string, platform: LocalAccessInstallPlatform): string {
  return platform === 'windows'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${origin}/install-local-access.ps1' | iex"`
    : `tmp="$(mktemp)"\ncurl -fsSL ${origin}/install-local-access.sh -o "$tmp" && bash "$tmp"; rm -f "$tmp"`;
}

function LocalAccessInstallInstructions({ origin, platform }: {
  origin: string;
  platform: LocalAccessInstallPlatform;
}) {
  const windows = platform === 'windows';
  return <section className="flex flex-col gap-2">
    <h3 className="text-sm font-medium">{t(windows
      ? 'settings.installation.localAccessWindows'
      : 'settings.installation.localAccessUnix')}</h3>
    <p className="text-xs text-[var(--muted)]">{t(windows
      ? 'settings.installation.localAccessWindowsHint'
      : 'settings.installation.localAccessUnixHint')}</p>
    <CopyBlock
      value={localAccessInstallCommand(origin, platform)}
      testId={windows ? 'installation-local-access-windows' : 'installation-local-access-unix'}
    />
  </section>;
}

function PlatformChoice({ platform, onChange, desktopOnly = false }: {
  platform: InstallPlatform; onChange: (platform: InstallPlatform) => void; desktopOnly?: boolean;
}) {
  return <Select id="installation-platform" label={t('settings.installation.platform')} value={platform}
    onChange={(event) => onChange(event.target.value as InstallPlatform)}>
    <option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option>
    {desktopOnly ? null : <><option value="ios">iPhone / iPad</option><option value="android">Android</option></>}
  </Select>;
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
      <Button type="button" size="md" variant="ghost" data-testid={`${testId}-copy`} onClick={() => void copy()}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}
