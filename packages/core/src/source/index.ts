export type {
  AddRecipientRequest,
  Bulk,
  CellData,
  CellPendingMetadata,
  CellRef,
  Lintable,
  MergeAware,
  Migratable,
  RecipientDriftResult,
  RecipientManaged,
  RemoveRecipientRequest,
  Rotatable,
  SecretSource,
  SourceCapabilities,
  Structural,
} from "./types";

export {
  describeCapabilities,
  isBulk,
  isLintable,
  isMergeAware,
  isMigratable,
  isRecipientManaged,
  isRotatable,
  isStructural,
} from "./guards";

export { defaultBulk } from "./default-bulk";
export { SourceCapabilityUnsupportedError } from "./errors";
export { MockSecretSource } from "./mock-source";

// Two orthogonal abstractions composed by `composeSecretSource`.
export type { StorageBackend } from "./storage-backend";
export { FilesystemStorageBackend } from "./filesystem-storage-backend";
export type { EncryptionBackend, EncryptionContext, RotateOptions } from "./encryption-backend";
export { createSopsEncryptionBackend } from "./sops-encryption-backend";
export { composeSecretSource } from "./compose";
