/**
 * Password hashing port (docs/specs/Spec-Pop-General.md §9). The algorithm and its cost parameters
 * are an infrastructure concern -- deliberately slow, and slow in a way that
 * would make the service tests crawl, which is why they use a cheap fake.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(hash: string, plaintext: string): Promise<boolean>;
}
