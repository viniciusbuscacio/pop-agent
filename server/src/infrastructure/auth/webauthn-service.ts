import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { WebAuthnGateway, WebAuthnRepo } from '../../application/ports/webauthn-repo.js';

/**
 * Passkeys (docs/specs/Spec-Pop-General.md §9): registering a phone's Face ID / a security key, and
 * unlocking with it instead of the password. The ceremony's challenge is held
 * in memory for the moment between issuing the options and verifying the
 * response -- one at a time is enough for a single-user server.
 *
 * The relying-party id is the host name; it is passed in per request because
 * the same install answers on a LAN name and a tailnet name, and a passkey is
 * bound to the rp id it was made on.
 */

export interface WebAuthnServiceDeps {
  repo: WebAuthnRepo;
  /** ISO now, injected. */
  now: () => number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'Pop Agent';

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

export class WebAuthnService implements WebAuthnGateway {
  private registration: PendingChallenge | undefined;
  private authentication: PendingChallenge | undefined;

  constructor(private readonly deps: WebAuthnServiceDeps) {}

  async registrationOptions(rpId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId,
      userName: 'pop',
      attestationType: 'none',
      excludeCredentials: this.deps.repo.list().map((credential) => ({ id: credential.id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    this.registration = { challenge: options.challenge, expiresAt: this.deps.now() + CHALLENGE_TTL_MS };
    return options;
  }

  async verifyRegistration(
    raw: unknown,
    rpId: string,
    origin: string,
    label: string,
  ): Promise<boolean> {
    const pending = this.take('registration');
    if (pending === undefined) return false;
    const response = raw as RegistrationResponseJSON;

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });
    if (!verification.verified || verification.registrationInfo === undefined) return false;

    const { credential } = verification.registrationInfo;
    this.deps.repo.save({
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: response.response.transports ?? [],
      label,
    });
    return true;
  }

  async authenticationOptions(rpId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: this.deps.repo.list().map((credential) => ({
        id: credential.id,
        transports: credential.transports as never,
      })),
      userVerification: 'preferred',
    });
    this.authentication = { challenge: options.challenge, expiresAt: this.deps.now() + CHALLENGE_TTL_MS };
    return options;
  }

  async verifyAuthentication(raw: unknown, rpId: string, origin: string): Promise<boolean> {
    const pending = this.take('authentication');
    if (pending === undefined) return false;
    const response = raw as AuthenticationResponseJSON;

    const credential = this.deps.repo.get(response.id);
    if (credential === undefined) return false;

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports as never,
      },
    });
    if (!verification.verified) return false;

    this.deps.repo.updateCounter(credential.id, verification.authenticationInfo.newCounter);
    return true;
  }

  list(): { id: string; label: string }[] {
    return this.deps.repo.list().map((credential) => ({ id: credential.id, label: credential.label }));
  }

  hasCredentials(): boolean {
    return this.deps.repo.list().length > 0;
  }

  remove(id: string): void {
    this.deps.repo.delete(id);
  }

  private take(kind: 'registration' | 'authentication'): PendingChallenge | undefined {
    const pending = kind === 'registration' ? this.registration : this.authentication;
    if (kind === 'registration') this.registration = undefined;
    else this.authentication = undefined;
    if (pending === undefined || pending.expiresAt < this.deps.now()) return undefined;
    return pending;
  }
}
