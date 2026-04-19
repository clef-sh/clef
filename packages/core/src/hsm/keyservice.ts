/**
 * Manages the `clef-keyservice` sidecar lifecycle: spawn, port discovery,
 * graceful shutdown. The keyservice is a localhost gRPC server that
 * implements the SOPS KeyService protocol and bridges DEK wrap/unwrap to
 * a hardware security module via PKCS#11.
 *
 * The CLI spawns one sidecar per SOPS-touching command and kills it
 * when done. The sidecar binds 127.0.0.1:0 (random port), prints
 * `PORT=<port>` to stdout once listening, and we forward that port
 * to SOPS via `--keyservice tcp://127.0.0.1:<port>`.
 *
 * Security notes:
 * - PIN is passed via env (`CLEF_PKCS11_PIN`) or env-file path
 *   (`CLEF_PKCS11_PIN_FILE`). NEVER on argv — process command lines
 *   are world-readable in `/proc/<pid>/cmdline` on Linux.
 * - Module path IS passed on argv (`--pkcs11-module`). It is not
 *   sensitive; vendor module locations are well-known constants.
 */
import { spawn, type ChildProcess } from "child_process";
import * as readline from "readline";

export interface KeyserviceHandle {
  /** Address for SOPS `--keyservice` flag, e.g. `tcp://127.0.0.1:12345`. */
  addr: string;
  /** Gracefully stop the keyservice process. SIGTERM, then SIGKILL after 3s. */
  kill(): Promise<void>;
}

export interface SpawnKeyserviceOptions {
  /** Absolute path to the clef-keyservice binary (from {@link resolveKeyservicePath}). */
  binaryPath: string;
  /** Path to the vendor PKCS#11 shared library (e.g. `/usr/lib/softhsm/libsofthsm2.so`). */
  modulePath: string;
  /**
   * HSM user PIN. Passed via `CLEF_PKCS11_PIN` env. Mutually exclusive
   * with {@link pinFile}. At least one must be provided.
   */
  pin?: string;
  /**
   * Path to a 0600 file containing the user PIN. Passed via
   * `CLEF_PKCS11_PIN_FILE` env. The keyservice reads the file itself.
   */
  pinFile?: string;
  /**
   * Extra environment variables to pass through. Vendor modules often
   * need their own config env (`SOFTHSM2_CONF`, `YUBIHSM_PKCS11_CONF`,
   * `ChrystokiConfigurationPath`). Forwarded verbatim.
   */
  extraEnv?: Record<string, string>;
}

const PORT_REGEX = /^PORT=(\d+)$/;
const STARTUP_TIMEOUT_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * Spawn a clef-keyservice sidecar and wait for it to report its port.
 *
 * @throws If neither `pin` nor `pinFile` is provided, if startup exceeds
 *   {@link STARTUP_TIMEOUT_MS}, or if the child exits before reporting `PORT=`.
 */
export async function spawnKeyservice(options: SpawnKeyserviceOptions): Promise<KeyserviceHandle> {
  if (!options.pin && !options.pinFile) {
    throw new Error(
      "Keyservice requires a PIN. Set CLEF_PKCS11_PIN, CLEF_PKCS11_PIN_FILE, " +
        "or .clef/config.yaml pkcs11_pin_file.",
    );
  }

  const args = ["--addr", "127.0.0.1:0", "--pkcs11-module", options.modulePath];

  // Build env: parent env + extras + PIN. Spread order matters — PIN
  // wins so a stale extraEnv entry can't shadow it.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.extraEnv ?? {}),
    ...(options.pin ? { CLEF_PKCS11_PIN: options.pin } : {}),
    ...(options.pinFile ? { CLEF_PKCS11_PIN_FILE: options.pinFile } : {}),
  };

  const child = spawn(options.binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });

  const port = await readPort(child);
  return {
    addr: `tcp://127.0.0.1:${port}`,
    kill: () => killGracefully(child),
  };
}

function readPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    // The child should be spawned with stdio[1]="pipe", so stdout is set.
    // Guard the assertion anyway so a misuse in tests fails clearly.
    if (!child.stdout) {
      reject(new Error("Keyservice child has no stdout pipe."));
      return;
    }
    const rl = readline.createInterface({ input: child.stdout });

    const settle = (): void => {
      clearTimeout(timer);
      rl.close();
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        settle();
        child.kill("SIGKILL");
        reject(
          new Error(
            `clef-keyservice did not report a port within ${STARTUP_TIMEOUT_MS}ms. ` +
              "Check that the PKCS#11 module path is valid and the PIN is correct.",
          ),
        );
      }
    }, STARTUP_TIMEOUT_MS);

    rl.on("line", (line) => {
      const match = PORT_REGEX.exec(line);
      if (match && !settled) {
        settled = true;
        settle();
        resolve(parseInt(match[1], 10));
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        settle();
        reject(new Error(`Failed to start clef-keyservice: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        settle();
        reject(new Error(`clef-keyservice exited with code ${code} before reporting a port.`));
      }
    });
  });
}

function killGracefully(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, SHUTDOWN_TIMEOUT_MS);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
