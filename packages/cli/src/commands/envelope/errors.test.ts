import {
  EnvelopeError,
  ExpiredOrRevokedError,
  HashMismatchError,
  KeyResolutionError,
  SignatureInvalidError,
} from "./errors";

describe("EnvelopeError subclasses carry their documented exit codes", () => {
  it("HashMismatchError — exit 2", () => {
    const err = new HashMismatchError("ciphertext hash does not match");
    expect(err).toBeInstanceOf(EnvelopeError);
    expect(err.exitCode).toBe(2);
    expect(err.name).toBe("HashMismatchError");
    expect(err.message).toBe("ciphertext hash does not match");
  });

  it("SignatureInvalidError — exit 3", () => {
    const err = new SignatureInvalidError("signature did not verify");
    expect(err.exitCode).toBe(3);
    expect(err.name).toBe("SignatureInvalidError");
  });

  it("KeyResolutionError — exit 4", () => {
    const err = new KeyResolutionError("no identity configured");
    expect(err.exitCode).toBe(4);
    expect(err.name).toBe("KeyResolutionError");
  });

  it("ExpiredOrRevokedError — exit 5", () => {
    const err = new ExpiredOrRevokedError("artifact expired");
    expect(err.exitCode).toBe(5);
    expect(err.name).toBe("ExpiredOrRevokedError");
  });

  it("base EnvelopeError can carry an arbitrary exit code for tests", () => {
    const err = new EnvelopeError("generic", 42);
    expect(err.exitCode).toBe(42);
    expect(err.name).toBe("EnvelopeError");
  });
});
