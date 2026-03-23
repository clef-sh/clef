import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as YAML from "yaml";
import { Command } from "commander";
import {
  ClefManifest,
  ClefLocalConfig,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SchemaValidator,
  SopsClient,
  SubprocessRunner,
  assertSops,
  SopsMissingError,
  SopsVersionError,
  generateAgeIdentity,
  formatAgeKeyFile,
  generateRandomValue,
  markPending,
  resolveRecipientsForEnvironment,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { setKeychainKey } from "../keychain";
import { generateKeyLabel } from "../label-generator";

const CLEF_DIR = ".clef";
const CLEF_CONFIG_FILENAME = "config.yaml";

const DEFAULT_CLEFIGNORE = `# .clefignore
# Files excluded from clef scan.
# See https://docs.clef.sh/cli/scan

# Dependencies
node_modules/
vendor/
.yarn/

# Build output
dist/
build/
.next/
.nuxt/

# Lock files (high entropy but not secrets)
*.lock
package-lock.json
yarn.lock
`;

function defaultAgeKeyPath(label: string): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "clef",
    "keys",
    label,
    "keys.txt",
  );
}

async function isGitRepository(dir: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      path.resolve(dir),
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isInsideAnyGitRepo(keyPath: string): Promise<boolean> {
  return isGitRepository(path.dirname(path.resolve(keyPath)));
}

async function promptKeyLocation(defaultPath: string): Promise<string> {
  const answer = await promptWithDefault(
    "Where should your age private key be stored? (must be outside any git repository)",
    defaultPath,
  );
  const resolved = path.resolve(answer);
  if (await isInsideAnyGitRepo(resolved)) {
    throw new Error(
      `Key path '${answer}' is inside a git repository. Choose a path outside any git repo to keep your private key secure.`,
    );
  }
  return resolved;
}

export function registerInitCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("init")
    .description(
      "Initialise a new Clef repo with a manifest, encrypted file matrix, and pre-commit hook",
    )
    .option(
      "--environments <envs>",
      "Comma-separated list of environments",
      "dev,staging,production",
    )
    .option("--namespaces <namespaces>", "Comma-separated list of namespaces")
    .option(
      "--backend <backend>",
      "SOPS encryption backend (age, awskms, gcpkms, azurekv, pgp)",
      "age",
    )
    .option("--non-interactive", "Skip interactive prompts and use defaults/flags")
    .option(
      "--random-values",
      "Scaffold required schema keys with random placeholder values (marks them as pending)",
    )
    .option("--include-optional", "When used with --random-values, also scaffold optional keys")
    .option("--secrets-dir <dir>", "Base directory for encrypted secret files", "secrets")
    .action(async (options) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        // Fail fast: clef init requires a git repository
        if (!(await isGitRepository(repoRoot))) {
          formatter.error("clef init must be run inside a git repository. Run 'git init' first.");
          process.exit(1);
          return;
        }

        const manifestPath = path.join(repoRoot, "clef.yaml");
        const clefConfigPath = path.join(repoRoot, CLEF_DIR, CLEF_CONFIG_FILENAME);

        const manifestExists = fs.existsSync(manifestPath);
        const localConfigExists = fs.existsSync(clefConfigPath);

        // Idempotency: both exist — already initialised
        if (manifestExists && localConfigExists) {
          formatter.print("Already initialised. Run 'clef update' to scaffold new environments.");
          process.exit(0);
          return;
        }

        // Second-dev onboarding: manifest exists but local config missing
        if (manifestExists && !localConfigExists) {
          await handleSecondDevOnboarding(repoRoot, clefConfigPath, deps, options);
          return;
        }

        // Full setup: neither exists (or manifest is missing)
        // Check dependencies first — fail fast with a clean error
        try {
          await assertSops(deps.runner);
        } catch (err) {
          if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
            formatter.formatDependencyError(err);
            process.exit(1);
            return;
          }
          /* istanbul ignore next -- only reachable if assertSops throws a non-dependency error */
          throw err;
        }

        await handleFullSetup(repoRoot, manifestPath, clefConfigPath, deps, options);
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}

async function handleSecondDevOnboarding(
  repoRoot: string,
  clefConfigPath: string,
  deps: { runner: SubprocessRunner },
  options: { nonInteractive?: boolean },
): Promise<void> {
  // Always generate a fresh key + label for this repo
  const label = generateKeyLabel();
  const identity = await generateAgeIdentity();
  const privateKey = identity.privateKey;
  let config: ClefLocalConfig;

  // Try keychain first
  const storedInKeychain = await setKeychainKey(deps.runner, privateKey, label);

  if (storedInKeychain) {
    formatter.success("Stored age key in OS keychain");
    config = { age_key_storage: "keychain", age_keychain_label: label };
  } else {
    // Keychain unavailable — filesystem fallback
    let keyPath: string;

    if (options.nonInteractive || !process.stdin.isTTY) {
      keyPath = process.env.CLEF_AGE_KEY_FILE || defaultAgeKeyPath(label);
      keyPath = path.resolve(keyPath);
    } else {
      keyPath = await promptKeyLocation(defaultAgeKeyPath(label));
    }

    if (await isInsideAnyGitRepo(keyPath)) {
      throw new Error(
        `Key path '${keyPath}' is inside a git repository. Choose a path outside any git repo to keep your private key secure.`,
      );
    }

    // Write key file
    const publicKey = identity.publicKey;
    const keyContent = formatAgeKeyFile(privateKey, publicKey);
    const keyDir = path.dirname(keyPath);
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }
    fs.writeFileSync(keyPath, keyContent, { encoding: "utf-8", mode: 0o600 });
    formatter.success(`Generated age key at ${keyPath}`);

    config = { age_key_file: keyPath, age_key_storage: "file", age_keychain_label: label };
  }

  // Write .clef/config.yaml and .clef/.gitignore
  const clefDir = path.dirname(clefConfigPath);
  if (!fs.existsSync(clefDir)) {
    fs.mkdirSync(clefDir, { recursive: true });
  }
  fs.writeFileSync(clefConfigPath, YAML.stringify(config), "utf-8");
  formatter.success("Created .clef/config.yaml");

  const gitignorePath = path.join(clefDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf-8");
    formatter.success("Created .clef/.gitignore");
  }

  formatter.success(`Key label: ${label}`);

  formatter.section("Next steps:");
  formatter.hint("clef recipients request  \u2014 request access to encrypted secrets");
  formatter.hint("clef update  \u2014 scaffold new environments");
  formatter.hint("clef lint    \u2014 check repo health");
}

async function handleFullSetup(
  repoRoot: string,
  manifestPath: string,
  clefConfigPath: string,
  deps: { runner: SubprocessRunner },
  options: {
    environments?: string;
    namespaces?: string;
    backend?: string;
    nonInteractive?: boolean;
    randomValues?: boolean;
    includeOptional?: boolean;
    secretsDir?: string;
  },
): Promise<void> {
  let environments: string[] = (options.environments ?? "dev,staging,production")
    .split(",")
    .map((s: string) => s.trim());
  let namespaces: string[] = options.namespaces
    ? options.namespaces.split(",").map((s: string) => s.trim())
    : [];
  const backend: string = options.backend ?? "age";
  let secretsDir: string = options.secretsDir ?? "secrets";

  if (!options.nonInteractive && process.stdin.isTTY) {
    const envAnswer = await promptWithDefault(
      "Environments (comma-separated)",
      environments.join(","),
    );
    environments = envAnswer.split(",").map((s) => s.trim());

    if (namespaces.length === 0) {
      const nsAnswer = await promptWithDefault("Namespaces (comma-separated)", "");
      if (nsAnswer) {
        namespaces = nsAnswer.split(",").map((s) => s.trim());
      }
    }

    secretsDir = await promptWithDefault("Secrets directory", secretsDir);
  }

  if (namespaces.length === 0) {
    formatter.error(
      "At least one namespace is required. Use --namespaces or provide interactively.",
    );
    process.exit(1);
    return;
  }

  const manifest: ClefManifest = {
    version: 1,
    environments: environments.map((name, _i) => ({
      name,
      description:
        name === "production"
          ? "Live system"
          : name === "staging"
            ? "Pre-production"
            : "Local development",
      ...(name === "production" ? { protected: true } : {}),
    })),
    namespaces: namespaces.map((name) => ({
      name,
      description: `${name.charAt(0).toUpperCase() + name.slice(1)} configuration`,
    })),
    sops: {
      default_backend: backend as ClefManifest["sops"]["default_backend"],
    },
    file_pattern: `${secretsDir}/{namespace}/{environment}.enc.yaml`,
  };

  // Validate the manifest
  const initParser = new ManifestParser();
  initParser.validate(manifest);

  // Write clef.yaml
  fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");
  formatter.success("Created clef.yaml");

  // Handle age backend: generate a fresh key + label and store securely
  let ageKeyFile: string | undefined;
  let ageKey: string | undefined;
  if (backend === "age") {
    const label = generateKeyLabel();
    const identity = await generateAgeIdentity();
    const privateKey = identity.privateKey;
    const publicKey = identity.publicKey;

    // Try to store in keychain
    const storedInKeychain = await setKeychainKey(deps.runner, privateKey, label);

    if (storedInKeychain) {
      formatter.success("Stored age key in OS keychain");
      ageKey = privateKey;
    } else {
      // Keychain unavailable — filesystem fallback requires explicit acknowledgment
      formatter.warn(
        "OS keychain is not available on this system.\n" +
          "  The private key must be written to the filesystem instead.\n" +
          "  See https://docs.clef.sh/guide/key-storage for security implications.",
      );

      if (!options.nonInteractive && process.stdin.isTTY) {
        const confirmed = await formatter.confirm("Write the private key to the filesystem?");
        if (!confirmed) {
          formatter.error(
            "Aborted — no key storage available. " +
              "Set up an OS keychain or re-run on a supported platform.",
          );
          process.exit(1);
          return;
        }
      }

      // Determine key path
      let keyPath: string;
      if (options.nonInteractive || !process.stdin.isTTY) {
        keyPath = defaultAgeKeyPath(label);
        if (await isInsideAnyGitRepo(path.resolve(keyPath))) {
          throw new Error(
            `Default key path '${keyPath}' is inside a git repository. Set HOME to a non-git location.`,
          );
        }
      } else {
        keyPath = await promptKeyLocation(defaultAgeKeyPath(label));
      }

      // Write key file
      const keyContent = formatAgeKeyFile(privateKey, publicKey);
      const keyDir = path.dirname(keyPath);
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
      }
      fs.writeFileSync(keyPath, keyContent, { encoding: "utf-8", mode: 0o600 });
      formatter.success(`Generated age key at ${keyPath}`);
      ageKeyFile = keyPath;
    }

    // Write .clef/config.yaml and .clef/.gitignore
    const clefDir = path.dirname(clefConfigPath);
    if (!fs.existsSync(clefDir)) {
      fs.mkdirSync(clefDir, { recursive: true });
    }
    const config: ClefLocalConfig = ageKeyFile
      ? { age_key_file: ageKeyFile, age_key_storage: "file", age_keychain_label: label }
      : { age_key_storage: "keychain", age_keychain_label: label };
    fs.writeFileSync(clefConfigPath, YAML.stringify(config), "utf-8");
    formatter.success("Created .clef/config.yaml");

    const gitignorePath = path.join(clefDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n", "utf-8");
      formatter.success("Created .clef/.gitignore");
    }

    formatter.success(`Key label: ${label}`);

    // Generate .sops.yaml using the public key
    const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
    const sopsConfig = buildSopsYaml(manifest, repoRoot, publicKey);
    fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
    formatter.success("Created .sops.yaml");
  } else {
    // Non-age backend: generate .sops.yaml without a key
    const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
    const sopsConfig = buildSopsYaml(manifest, repoRoot, undefined);
    fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
    formatter.success("Created .sops.yaml");
  }

  // Scaffold the matrix
  const sopsClient = new SopsClient(deps.runner, ageKeyFile, ageKey);
  const matrixManager = new MatrixManager();
  const cells = matrixManager.resolveMatrix(manifest, repoRoot);

  let scaffoldedCount = 0;
  for (const cell of cells) {
    if (!cell.exists) {
      try {
        await matrixManager.scaffoldCell(cell, sopsClient, manifest);
        scaffoldedCount++;
      } catch (err) {
        formatter.warn(
          `Could not scaffold ${cell.namespace}/${cell.environment}: ${(err as Error).message}`,
        );
      }
    }
  }

  if (scaffoldedCount > 0) {
    formatter.success(`Scaffolded ${scaffoldedCount} encrypted file(s)`);
  }

  // --random-values: populate schema keys with random placeholders
  if (options.randomValues) {
    const schemaValidator = new SchemaValidator();
    let pendingTotal = 0;

    for (const ns of manifest.namespaces) {
      if (!ns.schema) {
        formatter.warn(
          `${ns.name} — no schema defined, skipped.\n` +
            `  To scaffold manually: clef set ${ns.name}/<environment> <KEY> --random`,
        );
        continue;
      }

      /* istanbul ignore next -- init creates namespaces without schema; this path only runs if a user edits clef.yaml before running init */
      await scaffoldRandomValues(
        ns,
        manifest,
        schemaValidator,
        sopsClient,
        repoRoot,
        options.includeOptional,
        /* istanbul ignore next */ (count: number) => {
          pendingTotal += count;
        },
      );
    }

    /* istanbul ignore next -- pendingTotal is always 0 during init since namespaces have no schema */
    if (pendingTotal > 0) {
      formatter.success(
        `Scaffolded ${pendingTotal} random placeholder value(s) — replace with real secrets using clef set`,
      );
    } else {
      formatter.warn(
        "No schemas found — --random-values requires schemas. " +
          "See clef set --random for manual scaffolding.",
      );
    }
  }

  // Create .clefignore if it doesn't exist
  const clefignorePath = path.join(repoRoot, ".clefignore");
  if (!fs.existsSync(clefignorePath)) {
    fs.writeFileSync(clefignorePath, DEFAULT_CLEFIGNORE, "utf-8");
    formatter.success("Created .clefignore");
  } else {
    formatter.print("  .clefignore already exists — skipping");
  }

  // Install git hooks and merge driver
  try {
    const git = new GitIntegration(deps.runner);
    await git.installPreCommitHook(repoRoot);
    formatter.success("Installed pre-commit hook");
    await git.installMergeDriver(repoRoot);
    formatter.success("Configured SOPS merge driver");
  } catch {
    formatter.warn(
      "Could not install git hooks. Run 'clef hooks install' inside a git repository.",
    );
  }

  formatter.section("Next steps:");
  formatter.hint("clef set <namespace>/<env> <KEY> <value>  \u2014 add a secret");
  formatter.hint("clef scan  \u2014 check for existing plaintext secrets");
  formatter.hint("clef lint  \u2014 check repo health");
  formatter.hint("clef ui    \u2014 open the web UI");
}

/**
 * Generate .sops.yaml from a manifest and write it to disk.
 * Used by `clef init` and `clef doctor --fix`.
 */
export function scaffoldSopsConfig(repoRoot: string): void {
  const manifestPath = path.join(repoRoot, "clef.yaml");
  const parser = new ManifestParser();
  const manifest = parser.parse(manifestPath);
  const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
  // Resolve age public key from environment or local config
  let agePublicKey: string | undefined;
  if (manifest.sops.default_backend === "age") {
    agePublicKey = resolveAgePublicKeyFromEnvOrFile(repoRoot);
  }
  const sopsConfig = buildSopsYaml(manifest, repoRoot, agePublicKey);
  fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
}

function buildSopsYaml(
  manifest: ClefManifest,
  _repoRoot: string,
  agePublicKey: string | undefined,
): Record<string, unknown> {
  const creationRules: Record<string, unknown>[] = [];

  for (const ns of manifest.namespaces) {
    for (const env of manifest.environments) {
      const pathRegex = `${ns.name}/${env.name}\\.enc\\.yaml$`;
      const rule: Record<string, unknown> = { path_regex: pathRegex };

      // Resolve the effective backend for this environment, respecting per-env overrides
      const backend = env.sops?.backend ?? manifest.sops.default_backend;

      switch (backend) {
        case "age": {
          const envRecipients = resolveRecipientsForEnvironment(manifest, env.name);
          if (envRecipients && envRecipients.length > 0) {
            const keys = envRecipients.map((r) => (typeof r === "string" ? r : r.key));
            rule.age = keys.join(",");
          } else if (agePublicKey) {
            rule.age = agePublicKey;
          }
          break;
        }
        case "awskms": {
          const arn = env.sops?.aws_kms_arn ?? manifest.sops.aws_kms_arn;
          if (arn) {
            rule.kms = arn;
          }
          break;
        }
        case "gcpkms": {
          const resourceId = env.sops?.gcp_kms_resource_id ?? manifest.sops.gcp_kms_resource_id;
          if (resourceId) {
            rule.gcp_kms = resourceId;
          }
          break;
        }
        case "azurekv": {
          const kvUrl = env.sops?.azure_kv_url ?? manifest.sops.azure_kv_url;
          if (kvUrl) {
            rule.azure_keyvault = kvUrl;
          }
          break;
        }
        case "pgp": {
          const fingerprint = env.sops?.pgp_fingerprint ?? manifest.sops.pgp_fingerprint;
          if (fingerprint) {
            rule.pgp = fingerprint;
          }
          break;
        }
      }

      creationRules.push(rule);
    }
  }

  return { creation_rules: creationRules };
}

/**
 * Resolve the age public key for .sops.yaml generation.
 * Checks (in order): CLEF_AGE_KEY_FILE env, CLEF_AGE_KEY env, .clef/config.yaml, default path.
 */
function resolveAgePublicKeyFromEnvOrFile(repoRoot: string): string | undefined {
  // 1. Try CLEF_AGE_KEY_FILE env
  if (process.env.CLEF_AGE_KEY_FILE) {
    const pubKey = extractAgePublicKey(process.env.CLEF_AGE_KEY_FILE);
    if (pubKey) return pubKey;
  }

  // 2. Try CLEF_AGE_KEY env (inline key — extract public key comment)
  if (process.env.CLEF_AGE_KEY) {
    const match = process.env.CLEF_AGE_KEY.match(/# public key: (age1[a-z0-9]+)/);
    if (match) return match[1];
  }

  // 3. Try .clef/config.yaml
  const clefConfigPath = path.join(repoRoot, CLEF_DIR, CLEF_CONFIG_FILENAME);
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

function extractAgePublicKey(keyFilePath: string): string | undefined {
  try {
    if (!fs.existsSync(keyFilePath)) return undefined;
    const content = fs.readFileSync(keyFilePath, "utf-8");
    const match = content.match(/# public key: (age1[a-z0-9]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/* istanbul ignore next -- only reachable if a namespace has a schema field, which init never sets */
async function scaffoldRandomValues(
  ns: { name: string; schema?: string },
  manifest: ClefManifest,
  schemaValidator: SchemaValidator,
  sopsClient: SopsClient,
  repoRoot: string,
  includeOptional: boolean | undefined,
  addCount: (count: number) => void,
): Promise<void> {
  let schema;
  try {
    schema = schemaValidator.loadSchema(path.join(repoRoot, ns.schema!));
  } catch {
    formatter.warn(
      `Could not load schema for namespace '${ns.name}' — skipping random scaffolding.`,
    );
    return;
  }

  const keysToScaffold = Object.entries(schema.keys).filter(([, def]) =>
    includeOptional ? true : def.required,
  );

  if (keysToScaffold.length === 0) return;

  for (const env of manifest.environments) {
    const filePath = path.join(
      repoRoot,
      manifest.file_pattern.replace("{namespace}", ns.name).replace("{environment}", env.name),
    );

    try {
      const decrypted = await sopsClient.decrypt(filePath);
      const pendingKeys: string[] = [];

      for (const [keyName] of keysToScaffold) {
        if (decrypted.values[keyName] === undefined) {
          decrypted.values[keyName] = generateRandomValue();
          pendingKeys.push(keyName);
        }
      }

      if (pendingKeys.length > 0) {
        await sopsClient.encrypt(filePath, decrypted.values, manifest, env.name);
        await markPending(filePath, pendingKeys, "clef init --random-values");
        addCount(pendingKeys.length);
      }
    } catch (err) {
      formatter.warn(
        `Could not scaffold random values for ${ns.name}/${env.name}: ${(err as Error).message}`,
      );
    }
  }
}

function promptWithDefault(message: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}
