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
export {
  serializeSchema,
  writeSchema,
  writeSchemaRaw,
  emptyTemplate,
  exampleTemplate,
} from "./schema/writer";
export type { SerializeSchemaOptions } from "./schema/writer";
export { DiffEngine } from "./diff/engine";
export { GitIntegration } from "./git/integration";
export {
  TransactionManager,
  TransactionLockError,
  TransactionPreflightError,
  TransactionRollbackError,
} from "./tx";
export type { TransactionOptions, TransactionResult } from "./tx";
export { SopsClient } from "./sops/client";
export type { RotateBlobOptions } from "./sops/client";
export { isClefHsmArn, pkcs11UriToSyntheticArn, syntheticArnToPkcs11Uri } from "./sops/hsm-arn";
export { resolveSopsPath, resetSopsResolution } from "./sops/resolver";
export type { SopsResolution, SopsSource } from "./sops/resolver";
export {
  resolveKeyservicePath,
  resetKeyserviceResolution,
  spawnKeyservice,
  tryBundledKeyservice,
} from "./hsm";
export type {
  KeyserviceHandle,
  KeyserviceResolution,
  KeyserviceSource,
  SpawnKeyserviceOptions,
} from "./hsm";
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
  recordRotation,
  removeRotation,
  getRotations,
  generateRandomValue,
} from "./pending/metadata";
export type { PendingKey, RotationRecord, CellMetadata } from "./pending/metadata";
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
export { mergeMetadataContents, mergeMetadataFiles } from "./merge/metadata-driver";
export { ServiceIdentityManager } from "./service-identity/manager";
export type { CreateServiceIdentityOptions } from "./service-identity/manager";
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
export {
  isPackedArtifact,
  validatePackedArtifact,
  assertPackedArtifact,
  InvalidArtifactError,
} from "./artifact/guards";
export type { ValidationResult } from "./artifact/guards";
export type {
  PackedArtifact,
  PackConfig,
  PackResult,
  PackOutput,
  KmsEnvelope,
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
export { computeCiphertextHash } from "./artifact/hash";
export type {
  InspectEnvelope,
  InspectResult,
  HashStatus,
  SignatureStatus,
  ExpiryStatus,
  RevocationStatus,
  OverallStatus,
  VerifyResult,
  VerifyInputs,
  DecryptStatus,
  DecryptResult,
  DecryptSuccessInputs,
} from "./envelope-debug";
export {
  buildInspectError,
  buildInspectResult,
  buildVerifyError,
  buildVerifyResult,
  buildDecryptError,
  buildDecryptResult,
  REVEAL_WARNING,
  formatRevealWarning,
  parseSignerKey,
} from "./envelope-debug";
export { PackBackendRegistry } from "./pack/registry";
export type {
  PackBackend,
  PackBackendFactory,
  PackRequest,
  PackServices,
  BackendPackResult,
} from "./pack/types";
export { JsonEnvelopeBackend } from "./pack/backends/json-envelope";
export type { JsonEnvelopeOptions } from "./pack/backends/json-envelope";
export type { KmsProvider, KmsWrapResult, KmsProviderType, AwsKmsArnValidation } from "./kms";
export { VALID_KMS_PROVIDERS, validateAwsKmsArn } from "./kms";
export { BackendMigrator } from "./migration/backend";
export type {
  MigrationTarget,
  MigrationOptions,
  MigrationResult,
  MigrationProgressEvent,
} from "./migration/backend";
export { ResetManager, describeScope, validateResetScope } from "./reset/manager";
export type { ResetScope, ResetOptions, ResetResult } from "./reset/manager";
export { SyncManager } from "./sync";
export type { SyncOptions, SyncPlan, SyncCellPlan, SyncResult } from "./sync";
export { PolicyParser, CLEF_POLICY_FILENAME } from "./policy/parser";
export { PolicyEvaluator } from "./policy/evaluator";
export { DEFAULT_POLICY } from "./policy/types";
export type {
  PolicyDocument,
  PolicyRotationConfig,
  PolicyEnvironmentRotation,
  FileRotationStatus,
  KeyRotationStatus,
} from "./policy/types";
export { ComplianceGenerator } from "./compliance/generator";
export type { ComplianceDocument, ComplianceSummary, GenerateOptions } from "./compliance/types";
export { runCompliance } from "./compliance/run";
export type { RunComplianceOptions, RunComplianceResult } from "./compliance/run";
export {
  describeCapabilities,
  isBulk,
  isLintable,
  isMergeAware,
  isMigratable,
  isRecipientManaged,
  isRotatable,
  isStructural,
  defaultBulk,
  SourceCapabilityUnsupportedError,
  MockSecretSource,
  FilesystemStorageBackend,
  createSopsEncryptionBackend,
  composeSecretSource,
} from "./source";
export type { StorageBackend, EncryptionBackend, EncryptionContext, RotateOptions } from "./source";
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
} from "./source";
