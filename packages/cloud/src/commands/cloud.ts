import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { CLOUD_DEFAULT_ENDPOINT, CLOUD_DEV_ENDPOINT } from "../constants";
import {
  readCloudCredentials,
  writeCloudCredentials,
  deleteCloudCredentials,
  isSessionExpired,
} from "../credentials";
import { startInstall, pollInstallUntilComplete, getMe } from "../cloud-api";
import { scaffoldPolicyFile, parsePolicyFile, POLICY_FILE_PATH } from "../policy";
import { resolveAuthProvider, DEFAULT_PROVIDER } from "../providers";
import type { AuthProvider, AuthProviderDeps, ClefCloudCredentials } from "../types";

/** CLI utilities injected by the host CLI package. */
export interface CloudCliDeps {
  runner: SubprocessRunner;
  formatter: {
    print(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
    hint(msg: string): void;
  };
  sym(name: string): string;
  openBrowser(url: string, runner: SubprocessRunner): Promise<boolean>;
  cliVersion: string;
}

function resolveEndpoint(): string {
  if (process.env.CLEF_CLOUD_ENDPOINT) return process.env.CLEF_CLOUD_ENDPOINT;
  if (process.env.CLEF_CLOUD_ENV === "dev") return CLOUD_DEV_ENDPOINT;
  return CLOUD_DEFAULT_ENDPOINT;
}

/**
 * Detect the owner/name from git remote origin.
 * Works with any git host (GitHub, GitLab, Bitbucket, etc.).
 * Returns null if it can't be detected.
 */
async function detectRepo(runner: SubprocessRunner): Promise<string | null> {
  try {
    const result = await runner.run("git", ["remote", "get-url", "origin"]);
    const url = result.stdout.trim();

    // SSH: git@host.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];

    // HTTPS: https://host.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];

    return null;
  } catch {
    return null;
  }
}

/** Build the AuthProviderDeps bridge from CloudCliDeps. */
function toAuthDeps(deps: CloudCliDeps): AuthProviderDeps {
  return {
    formatter: deps.formatter,
    openBrowser: (url: string) => deps.openBrowser(url, deps.runner),
  };
}

/**
 * Ensure the user has a valid (non-expired) session.
 * If expired or missing, runs the provider's login flow.
 * Returns the credentials or null if auth was cancelled/expired.
 */
async function ensureAuth(
  provider: AuthProvider,
  deps: CloudCliDeps,
  endpoint: string,
): Promise<ClefCloudCredentials | null> {
  const existing = readCloudCredentials();
  if (existing && !isSessionExpired(existing)) {
    return existing;
  }

  if (existing && isSessionExpired(existing)) {
    deps.formatter.info("Session expired. Re-authenticating...");
  }

  const creds = await provider.login(endpoint, toAuthDeps(deps));
  if (creds) {
    writeCloudCredentials(creds);
    deps.formatter.success(`Signed in as ${creds.login}`);
  }
  return creds;
}

export function registerCloudCommands(program: Command, deps: CloudCliDeps): void {
  const { formatter, sym, runner } = deps;
  const cloud = program.command("cloud").description("Manage Clef Cloud integration.");

  // ── clef cloud login ────────────────────────────────────────────────────

  cloud
    .command("login")
    .description("Authenticate to Clef Cloud.")
    .option("--provider <name>", "VCS provider to authenticate with", DEFAULT_PROVIDER)
    .action(async (opts) => {
      try {
        const provider = resolveAuthProvider(opts.provider as string);
        const endpoint = resolveEndpoint();

        // Check if already logged in with a valid session
        const existing = readCloudCredentials();
        if (existing && !isSessionExpired(existing)) {
          formatter.success(`Already signed in as ${existing.login}`);
          return;
        }

        const creds = await ensureAuth(provider, deps, endpoint);
        if (!creds) {
          process.exit(1);
        }
      } catch (err) {
        formatter.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clef cloud logout ───────────────────────────────────────────────────

  cloud
    .command("logout")
    .description("Clear local Clef Cloud credentials.")
    .action(() => {
      deleteCloudCredentials();
      formatter.success("Logged out of Clef Cloud.");
    });

  // ── clef cloud status ───────────────────────────────────────────────────

  cloud
    .command("status")
    .description("Show Clef Cloud account and installation status.")
    .action(async () => {
      try {
        const creds = readCloudCredentials();
        if (!creds) {
          formatter.error("Not logged in. Run 'clef cloud login' first.");
          process.exit(1);
          return;
        }

        if (isSessionExpired(creds)) {
          formatter.error("Session expired. Run 'clef cloud login'.");
          process.exit(1);
          return;
        }

        const me = await getMe(creds.base_url, creds.session_token);
        const login = me.user.vcsAccounts[0]?.login ?? me.user.email;

        formatter.print(`${sym("clef")}  Clef Cloud Status\n`);
        formatter.print(`  Signed in as: ${login} (${me.user.email})`);

        if (me.installations.length > 0) {
          formatter.print("\n  Installed on:");
          for (const inst of me.installations) {
            formatter.print(`    ${inst.account.padEnd(20)} (id: ${inst.id})`);
          }
          formatter.print(`\n  Free tier limit: ${me.freeTierLimit} repo per installation`);
        } else {
          formatter.print(
            "  No installations — run 'clef cloud init' to install the app on an org",
          );
        }
      } catch (err) {
        formatter.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clef cloud init ─────────────────────────────────────────────────────

  cloud
    .command("init")
    .description("Sign up, install the Clef bot, and scaffold .clef/policy.yaml.")
    .option("--provider <name>", "VCS provider", DEFAULT_PROVIDER)
    .option("--repo <owner/name>", "Override repo detection")
    .option("--no-browser", "Print URLs instead of opening browser")
    .option("--non-interactive", "Skip prompts; fail if input needed")
    .option("--policy-file <path>", "Custom policy file path", POLICY_FILE_PATH)
    .option("--no-policy", "Skip policy file creation")
    .action(async (opts) => {
      try {
        const provider = resolveAuthProvider(opts.provider as string);
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const endpoint = resolveEndpoint();

        // Step 1: Check for clef.yaml
        const manifestPath = path.join(repoRoot, "clef.yaml");
        if (!fs.existsSync(manifestPath)) {
          formatter.error("No clef.yaml found. Run 'clef init' first.");
          process.exit(1);
          return;
        }

        // Step 2: Detect repo
        const repo = (opts.repo as string) || (await detectRepo(runner));
        if (!repo) {
          formatter.error("Could not detect repo from git remote. Use --repo owner/name.");
          process.exit(1);
          return;
        }

        formatter.print(`${sym("clef")}  Clef Cloud\n`);
        formatter.print("  This will:");
        formatter.print(`    1. Sign you in to Clef Cloud via ${provider.displayName} (free tier)`);
        formatter.print("    2. Install the Clef bot on this repo");
        formatter.print("    3. Create .clef/policy.yaml with sensible defaults\n");
        formatter.print(`  Detected repo: ${repo}`);

        // Step 3: Authenticate
        const creds = await ensureAuth(provider, deps, endpoint);
        if (!creds) {
          process.exit(1);
          return;
        }

        // Step 4: Install — let the server decide whether this is a fresh install or re-run.
        // POST /install/start returns already_installed: true (with a dashboard handoff URL)
        // if the app is already set up, or the install URL + state token for a fresh install.
        const installData = await startInstall(creds.base_url, creds.session_token);

        if (installData.already_installed) {
          formatter.success(`Clef App already installed on ${installData.installation.account}`);
          const dashUrl = installData.dashboard_url;
          if (dashUrl === null) {
            formatter.info("Visit your dashboard at https://cloud.clef.sh/app");
          } else if (opts.browser !== false) {
            formatter.print("  Opening dashboard...");
            await deps.openBrowser(dashUrl, runner);
          } else {
            formatter.hint(`Open your dashboard: ${dashUrl}`);
          }
        } else {
          formatter.print("\n  Opening browser to install the Clef App...");
          formatter.print(`  If it doesn't open, go to: ${installData.install_url}\n`);

          if (opts.browser !== false) {
            await deps.openBrowser(installData.install_url, runner);
          }

          formatter.print("  Waiting for installation to complete... (press Ctrl+C to cancel)");

          const installResult = await pollInstallUntilComplete(
            creds.base_url,
            installData.state,
            installData.expires_in,
          );

          if (installResult.status !== "complete") {
            formatter.error("Install timed out. Run 'clef cloud init' again.");
            process.exit(1);
            return;
          }

          // Browser was redirected to the dashboard by the server's setup callback —
          // do not open a second tab here.
          formatter.success(`Clef App installed (id: ${installResult.installation!.id})`);
        }

        // Step 5: Scaffold policy file
        if (opts.policy !== false) {
          const existingPolicy = parsePolicyFile(repoRoot);
          if (existingPolicy.valid) {
            formatter.info("Policy file already exists.");
          } else {
            const { created } = scaffoldPolicyFile(repoRoot);
            if (created) {
              formatter.success(`Created ${POLICY_FILE_PATH}`);
            } else {
              formatter.warn(
                `${POLICY_FILE_PATH} exists but could not be parsed: ${(existingPolicy as { valid: false; reason: string }).reason}`,
              );
              formatter.hint("Fix or delete the file and run 'clef cloud init' again.");
            }
          }
        }

        // Step 6: Print next steps
        formatter.print("\n  Next steps:");
        formatter.print("    1. Review .clef/policy.yaml");
        formatter.print("    2. git add .clef/policy.yaml");
        formatter.print('    3. git commit -m "Enable Clef bot"');
        formatter.print("    4. Push — the bot will run on your next PR\n");
      } catch (err) {
        formatter.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clef cloud doctor ───────────────────────────────────────────────────

  cloud
    .command("doctor")
    .description("Verify Clef Cloud setup: policy, credentials, git remote.")
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        let issues = 0;

        formatter.print(`${sym("clef")}  Clef Cloud Doctor\n`);

        // Check clef.yaml
        const manifestPath = path.join(repoRoot, "clef.yaml");
        if (fs.existsSync(manifestPath)) {
          formatter.print(`  ${sym("success")} clef.yaml found`);
        } else {
          formatter.print("  ✗ clef.yaml not found");
          issues++;
        }

        // Check policy file
        const policy = parsePolicyFile(repoRoot);
        if (policy.valid) {
          formatter.print(`  ${sym("success")} ${POLICY_FILE_PATH} valid`);
        } else {
          formatter.print(`  ✗ ${POLICY_FILE_PATH}: ${(policy as { reason: string }).reason}`);
          issues++;
        }

        // Check credentials
        const creds = readCloudCredentials();
        if (creds && !isSessionExpired(creds)) {
          formatter.print(`  ${sym("success")} Session valid (${creds.login})`);
        } else if (creds && isSessionExpired(creds)) {
          formatter.print("  ✗ Session token expired");
          formatter.hint("  Run 'clef cloud login' to re-authenticate.");
          issues++;
        } else {
          formatter.print("  ✗ Not logged in");
          formatter.hint("  Run 'clef cloud login' to authenticate.");
          issues++;
        }

        // Check git remote
        const repo = await detectRepo(runner);
        if (repo) {
          formatter.print(`  ${sym("success")} Git remote: ${repo}`);
        } else {
          formatter.print("  ✗ Could not detect git remote");
          issues++;
        }

        if (issues === 0) {
          formatter.print("\n  Everything looks good!");
        } else {
          formatter.print(`\n  ${issues} issue${issues > 1 ? "s" : ""} found.`);
        }
      } catch (err) {
        formatter.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clef cloud upgrade ──────────────────────────────────────────────────

  cloud
    .command("upgrade")
    .description("Upgrade to a paid Clef Cloud plan.")
    .action(() => {
      formatter.info("Upgrade is not yet available.");
    });
}
