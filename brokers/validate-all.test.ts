/**
 * Validates all official brokers against the broker contract.
 *
 * Run: npx jest --config brokers/jest.config.js
 */
import * as path from "path";
import * as fs from "fs";
import { parse as parseYaml } from "yaml";
import { validateBroker, formatResults } from "@clef-sh/broker";

const BROKERS_DIR = path.resolve(__dirname);

/** Discover all broker directories (two levels: provider/name). */
function discoverBrokers(): { name: string; dir: string }[] {
  const brokers: { name: string; dir: string }[] = [];
  const providers = fs.readdirSync(BROKERS_DIR).filter((entry) => {
    const fullPath = path.join(BROKERS_DIR, entry);
    return fs.statSync(fullPath).isDirectory() && !entry.startsWith(".");
  });

  for (const provider of providers) {
    const providerDir = path.join(BROKERS_DIR, provider);
    const entries = fs.readdirSync(providerDir).filter((entry) => {
      return fs.statSync(path.join(providerDir, entry)).isDirectory();
    });
    for (const entry of entries) {
      brokers.push({ name: `${provider}/${entry}`, dir: path.join(providerDir, entry) });
    }
  }
  return brokers;
}

const brokers = discoverBrokers();

describe("official brokers validation", () => {
  it("discovers at least 4 brokers", () => {
    expect(brokers.length).toBeGreaterThanOrEqual(4);
  });

  for (const { name, dir } of brokers) {
    describe(name, () => {
      it("passes all validation checks", () => {
        const result = validateBroker(dir);

        if (!result.passed) {
          // Fail with the full report for debugging
          throw new Error(`\n${name}:\n${formatResults(result)}`);
        }

        expect(result.passed).toBe(true);
      });

      it("has broker.yaml with correct name", () => {
        const raw = fs.readFileSync(path.join(dir, "broker.yaml"), "utf-8");
        const manifest = parseYaml(raw);
        // Name should match the directory name (last segment)
        expect(manifest.name).toBe(path.basename(dir));
      });
    });
  }
});
