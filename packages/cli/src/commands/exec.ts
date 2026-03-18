import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  ConsumptionClient,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { createSopsClient } from "../age-credential";

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function registerExecCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("exec <target>")
    .description(
      "Run a command with decrypted secrets injected as environment variables.\n\n" +
        "  target: namespace/environment (e.g. payments/production)\n\n" +
        "Everything after -- is the command to run:\n" +
        "  clef exec payments/production -- node server.js\n\n" +
        "Exit codes:\n" +
        "  The exit code matches the child process exactly.\n" +
        "  1  if Clef itself fails (decryption error, bad arguments)",
    )
    .option("--only <keys>", "Comma-separated list of keys to inject (ignores all others)")
    .option("--prefix <string>", "Prefix all injected key names (e.g. --prefix APP_)")
    .option("--no-override", "Do not override existing environment variables")
    .option(
      "--also <target>",
      "Also inject secrets from another namespace/environment (repeatable)",
      collect,
      [],
    )
    .allowUnknownOption(true)
    .action(
      async (
        target: string,
        options: { only?: string; prefix?: string; override: boolean; also: string[] },
      ) => {
        try {
          // Parse everything after -- as the child command.
          // This relies on Commander.js preserving -- in process.argv unmodified.
          const dashIndex = process.argv.indexOf("--");

          if (dashIndex === -1) {
            formatter.error(
              "Missing command to execute. Use -- to separate the command:\n\n" +
                "  clef exec payments/production -- node server.js\n\n" +
                "The -- separator is required to distinguish Clef flags from the child command.",
            );
            process.exit(1);
            return;
          }

          const childArgs = process.argv.slice(dashIndex + 1);

          if (childArgs.length === 0) {
            formatter.error(
              "Missing command to execute after --.\n\n" +
                "  clef exec payments/production -- node server.js",
            );
            process.exit(1);
            return;
          }

          const [namespace, environment] = parseTarget(target);
          const repoRoot = (program.opts().dir as string) || process.cwd();

          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          // Warn on protected environments (but do not block)
          const envDef = manifest.environments.find((e) => e.name === environment);
          if (envDef?.protected) {
            formatter.warn(`Executing in protected environment '${environment}'.`);
          }

          const sopsClient = await createSopsClient(repoRoot, deps.runner);

          // Decrypt primary target
          const primaryFilePath = path.join(
            repoRoot,
            manifest.file_pattern
              .replace("{namespace}", namespace)
              .replace("{environment}", environment),
          );
          const primaryDecrypted = await sopsClient.decrypt(primaryFilePath);

          // Merge values: primary first, then --also targets in order (later overrides earlier)
          const mergedValues = { ...primaryDecrypted.values };

          for (const alsoTarget of options.also) {
            try {
              const [alsoNs, alsoEnv] = parseTarget(alsoTarget);
              const alsoFilePath = path.join(
                repoRoot,
                manifest.file_pattern
                  .replace("{namespace}", alsoNs)
                  .replace("{environment}", alsoEnv),
              );
              const alsoDecrypted = await sopsClient.decrypt(alsoFilePath);
              for (const key of Object.keys(alsoDecrypted.values)) {
                if (key in mergedValues) {
                  if (!options.override) continue;
                  formatter.warn(
                    `--also '${alsoTarget}' overrides key '${key}' from a previous source.`,
                  );
                }
                mergedValues[key] = alsoDecrypted.values[key];
              }
            } catch (err) {
              throw new Error(
                `Failed to decrypt --also '${alsoTarget}': ${(err as Error).message}`,
              );
            }
          }

          const consumption = new ConsumptionClient();
          const execOptions = {
            only: options.only ? options.only.split(",").map((k) => k.trim()) : undefined,
            prefix: options.prefix,
            noOverride: !options.override,
          };

          const childEnv = consumption.prepareEnvironment(
            { values: mergedValues, metadata: primaryDecrypted.metadata },
            process.env as Record<string, string | undefined>,
            execOptions,
          );

          // Spawn child process with inherited stdio — values injected via env, never via shell
          const childCommand = childArgs[0];
          const childCommandArgs = childArgs.slice(1);

          const exitCode = await spawnChild(childCommand, childCommandArgs, childEnv);
          process.exit(exitCode);
        } catch (err) {
          if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
            formatter.formatDependencyError(err);
            process.exit(1);
            return;
          }
          // Never leak decrypted values in error messages
          const message = err instanceof Error ? err.message : "Execution failed";
          formatter.error(message);
          process.exit(1);
        }
      },
    );
}

function spawnChild(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        env,
        stdio: "inherit",
      });
    } catch {
      formatter.error(`Failed to start command '${command}'. Ensure it exists and is executable.`);
      resolve(1);
      return;
    }

    child.on("error", () => {
      formatter.error(`Failed to start command '${command}'. Ensure it exists and is executable.`);
      resolve(1);
    });

    child.on("exit", (code, signal) => {
      // Clean up signal handlers
      process.off("SIGTERM", sigtermHandler);
      process.off("SIGINT", sigintHandler);

      if (signal) {
        // Process was killed by a signal — map to conventional exit code
        const signalCodes: Record<string, number> = {
          SIGHUP: 129,
          SIGINT: 130,
          SIGTERM: 143,
        };
        resolve(signalCodes[signal] ?? 128);
      } else {
        resolve(code ?? 1);
      }
    });

    // Forward signals to child with SIGKILL fallback.
    // On Windows, the child already receives CTRL_C_EVENT directly from the
    // shared console group, so forwarding is a no-op — calling child.kill()
    // would invoke TerminateProcess() and force-kill the child before it can
    // run its own cleanup handlers.
    const sigtermHandler = () => {
      if (process.platform === "win32") return;
      child.kill("SIGTERM");
      // Give child 5s to clean up, then force kill
      /* istanbul ignore next -- timer callback only fires if child hangs; not testable without real timers */
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };
    const sigintHandler = () => {
      if (process.platform === "win32") return;
      child.kill("SIGINT");
    };

    process.on("SIGTERM", sigtermHandler);
    process.on("SIGINT", sigintHandler);
  });
}

function parseTarget(target: string): [string, string] {
  const parts = target.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid target "${target}". Expected format: namespace/environment`);
  }
  return [parts[0], parts[1]];
}
