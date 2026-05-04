import type {
  Bulk,
  Lintable,
  MergeAware,
  Migratable,
  RecipientManaged,
  Rotatable,
  SecretSource,
  SourceCapabilities,
  Structural,
} from "./types";

/**
 * Type guards for runtime capability detection. Each guard narrows the
 * input to the intersection of `SecretSource` and the trait so callers
 * can safely invoke trait methods after the check.
 *
 * The checks look for the trait's most distinctive method rather than
 * every member — duck-typing in the same shape consumers already use
 * (`isLintable(s) && s.validateEncryption(...)`) without per-trait
 * runtime registries.
 */

function isFn(o: unknown, name: string): boolean {
  return (
    typeof o === "object" &&
    o !== null &&
    typeof (o as Record<string, unknown>)[name] === "function"
  );
}

export function isLintable(s: SecretSource): s is SecretSource & Lintable {
  return isFn(s, "validateEncryption") && isFn(s, "checkRecipientDrift");
}

export function isRotatable(s: SecretSource): s is SecretSource & Rotatable {
  return isFn(s, "rotate");
}

export function isRecipientManaged(s: SecretSource): s is SecretSource & RecipientManaged {
  return isFn(s, "listRecipients") && isFn(s, "addRecipient") && isFn(s, "removeRecipient");
}

export function isMergeAware(s: SecretSource): s is SecretSource & MergeAware {
  return isFn(s, "mergeCells") && isFn(s, "installMergeDriver");
}

export function isMigratable(s: SecretSource): s is SecretSource & Migratable {
  return isFn(s, "migrateBackend");
}

export function isBulk(s: SecretSource): s is SecretSource & Bulk {
  return isFn(s, "bulkSet") && isFn(s, "bulkDelete") && isFn(s, "copyValue");
}

export function isStructural(s: SecretSource): s is SecretSource & Structural {
  return (
    isFn(s, "addNamespace") &&
    isFn(s, "addEnvironment") &&
    isFn(s, "renameNamespace") &&
    isFn(s, "renameEnvironment")
  );
}

/**
 * Build a boolean capability descriptor for the source. Used by the UI
 * server's `GET /api/capabilities` endpoint and by `clef doctor` output.
 */
export function describeCapabilities(s: SecretSource): SourceCapabilities {
  return {
    lint: isLintable(s),
    rotate: isRotatable(s),
    recipients: isRecipientManaged(s),
    merge: isMergeAware(s),
    migrate: isMigratable(s),
    bulk: isBulk(s),
    structural: isStructural(s),
  };
}
