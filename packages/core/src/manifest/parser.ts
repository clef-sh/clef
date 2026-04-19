/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as fs from "fs";
import * as YAML from "yaml";
import {
  ClefManifest,
  ClefEnvironment,
  ManifestValidationError,
  ServiceIdentityDefinition,
  ServiceIdentityEnvironmentConfig,
} from "../types";
import { validateAgePublicKey } from "../recipients/validator";

/**
 * Canonical filename for the Clef manifest.
 * All code that references this filename must import this constant.
 */
export const CLEF_MANIFEST_FILENAME = "clef.yaml";

const VALID_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp", "hsm"] as const;
/**
 * Minimum PKCS#11 URI shape required at parse time. Loose by design — full
 * RFC 7512 grammar varies per HSM vendor, and clef-keyservice owns the
 * authoritative parse via miekg/pkcs11. We just guard against obvious typos
 * (wrong scheme, no attributes) so that misconfigured manifests fail at
 * `clef lint` instead of at first encrypt.
 */
const PKCS11_URI_PATTERN = /^pkcs11:[a-zA-Z][a-zA-Z0-9_-]*=[^;]+/;
const VALID_TOP_LEVEL_KEYS = [
  "version",
  "environments",
  "namespaces",
  "sops",
  "file_pattern",
  "service_identities",
];
/** Shared pattern for environment and namespace names. */
const ENV_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const FILE_PATTERN_REQUIRED_TOKENS = ["{namespace}", "{environment}"];

/**
 * Parses and validates `clef.yaml` manifest files.
 *
 * @example
 * ```ts
 * const parser = new ManifestParser();
 * const manifest = parser.parse("/path/to/clef.yaml");
 * ```
 */
export class ManifestParser {
  /**
   * Read and validate a `clef.yaml` file from disk.
   *
   * @param filePath - Absolute or relative path to the manifest file.
   * @returns Validated {@link ClefManifest}.
   * @throws {@link ManifestValidationError} If the file cannot be read, contains invalid YAML,
   *   or fails schema validation.
   */
  parse(filePath: string): ClefManifest {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new ManifestValidationError(
        `Could not read manifest file at '${filePath}'. Run 'clef init' to create one.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      throw new ManifestValidationError(
        "Manifest file contains invalid YAML. Check for syntax errors in clef.yaml.",
      );
    }

    return this.validate(parsed);
  }

  /**
   * Validate an already-parsed object against the manifest schema.
   *
   * @param input - Raw value returned by `YAML.parse`.
   * @returns Validated {@link ClefManifest}.
   * @throws {@link ManifestValidationError} On any schema violation.
   */
  validate(input: unknown): ClefManifest {
    if (input === null || input === undefined || typeof input !== "object") {
      throw new ManifestValidationError(
        "Manifest must be a YAML object, not null or a scalar value.",
        "root",
      );
    }

    const obj = input as Record<string, unknown>;

    // Check for unknown top-level keys
    for (const key of Object.keys(obj)) {
      if (!VALID_TOP_LEVEL_KEYS.includes(key)) {
        throw new ManifestValidationError(
          `Unknown top-level key '${key}' in manifest. Valid keys are: ${VALID_TOP_LEVEL_KEYS.join(", ")}.`,
          key,
        );
      }
    }

    // version
    if (obj.version === undefined) {
      throw new ManifestValidationError("Missing required field 'version'.", "version");
    }
    if (typeof obj.version !== "number" || obj.version !== 1) {
      throw new ManifestValidationError(
        "Field 'version' must be 1. Only version 1 is currently supported.",
        "version",
      );
    }

    // environments
    if (!obj.environments) {
      throw new ManifestValidationError(
        "Missing required field 'environments'. Define at least one environment.",
        "environments",
      );
    }
    if (!Array.isArray(obj.environments) || obj.environments.length === 0) {
      throw new ManifestValidationError(
        "Field 'environments' must be a non-empty array.",
        "environments",
      );
    }
    const environments: ClefEnvironment[] = obj.environments.map((env: unknown, i: number) => {
      if (typeof env !== "object" || env === null) {
        throw new ManifestValidationError(
          `Environment at index ${i} must be an object with 'name' and 'description'.`,
          "environments",
        );
      }
      const envObj = env as Record<string, unknown>;
      if (!envObj.name || typeof envObj.name !== "string") {
        throw new ManifestValidationError(
          `Environment at index ${i} is missing a 'name' string.`,
          "environments",
        );
      }
      if (!ENV_NAME_PATTERN.test(envObj.name)) {
        throw new ManifestValidationError(
          `Environment name '${envObj.name}' is invalid. Names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, and underscores.`,
          "environments",
        );
      }
      if (!envObj.description || typeof envObj.description !== "string") {
        throw new ManifestValidationError(
          `Environment '${envObj.name}' is missing a 'description' string.`,
          "environments",
        );
      }

      const result: ClefEnvironment = {
        name: envObj.name,
        description: envObj.description,
        ...(typeof envObj.protected === "boolean" ? { protected: envObj.protected } : {}),
      };

      // Parse optional per-environment sops override
      if (envObj.sops !== undefined) {
        if (typeof envObj.sops !== "object" || envObj.sops === null) {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' has an invalid 'sops' field. It must be an object.`,
            "environments",
          );
        }
        const sopsOverride = envObj.sops as Record<string, unknown>;
        if (!sopsOverride.backend || typeof sopsOverride.backend !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' sops override is missing 'backend'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
            "environments",
          );
        }
        if (!(VALID_BACKENDS as readonly string[]).includes(sopsOverride.backend)) {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' has invalid sops backend '${sopsOverride.backend}'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
            "environments",
          );
        }
        const backend = sopsOverride.backend as (typeof VALID_BACKENDS)[number];

        // Validate required fields per backend
        if (backend === "awskms" && typeof sopsOverride.aws_kms_arn !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'awskms' backend but is missing 'aws_kms_arn'.`,
            "environments",
          );
        }
        if (backend === "gcpkms" && typeof sopsOverride.gcp_kms_resource_id !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'gcpkms' backend but is missing 'gcp_kms_resource_id'.`,
            "environments",
          );
        }
        if (backend === "azurekv" && typeof sopsOverride.azure_kv_url !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'azurekv' backend but is missing 'azure_kv_url'.`,
            "environments",
          );
        }
        if (backend === "pgp" && typeof sopsOverride.pgp_fingerprint !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'pgp' backend but is missing 'pgp_fingerprint'.`,
            "environments",
          );
        }
        if (backend === "hsm") {
          if (typeof sopsOverride.pkcs11_uri !== "string") {
            throw new ManifestValidationError(
              `Environment '${envObj.name}' uses 'hsm' backend but is missing 'pkcs11_uri'.`,
              "environments",
            );
          }
          if (!PKCS11_URI_PATTERN.test(sopsOverride.pkcs11_uri)) {
            throw new ManifestValidationError(
              `Environment '${envObj.name}' has an invalid 'pkcs11_uri' '${sopsOverride.pkcs11_uri}'. ` +
                "Must start with 'pkcs11:' and contain at least one attribute (e.g. 'pkcs11:slot=0;label=clef-dek-wrapper').",
              "environments",
            );
          }
        }

        result.sops = {
          backend,
          ...(typeof sopsOverride.aws_kms_arn === "string"
            ? { aws_kms_arn: sopsOverride.aws_kms_arn }
            : {}),
          ...(typeof sopsOverride.gcp_kms_resource_id === "string"
            ? { gcp_kms_resource_id: sopsOverride.gcp_kms_resource_id }
            : {}),
          ...(typeof sopsOverride.azure_kv_url === "string"
            ? { azure_kv_url: sopsOverride.azure_kv_url }
            : {}),
          ...(typeof sopsOverride.pgp_fingerprint === "string"
            ? { pgp_fingerprint: sopsOverride.pgp_fingerprint }
            : {}),
          ...(typeof sopsOverride.pkcs11_uri === "string"
            ? { pkcs11_uri: sopsOverride.pkcs11_uri }
            : {}),
        };
      }

      // Parse optional per-environment recipients
      if (envObj.recipients !== undefined) {
        if (!Array.isArray(envObj.recipients)) {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' has an invalid 'recipients' field. It must be an array.`,
            "environments",
          );
        }
        const parsedRecipients: (string | { key: string; label?: string })[] = [];
        for (let ri = 0; ri < envObj.recipients.length; ri++) {
          const entry = envObj.recipients[ri];
          if (typeof entry === "string") {
            const validation = validateAgePublicKey(entry);
            if (!validation.valid) {
              throw new ManifestValidationError(
                `Environment '${envObj.name}' recipient at index ${ri}: ${validation.error}`,
                "environments",
              );
            }
            parsedRecipients.push(validation.key!);
          } else if (typeof entry === "object" && entry !== null) {
            const entryObj = entry as Record<string, unknown>;
            if (typeof entryObj.key !== "string") {
              throw new ManifestValidationError(
                `Environment '${envObj.name}' recipient at index ${ri} must have a 'key' string.`,
                "environments",
              );
            }
            const validation = validateAgePublicKey(entryObj.key);
            if (!validation.valid) {
              throw new ManifestValidationError(
                `Environment '${envObj.name}' recipient at index ${ri}: ${validation.error}`,
                "environments",
              );
            }
            const recipientObj: { key: string; label?: string } = { key: validation.key! };
            if (typeof entryObj.label === "string") {
              recipientObj.label = entryObj.label;
            }
            parsedRecipients.push(recipientObj);
          } else {
            throw new ManifestValidationError(
              `Environment '${envObj.name}' recipient at index ${ri} must be a string or object.`,
              "environments",
            );
          }
        }
        if (parsedRecipients.length > 0) {
          result.recipients = parsedRecipients;
        }
      }

      return result;
    });

    // Check for duplicate environment names
    const envNames = new Set<string>();
    for (const env of environments) {
      if (envNames.has(env.name)) {
        throw new ManifestValidationError(
          `Duplicate environment name '${env.name}'. Each environment must have a unique name.`,
          "environments",
        );
      }
      envNames.add(env.name);
    }

    // namespaces
    // Design decision: all namespaces are encrypted. There is no `encrypted: false`
    // option on namespace definitions. This is intentional — see docs/guide/concepts.md
    // "Design decision: all namespaces are encrypted" for the full rationale.
    if (!obj.namespaces) {
      throw new ManifestValidationError(
        "Missing required field 'namespaces'. Define at least one namespace.",
        "namespaces",
      );
    }
    if (!Array.isArray(obj.namespaces) || obj.namespaces.length === 0) {
      throw new ManifestValidationError(
        "Field 'namespaces' must be a non-empty array.",
        "namespaces",
      );
    }
    const namespaces = obj.namespaces.map((ns: unknown, i: number) => {
      if (typeof ns !== "object" || ns === null) {
        throw new ManifestValidationError(
          `Namespace at index ${i} must be an object with 'name' and 'description'.`,
          "namespaces",
        );
      }
      const nsObj = ns as Record<string, unknown>;
      if (!nsObj.name || typeof nsObj.name !== "string") {
        throw new ManifestValidationError(
          `Namespace at index ${i} is missing a 'name' string.`,
          "namespaces",
        );
      }
      if (!ENV_NAME_PATTERN.test(nsObj.name)) {
        throw new ManifestValidationError(
          `Namespace name '${nsObj.name}' is invalid. Names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, and underscores.`,
          "namespaces",
        );
      }
      if (!nsObj.description || typeof nsObj.description !== "string") {
        throw new ManifestValidationError(
          `Namespace '${nsObj.name}' is missing a 'description' string.`,
          "namespaces",
        );
      }
      return {
        name: nsObj.name,
        description: nsObj.description,
        ...(typeof nsObj.schema === "string" ? { schema: nsObj.schema } : {}),
        ...(Array.isArray(nsObj.owners) ? { owners: nsObj.owners as string[] } : {}),
      };
    });

    // Check for duplicate namespace names
    const nsNames = new Set<string>();
    for (const ns of namespaces) {
      if (nsNames.has(ns.name)) {
        throw new ManifestValidationError(
          `Duplicate namespace name '${ns.name}'. Each namespace must have a unique name.`,
          "namespaces",
        );
      }
      nsNames.add(ns.name);
    }

    // sops
    if (!obj.sops) {
      throw new ManifestValidationError(
        "Missing required field 'sops'. Configure at least 'default_backend'.",
        "sops",
      );
    }
    if (typeof obj.sops !== "object" || obj.sops === null) {
      throw new ManifestValidationError("Field 'sops' must be an object.", "sops");
    }
    const sopsObj = obj.sops as Record<string, unknown>;
    if (!sopsObj.default_backend || typeof sopsObj.default_backend !== "string") {
      throw new ManifestValidationError(
        `Field 'sops.default_backend' is required and must be one of: ${VALID_BACKENDS.join(", ")}.`,
        "sops.default_backend",
      );
    }
    if (!(VALID_BACKENDS as readonly string[]).includes(sopsObj.default_backend)) {
      throw new ManifestValidationError(
        `Invalid sops.default_backend '${sopsObj.default_backend}'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
        "sops.default_backend",
      );
    }

    // Parse age.recipients if present
    const ageObj = sopsObj.age as Record<string, unknown> | undefined;
    const ageRecipients =
      ageObj && Array.isArray(ageObj.recipients) ? (ageObj.recipients as unknown[]) : undefined;
    const parsedAge = ageRecipients
      ? {
          age: {
            recipients: ageRecipients.map((r) => {
              if (typeof r === "string") return r;
              if (typeof r === "object" && r !== null) {
                const obj = r as Record<string, unknown>;
                return {
                  key: String(obj.key ?? ""),
                  ...(typeof obj.label === "string" ? { label: obj.label } : {}),
                };
              }
              return String(r);
            }),
          },
        }
      : {};

    // Optional global pkcs11_uri — required iff default_backend is hsm.
    if (sopsObj.pkcs11_uri !== undefined && typeof sopsObj.pkcs11_uri !== "string") {
      throw new ManifestValidationError(
        "Field 'sops.pkcs11_uri' must be a string.",
        "sops.pkcs11_uri",
      );
    }
    if (typeof sopsObj.pkcs11_uri === "string" && !PKCS11_URI_PATTERN.test(sopsObj.pkcs11_uri)) {
      throw new ManifestValidationError(
        `Field 'sops.pkcs11_uri' has invalid format '${sopsObj.pkcs11_uri}'. ` +
          "Must start with 'pkcs11:' and contain at least one attribute (e.g. 'pkcs11:slot=0;label=clef-dek-wrapper').",
        "sops.pkcs11_uri",
      );
    }
    if (sopsObj.default_backend === "hsm" && typeof sopsObj.pkcs11_uri !== "string") {
      throw new ManifestValidationError(
        "Field 'sops.pkcs11_uri' is required when sops.default_backend is 'hsm'.",
        "sops.pkcs11_uri",
      );
    }

    const sopsConfig = {
      default_backend: sopsObj.default_backend as (typeof VALID_BACKENDS)[number],
      ...parsedAge,
      ...(typeof sopsObj.aws_kms_arn === "string" ? { aws_kms_arn: sopsObj.aws_kms_arn } : {}),
      ...(typeof sopsObj.gcp_kms_resource_id === "string"
        ? { gcp_kms_resource_id: sopsObj.gcp_kms_resource_id }
        : {}),
      ...(typeof sopsObj.azure_kv_url === "string" ? { azure_kv_url: sopsObj.azure_kv_url } : {}),
      ...(typeof sopsObj.pgp_fingerprint === "string"
        ? { pgp_fingerprint: sopsObj.pgp_fingerprint }
        : {}),
      ...(typeof sopsObj.pkcs11_uri === "string" ? { pkcs11_uri: sopsObj.pkcs11_uri } : {}),
    };

    // Post-processing: validate per-env recipients are only used with age backend
    for (const env of environments) {
      if (env.recipients && env.recipients.length > 0) {
        const effectiveBackend = env.sops?.backend ?? sopsConfig.default_backend;
        if (effectiveBackend !== "age") {
          throw new ManifestValidationError(
            `Environment '${env.name}' has per-environment recipients but uses '${effectiveBackend}' backend. Per-environment recipients are only supported with the 'age' backend.`,
            "environments",
          );
        }
      }
    }

    // file_pattern
    if (!obj.file_pattern || typeof obj.file_pattern !== "string") {
      throw new ManifestValidationError(
        "Missing required field 'file_pattern'. Example: '{namespace}/{environment}.enc.yaml'.",
        "file_pattern",
      );
    }
    for (const token of FILE_PATTERN_REQUIRED_TOKENS) {
      if (!obj.file_pattern.includes(token)) {
        throw new ManifestValidationError(
          `file_pattern must contain '${token}'. Got: '${obj.file_pattern}'.`,
          "file_pattern",
        );
      }
    }

    // service_identities (optional)
    let serviceIdentities: ServiceIdentityDefinition[] | undefined;
    if (obj.service_identities !== undefined) {
      if (!Array.isArray(obj.service_identities)) {
        throw new ManifestValidationError(
          "Field 'service_identities' must be an array.",
          "service_identities",
        );
      }
      serviceIdentities = obj.service_identities.map((si: unknown, i: number) => {
        if (typeof si !== "object" || si === null) {
          throw new ManifestValidationError(
            `Service identity at index ${i} must be an object.`,
            "service_identities",
          );
        }
        const siObj = si as Record<string, unknown>;

        if (!siObj.name || typeof siObj.name !== "string") {
          throw new ManifestValidationError(
            `Service identity at index ${i} is missing a 'name' string.`,
            "service_identities",
          );
        }
        const siName = siObj.name;

        // Identity names appear as DNS subdomains in Cloud serve URLs
        // (e.g. api-gateway.serve.clef.sh) and as URL path segments, so
        // they must be valid DNS labels: lowercase alphanumeric + hyphens,
        // no leading/trailing hyphen, max 63 chars.
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(siName)) {
          throw new ManifestValidationError(
            `Service identity '${siName}' has an invalid name. ` +
              "Names must be lowercase alphanumeric with hyphens, " +
              "must not start or end with a hyphen, and max 63 characters " +
              "(e.g. 'api-gateway', 'auth-service').",
            "service_identities",
          );
        }

        if (siObj.description != null && typeof siObj.description !== "string") {
          throw new ManifestValidationError(
            `Service identity '${siName}' has a non-string 'description'.`,
            "service_identities",
          );
        }

        if (siObj.pack_only !== undefined && typeof siObj.pack_only !== "boolean") {
          throw new ManifestValidationError(
            `Service identity '${siName}' has a non-boolean 'pack_only' field.`,
            "service_identities",
          );
        }

        // namespaces
        if (!Array.isArray(siObj.namespaces) || siObj.namespaces.length === 0) {
          throw new ManifestValidationError(
            `Service identity '${siName}' must have a non-empty 'namespaces' array.`,
            "service_identities",
          );
        }
        for (const ns of siObj.namespaces) {
          if (typeof ns !== "string") {
            throw new ManifestValidationError(
              `Service identity '${siName}' has a non-string entry in 'namespaces'.`,
              "service_identities",
            );
          }
          if (!nsNames.has(ns)) {
            throw new ManifestValidationError(
              `Service identity '${siName}' references unknown namespace '${ns}'.`,
              "service_identities",
            );
          }
        }

        // environments
        if (
          !siObj.environments ||
          typeof siObj.environments !== "object" ||
          Array.isArray(siObj.environments)
        ) {
          throw new ManifestValidationError(
            `Service identity '${siName}' must have an 'environments' object.`,
            "service_identities",
          );
        }
        const siEnvs = siObj.environments as Record<string, unknown>;
        const parsedEnvs: Record<string, ServiceIdentityEnvironmentConfig> = {};

        // Note: we deliberately DO NOT enforce "every declared env must be on
        // every SI" at parse time. `clef env add` adds an env without
        // cascading to existing SIs — that gap is reported by `clef lint` /
        // ServiceIdentityManager.validate as a `missing_environment` issue,
        // and the user fills it explicitly with `clef service add-env`.
        // Failing the parse would prevent any clef command from running
        // against a manifest in the legitimate "env added, SIs not yet
        // updated" state.

        for (const [envName, envVal] of Object.entries(siEnvs)) {
          if (!envNames.has(envName)) {
            throw new ManifestValidationError(
              `Service identity '${siName}' references unknown environment '${envName}'.`,
              "service_identities",
            );
          }
          if (typeof envVal !== "object" || envVal === null) {
            throw new ManifestValidationError(
              `Service identity '${siName}' environment '${envName}' must be an object with 'recipient' or 'kms'.`,
              "service_identities",
            );
          }
          const envObj = envVal as Record<string, unknown>;
          const hasRecipient = envObj.recipient !== undefined;
          const hasKms = envObj.kms !== undefined;

          if (hasRecipient && hasKms) {
            throw new ManifestValidationError(
              `Service identity '${siName}' environment '${envName}': 'recipient' and 'kms' are mutually exclusive.`,
              "service_identities",
            );
          }
          if (!hasRecipient && !hasKms) {
            throw new ManifestValidationError(
              `Service identity '${siName}' environment '${envName}' must have either 'recipient' or 'kms'.`,
              "service_identities",
            );
          }

          if (hasRecipient) {
            if (typeof envObj.recipient !== "string") {
              throw new ManifestValidationError(
                `Service identity '${siName}' environment '${envName}': 'recipient' must be a string.`,
                "service_identities",
              );
            }
            const recipientValidation = validateAgePublicKey(envObj.recipient);
            if (!recipientValidation.valid) {
              throw new ManifestValidationError(
                `Service identity '${siName}' environment '${envName}': ${recipientValidation.error}`,
                "service_identities",
              );
            }
            parsedEnvs[envName] = { recipient: recipientValidation.key! };
          } else {
            const kmsObj = envObj.kms as Record<string, unknown>;
            if (typeof kmsObj !== "object" || kmsObj === null) {
              throw new ManifestValidationError(
                `Service identity '${siName}' environment '${envName}': 'kms' must be an object.`,
                "service_identities",
              );
            }
            const validProviders = ["aws", "gcp", "azure"];
            if (!kmsObj.provider || !validProviders.includes(kmsObj.provider as string)) {
              throw new ManifestValidationError(
                `Service identity '${siName}' environment '${envName}': kms.provider must be one of: ${validProviders.join(", ")}.`,
                "service_identities",
              );
            }
            if (!kmsObj.keyId || typeof kmsObj.keyId !== "string") {
              throw new ManifestValidationError(
                `Service identity '${siName}' environment '${envName}': kms.keyId must be a non-empty string.`,
                "service_identities",
              );
            }
            parsedEnvs[envName] = {
              kms: {
                provider: kmsObj.provider as "aws" | "gcp" | "azure",
                keyId: kmsObj.keyId,
                region: typeof kmsObj.region === "string" ? kmsObj.region : undefined,
              },
            };
          }
        }

        return {
          name: siName,
          description: (siObj.description as string) ?? "",
          namespaces: siObj.namespaces as string[],
          environments: parsedEnvs,
          ...(siObj.pack_only === true ? { pack_only: true } : {}),
        };
      });

      // Check for duplicate identity names
      const siNames = new Set<string>();
      for (const si of serviceIdentities) {
        if (siNames.has(si.name)) {
          throw new ManifestValidationError(
            `Duplicate service identity name '${si.name}'.`,
            "service_identities",
          );
        }
        siNames.add(si.name);
      }
    }

    return {
      version: 1,
      environments,
      namespaces,
      sops: sopsConfig,
      file_pattern: obj.file_pattern,
      ...(serviceIdentities ? { service_identities: serviceIdentities } : {}),
    };
  }

  /**
   * Watch a manifest file for changes and invoke a callback on each successful parse.
   *
   * @param filePath - Path to the manifest file to watch.
   * @param onChange - Called with the newly parsed manifest on each valid change.
   * @returns Unsubscribe function — call it to stop watching.
   */
  watch(filePath: string, onChange: (manifest: ClefManifest) => void): () => void {
    const watcher = fs.watch(filePath, () => {
      try {
        const manifest = this.parse(filePath);
        onChange(manifest);
      } catch {
        // Ignore parse errors during watch — file may be mid-save
      }
    });

    return () => {
      watcher.close();
    };
  }
}
