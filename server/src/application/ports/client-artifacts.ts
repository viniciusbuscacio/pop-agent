/** Verified installer assets are acquired only when a client requests its target. */
export interface ClientArtifactProvider {
  ensure(category: 'node' | 'launcher' | 'local-access', file: string): Promise<string | undefined>;
}
