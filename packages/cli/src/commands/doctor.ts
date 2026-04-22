import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import {
  ClefLocalConfig,
  ClefManifest,
  ManifestParser,
  checkAll,
  GitIntegration,
  REQUIREMENTS,
  resolveKeyservicePath,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import {
  resolveAgeCredential,
  getExpectedKeyStorage,
  getExpectedKeyLabel,
} from "../age-credential";

interface DoctorCheckResult {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

interface AgeKeyCheckResult extends DoctorCheckResult {
  source: string | null;
}

interface DoctorJsonOutput {
  clef: { version: string; ok: boolean };
  sops: { version: string | null; required: string; ok: boolean; source?: string; path?: string };
  git: { version: string | null; required: string; ok: boolean };
  manifest: { found: boolean; ok: boolean };
  ageKey: { source: string | null; ok: boolean };
  scanner: { clefignoreFound: boolean; ok: boolean };
  mergeDriver: { gitConfig: boolean; gitattributes: boolean; ok: boolean };
  metadataMergeDriver: { gitConfig: boolean; gitattributes: boolean; ok: boolean };
}

export function registerDoctorCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("doctor")
    .description(
      "Check your environment for required dependencies and configuration.\n\n" +
        "Exit codes:\n" +
        "  0  All checks pass\n" +
        "  1  One or more checks failed",
    )
    .option("--fix", "Attempt to auto-fix issues")
    .action(async (options: { fix?: boolean }) => {
      const repoRoot = (program.opts().dir as string) || process.cwd();
      const clefVersion = program.version() ?? "unknown";

      const checks: DoctorCheckResult[] = [];
      const depStatus = await checkAll(deps.runner);

      // 1. Clef version (always passes)
      checks.push({
        name: "clef",
        ok: true,
        detail: `v${clefVersion}`,
      });

      // 2. sops
      if (depStatus.sops) {
        const sourceLabel =
          depStatus.sops.source === "bundled"
            ? " [bundled]"
            : depStatus.sops.source === "env"
              ? " [CLEF_SOPS_PATH]"
              : " [system]";
        checks.push({
          name: "sops",
          ok: depStatus.sops.satisfied,
          detail: depStatus.sops.satisfied
            ? `v${depStatus.sops.installed}${sourceLabel}    (required >= ${depStatus.sops.required})`
            : `v${depStatus.sops.installed}${sourceLabel}    (required >= ${depStatus.sops.required})`,
          hint: depStatus.sops.satisfied ? undefined : depStatus.sops.installHint,
        });
      } else {
        checks.push({
          name: "sops",
          ok: false,
          detail: "not installed",
          hint: getSopsInstallHint(),
        });
      }

      // 3. git
      if (depStatus.git) {
        checks.push({
          name: "git",
          ok: depStatus.git.satisfied,
          detail: depStatus.git.satisfied
            ? `v${depStatus.git.installed}    (required >= ${depStatus.git.required})`
            : `v${depStatus.git.installed}    (required >= ${depStatus.git.required})`,
          hint: depStatus.git.satisfied ? undefined : depStatus.git.installHint,
        });
      } else {
        checks.push({
          name: "git",
          ok: false,
          detail: "not installed",
          hint: "see https://git-scm.com/downloads",
        });
      }

      // 5. manifest
      const manifestPath = path.join(repoRoot, "clef.yaml");
      const manifestFound = fs.existsSync(manifestPath);
      checks.push({
        name: "manifest",
        ok: manifestFound,
        detail: manifestFound ? "clef.yaml found" : "clef.yaml not found",
        hint: manifestFound ? undefined : "run: clef init",
      });

      // 5b. HSM (only when the manifest declares an `hsm` backend)
      const parsedManifest = manifestFound ? safeParseManifest(manifestPath) : null;
      if (parsedManifest && manifestUsesHsm(parsedManifest)) {
        for (const check of checkHsm(repoRoot)) checks.push(check);
      }

      // 6. age key
      const ageKeyResult = await checkAgeKey(repoRoot, deps.runner);
      checks.push(ageKeyResult);

      // 7. .clefignore
      const clefignorePath = path.join(repoRoot, ".clefignore");
      const clefignoreFound = fs.existsSync(clefignorePath);
      let clefignoreRuleCount = 0;
      if (clefignoreFound) {
        try {
          const content = fs.readFileSync(clefignorePath, "utf-8");
          clefignoreRuleCount = content
            .split("\n")
            .filter(
              (l) =>
                l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("ignore-pattern:"),
            ).length;
        } catch {
          // unreadable — count stays 0
        }
      }
      checks.push({
        name: "scanner",
        ok: clefignoreFound,
        detail: clefignoreFound
          ? `.clefignore found (${clefignoreRuleCount} rules)`
          : "no .clefignore found",
        hint: clefignoreFound
          ? undefined
          : "run clef init or create manually — see https://docs.clef.sh/cli/scan#clefignore",
      });

      // 9. merge drivers — two independent registrations: the SOPS-aware
      // driver for `.enc.*` files and the Clef metadata driver for
      // `.clef-meta.yaml` sidecars.  The latter was added after the initial
      // release, so repos that ran `clef hooks install` under an older
      // version will have the SOPS driver but not the metadata one.
      // `clef hooks install` is idempotent and registers both — so a
      // single re-run brings stale installs up to date.
      const git = new GitIntegration(deps.runner);
      const mergeDriverStatus = await git.checkMergeDriver(repoRoot);

      const sopsOk = mergeDriverStatus.gitConfig && mergeDriverStatus.gitattributes;
      const sopsDetails: string[] = [];
      if (!mergeDriverStatus.gitConfig) sopsDetails.push("git config missing");
      if (!mergeDriverStatus.gitattributes) sopsDetails.push(".gitattributes missing");
      checks.push({
        name: "sops merge driver",
        ok: sopsOk,
        detail: sopsOk ? "Configured for .enc.yaml / .enc.json" : sopsDetails.join(", "),
        hint: sopsOk ? undefined : "run: clef hooks install",
      });

      const metaOk = mergeDriverStatus.metadataGitConfig && mergeDriverStatus.metadataGitattributes;
      const metaDetails: string[] = [];
      if (!mergeDriverStatus.metadataGitConfig) metaDetails.push("git config missing");
      if (!mergeDriverStatus.metadataGitattributes) metaDetails.push(".gitattributes missing");
      checks.push({
        name: "metadata merge driver",
        ok: metaOk,
        detail: metaOk
          ? "Configured for .clef-meta.yaml"
          : `${metaDetails.join(", ")} — rotation metadata won't auto-merge`,
        hint: metaOk
          ? undefined
          : "run: clef hooks install (registers the new clef-metadata merge driver idempotently)",
      });

      // --fix: placeholder for future auto-fix logic
      if (options.fix) {
        const failures = checks.filter((c) => !c.ok);
        if (failures.length > 0) {
          formatter.warn("--fix cannot resolve these issues automatically.");
        }
      }

      // JSON output
      if (isJsonMode()) {
        const json: DoctorJsonOutput = {
          clef: { version: clefVersion, ok: true },
          sops: {
            version: depStatus.sops?.installed ?? null,
            required: REQUIREMENTS.sops,
            ok: depStatus.sops?.satisfied ?? false,
            source: depStatus.sops?.source,
            path: depStatus.sops?.resolvedPath,
          },
          git: {
            version: depStatus.git?.installed ?? null,
            required: REQUIREMENTS.git,
            ok: depStatus.git?.satisfied ?? false,
          },
          manifest: { found: manifestFound, ok: manifestFound },
          ageKey: {
            source: ageKeyResult.source,
            ok: ageKeyResult.ok,
          },
          scanner: {
            clefignoreFound: checks.find((c) => c.name === "scanner")?.ok ?? false,
            ok: checks.find((c) => c.name === "scanner")?.ok ?? false,
          },
          mergeDriver: {
            gitConfig: mergeDriverStatus.gitConfig,
            gitattributes: mergeDriverStatus.gitattributes,
            ok: sopsOk,
          },
          metadataMergeDriver: {
            gitConfig: mergeDriverStatus.metadataGitConfig,
            gitattributes: mergeDriverStatus.metadataGitattributes,
            ok: metaOk,
          },
        };

        formatter.json(json);
        const hasFailures = checks.some((c) => !c.ok);
        process.exit(hasFailures ? 1 : 0);
        return;
      }

      // Pretty output
      formatter.print("\nDiagnosing...\n");

      const nameWidth = Math.max(...checks.map((c) => c.name.length));

      for (const check of checks) {
        const icon = check.ok ? sym("success") : sym("failure");
        const name = check.name.padEnd(nameWidth);
        formatter.print(`${icon} ${name}  ${check.detail}`);
        if (check.hint) {
          formatter.hint(check.hint);
        }
      }

      formatter.print("");

      const failures = checks.filter((c) => !c.ok);
      if (failures.length === 0) {
        formatter.success("Everything looks good.");
      } else {
        formatter.error(`${failures.length} issue${failures.length > 1 ? "s" : ""} found.`);
      }

      formatter.hint("clef scan \u2014 check for plaintext secrets");
      process.exit(failures.length > 0 ? 1 : 0);
    });
}

async function checkAgeKey(repoRoot: string, runner: SubprocessRunner): Promise<AgeKeyCheckResult> {
  const credential = await resolveAgeCredential(repoRoot, runner);

  if (!credential) {
    const expected = getExpectedKeyStorage(repoRoot);
    let hint: string;
    if (expected === "keychain") {
      hint =
        "your key was stored in the OS keychain during init but is not available now — " +
        "check that your keychain service is running (see https://docs.clef.sh/guide/key-storage)";
    } else if (expected === "file") {
      hint = "the key file configured in .clef/config.yaml is missing or unreadable";
    } else {
      hint = "run: clef init to auto-generate your age key";
    }
    return {
      name: "age key",
      ok: false,
      detail: "not configured",
      hint,
      source: null,
    };
  }

  const label = getExpectedKeyLabel(repoRoot);
  const labelSuffix = label ? `, label: ${label}` : "";

  switch (credential.source) {
    case "keychain":
      return {
        name: "age key",
        ok: true,
        detail: `loaded (from OS keychain${labelSuffix})`,
        source: "keychain",
      };
    case "env-key":
      return {
        name: "age key",
        ok: true,
        detail: "loaded (via CLEF_AGE_KEY env var)",
        source: "env",
      };
    case "env-file":
      return {
        name: "age key",
        ok: true,
        detail: `loaded (via CLEF_AGE_KEY_FILE: ${process.env.CLEF_AGE_KEY_FILE})`,
        source: "env",
      };
    case "config-file":
      if (!fs.existsSync(credential.path)) {
        return {
          name: "age key",
          ok: false,
          detail: `configured (${credential.path}) — file not found`,
          hint: "run: clef init to regenerate your age key",
          source: null,
        };
      }
      return {
        name: "age key",
        ok: true,
        detail: `loaded (from ${credential.path}${labelSuffix})`,
        source: "file",
      };
  }
}

function getSopsInstallHint(): string {
  if (process.platform === "darwin") return "brew install sops";
  return "see https://github.com/getsops/sops/releases";
}

/**
 * Parse the manifest, suppressing errors. Returns null on any failure —
 * the dedicated manifest check above already surfaces parse errors, and
 * we don't want HSM diagnostics to mask the underlying problem.
 */
function safeParseManifest(manifestPath: string): ClefManifest | null {
  try {
    return new ManifestParser().parse(manifestPath);
  } catch {
    return null;
  }
}

function manifestUsesHsm(manifest: ClefManifest): boolean {
  return (
    manifest.sops.default_backend === "hsm" ||
    manifest.environments.some((e) => e.sops?.backend === "hsm")
  );
}

/** Read .clef/config.yaml without throwing. Used only for diagnostics. */
function readLocalConfigForDoctor(repoRoot: string): ClefLocalConfig | null {
  const p = path.join(repoRoot, ".clef", "config.yaml");
  try {
    if (!fs.existsSync(p)) return null;
    return YAML.parse(fs.readFileSync(p, "utf-8")) as ClefLocalConfig;
  } catch {
    return null;
  }
}

function checkHsm(repoRoot: string): DoctorCheckResult[] {
  const out: DoctorCheckResult[] = [];

  // 1. Keyservice binary resolution
  try {
    const ks = resolveKeyservicePath();
    const sourceLabel =
      ks.source === "bundled"
        ? " [bundled]"
        : ks.source === "env"
          ? " [CLEF_KEYSERVICE_PATH]"
          : " [system]";
    out.push({
      name: "clef-keyservice",
      ok: true,
      detail: `${ks.path}${sourceLabel}`,
    });
  } catch (err) {
    out.push({
      name: "clef-keyservice",
      ok: false,
      detail: (err as Error).message,
      hint:
        "install the @clef-sh/keyservice-* platform package, set CLEF_KEYSERVICE_PATH, " +
        "or place clef-keyservice on your PATH",
    });
  }

  const config = readLocalConfigForDoctor(repoRoot);

  // 2. PKCS#11 module path
  const moduleEnv = process.env.CLEF_PKCS11_MODULE;
  const moduleConfig = config?.pkcs11_module;
  const modulePath = moduleEnv ?? moduleConfig;
  if (!modulePath) {
    out.push({
      name: "pkcs11 module",
      ok: false,
      detail: "not configured",
      hint:
        "set CLEF_PKCS11_MODULE or pkcs11_module in .clef/config.yaml " +
        "(e.g. /usr/lib/softhsm/libsofthsm2.so)",
    });
  } else if (!fs.existsSync(modulePath)) {
    out.push({
      name: "pkcs11 module",
      ok: false,
      detail: `${modulePath} (not found)`,
      hint: "install the vendor PKCS#11 library or correct the module path",
    });
  } else {
    const sourceLabel = moduleEnv ? " [CLEF_PKCS11_MODULE]" : " [.clef/config.yaml]";
    out.push({
      name: "pkcs11 module",
      ok: true,
      detail: `${modulePath}${sourceLabel}`,
    });
  }

  // 3. PIN source — never read or display the PIN value, only the source.
  if (process.env.CLEF_PKCS11_PIN) {
    out.push({
      name: "pkcs11 pin",
      ok: true,
      detail: "configured (CLEF_PKCS11_PIN env)",
    });
  } else if (process.env.CLEF_PKCS11_PIN_FILE) {
    const f = process.env.CLEF_PKCS11_PIN_FILE;
    const exists = fs.existsSync(f);
    out.push({
      name: "pkcs11 pin",
      ok: exists,
      detail: exists ? `pin file (${f})` : `pin file (${f}) not readable`,
      hint: exists ? undefined : "create the file with the PIN content (mode 0600)",
    });
  } else if (config?.pkcs11_pin_file) {
    const f = config.pkcs11_pin_file;
    const exists = fs.existsSync(f);
    out.push({
      name: "pkcs11 pin",
      ok: exists,
      detail: exists ? `pin file (${f})` : `pin file (${f}) not readable`,
      hint: exists ? undefined : "create the file with the PIN content (mode 0600)",
    });
  } else {
    out.push({
      name: "pkcs11 pin",
      ok: false,
      detail: "not configured",
      hint:
        "set CLEF_PKCS11_PIN, CLEF_PKCS11_PIN_FILE, or pkcs11_pin_file " + "in .clef/config.yaml",
    });
  }

  return out;
}
