/**
 * Typed error classes for `clef envelope` commands. Each subclass carries a
 * stable exit code matching the PRD's contract; `handleEnvelopeError` maps
 * any thrown error to the correct process exit.
 *
 * Exit codes:
 *   0 — success
 *   1 — generic (bad args, source unreachable, JSON parse failure)
 *   2 — ciphertext hash mismatch (verify/decrypt only; inspect exits 0 per D2)
 *   3 — signature invalid
 *   4 — key resolution failure
 *   5 — expired or revoked
 */
export class EnvelopeError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "EnvelopeError";
    this.exitCode = exitCode;
  }
}

export class HashMismatchError extends EnvelopeError {
  constructor(message: string) {
    super(message, 2);
    this.name = "HashMismatchError";
  }
}

export class SignatureInvalidError extends EnvelopeError {
  constructor(message: string) {
    super(message, 3);
    this.name = "SignatureInvalidError";
  }
}

export class KeyResolutionError extends EnvelopeError {
  constructor(message: string) {
    super(message, 4);
    this.name = "KeyResolutionError";
  }
}

export class ExpiredOrRevokedError extends EnvelopeError {
  constructor(message: string) {
    super(message, 5);
    this.name = "ExpiredOrRevokedError";
  }
}
