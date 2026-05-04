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
export type { BlobStore } from "./blob-store";
export { FilesystemBlobStore } from "./filesystem-blob-store";
export { composeSecretSource } from "./compose";
