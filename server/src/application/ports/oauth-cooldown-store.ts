/** Durable, non-secret deadline for an OAuth provider's rate-limit window. */
export interface OAuthCooldownStore {
  get(providerId: string): number | undefined;
  set(providerId: string, until: number | undefined): void;
}
