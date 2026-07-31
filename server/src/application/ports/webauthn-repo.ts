/**
 * Persistence for registered passkeys (popy.spec §9). One account, many
 * authenticators.
 */
export interface WebAuthnCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  label: string;
}

export interface WebAuthnRepo {
  list(): WebAuthnCredential[];
  get(id: string): WebAuthnCredential | undefined;
  save(credential: WebAuthnCredential): void;
  updateCounter(id: string, counter: number): void;
  delete(id: string): void;
}

/**
 * The WebAuthn ceremony as the routes see it (popy.spec §9). Options and
 * responses cross as opaque JSON so this port stays free of the library's
 * types -- the interface layer just relays them between the browser and the
 * adapter in infrastructure.
 */
export interface WebAuthnGateway {
  registrationOptions(rpId: string): Promise<unknown>;
  verifyRegistration(
    response: unknown,
    rpId: string,
    origin: string,
    label: string,
  ): Promise<boolean>;
  authenticationOptions(rpId: string): Promise<unknown>;
  verifyAuthentication(response: unknown, rpId: string, origin: string): Promise<boolean>;
  list(): { id: string; label: string }[];
  hasCredentials(): boolean;
  remove(id: string): void;
}
