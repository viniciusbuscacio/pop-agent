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
    const previous = Object.hasOwn(state.machines, machineId) ? state.machines[machineId] : undefined;
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
    const machines = this.read().machines;
    return Object.hasOwn(machines, machineId) ? machines[machineId]?.enabled ?? false : false;
  }

  setEnabled(machineId: string, enabled: boolean): boolean {
    const state = this.read();
    const machine = Object.hasOwn(state.machines, machineId) ? state.machines[machineId] : undefined;
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
    const machines: Record<string, KnownLocalMachine> = Object.create(null) as Record<string, KnownLocalMachine>;
    if (stored === undefined || typeof stored !== 'object' || typeof stored.machines !== 'object' || stored.machines === null) {
      return { machines };
    }
    for (const [machineId, candidate] of Object.entries(stored.machines)) {
      if (!validMachine(machineId, candidate)) continue;
      machines[machineId] = { ...candidate };
    }
    return { machines };
  }

  private write(state: StoredState): void {
    this.settings.set(SETTINGS_KEY, state);
  }
}

function validMachine(machineId: string, value: unknown): value is KnownLocalMachine {
  if (typeof value !== 'object' || value === null) return false;
  const machine = value as Partial<KnownLocalMachine>;
  return (
    /^(?!__proto__$)(?!prototype$)(?!constructor$)[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(machineId) &&
    machine.machineId === machineId &&
    typeof machine.hostname === 'string' &&
    typeof machine.platform === 'string' &&
    typeof machine.arch === 'string' &&
    typeof machine.clientVersion === 'string' &&
    typeof machine.enabled === 'boolean'
  );
}
