import type { SettingsRepo } from '../ports/settings-repo.js';
import type { LocalMachine } from './local-connection-registry.js';

const SETTINGS_KEY = 'local-machine-access';

export interface KnownLocalMachine {
  machineId: string;
  hostname: string;
  platform: string;
  arch: string;
  clientVersion: string;
  enabled: boolean;
}

interface StoredState {
  machines: Record<string, KnownLocalMachine>;
}

/** Persistent, server-authoritative permission for every known computer. */
export class LocalAccessPolicyService {
  constructor(private readonly settings: SettingsRepo) {}

  remember(machine: LocalMachine): void {
    const machineId = machine.machineId;
    if (machineId === undefined || machineId.length === 0) return;
    const state = this.read();
    const previous = state.machines[machineId];
    state.machines[machineId] = {
      machineId,
      hostname: machine.hostname,
      platform: machine.platform,
      arch: machine.arch,
      clientVersion: machine.clientVersion,
      enabled: previous?.enabled ?? false,
    };
    this.write(state);
  }

  enabled(machineId: string | undefined): boolean {
    if (machineId === undefined) return false;
    return this.read().machines[machineId]?.enabled ?? false;
  }

  setEnabled(machineId: string, enabled: boolean): boolean {
    const state = this.read();
    const machine = state.machines[machineId];
    if (machine === undefined) return false;
    state.machines[machineId] = { ...machine, enabled };
    this.write(state);
    return true;
  }

  machines(): KnownLocalMachine[] {
    return Object.values(this.read().machines).sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  private read(): StoredState {
    const stored = this.settings.get<Partial<StoredState>>(SETTINGS_KEY);
    if (stored === undefined || typeof stored !== 'object' || stored.machines === undefined) {
      return { machines: {} };
    }
    return { machines: { ...stored.machines } };
  }

  private write(state: StoredState): void {
    this.settings.set(SETTINGS_KEY, state);
  }
}
