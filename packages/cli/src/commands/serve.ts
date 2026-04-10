import * as path from "path";
import { randomBytes } from "crypto";
import { Command } from "commander";
import {
  ManifestParser,
  SubprocessRunner,
  MatrixManager,
  ArtifactPacker,
  MemoryPackOutput,
  generateAgeIdentity,
} from "@clef-sh/core";
import type { ClefManifest } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { createSopsClient } from "../age-credential";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

/**
 * Build a synthetic manifest where the target SI's environment uses an
 * ephemeral age recipient. This lets the local serve process decrypt the
 * packed artifact without needing the production SI's private key (or KMS
 * access for the SI envelope). The user's existing creds are still used to
 * decrypt the source matrix files.
 */
function synthesizeDevManifest(
  manifest: ClefManifest,
  identityName: string,
  envName: string,
  ephemeralPublicKey: string,
): ClefManifest {
  return {
    ...manifest,
    service_identities: manifest.service_identities?.map((si) =>
      si.name === identityName
        ? {
            ...si,
            environments: {
              ...si.environments,
              [envName]: { recipient: ephemeralPublicKey },
            },
          }
        : si,
    ),
  };
}

export function registerServeCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("serve")
    .description(
      "Start a local secrets server for development.\n\n" +
        "  Packs and decrypts the specified service identity, then serves secrets\n" +
        "  at GET /v1/secrets — the same contract as the Clef agent and Cloud serve\n" +
        "  endpoint. Your app code works identically in local dev and production.\n\n" +
        "Usage:\n" +
        "  clef serve --identity api-gateway --env dev\n" +
        "  clef serve --identity api-gateway --env dev --port 7779",
    )
    .requiredOption("-i, --identity <name>", "Service identity to serve")
    .requiredOption("-e, --env <environment>", "Environment to serve")
    .option("-p, --port <port>", "Port to listen on", "7779")
    .action(async (opts: { identity: string; env: string; port: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        // Validate environment exists
        const env = manifest.environments.find((e) => e.name === opts.env);
        if (!env) {
          formatter.error(`Environment '${opts.env}' not found in manifest.`);
          process.exit(1);
          return;
        }

        // Refuse protected environments
        if (env.protected) {
          formatter.error(
            `Cannot serve protected environment '${opts.env}' locally.\n` +
              "  Use Clef Cloud for production secrets: clef cloud init --env production",
          );
          process.exit(1);
          return;
        }

        // Validate identity exists
        const si = manifest.service_identities?.find((s) => s.name === opts.identity);
        if (!si) {
          formatter.error(
            `Service identity '${opts.identity}' not found in manifest.\n` +
              "  Available identities: " +
              (manifest.service_identities?.map((s) => s.name).join(", ") || "(none)"),
          );
          process.exit(1);
          return;
        }

        // Validate port
        const port = parseInt(opts.port, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          formatter.error("--port must be a number between 1 and 65535.");
          process.exit(1);
          return;
        }

        formatter.print(`${sym("working")}  Packing '${opts.identity}/${opts.env}'...`);

        // Generate an ephemeral age keypair for this serve session.
        // The local artifact envelope is encrypted to this key so the user
        // doesn't need the production SI's private key (or KMS access for
        // the SI envelope). The ephemeral key never touches disk.
        const ephemeral = await generateAgeIdentity();

        // Synthesize a manifest where the target SI's environment uses the
        // ephemeral recipient. The user's sopsClient still decrypts the
        // source matrix files using their normal creds (age or KMS).
        const devManifest = synthesizeDevManifest(
          manifest,
          opts.identity,
          opts.env,
          ephemeral.publicKey,
        );

        // Pack in memory
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const matrixManager = new MatrixManager();

        const memOutput = new MemoryPackOutput();
        const packer = new ArtifactPacker(sopsClient, matrixManager);
        const result = await packer.pack(
          { identity: opts.identity, environment: opts.env, output: memOutput },
          devManifest,
          repoRoot,
        );

        if (!memOutput.artifact) {
          formatter.error("Pack produced no artifact.");
          process.exit(1);
          return;
        }

        // Decrypt the artifact with the ephemeral private key
        const { ArtifactDecryptor } = await import("@clef-sh/runtime");
        const decryptor = new ArtifactDecryptor({ privateKey: ephemeral.privateKey });
        const decrypted = await decryptor.decrypt(memOutput.artifact);

        // Load into cache
        const { SecretsCache } = await import("@clef-sh/runtime");
        const cache = new SecretsCache();
        cache.swap(decrypted.values, decrypted.keys, decrypted.revision);

        // Start server
        const token = randomBytes(32).toString("hex");
        const { startAgentServer } = await import("@clef-sh/agent");
        const server = await startAgentServer({ port, token, cache });

        formatter.warn(
          "DEVELOPMENT ONLY\n" +
            "  This server packs secrets locally with an ephemeral age key.\n" +
            "  Do NOT use this in production. For production, deploy the Clef\n" +
            "  agent with the service identity's actual private key or KMS access.",
        );

        formatter.success(`Serving ${result.keyCount} secrets for '${opts.identity}/${opts.env}'`);
        formatter.print(`\n  URL:      ${server.url}/v1/secrets`);
        formatter.print(`  Token:    ${token}`);
        formatter.print(
          `  Secrets:  ${result.keyCount} keys from ${result.namespaceCount} namespace(s)`,
        );
        formatter.print(`  Revision: ${result.revision}`);
        formatter.print(`\n  Example:`);
        formatter.print(`    curl -H "Authorization: Bearer ${token}" ${server.url}/v1/secrets`);
        formatter.print(`\n  Press Ctrl+C to stop.\n`);

        // Block until SIGINT/SIGTERM
        await new Promise<void>((resolve) => {
          const shutdown = async () => {
            formatter.print(`\n${sym("working")}  Stopping server...`);
            cache.wipe();
            // Wipe ephemeral private key from memory
            ephemeral.privateKey = "";
            await server.stop();
            resolve();
          };
          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        });
      } catch (err) {
        handleCommandError(err);
      }
    });
}
