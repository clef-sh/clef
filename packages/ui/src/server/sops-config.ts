import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ManifestParser, resolveRecipientsForEnvironment } from "@clef-sh/core";
import type { ClefManifest, ClefLocalConfig } from "@clef-sh/core";

/**
 * Regenerate `.sops.yaml` from the current `clef.yaml` manifest.
 * Mirrors `scaffoldSopsConfig` from `packages/cli/src/commands/init.ts` so
 * the UI can call it without depending on `@clef-sh/cli`.
 */
export function scaffoldSopsConfig(repoRoot: string, ageKeyFile?: string, ageKey?: string): void {
  const parser = new ManifestParser();
  const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
  const sopsYamlPath = path.join(repoRoot, ".sops.yaml");

  let agePublicKey: string | undefined;
  if (manifest.sops.default_backend === "age") {
    agePublicKey = resolveAgePublicKey(repoRoot, ageKeyFile, ageKey);
  }

  const sopsConfig = buildSopsYaml(manifest, repoRoot, agePublicKey);
  fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
}

function buildSopsYaml(
  manifest: ClefManifest,
  repoRoot: string,
  agePublicKey: string | undefined,
): Record<string, unknown> {
  const creationRules: Record<string, unknown>[] = [];

  for (const ns of manifest.namespaces) {
    for (const env of manifest.environments) {
      const pathRegex = `${ns.name}/${env.name}\\.enc\\.yaml$`;
      const rule: Record<string, unknown> = { path_regex: pathRegex };
      const backend = env.sops?.backend ?? manifest.sops.default_backend;

      switch (backend) {
        case "age": {
          const envRecipients = resolveRecipientsForEnvironment(manifest, env.name);
          if (envRecipients && envRecipients.length > 0) {
            const keys = envRecipients.map((r) => (typeof r === "string" ? r : r.key));
            rule.age = keys.join(",");
          } else if (agePublicKey) {
            rule.age = agePublicKey;
          } else {
            // Fallback: read age recipients from the existing encrypted file's SOPS metadata
            const filePath = path.join(
              repoRoot,
              manifest.file_pattern
                .replace("{namespace}", ns.name)
                .replace("{environment}", env.name),
            );
            const existingAge = readAgeRecipientsFromFile(filePath);
            if (existingAge) rule.age = existingAge;
          }
          break;
        }
        case "awskms": {
          const arn = env.sops?.aws_kms_arn ?? manifest.sops.aws_kms_arn;
          if (arn) rule.kms = arn;
          break;
        }
        case "gcpkms": {
          const resourceId = env.sops?.gcp_kms_resource_id ?? manifest.sops.gcp_kms_resource_id;
          if (resourceId) rule.gcp_kms = resourceId;
          break;
        }
        case "azurekv": {
          const kvUrl = env.sops?.azure_kv_url ?? manifest.sops.azure_kv_url;
          if (kvUrl) rule.azure_keyvault = kvUrl;
          break;
        }
        case "pgp": {
          const fingerprint = env.sops?.pgp_fingerprint ?? manifest.sops.pgp_fingerprint;
          if (fingerprint) rule.pgp = fingerprint;
          break;
        }
      }

      creationRules.push(rule);
    }
  }

  return { creation_rules: creationRules };
}

/**
 * Resolve age public key for `.sops.yaml` generation.
 * Checks: ageKeyFile arg → ageKey arg → CLEF_AGE_KEY_FILE env →
 * CLEF_AGE_KEY env → `.clef/config.yaml`.
 */
function resolveAgePublicKey(
  repoRoot: string,
  ageKeyFile?: string,
  ageKey?: string,
): string | undefined {
  // 1. Explicit ageKeyFile (passed from ApiDeps)
  if (ageKeyFile) {
    const pubKey = extractAgePublicKey(ageKeyFile);
    if (pubKey) return pubKey;
  }

  // 2. Explicit ageKey (inline private key — extract public key comment)
  if (ageKey) {
    const match = ageKey.match(/# public key: (age1[a-z0-9]+)/);
    if (match) return match[1];
  }

  // 3. CLEF_AGE_KEY_FILE env
  if (process.env.CLEF_AGE_KEY_FILE) {
    const pubKey = extractAgePublicKey(process.env.CLEF_AGE_KEY_FILE);
    if (pubKey) return pubKey;
  }

  // 4. CLEF_AGE_KEY env
  if (process.env.CLEF_AGE_KEY) {
    const match = process.env.CLEF_AGE_KEY.match(/# public key: (age1[a-z0-9]+)/);
    if (match) return match[1];
  }

  // 5. .clef/config.yaml
  const clefConfigPath = path.join(repoRoot, ".clef", "config.yaml");
  if (fs.existsSync(clefConfigPath)) {
    try {
      const config = YAML.parse(fs.readFileSync(clefConfigPath, "utf-8")) as ClefLocalConfig;
      if (config?.age_key_file) {
        const pubKey = extractAgePublicKey(config.age_key_file);
        if (pubKey) return pubKey;
      }
    } catch {
      // ignore parse errors
    }
  }

  return undefined;
}

/**
 * Read age recipient public keys from an existing SOPS-encrypted file's metadata.
 * Returns a comma-separated string of age public keys, or undefined if unavailable.
 */
function readAgeRecipientsFromFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    const sops = parsed?.sops as Record<string, unknown> | undefined;
    const ageEntries = sops?.age as Array<{ recipient: string }> | undefined;
    if (!ageEntries || ageEntries.length === 0) return undefined;
    const keys = ageEntries.map((e) => e.recipient).filter(Boolean);
    return keys.length > 0 ? keys.join(",") : undefined;
  } catch {
    return undefined;
  }
}

function extractAgePublicKey(keyFilePath: string): string | undefined {
  try {
    const content = fs.readFileSync(keyFilePath, "utf-8");
    const match = content.match(/# public key: (age1[a-z0-9]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}
