export * from "./types";
export { ManifestParser, CLEF_MANIFEST_FILENAME } from "./manifest/parser";
export { readManifestYaml, writeManifestYaml, writeManifestYamlRaw } from "./manifest/io";
export {
  ScanRunner,
  shannonEntropy,
  isHighEntropy,
  matchPatterns,
  redactValue,
  loadIgnoreRules,
  shouldIgnoreFile,
  shouldIgnoreMatch,
  parseIgnoreContent,
} from "./scanner";
export type { ScanMatch, ScanResult, ScanOptions, ClefIgnoreRules } from "./scanner";
export { MatrixManager } from "./matrix/manager";
export { SchemaValidator } from "./schema/validator";
export { DiffEngine } from "./diff/engine";
export { BulkOps } from "./bulk/ops";
export { GitIntegration } from "./git/integration";
export {
  TransactionManager,
  TransactionLockError,
  TransactionPreflightError,
  TransactionRollbackError,
} from "./tx";
export type { TransactionOptions, TransactionResult } from "./tx";
export { SopsClient } from "./sops/client";
export { resolveSopsPath, resetSopsResolution } from "./sops/resolver";
export type { SopsResolution, SopsSource } from "./sops/resolver";
export { LintRunner } from "./lint/runner";
export { ConsumptionClient } from "./consumption/client";
export { checkDependency, checkAll, assertSops, REQUIREMENTS } from "./dependencies/checker";
export { generateAgeIdentity, deriveAgePublicKey, formatAgeKeyFile } from "./age/keygen";
export type { AgeIdentity } from "./age/keygen";
export {
  metadataPath,
  loadMetadata,
  saveMetadata,
  markPending,
  markPendingWithRetry,
  markResolved,
  getPendingKeys,
  isPending,
  generateRandomValue,
} from "./pending/metadata";
export type { PendingKey, PendingMetadata } from "./pending/metadata";
export { ImportRunner } from "./import";
export type { ImportFormat, ImportOptions, ImportResult, ParsedImport } from "./import";
export { parse, parseDotenv, parseJson, parseYaml, detectFormat } from "./import/parsers";
export { RecipientManager } from "./recipients";
export type { Recipient, RecipientsResult } from "./recipients";
export { validateAgePublicKey, keyPreview } from "./recipients/validator";
export type { AgeKeyValidation } from "./recipients/validator";
export {
  REQUESTS_FILENAME,
  requestsFilePath,
  loadRequests,
  saveRequests,
  upsertRequest,
  removeRequest as removeAccessRequest,
  findRequest,
} from "./recipients/requests";
export type { RecipientRequest } from "./recipients/requests";
export { DriftDetector } from "./drift/detector";
export {
  ReportGenerator,
  ReportSanitizer,
  ReportTransformer,
  CloudClient,
  collectCIContext,
} from "./report";
export { SopsMergeDriver } from "./merge/driver";
export type { MergeResult, MergeKey, MergeKeyStatus } from "./merge/driver";
export { ServiceIdentityManager } from "./service-identity/manager";
export { StructureManager } from "./structure/manager";
export type {
  NamespaceEditOptions,
  EnvironmentEditOptions,
  AddNamespaceOptions,
  AddEnvironmentOptions,
} from "./structure/manager";
export { resolveIdentitySecrets } from "./artifact/resolve";
export type { ResolvedSecrets } from "./artifact/resolve";
export { ArtifactPacker } from "./artifact/packer";
export { FilePackOutput, MemoryPackOutput } from "./artifact/output";
export type {
  PackedArtifact,
  PackConfig,
  PackResult,
  PackOutput,
  ArtifactEnvelope,
  SignatureAlgorithm,
} from "./artifact/types";
export {
  buildSigningPayload,
  generateSigningKeyPair,
  signEd25519,
  signKms,
  verifySignature,
  detectAlgorithm,
} from "./artifact/signer";
export type { KmsProvider, KmsWrapResult, KmsProviderType } from "./kms";
export { VALID_KMS_PROVIDERS } from "./kms";
export { BackendMigrator } from "./migration/backend";
export type {
  MigrationTarget,
  MigrationOptions,
  MigrationResult,
  MigrationProgressEvent,
} from "./migration/backend";
export { ResetManager, describeScope, validateResetScope } from "./reset/manager";
export type { ResetScope, ResetOptions, ResetResult } from "./reset/manager";
