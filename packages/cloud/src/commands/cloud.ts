import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  SopsClient,
  readManifestYaml,
  writeManifestYaml,
} from "@clef-sh/core";
import {
  readCloudCredentials,
  writeCloudCredentials,
  resolveKeyservicePath,
  initiateDeviceFlow,
  pollDeviceFlow,
  spawnKeyservice,
  resolveAccessToken,
  CLOUD_DEFAULT_ENDPOINT,
} from "../index";
import type { DevicePollResult, ClefCloudCredentials } from "../index";

const POLL_INTERVAL_MS = 2000;

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
  createSopsClient(
    repoRoot: string,
    runner: SubprocessRunner,
    keyserviceAddr?: string,
  ): Promise<SopsClient>;
  cliVersion: string;
}

export function registerCloudCommands(program: Command, deps: CloudCliDeps): void {
  const { formatter, sym, runner } = deps;
  const cloud = program.command("cloud").description("Manage Clef Cloud integration.");

  cloud
    .command("status")
    .description("Show Clef Cloud integration status.")
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();

        // Check manifest
        let manifest;
        try {
          manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
        } catch {
          formatter.print(`${sym("info")}  No clef.yaml found in ${repoRoot}`);
          return;
        }

        formatter.print(`${sym("clef")}  Clef Cloud Status\n`);

        // Cloud config
        if (manifest.cloud) {
          formatter.print(`   Integration:  ${manifest.cloud.integrationId}`);
          formatter.print(`   Key ID:       ${manifest.cloud.keyId}`);
        } else {
          formatter.print(`   Cloud:  not configured`);
          formatter.hint("\n   Run 'clef cloud init --env <environment>' to set up Cloud.");
          return;
        }

        // Environments using cloud backend
        const cloudEnvs = manifest.environments.filter((e) => e.sops?.backend === "cloud");
        const defaultCloud = manifest.sops.default_backend === "cloud";
        if (cloudEnvs.length > 0 || defaultCloud) {
          const envNames = defaultCloud
            ? manifest.environments.map((e) => e.name)
            : cloudEnvs.map((e) => e.name);
          formatter.print(`   Environments: ${envNames.join(", ")}`);
        } else {
          formatter.print(`   Environments: none using cloud backend`);
        }

        // Credentials
        const creds = readCloudCredentials();
        if (creds) {
          formatter.print(`   Auth:         authenticated`);
          formatter.print(`   Endpoint:     ${creds.endpoint}`);
        } else {
          formatter.print(`   Auth:         not authenticated`);
          formatter.hint("   Run 'clef cloud login' to authenticate.");
        }

        // Keyservice binary
        try {
          const ks = resolveKeyservicePath();
          formatter.print(`   Keyservice:   ${ks.source} (${ks.path})`);
        } catch {
          formatter.print(`   Keyservice:   not found`);
          formatter.hint("   Install the cloud package: npm install @clef-sh/cloud");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        formatter.error(message);
        process.exit(1);
      }
    });

  cloud
    .command("init")
    .description("Set up Clef Cloud for an environment.")
    .requiredOption("--env <environment>", "Target environment (e.g., production)")
    .action(async (opts: { env: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        // Pre-checks
        const targetEnv = manifest.environments.find((e) => e.name === opts.env);
        if (!targetEnv) {
          formatter.error(
            `Environment '${opts.env}' not found in clef.yaml. ` +
              `Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
          );
          process.exit(1);
          return;
        }

        if (targetEnv.sops?.backend === "cloud" && manifest.cloud) {
          formatter.info(
            `Environment '${opts.env}' is already using Cloud backend ` +
              `(${manifest.cloud.keyId}). Nothing to do.`,
          );
          return;
        }

        // Verify keyservice binary is available
        let keyservicePath: string;
        try {
          keyservicePath = resolveKeyservicePath().path;
        } catch {
          formatter.error(
            "Keyservice binary not found. Install the cloud package: npm install @clef-sh/cloud",
          );
          process.exit(1);
          return;
        }

        formatter.print(`${sym("clef")}  Clef Cloud\n`);

        // Device flow — auth + payment
        const existingCreds = readCloudCredentials();
        const cloudEndpoint = existingCreds?.endpoint ?? CLOUD_DEFAULT_ENDPOINT;
        formatter.print(`   Endpoint:  ${cloudEndpoint}`);
        formatter.print(
          `   Creds:     ${existingCreds ? `authenticated=${existingCreds.refreshToken ? "yes" : "no"}, endpoint=${existingCreds.endpoint}` : "none"}`,
        );

        let integrationId: string;
        let keyId: string;
        let deviceFlowAccessToken: string | undefined;

        if (existingCreds && existingCreds.refreshToken && manifest.cloud) {
          // Already authenticated and cloud config exists — skip device flow
          integrationId = manifest.cloud.integrationId;
          keyId = manifest.cloud.keyId;
          formatter.print(`   Using existing Cloud integration: ${keyId}`);
        } else {
          formatter.print(`   Opening browser to set up Cloud for ${opts.env}...`);

          const session = await initiateDeviceFlow(cloudEndpoint, {
            repoName: path.basename(repoRoot),
            environment: opts.env,
            clientVersion: deps.cliVersion,
            flow: "setup",
          });

          formatter.print(`   If the browser doesn't open, visit:\n   ${session.loginUrl}\n`);

          await deps.openBrowser(session.loginUrl, runner);
          formatter.print(`   Waiting for authorization... (press Ctrl+C to cancel)`);

          const result = await pollUntilComplete(session.pollUrl);

          if (
            result.status !== "complete" ||
            !result.token ||
            !result.integrationId ||
            !result.keyId
          ) {
            formatter.error(
              result.status === "expired"
                ? "Session expired. Run 'clef cloud init' again."
                : "Setup cancelled.",
            );
            process.exit(1);
            return;
          }

          integrationId = result.integrationId;
          keyId = result.keyId;

          const creds: ClefCloudCredentials = {
            refreshToken: result.token,
            endpoint: existingCreds?.endpoint,
            cognitoDomain: result.cognitoDomain,
            clientId: result.clientId,
          };
          if (result.accessToken && result.accessTokenExpiresIn) {
            creds.accessToken = result.accessToken;
            creds.accessTokenExpiry = Date.now() + result.accessTokenExpiresIn * 1000;
            deviceFlowAccessToken = result.accessToken;
          }
          writeCloudCredentials(creds);
          formatter.success("Authorized");
        }

        formatter.print(`\n   Provisioning Cloud backend for ${opts.env}...`);
        formatter.print(`   ${sym("success")}  KMS key provisioned: ${keyId}`);

        formatter.print(`\n   Migrating ${opts.env} secrets to Cloud backend...`);

        // Build the cloud-enabled manifest in memory — don't write to disk yet
        // so a failed migration can be retried with `clef cloud init` again.
        const cloudManifest = structuredClone(manifest);
        cloudManifest.cloud = { integrationId, keyId };
        const cloudEnv = cloudManifest.environments.find((e) => e.name === opts.env);
        if (cloudEnv) {
          cloudEnv.sops = { backend: "cloud" };
        }

        const matrixManager = new MatrixManager();
        const cells = matrixManager
          .resolveMatrix(manifest, repoRoot)
          .filter((c) => c.environment === opts.env && c.exists);

        if (cells.length === 0) {
          formatter.print(`   No encrypted files found for ${opts.env}.`);
        } else {
          const ageSopsClient = await deps.createSopsClient(repoRoot, runner);
          const { accessToken, endpoint: ksEndpoint } = deviceFlowAccessToken
            ? { accessToken: deviceFlowAccessToken, endpoint: cloudEndpoint }
            : await resolveAccessToken();

          const ksHandle = await spawnKeyservice({
            binaryPath: keyservicePath,
            token: accessToken,
            endpoint: ksEndpoint,
          });

          try {
            const cloudSopsClient = await deps.createSopsClient(repoRoot, runner, ksHandle.addr);

            for (const cell of cells) {
              const decrypted = await ageSopsClient.decrypt(cell.filePath);
              await cloudSopsClient.encrypt(
                cell.filePath,
                decrypted.values,
                cloudManifest,
                cell.environment,
              );
              const relPath = path.relative(repoRoot, cell.filePath);
              formatter.print(`   ${sym("success")}  ${relPath}`);
            }

            formatter.print(`\n   Verifying encrypted files...`);
            for (const cell of cells) {
              await cloudSopsClient.decrypt(cell.filePath);
              const relPath = path.relative(repoRoot, cell.filePath);
              formatter.print(`   ${sym("success")}  ${relPath}`);
            }
          } finally {
            await ksHandle.kill();
          }
        }

        // Migration succeeded — now persist the manifest changes
        const rawManifest = readManifestYaml(repoRoot);
        rawManifest.cloud = { integrationId, keyId };
        const envs = rawManifest.environments as Array<Record<string, unknown>>;
        const targetRawEnv = envs.find((e) => e.name === opts.env);
        if (targetRawEnv) {
          targetRawEnv.sops = { backend: "cloud" };
        }
        writeManifestYaml(repoRoot, rawManifest);

        formatter.print(`\n   ${sym("success")}  Cloud setup complete.\n`);
        formatter.print(`   Your ${opts.env} environment now uses Clef Cloud for encryption.`);
        formatter.print(`   Other environments continue to use age keys locally.\n`);
        formatter.hint("   Commit your changes: git add clef.yaml && git commit");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        formatter.error(message);
        process.exit(1);
      }
    });

  cloud
    .command("login")
    .description("Authenticate with Clef Cloud.")
    .action(async () => {
      try {
        formatter.print(`${sym("clef")}  Clef Cloud\n`);

        const existingCreds = readCloudCredentials();
        const endpoint = existingCreds?.endpoint;

        const session = await initiateDeviceFlow(endpoint, {
          repoName: path.basename(process.cwd()),
          clientVersion: deps.cliVersion,
          flow: "login",
        });

        formatter.print(`   Opening browser to log in...`);
        formatter.print(`   If the browser doesn't open, visit:\n   ${session.loginUrl}\n`);

        const opened = await deps.openBrowser(session.loginUrl, runner);
        if (!opened) {
          formatter.warn("Could not open browser automatically. Visit the URL above.");
        }

        formatter.print(`   Waiting for authorization... (press Ctrl+C to cancel)`);

        const result = await pollUntilComplete(session.pollUrl);

        if (result.status === "expired") {
          formatter.error("Session expired. Run 'clef cloud login' again.");
          process.exit(1);
          return;
        }
        if (result.status === "cancelled") {
          formatter.info("Login cancelled.");
          return;
        }

        if (result.token) {
          const creds: ClefCloudCredentials = {
            refreshToken: result.token,
            endpoint,
            cognitoDomain: result.cognitoDomain,
            clientId: result.clientId,
          };
          if (result.accessToken && result.accessTokenExpiresIn) {
            creds.accessToken = result.accessToken;
            creds.accessTokenExpiry = Date.now() + result.accessTokenExpiresIn * 1000;
          }
          writeCloudCredentials(creds);
          formatter.success("Logged in. Credentials saved to ~/.clef/credentials.yaml");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        formatter.error(message);
        process.exit(1);
      }
    });
}

async function pollUntilComplete(pollUrl: string): Promise<DevicePollResult> {
  for (;;) {
    const result = await pollDeviceFlow(pollUrl);
    if (
      result.status === "complete" ||
      result.status === "expired" ||
      result.status === "cancelled"
    ) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
