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

function defaultAgeKeyPath(): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "clef",
    "keys.txt",
  );
}

async function isInsideAnyGitRepo(keyPath: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const dir = path.dirname(path.resolve(keyPath));
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
    return stdout.trim().length > 0;
  } catch {
    return false; // git command failed = not a git repo
  }
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
    .option("--backend <backend>", "SOPS encryption backend (age, awskms, gcpkms, pgp)", "age")
    .option("--non-interactive", "Skip interactive prompts and use defaults/flags")
    .option(
      "--random-values",
      "Scaffold required schema keys with random placeholder values (marks them as pending)",
    )
    .option("--include-optional", "When used with --random-values, also scaffold optional keys")
    .action(async (options) => {
      try {
        const repoRoot = (program.opts().repo as string) || process.cwd();
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
          await handleSecondDevOnboarding(repoRoot, clefConfigPath, options);
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
  options: { nonInteractive?: boolean },
): Promise<void> {
  let keyPath: string;

  if (options.nonInteractive || !process.stdin.isTTY) {
    // Non-interactive: use SOPS_AGE_KEY_FILE env or default
    keyPath = process.env.SOPS_AGE_KEY_FILE || defaultAgeKeyPath();
    keyPath = path.resolve(keyPath);
  } else {
    keyPath = await promptKeyLocation(defaultAgeKeyPath());
  }

  if (await isInsideAnyGitRepo(keyPath)) {
    throw new Error(
      `Key path '${keyPath}' is inside a git repository. Choose a path outside any git repo to keep your private key secure.`,
    );
  }

  // Write .clef/config.yaml and .clef/.gitignore
  const clefDir = path.dirname(clefConfigPath);
  if (!fs.existsSync(clefDir)) {
    fs.mkdirSync(clefDir, { recursive: true });
  }
  const config: ClefLocalConfig = { age_key_file: keyPath };
  fs.writeFileSync(clefConfigPath, YAML.stringify(config), "utf-8");
  formatter.success("Created .clef/config.yaml");

  const gitignorePath = path.join(clefDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf-8");
    formatter.success("Created .clef/.gitignore");
  }

  formatter.section("Next steps:");
  formatter.hint("clef update  — scaffold new environments");
  formatter.hint("clef lint    — check repo health");
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
  },
): Promise<void> {
  let environments: string[] = (options.environments ?? "dev,staging,production")
    .split(",")
    .map((s: string) => s.trim());
  let namespaces: string[] = options.namespaces
    ? options.namespaces.split(",").map((s: string) => s.trim())
    : [];
  const backend: string = options.backend ?? "age";

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
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };

  // Validate the manifest
  const initParser = new ManifestParser();
  initParser.validate(manifest);

  // Write clef.yaml
  fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");
  formatter.success("Created clef.yaml");

  // Handle age backend: generate key and write local config
  let ageKeyFile: string | undefined;
  if (backend === "age") {
    // Determine key path
    let keyPath: string;
    if (options.nonInteractive || !process.stdin.isTTY) {
      keyPath = defaultAgeKeyPath();
      if (await isInsideAnyGitRepo(path.resolve(keyPath))) {
        throw new Error(
          `Default key path '${keyPath}' is inside a git repository. Set HOME to a non-git location.`,
        );
      }
    } else {
      keyPath = await promptKeyLocation(defaultAgeKeyPath());
    }

    // Generate age key pair
    const identity = await generateAgeIdentity();
    const keyContent = formatAgeKeyFile(identity.privateKey, identity.publicKey);

    // Write key file
    const keyDir = path.dirname(keyPath);
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }
    fs.writeFileSync(keyPath, keyContent, { encoding: "utf-8", mode: 0o600 });
    formatter.success(`Generated age key at ${keyPath}`);
    ageKeyFile = keyPath;

    // Write .clef/config.yaml and .clef/.gitignore
    const clefDir = path.dirname(clefConfigPath);
    if (!fs.existsSync(clefDir)) {
      fs.mkdirSync(clefDir, { recursive: true });
    }
    const config: ClefLocalConfig = { age_key_file: keyPath };
    fs.writeFileSync(clefConfigPath, YAML.stringify(config), "utf-8");
    formatter.success("Created .clef/config.yaml");

    const gitignorePath = path.join(clefDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n", "utf-8");
      formatter.success("Created .clef/.gitignore");
    }

    // Generate .sops.yaml using the new public key
    const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
    const sopsConfig = buildSopsYaml(manifest, repoRoot, identity.publicKey);
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
  const sopsClient = new SopsClient(deps.runner, ageKeyFile);
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
 * Checks (in order): SOPS_AGE_KEY_FILE env, SOPS_AGE_KEY env, .clef/config.yaml, default path.
 */
function resolveAgePublicKeyFromEnvOrFile(repoRoot: string): string | undefined {
  // 1. Try SOPS_AGE_KEY_FILE env
  if (process.env.SOPS_AGE_KEY_FILE) {
    const pubKey = extractAgePublicKey(process.env.SOPS_AGE_KEY_FILE);
    if (pubKey) return pubKey;
  }

  // 2. Try SOPS_AGE_KEY env (inline key — extract public key comment)
  if (process.env.SOPS_AGE_KEY) {
    const match = process.env.SOPS_AGE_KEY.match(/# public key: (age1[a-z0-9]+)/);
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

  // 4. Try default SOPS path
  const defaultPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "sops",
    "age",
    "keys.txt",
  );
  const pubKey = extractAgePublicKey(defaultPath);
  if (pubKey) return pubKey;

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
