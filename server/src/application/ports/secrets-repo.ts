/**
 * Persistence port for provider credentials and anything else that must not
 * sit in the database as plaintext (pop-agent.spec §9). Values cross this interface
 * already decrypted; sealing them is the adapter's job.
 */
export interface SecretsRepo {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}
