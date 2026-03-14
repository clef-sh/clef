import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import { checkAll, GitIntegration, REQUIREMENTS, SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { scaffoldSopsConfig } from "./init";
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
  sops: { version: string | null; required: string; ok: boolean };
  git: { version: string | null; required: string; ok: boolean };
  manifest: { found: boolean; ok: boolean };
  ageKey: { source: string | null; recipients: number; ok: boolean };
  sopsYaml: { found: boolean; ok: boolean; fix?: string };
  scanner: { clefignoreFound: boolean; ok: boolean };
  mergeDriver: { gitConfig: boolean; gitattributes: boolean; ok: boolean };
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
    .option("--json", "Output the full status as JSON")
    .option(
      "--fix",
      "Attempt to auto-fix issues (runs clef init if .sops.yaml is the only failure)",
    )
    .action(async (options: { json?: boolean; fix?: boolean }) => {
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
        checks.push({
          name: "sops",
          ok: depStatus.sops.satisfied,
          detail: depStatus.sops.satisfied
            ? `v${depStatus.sops.installed}    (required >= ${depStatus.sops.required})`
            : `v${depStatus.sops.installed}    (required >= ${depStatus.sops.required})`,
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

      // 6. age key
      const ageKeyResult = await checkAgeKey(repoRoot, deps.runner);
      checks.push(ageKeyResult);

      // 7. .sops.yaml
      const sopsYamlPath = path.join(repoRoot, ".sops.yaml");
      const sopsYamlFound = fs.existsSync(sopsYamlPath);
      checks.push({
        name: ".sops.yaml",
        ok: sopsYamlFound,
        detail: sopsYamlFound ? "found" : "not found",
        hint: sopsYamlFound ? undefined : "run: clef init",
      });

      // 8. .clefignore
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

      // 9. merge driver
      const git = new GitIntegration(deps.runner);
      const mergeDriverStatus = await git.checkMergeDriver(repoRoot);
      const mergeDriverOk = mergeDriverStatus.gitConfig && mergeDriverStatus.gitattributes;
      const mergeDriverDetails: string[] = [];
      if (!mergeDriverStatus.gitConfig) mergeDriverDetails.push("git config missing");
      if (!mergeDriverStatus.gitattributes) mergeDriverDetails.push(".gitattributes missing");
      checks.push({
        name: "merge driver",
        ok: mergeDriverOk,
        detail: mergeDriverOk ? "SOPS merge driver configured" : mergeDriverDetails.join(", "),
        hint: mergeDriverOk ? undefined : "run: clef hooks install",
      });

      // --fix: if the only failure is .sops.yaml missing, run clef init
      if (options.fix) {
        const failures = checks.filter((c) => !c.ok);
        const onlySopsYamlMissing =
          failures.length === 1 && failures[0].name === ".sops.yaml" && !sopsYamlFound;

        if (onlySopsYamlMissing) {
          formatter.info("Attempting to fix: generating .sops.yaml from manifest...");
          try {
            scaffoldSopsConfig(repoRoot);
            const nowFound = fs.existsSync(sopsYamlPath);
            if (nowFound) {
              const sopsYamlCheck = checks.find((c) => c.name === ".sops.yaml");
              if (sopsYamlCheck) {
                sopsYamlCheck.ok = true;
                sopsYamlCheck.detail = "found (fixed)";
                delete sopsYamlCheck.hint;
              }
              formatter.success(".sops.yaml created from manifest.");
            }
          } catch {
            formatter.error("Failed to generate .sops.yaml. Run 'clef init' manually to diagnose.");
          }
        } else if (failures.length > 0) {
          formatter.warn("--fix cannot resolve these issues automatically.");
        }
      }

      // JSON output
      if (options.json) {
        const json: DoctorJsonOutput = {
          clef: { version: clefVersion, ok: true },
          sops: {
            version: depStatus.sops?.installed ?? null,
            required: REQUIREMENTS.sops,
            ok: depStatus.sops?.satisfied ?? false,
          },
          git: {
            version: depStatus.git?.installed ?? null,
            required: REQUIREMENTS.git,
            ok: depStatus.git?.satisfied ?? false,
          },
          manifest: { found: manifestFound, ok: manifestFound },
          ageKey: {
            source: ageKeyResult.source,
            recipients: countAgeRecipients(sopsYamlPath),
            ok: ageKeyResult.ok,
          },
          sopsYaml: {
            found: checks.find((c) => c.name === ".sops.yaml")!.ok,
            ok: checks.find((c) => c.name === ".sops.yaml")!.ok,
            ...(!checks.find((c) => c.name === ".sops.yaml")!.ok ? { fix: "clef init" } : {}),
          },
          scanner: {
            clefignoreFound: checks.find((c) => c.name === "scanner")?.ok ?? false,
            ok: checks.find((c) => c.name === "scanner")?.ok ?? false,
          },
          mergeDriver: {
            gitConfig: mergeDriverStatus.gitConfig,
            gitattributes: mergeDriverStatus.gitattributes,
            ok: mergeDriverOk,
          },
        };

        formatter.raw(JSON.stringify(json, null, 2) + "\n");
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
        detail: "loaded (via SOPS_AGE_KEY env var)",
        source: "env",
      };
    case "env-file":
      return {
        name: "age key",
        ok: true,
        detail: `loaded (via SOPS_AGE_KEY_FILE: ${process.env.SOPS_AGE_KEY_FILE})`,
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

function countAgeRecipients(sopsYamlPath: string): number {
  try {
    if (!fs.existsSync(sopsYamlPath)) return 0;
    const content = fs.readFileSync(sopsYamlPath, "utf-8");
    const config = YAML.parse(content);
    if (!config?.creation_rules || !Array.isArray(config.creation_rules)) {
      return 0;
    }
    const recipients = new Set<string>();
    for (const rule of config.creation_rules) {
      if (typeof rule.age === "string") {
        // age field may contain comma-separated recipients
        for (const r of rule.age.split(",")) {
          const trimmed = r.trim();
          if (trimmed) {
            recipients.add(trimmed);
          }
        }
      }
    }
    return recipients.size;
  } catch {
    return 0;
  }
}

function getSopsInstallHint(): string {
  if (process.platform === "darwin") return "brew install sops";
  return "see https://github.com/getsops/sops/releases";
}
