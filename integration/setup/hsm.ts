/**
 * SoftHSM2 fixture for HSM-backend integration tests.
 *
 * Provisions a throwaway PKCS#11 token, generates an RSA-2048 wrap keypair,
 * and returns the artifacts needed to drive `clef set / get / rotate` end
 * to end against a real `clef-keyservice` sidecar.
 *
 * Tests that consume this MUST call `setupSoftHsm()` from a `beforeAll`
 * and check the returned `available` flag — when SoftHSM2 / pkcs11-tool
 * aren't installed, or the keyservice binary can't be located, the helper
 * returns `{ available: false, reason }` and the test should `it.skip`.
 *
 * Note on SHA-1: SoftHSM2 (Homebrew 2.7.0 against OpenSSL 3) rejects
 * SHA-256 OAEP with CKR_ARGUMENTS_BAD; SHA-1 works. We pin `hash=sha1`
 * in fixture URIs. Production HSMs (CloudHSM, YubiHSM2, Luna) use the
 * sha256 default and don't have this bug — see the keyservice repo's
 * integration_test.go for the authoritative note.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

export interface HsmFixture {
  available: true;
  /** PKCS#11 URI to put in the manifest's `pkcs11_uri` field. */
  pkcs11Uri: string;
  /** Path to the SoftHSM2 module (libsofthsm2.so). */
  modulePath: string;
  /** User PIN for the test token. */
  pin: string;
  /** Path to the resolved clef-keyservice binary. */
  keyservicePath: string;
  /** Env vars that callers must forward to every clef invocation (SOFTHSM2_CONF). */
  extraEnv: Record<string, string>;
  /** Tear down the temp tokendir. */
  cleanup: () => void;
}

export interface HsmFixtureUnavailable {
  available: false;
  reason: string;
}

const SOFTHSM_MODULE_CANDIDATES = [
  // macOS Homebrew
  "/opt/homebrew/lib/softhsm/libsofthsm2.so",
  "/usr/local/lib/softhsm/libsofthsm2.so",
  // Linux distro packages
  "/usr/lib/softhsm/libsofthsm2.so",
  "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so",
  "/usr/lib/aarch64-linux-gnu/softhsm/libsofthsm2.so",
  "/usr/lib64/softhsm/libsofthsm2.so",
];

function findSoftHsmModule(): string | null {
  return SOFTHSM_MODULE_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function findOnPath(name: string): string | null {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [name], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the keyservice binary the same way the CLI does: env override,
 * then bundled platform package, then PATH. Returns null on failure so the
 * caller can skip cleanly.
 */
function resolveKeyserviceBinary(): string | null {
  const envPath = process.env.CLEF_KEYSERVICE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Bundled package (mirrors core/src/hsm/bundled.ts logic).
  const archName = process.arch === "x64" || process.arch === "arm64" ? process.arch : null;
  const platformName =
    process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  if (archName && platformName) {
    try {
      const main = require.resolve(`@clef-sh/keyservice-${platformName}-${archName}/package.json`);
      const candidate = path.join(path.dirname(main), "bin", "clef-keyservice");
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // not installed
    }
  }

  return findOnPath("clef-keyservice");
}

/**
 * Provision a SoftHSM2 token + RSA-2048 wrap keypair in a throwaway directory.
 * Returns either a fully-resolved fixture or an unavailable marker — never throws
 * on missing prerequisites (so callers can branch instead of crashing the suite).
 */
export function setupSoftHsm(): HsmFixture | HsmFixtureUnavailable {
  if (process.platform === "win32") {
    return { available: false, reason: "HSM backend is not supported on Windows" };
  }

  const modulePath = findSoftHsmModule();
  if (!modulePath) {
    return {
      available: false,
      reason: `libsofthsm2.so not found in any of: ${SOFTHSM_MODULE_CANDIDATES.join(", ")}`,
    };
  }
  if (!findOnPath("softhsm2-util")) {
    return { available: false, reason: "softhsm2-util not on PATH" };
  }
  if (!findOnPath("pkcs11-tool")) {
    return { available: false, reason: "pkcs11-tool (OpenSC) not on PATH" };
  }
  const keyservicePath = resolveKeyserviceBinary();
  if (!keyservicePath) {
    return {
      available: false,
      reason:
        "clef-keyservice binary not found. Set CLEF_KEYSERVICE_PATH, install " +
        "@clef-sh/keyservice-{platform}-{arch}, or place clef-keyservice on PATH.",
    };
  }

  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-softhsm-"));
  const confPath = path.join(tokenDir, "softhsm2.conf");
  fs.writeFileSync(
    confPath,
    `directories.tokendir = ${tokenDir}\nobjectstore.backend = file\nlog.level = ERROR\n`,
    { mode: 0o600 },
  );

  const env = { ...process.env, SOFTHSM2_CONF: confPath };
  const tokenLabel = "clef-test";
  const pin = "1234";
  const keyLabel = "clef-dek-wrapper";

  execFileSync(
    "softhsm2-util",
    ["--init-token", "--free", "--label", tokenLabel, "--pin", pin, "--so-pin", pin],
    { env, stdio: "pipe" },
  );

  // Find the slot id for the token we just initialized. SoftHSM2 assigns
  // a fresh slot id on init, so labels are the only stable reference.
  const slotsOutput = execFileSync("softhsm2-util", ["--show-slots"], {
    env,
    encoding: "utf-8",
  });
  const slotId = parseFirstSlotForLabel(slotsOutput, tokenLabel);
  if (slotId === null) {
    fs.rmSync(tokenDir, { recursive: true, force: true });
    throw new Error(`Could not find SoftHSM2 slot for label '${tokenLabel}':\n${slotsOutput}`);
  }

  execFileSync(
    "pkcs11-tool",
    [
      "--module",
      modulePath,
      "--login",
      "--pin",
      pin,
      "--slot",
      String(slotId),
      "--keypairgen",
      "--key-type",
      "rsa:2048",
      "--label",
      keyLabel,
      "--id",
      "01",
    ],
    { env, stdio: "pipe" },
  );

  return {
    available: true,
    pkcs11Uri: `pkcs11:slot=${slotId};label=${keyLabel};hash=sha1`,
    modulePath,
    pin,
    keyservicePath,
    extraEnv: { SOFTHSM2_CONF: confPath },
    cleanup: () => {
      try {
        fs.rmSync(tokenDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

const SLOT_RE = /^Slot\s+(\d+)/gm;

function parseFirstSlotForLabel(output: string, label: string): number | null {
  // Walk each "Slot <n>" block and check its Label line.
  const matches = [...output.matchAll(SLOT_RE)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? output.length) : output.length;
    const block = output.slice(start, end);
    if (block.includes(`Label:            ${label}`) || block.includes(`Label: ${label}`)) {
      return parseInt(matches[i][1], 10);
    }
  }
  return null;
}
