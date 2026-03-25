/**
 * Build-time data loader for the index page broker catalog.
 * Walks ../brokers/ and reads each broker.yaml for summary data.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BrokerSummary {
  name: string;
  description: string;
  provider: string;
  tier: number;
  version: string;
  author: string;
  license: string;
  outputKeys: string[];
}

declare const data: BrokerSummary[];
export { data };

export default {
  watch: ["../../brokers/**/broker.yaml"],
  load(): BrokerSummary[] {
    const brokersRoot = path.resolve(__dirname, "../../brokers");
    const brokers: BrokerSummary[] = [];

    if (!fs.existsSync(brokersRoot)) return brokers;

    const providers = fs.readdirSync(brokersRoot).filter((entry) => {
      const fullPath = path.join(brokersRoot, entry);
      return fs.statSync(fullPath).isDirectory() && !entry.startsWith(".");
    });

    for (const provider of providers) {
      const providerDir = path.join(brokersRoot, provider);
      const entries = fs.readdirSync(providerDir).filter((entry) => {
        return fs.statSync(path.join(providerDir, entry)).isDirectory();
      });

      for (const entry of entries) {
        const manifestPath = path.join(providerDir, entry, "broker.yaml");
        if (!fs.existsSync(manifestPath)) continue;

        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = parseYaml(raw);

        brokers.push({
          name: manifest.name,
          description: manifest.description,
          provider: manifest.provider,
          tier: Number(manifest.tier),
          version: manifest.version,
          author: manifest.author,
          license: manifest.license,
          outputKeys: manifest.output?.keys ?? [],
        });
      }
    }

    return brokers.sort((a, b) => a.name.localeCompare(b.name));
  },
};
