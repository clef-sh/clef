import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as YAML from "yaml";
import { Command } from "commander";
import {
  ClefManifest,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SchemaValidator,
  SopsClient,
  SubprocessRunner,
  assertSops,
  SopsMissingError,
  SopsVersionError,
  generateRandomValue,
  markPending,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

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
    .option("--age-key-file <path>", "Path to age key file", ".sops/keys.txt")
    .option("--non-interactive", "Skip interactive prompts and use defaults/flags")
    .option(
      "--random-values",
      "Scaffold required schema keys with random placeholder values (marks them as pending)",
    )
    .option("--include-optional", "When used with --random-values, also scaffold optional keys")
    .option("--update", "Scaffold new environments without overwriting clef.yaml")
    .action(async (options) => {
      try {
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

        const repoRoot = (program.opts().repo as string) || process.cwd();
        const manifestPath = path.join(repoRoot, "clef.yaml");

        if (!options.update && fs.existsSync(manifestPath)) {
          formatter.error("clef.yaml already exists. Use --update to scaffold new environments.");
          process.exit(1);
          return;
        }

        let manifest: ClefManifest;

        if (options.update) {
          // --update mode: read existing manifest, skip creation
          const existingParser = new ManifestParser();
          manifest = existingParser.parse(manifestPath);
        } else {
          let environments: string[] = options.environments.split(",").map((s: string) => s.trim());
          let namespaces: string[] = options.namespaces
            ? options.namespaces.split(",").map((s: string) => s.trim())
            : [];
          const backend: string = options.backend;
          const ageKeyFile: string = options.ageKeyFile;

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

          manifest = {
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
              ...(backend === "age" ? { age_key_file: ageKeyFile } : {}),
            },
            file_pattern: "{namespace}/{environment}.enc.yaml",
          };

          // Validate the manifest
          const initParser = new ManifestParser();
          initParser.validate(manifest);

          // Write clef.yaml
          fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");
          formatter.success("Created clef.yaml");

          // Generate .sops.yaml for SOPS creation rules
          const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
          const sopsConfig = buildSopsYaml(manifest, repoRoot);
          fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
          formatter.success("Created .sops.yaml");
        }

        const backend = manifest.sops.default_backend;
        const ageKeyFile = manifest.sops.age_key_file ?? ".sops/keys.txt";

        // Set up age key directory if using age backend
        if (backend === "age") {
          const keyDir = path.join(repoRoot, ".sops");
          if (!fs.existsSync(keyDir)) {
            fs.mkdirSync(keyDir, { recursive: true });
          }
          const gitignorePath = path.join(keyDir, ".gitignore");
          if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, "keys.txt\n", "utf-8");
          }

          const keyFilePath = path.join(repoRoot, ageKeyFile);
          if (!fs.existsSync(keyFilePath)) {
            formatter.warn(
              `Age key file not found at '${ageKeyFile}'. Generate one with: age-keygen -o ${ageKeyFile}`,
            );
            formatter.info("Skipping file matrix scaffold — key must exist before encrypting.");
            formatter.section("Next steps:");
            formatter.hint(`age-keygen -o ${ageKeyFile}`);
            formatter.hint("clef lint --fix  (to scaffold encrypted files)");
            formatter.hint("clef set <namespace>/<env> <KEY> <value>");
            return;
          }
        }

        // Scaffold the matrix
        const sopsClient = new SopsClient(deps.runner);
        const matrixManager = new MatrixManager();
        const cells = matrixManager.resolveMatrix(manifest, repoRoot);

        let scaffoldedCount = 0;
        for (const cell of cells) {
          if (!cell.exists) {
            try {
              await matrixManager.scaffoldCell(cell, sopsClient);
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

        // Install pre-commit hook
        try {
          const git = new GitIntegration(deps.runner);
          await git.installPreCommitHook(repoRoot);
          formatter.success("Installed pre-commit hook");
        } catch {
          formatter.warn(
            "Could not install pre-commit hook. Run 'clef hooks install' inside a git repository.",
          );
        }

        formatter.section("Next steps:");
        formatter.hint("clef set <namespace>/<env> <KEY> <value>  \u2014 add a secret");
        formatter.hint("clef scan  \u2014 check for existing plaintext secrets");
        formatter.hint("clef lint  \u2014 check repo health");
        formatter.hint("clef ui    \u2014 open the web UI");
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
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
  const sopsConfig = buildSopsYaml(manifest, repoRoot);
  fs.writeFileSync(sopsYamlPath, YAML.stringify(sopsConfig), "utf-8");
}

function buildSopsYaml(manifest: ClefManifest, repoRoot: string): Record<string, unknown> {
  const creationRules: Record<string, unknown>[] = [];

  // Resolve age public key once if using age backend
  let ageRecipient: string | undefined;
  if (manifest.sops.default_backend === "age") {
    ageRecipient = resolveAgePublicKey(manifest, repoRoot);
  }

  for (const ns of manifest.namespaces) {
    for (const env of manifest.environments) {
      const pathRegex = `${ns.name}/${env.name}\\.enc\\.yaml$`;
      const rule: Record<string, unknown> = { path_regex: pathRegex };

      switch (manifest.sops.default_backend) {
        case "age":
          if (ageRecipient) {
            rule.age = ageRecipient;
          }
          break;
        case "awskms":
          if (manifest.sops.aws_kms_arn) {
            rule.kms = manifest.sops.aws_kms_arn;
          }
          break;
        case "gcpkms":
          if (manifest.sops.gcp_kms_resource_id) {
            rule.gcp_kms = manifest.sops.gcp_kms_resource_id;
          }
          break;
        case "pgp":
          if (manifest.sops.pgp_fingerprint) {
            rule.pgp = manifest.sops.pgp_fingerprint;
          }
          break;
      }

      creationRules.push(rule);
    }
  }

  return { creation_rules: creationRules };
}

/**
 * Resolve the age public key from the key file.
 * Checks (in order): manifest age_key_file, SOPS_AGE_KEY_FILE env, SOPS_AGE_KEY env,
 * default path ~/.config/sops/age/keys.txt.
 */
function resolveAgePublicKey(manifest: ClefManifest, repoRoot: string): string | undefined {
  // 1. Try manifest's age_key_file
  if (manifest.sops.age_key_file) {
    const keyPath = path.join(repoRoot, manifest.sops.age_key_file);
    const pubKey = extractAgePublicKey(keyPath);
    if (pubKey) return pubKey;
  }

  // 2. Try SOPS_AGE_KEY_FILE env
  if (process.env.SOPS_AGE_KEY_FILE) {
    const pubKey = extractAgePublicKey(process.env.SOPS_AGE_KEY_FILE);
    if (pubKey) return pubKey;
  }

  // 3. Try SOPS_AGE_KEY env (inline key — extract public key comment)
  if (process.env.SOPS_AGE_KEY) {
    const match = process.env.SOPS_AGE_KEY.match(/# public key: (age1[a-z0-9]+)/);
    if (match) return match[1];
  }

  // 4. Try default path
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
        await sopsClient.encrypt(filePath, decrypted.values, manifest);
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
