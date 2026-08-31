/**
 * A one-time recovery key may survive a reload in this tab while its mandatory
 * acknowledgement screen is open. It never reaches localStorage and is erased
 * as soon as the owner confirms it was saved.
 */
const STORAGE_KEY = 'pop-agent.pendingRecovery';

export type RecoveryFlow = 'setup' | 'recover' | 'change-password';

interface PendingRecovery {
  flow: RecoveryFlow;
  key: string;
}

export const pendingRecovery = {
  read(flow: RecoveryFlow): string | undefined {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as
        | Partial<PendingRecovery>
        | null;
      return parsed?.flow === flow && typeof parsed.key === 'string' ? parsed.key : undefined;
    } catch {
      return undefined;
    }
  },

  write(flow: RecoveryFlow, key: string): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ flow, key } satisfies PendingRecovery));
    } catch {
      // The mounted screen still owns the key when storage is unavailable.
    }
  },

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else can recover it from denied storage.
    }
  },
};
