/** JSON envelope for a packed artifact. Language-agnostic, forward-compatible. */
export interface PackedArtifact {
  version: 1;
  /** Service identity name. */
  identity: string;
  /** Target environment name. */
  environment: string;
  /** ISO-8601 timestamp of when the artifact was packed. */
  packedAt: string;
  /** Monotonic revision (unix epoch ms) for change detection. */
  revision: string;
  /** SHA-256 hex digest of the ciphertext for integrity verification. */
  ciphertextHash: string;
  /** PEM-armored age ciphertext containing the encrypted secrets blob. */
  ciphertext: string;
  /** Secret key names for introspection (not the values). */
  keys: string[];
}

/** Configuration for the `pack` command. */
export interface PackConfig {
  /** Service identity name from the manifest. */
  identity: string;
  /** Target environment name. */
  environment: string;
  /** Local file path to write the artifact JSON to. */
  outputPath: string;
}

/** Result of a pack operation. */
export interface PackResult {
  /** Path where the artifact was written. */
  outputPath: string;
  /** Number of namespaces included. */
  namespaceCount: number;
  /** Number of secret keys in the artifact. */
  keyCount: number;
  /** Size of the artifact file in bytes. */
  artifactSize: number;
  /** Monotonic revision string. */
  revision: string;
}
